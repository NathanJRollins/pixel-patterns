import { signal } from "@preact/signals";
import {
  clearPattern,
  clonePattern,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  decodePattern,
  emptyPattern,
  encodePattern,
  fillPattern,
  patternsEqual,
  resizePattern,
  setCell,
} from "../domain/pattern.js";
import { cellAlpha01, cellToHex, hexToCell, packRGBA, unpackRGBA } from "../domain/color.js";
import { History } from "../domain/history.js";
import { bridgeLine } from "../domain/tools.js";
import { mirrorCell } from "../domain/mirror.js";
import { randomPattern, RANDOMIZE_DEFAULT_MODE } from "../domain/randomize.js";
import { PRESETS } from "../domain/presets.js";
import { invalidationToken } from "./persistence.js";
import { shareUrlEncode, shareUrlDecode } from "./share-url.js";
import { superTileCanvas } from "../render/super-tile-canvas.js";
import type { Cell, MirrorMode, Pattern, Theme, Tool } from "../domain/types.js";

/**
 * Central signals-based store.
 *
 * All UI mutation goes through the action methods exported here — they
 * update the relevant signals and trigger downstream side-effects
 * (autosave, history push, render invalidations).
 *
 * History: snapshots are taken at the *start* of each stroke (before a
 * mutating tool fires); undo/redo swap the current pattern back/forward.
 */

const DEFAULT_HEX = "#cc33cc"; // callback to original default color
const DEFAULT_RECENT_MAX = 12;

export interface Savestate {
  pattern: string; // encoded
  mirrorMode: MirrorMode;
  tool: Tool;
  hex: string;
  alpha01: number;
  recentCells: number[];
  previewCellScale: number;
  bgScale: number;
  showPageBg: boolean;
  showGridLines: boolean;
  showMirrorAxis: boolean;
  theme: Theme;
  saveEnabled: boolean;
  slots: SlotSerialized[];
}

export interface SlotSerialized {
  name: string;
  createdAt: number;
  thumb: string; // dataURL
  pattern: string; // encoded
  mirrorMode: MirrorMode;
}

function makeDefaultColor(): Cell {
  return hexToCell(DEFAULT_HEX, 1);
}

function makeDefaultPattern(): Pattern {
  return emptyPattern(DEFAULT_WIDTH, DEFAULT_HEIGHT);
}

class Store {
  pattern = signal<Pattern>(makeDefaultPattern());
  mirrorMode = signal<MirrorMode>(RANDOMIZE_DEFAULT_MODE); // `HV` by default
  tool = signal<Tool>("pencil");
  color = signal<Cell>(makeDefaultColor());
  alpha01 = signal<number>(1);
  recentCells = signal<Cell[]>([]);

  previewCellScale = signal<number>(8);
  bgScale = signal<number>(4);
  showPageBg = signal<boolean>(true);
  showGridLines = signal<boolean>(true);
  showMirrorAxis = signal<boolean>(true);
  theme = signal<Theme>("dark");
  saveEnabled = signal<boolean>(true);

  slots = signal<SlotSerialized[]>([]);

  /** Transient: is a pointer stroke in progress? */
  strokeActive = signal<boolean>(false);
  hover = signal<{ x: number; y: number } | null>(null);

  history = new History();

  /** Bumped on every pattern mutation. Render effects listen. */
  rev = signal<number>(0);

  /** Reload suggestion fired by persistence after an external load. */
  externalReload = invalidationToken;

  // ---------------------------------------------------------------------------
  // Color
  // ---------------------------------------------------------------------------

  setHex(hex: string): void {
    this.color.value = hexToCell(hex, this.alpha01.value);
    this.bumpRecent();
  }

  setAlpha01(a: number): void {
    this.alpha01.value = a;
    const [r, g, b] = unpackRGBA(this.color.value || makeDefaultColor());
    this.color.value = packRGBA(r, g, b, Math.round(a * 255));
  }

  pickColor(cell: Cell): void {
    if (cell === 0) {
      this.color.value = makeDefaultColor();
      this.alpha01.value = 1;
    } else {
      this.color.value = cell;
      this.alpha01.value = cellAlpha01(cell);
    }
    this.bumpRecent();
  }

  private bumpRecent(): void {
    const c = this.color.value;
    if (c === 0) return;
    const list = this.recentCells.value.slice();
    const idx = list.findIndex((x) => x === c);
    if (idx === 0) return;
    if (idx > 0) list.splice(idx, 1);
    list.unshift(c);
    if (list.length > DEFAULT_RECENT_MAX) list.length = DEFAULT_RECENT_MAX;
    this.recentCells.value = list;
  }

  // ---------------------------------------------------------------------------
  // Mirror / dimension / view settings
  // ---------------------------------------------------------------------------

  setMirrorMode(m: MirrorMode): void {
    this.mirrorMode.value = m;
  }
  setTool(t: Tool): void {
    this.tool.value = t;
  }
  setPreviewCellScale(n: number): void {
    this.previewCellScale.value = Math.max(1, Math.min(64, Math.round(n)));
  }
  setBgScale(n: number): void {
    this.bgScale.value = Math.max(1, Math.min(64, Math.round(n)));
  }
  setShowPageBg(b: boolean): void {
    this.showPageBg.value = b;
  }
  setShowGridLines(b: boolean): void {
    this.showGridLines.value = b;
  }
  setShowMirrorAxis(b: boolean): void {
    this.showMirrorAxis.value = b;
  }
  setTheme(t: Theme): void {
    this.theme.value = t;
    document.body.dataset["theme"] = t;
  }
  setSaveEnabled(b: boolean): void {
    this.saveEnabled.value = b;
  }

  setDimensions(w: number, h: number): void {
    if (w === this.pattern.value.width && h === this.pattern.value.height) return;
    this.history.push(this.pattern.value);
    this.pattern.value = resizePattern(this.pattern.value, w, h);
    this.bumpRev();
  }

  // ---------------------------------------------------------------------------
  // Pattern mutations (tools)
  // ---------------------------------------------------------------------------

  beginStroke(): void {
    if (this.strokeActive.value) return;
    this.strokeActive.value = true;
    this.history.push(this.pattern.value);
  }

  paintAt(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.pattern.value.width || y >= this.pattern.value.height) return;
    const tool = this.tool.value;
    if (tool === "dropper") {
      this.pickColor(this.pattern.value.cells[y * this.pattern.value.width + x]);
      return;
    }
    const c = tool === "eraser" ? 0 : this.color.value;
    this.applyCells([[x, y]], c);
  }

  /** Bridge from previous pointer position to current, hitting every cell
   * via Bresenham along the way. Mirroring handled at the cell level. */
  paintLine(x0: number, y0: number, x1: number, y1: number): void {
    if (this.tool.value === "dropper") {
      this.paintAt(x1, y1);
      return;
    }
    const c = this.tool.value === "eraser" ? 0 : this.color.value;
    const hits = bridgeLine(
      x0, y0, x1, y1,
      this.pattern.value.width,
      this.pattern.value.height,
      this.mirrorMode.value,
    );
    this.applyCells(hits, c);
  }

  bucketFillAt(x: number, y: number): void {
    if (this.tool.value !== "bucket") return;
    this.beginStroke();
    const p = this.pattern.value;
    if (x < 0 || y < 0 || x >= p.width || y >= p.height) return;
    const target = p.cells[y * p.width + x];
    const color = this.color.value;
    if (target === color) return;
    const stack: Array<[number, number]> = [[x, y]];
    const visited = new Uint8Array(p.width * p.height);
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      if (cx < 0 || cy < 0 || cx >= p.width || cy >= p.height) continue;
      const idx = cy * p.width + cx;
      if (visited[idx]) continue;
      visited[idx] = 1;
      if (p.cells[idx] !== target) continue;
      this.applyCells([[cx, cy]], color);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    this.bumpRev();
  }

  /** Mirrored write of `c` at each `(x,y)` in `hits`. Mutates the live
   * pattern's cells array directly; {@link rev} bumps so re-render fires. */
  private applyCells(hits: Array<[number, number]>, c: Cell): void {
    const p = this.pattern.value;
    for (const [hx, hy] of hits) {
      for (const [mx, my] of mirrorCell(hx, hy, p.width, p.height, this.mirrorMode.value)) {
        setCell(p, mx, my, c);
      }
    }
    this.bumpRev();
  }

  endStroke(): void {
    this.strokeActive.value = false;
  }

  clearPattern(): void {
    this.beginStroke();
    if (clearPattern(this.pattern.value)) this.bumpRev();
    this.endStroke();
  }

  fillPattern(): void {
    this.beginStroke();
    if (fillPattern(this.pattern.value, this.color.value)) this.bumpRev();
    this.endStroke();
  }

  // ---------------------------------------------------------------------------
  // Undo / redo
  // ---------------------------------------------------------------------------

  undo(): void {
    const next = this.history.undoStep(this.pattern.value);
    if (next) {
      this.pattern.value = next;
      this.bumpRev();
    }
  }

  redo(): void {
    const next = this.history.redoStep(this.pattern.value);
    if (next) {
      this.pattern.value = next;
      this.bumpRev();
    }
  }

  // ---------------------------------------------------------------------------
  // Presets / randomize
  // ---------------------------------------------------------------------------

  applyPreset(id: string): void {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    this.history.push(this.pattern.value);
    const decoded = decodePattern(`${preset.width}x${preset.height}:${preset.cells}`);
    if (decoded) {
      this.pattern.value = clonePattern(decoded);
      this.mirrorMode.value = preset.mode;
      this.bumpRev();
    }
  }

  randomize(): void {
    this.history.push(this.pattern.value);
    this.pattern.value = randomPattern({
      width: this.pattern.value.width,
      height: this.pattern.value.height,
      mode: this.mirrorMode.value,
    });
    this.bumpRev();
  }

  // ---------------------------------------------------------------------------
  // Save slots (local-only)
  // ---------------------------------------------------------------------------

  saveSlot(name: string): void {
    const list = this.slots.value.slice();
    const preset: SlotSerialized = {
      name,
      createdAt: Date.now(),
      thumb: thumbFromPattern(this.pattern.value, this.mirrorMode.value),
      pattern: encodePattern(this.pattern.value),
      mirrorMode: this.mirrorMode.value,
    };
    const idx = list.findIndex((s) => s.name === name);
    if (idx >= 0) list[idx] = preset;
    else list.unshift(preset);
    this.slots.value = list;
  }

  loadSlot(name: string): void {
    const slot = this.slots.value.find((s) => s.name === name);
    if (!slot) return;
    const decoded = decodePattern(slot.pattern);
    if (!decoded) return;
    this.history.push(this.pattern.value);
    this.pattern.value = clonePattern(decoded);
    this.mirrorMode.value = slot.mirrorMode;
    this.bumpRev();
  }

  deleteSlot(name: string): void {
    this.slots.value = this.slots.value.filter((s) => s.name !== name);
  }

  clearAllSlots(): void {
    this.slots.value = [];
  }

  // ---------------------------------------------------------------------------
  // Share URL
  // ---------------------------------------------------------------------------

  buildShareUrl(): string {
    return shareUrlEncode({
      pattern: this.pattern.value,
      mode: this.mirrorMode.value,
      color: this.color.value,
      alpha01: this.alpha01.value,
    });
  }

  loadFromShareUrl(): boolean {
    const decoded = shareUrlDecode();
    if (!decoded) return false;
    this.history.push(this.pattern.value);
    if (!patternsEqual(this.pattern.value, decoded.pattern)) {
      this.pattern.value = clonePattern(decoded.pattern);
    }
    this.mirrorMode.value = decoded.mode;
    if (decoded.color !== 0) {
      this.color.value = decoded.color;
      this.alpha01.value = cellAlpha01(decoded.color);
    }
    this.bumpRev();
    return true;
  }

  hasShareUrl(): boolean {
    return shareUrlDecode() !== null;
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  snapshot(): Savestate {
    return {
      pattern: encodePattern(this.pattern.value),
      mirrorMode: this.mirrorMode.value,
      tool: this.tool.value,
      hex: cellToHex(this.color.value),
      alpha01: this.alpha01.value,
      recentCells: this.recentCells.value,
      previewCellScale: this.previewCellScale.value,
      bgScale: this.bgScale.value,
      showPageBg: this.showPageBg.value,
      showGridLines: this.showGridLines.value,
      showMirrorAxis: this.showMirrorAxis.value,
      theme: this.theme.value,
      saveEnabled: this.saveEnabled.value,
      slots: this.slots.value,
    };
  }

  restore(s: Partial<Savestate>): void {
    if (s.pattern) {
      const p = decodePattern(s.pattern);
      if (p) this.pattern.value = p;
    }
    if (s.mirrorMode) this.mirrorMode.value = s.mirrorMode;
    if (s.tool) this.tool.value = s.tool;
    if (typeof s.hex === "string") {
      const alpha = typeof s.alpha01 === "number" ? s.alpha01 : 1;
      this.color.value = hexToCell(s.hex, alpha);
    }
    if (typeof s.alpha01 === "number") this.alpha01.value = s.alpha01;
    if (Array.isArray(s.recentCells)) this.recentCells.value = s.recentCells as Cell[];
    if (typeof s.previewCellScale === "number") this.previewCellScale.value = s.previewCellScale;
    if (typeof s.bgScale === "number") this.bgScale.value = s.bgScale;
    if (typeof s.showPageBg === "boolean") this.showPageBg.value = s.showPageBg;
    if (typeof s.showGridLines === "boolean") this.showGridLines.value = s.showGridLines;
    if (typeof s.showMirrorAxis === "boolean") this.showMirrorAxis.value = s.showMirrorAxis;
    if (s.theme === "light" || s.theme === "dark") this.setTheme(s.theme);
    if (typeof s.saveEnabled === "boolean") this.saveEnabled.value = s.saveEnabled;
    if (Array.isArray(s.slots)) this.slots.value = s.slots;
    this.history.reset(this.pattern.value);
    this.bumpRev();
  }

  clearAllData(): void {
    this.slots.value = [];
    this.pattern.value = makeDefaultPattern();
    this.mirrorMode.value = RANDOMIZE_DEFAULT_MODE;
    this.color.value = makeDefaultColor();
    this.alpha01.value = 1;
    this.recentCells.value = [];
    this.tool.value = "pencil";
    this.history.reset(this.pattern.value);
    this.bumpRev();
  }

  private bumpRev(): void {
    this.rev.value = this.rev.peek() + 1;
  }
}

function thumbFromPattern(p: Pattern, mode: MirrorMode): string {
  const tile = superTileCanvas(p, mode, 1);
  const target = 32;
  const out = document.createElement("canvas");
  out.width = target;
  out.height = target;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const scale = Math.max(1, Math.floor(target / Math.max(tile.width, tile.height)));
  const scaled = superTileCanvas(p, mode, scale);
  ctx.drawImage(
    scaled,
    Math.floor((target - scaled.width) / 2),
    Math.floor((target - scaled.height) / 2),
  );
  return out.toDataURL("image/png");
}

export const store = new Store();
export type { Theme, Tool, MirrorMode };
export type StoreInstance = typeof store;