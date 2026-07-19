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
import type { Cell, ColorSlot, MirrorMode, Pattern, Theme, Tool } from "../domain/types.js";

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

const DEFAULT_HEX = "#cc33cc"; // callback to original default color (primary)
const DEFAULT_SECONDARY_HEX = "#ffffff"; // MSPaint-style secondary default
const DEFAULT_RECENT_MAX = 24; // doubled per operator request — there's UI room

export interface Savestate {
  pattern: string; // encoded
  mirrorMode: MirrorMode;
  tool: Tool;
  hex: string; // primary
  secondaryHex: string;
  alpha01: number; // primary
  secondaryAlpha01: number;
  activeColorSlot: ColorSlot;
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

/** Which color slot is currently 'active' — i.e. the one the picker / alpha
 * slider / recents will act on. {@link ColorSlot} is imported from
 * domain/types; the import alias keeps the call sites short. */

function makeDefaultColor(): Cell {
  return hexToCell(DEFAULT_HEX, 1);
}
function makeDefaultSecondaryColor(): Cell {
  return hexToCell(DEFAULT_SECONDARY_HEX, 1);
}

function makeDefaultPattern(): Pattern {
  return emptyPattern(DEFAULT_WIDTH, DEFAULT_HEIGHT);
}

class Store {
  pattern = signal<Pattern>(makeDefaultPattern());
  mirrorMode = signal<MirrorMode>(RANDOMIZE_DEFAULT_MODE); // `HV` by default
  tool = signal<Tool>("pencil");

  // Two color slots, MSPaint-style. `color` and `alpha01` are kept as
  // *projections* of the currently-active slot for backwards-compat with
  // existing readers; the per-slot signals are the source of truth.
  primaryColor = signal<Cell>(makeDefaultColor());
  secondaryColor = signal<Cell>(makeDefaultSecondaryColor());
  primaryAlpha01 = signal<number>(1);
  secondaryAlpha01 = signal<number>(1);
  activeColorSlot = signal<ColorSlot>("primary");

  /** Active slot's color (projection). Read this in components that don't
   * care which slot is active. Mutating `.value` would bypass the slot
   * routing; use {@link setHex} / {@link setAlpha01} / {@link pickColor} /
   * {@link pickSwatch} instead. */
  color = signal<Cell>(makeDefaultColor());
  alpha01 = signal<number>(1);
  recentCells = signal<Cell[]>([]);

  // New-session defaults: a 7×7 grid with HV mirror at 3px cells tiles to a
// 14×14 super-tile at 42×42 actual px — a comfortably dense wallpaper. The
// page background at scale 1 means each super-tile cell is just 1 device px
// on screen, so the pattern reads at real pixel density.
previewCellScale = signal<number>(3);
bgScale = signal<number>(1);
  showPageBg = signal<boolean>(true);
  showGridLines = signal<boolean>(true);
  showMirrorAxis = signal<boolean>(true);
  theme = signal<Theme>("dark");
  saveEnabled = signal<boolean>(true);

  slots = signal<SlotSerialized[]>([]);

  /** Transient: is a pointer stroke in progress? */
  strokeActive = signal<boolean>(false);
  hover = signal<{ x: number; y: number } | null>(null);

  /**
   * Bumped whenever the user requests the native HTML5 color picker to open
   * — via the `C` / `Shift+C` keyboard shortcut. The {@link ColorDock}
   * component subscribes (via an effect) and calls `.showPicker()` (or
   * `.click()` as a fallback) on its `<input type="color">` element in
   * response. The payload indicates whether primary or secondary was
   * requested, so the dock can temporarily switch the active slot to
   * secondary under Shift+C and switch back after the picker closes.
   */
  openPickerRequest = signal<{ slot: ColorSlot; nonce: number } | null>(null);

  /** Request the native color picker to open for a given slot. `slot`
   * defaults to the active slot. Used by the `C` / `Shift+C` hotkeys and
   * any future programmatic caller. */
  requestOpenColorPicker(slot: ColorSlot | null = null): void {
    const target = slot ?? this.activeColorSlot.value;
    this.openPickerRequest.value = { slot: target, nonce: (this.openPickerRequest.value?.nonce ?? 0) + 1 };
  }

  history = new History();

  /** Bumped on every pattern mutation. Render effects listen. */
  rev = signal<number>(0);

  /** Reload suggestion fired by persistence after an external load. */
  externalReload = invalidationToken;

  // ---------------------------------------------------------------------------
  // Color
  // ---------------------------------------------------------------------------

  /** Switch which slot the picker / alpha / recents act on. */
  setActiveColorSlot(slot: ColorSlot): void {
    this.activeColorSlot.value = slot;
    this.syncColorProjection();
  }

  /** Swap primary ↔ secondary (Photoshop `X`). */
  swapColors(): void {
    const pc = this.primaryColor.value;
    const pa = this.primaryAlpha01.value;
    this.primaryColor.value = this.secondaryColor.value;
    this.primaryAlpha01.value = this.secondaryAlpha01.value;
    this.secondaryColor.value = pc;
    this.secondaryAlpha01.value = pa;
    this.syncColorProjection();
  }

  /**
   * Update the active slot's color from a `#rrggbb` hex string. Does NOT
   * push to recents — recents reflect *committed* color picks, and an
   * HTML5 color picker drags one colour per pixel which would wipe the
   * recents in one drag. Callers that want a recents push (HTML picker
   * `change`, dropper sample, recent-swatch click) call {@link commitRecent}.
   *
   * `which` (optional) overrides the active slot — used by RMB swatch
   * clicks that fill the inactive slot directly.
   */
  setHex(hex: string, which: ColorSlot | null = null): void {
    const slot = which ?? this.activeColorSlot.value;
    const a = slot === "primary" ? this.primaryAlpha01.value : this.secondaryAlpha01.value;
    const cell = hexToCell(hex, a);
    this.writeSlot(slot, cell);
    if (slot === this.activeColorSlot.value) this.syncColorProjection();
  }

  /** Push the active slot's color to the recents panel. RGB-only dedup
   * (the alpha channel is governed globally per-slot, so picking the same
   * hue at two different alphas stays one recent entry, re-rendering at
   * the current alpha). */
  commitRecent(which: ColorSlot | null = null): void {
    const slot = which ?? this.activeColorSlot.value;
    this.bumpRecent(slot);
  }

  setAlpha01(a: number, which: ColorSlot | null = null): void {
    const slot = which ?? this.activeColorSlot.value;
    const currentCell = this.readSlot(slot);
    const [r, g, b] = unpackRGBA(currentCell || makeDefaultColor());
    this.writeSlot(slot, packRGBA(r, g, b, Math.round(a * 255)));
    if (slot === "primary") this.primaryAlpha01.value = a;
    else this.secondaryAlpha01.value = a;
    if (slot === this.activeColorSlot.value) this.syncColorProjection();
  }

  /**
   * Pick the colour of a cell onto a slot's brush. Used by the dropper
   * tool — copies both RGB and alpha from the sampled cell. Sampling a
   * transparent cell is a no-op (the brush is left untouched), so an
   * accidental dropper over empty space doesn't yank the slot to the default.
   *
   * `which` defaults to the active slot. RMB-dropper callers pass
   * `'secondary'` explicitly. The dropper's one-shot auto-revert in
   * {@link revertDropper} restores the *tool*, not the colour — this
   * method's effect persists.
   */
  pickColor(cell: Cell, which: ColorSlot | null = null): void {
    if (cell === 0) return;
    const slot = which ?? this.activeColorSlot.value;
    this.writeSlot(slot, cell);
    if (slot === "primary") this.primaryAlpha01.value = cellAlpha01(cell);
    else this.secondaryAlpha01.value = cellAlpha01(cell);
    this.bumpRecent(slot);
    if (slot === this.activeColorSlot.value) this.syncColorProjection();
  }

  /**
   * Pick a recent / palette swatch onto a slot's brush. Only the swatch's
   * RGB is bound onto the slot's colour; the slot's own alpha slider is
   * preserved (so the recents panel re-tints at the current alpha —
   * "ideal way to operate" the operator pointed out). Clicking a recent
   * swatch also re-orders it to the top of the recents list.
   *
   * `which` defaults to the active slot. RMB callers pass `'secondary'`
   * explicitly so the inactive slot fills without disturbing the active
   * picker / alpha slider state.
   */
  pickSwatch(cell: Cell, which: ColorSlot | null = null): void {
    if (cell === 0) return;
    const slot = which ?? this.activeColorSlot.value;
    const a255 =
      slot === "primary"
        ? Math.round(this.primaryAlpha01.value * 255)
        : Math.round(this.secondaryAlpha01.value * 255);
    const [r, g, b] = unpackRGBA(cell);
    this.writeSlot(slot, packRGBA(r, g, b, a255));
    this.bumpRecent(slot);
    if (slot === this.activeColorSlot.value) this.syncColorProjection();
  }

  /** Read the colour signal of a slot. Helper for the setters. */
  private readSlot(slot: ColorSlot): Cell {
    return slot === "primary" ? this.primaryColor.value : this.secondaryColor.value;
  }

  /** Write the colour signal of a slot. */
  private writeSlot(slot: ColorSlot, cell: Cell): void {
    if (slot === "primary") this.primaryColor.value = cell;
    else this.secondaryColor.value = cell;
  }

  /** Re-sync the projection signals (`color` / `alpha01`) to the active slot. */
  private syncColorProjection(): void {
    const slot = this.activeColorSlot.value;
    this.color.value = slot === "primary" ? this.primaryColor.value : this.secondaryColor.value;
    this.alpha01.value =
      slot === "primary" ? this.primaryAlpha01.value : this.secondaryAlpha01.value;
  }

  private bumpRecent(which: ColorSlot): void {
    const c = which === "primary" ? this.primaryColor.value : this.secondaryColor.value;
    if (c === 0) return;
    const rgb = (c >>> 8) & 0xffffff; // alpha-agnostic key
    const list = this.recentCells.value.slice();
    // Dedup by RGB only — older entries of the same hue at any alpha drop.
    const idx = list.findIndex((x) => ((x >>> 8) & 0xffffff) === rgb);
    if (idx === 0) {
      // Already at the top, but its alpha may be stale — refresh in place so
      // the displayed value matches the current alpha01.
      if (list[0] !== c) list[0] = c;
      this.recentCells.value = list;
      return;
    }
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

  /**
   * The tool the user had active *before* they switched to the dropper.
   * Captured so a one-shot dropper sample can auto-revert to that tool
   * (the operator's stated UX preference: "click once with dropper, go
   * back to whatever I had before"). Defaults to pencil. The long-press
   * dropper gesture has its own savedToolRef in DrawPanel; these two
   * mechanisms compose — the long-press restore runs first and makes
   * `revertDropper` a no-op for that case.
   */
  private prevTool: Tool = "pencil";

  setTool(t: Tool): void {
    if (t !== this.tool.value) {
      // Switching *to* the dropper: remember what we had for a one-shot revert.
      if (t === "dropper") this.prevTool = this.tool.value;
      this.tool.value = t;
    }
  }

  /**
   * Revert from dropper to whatever tool the user had before they picked
   * dropper. No-op if the current tool isn't dropper (e.g. they switched
   * to something else already, or the long-press path already restored).
   */
  revertDropper(): void {
    if (this.tool.value === "dropper" && this.prevTool !== "dropper") {
      this.tool.value = this.prevTool;
    }
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

  /**
   * Paint a single cell with the active (or specified) slot's color.
   *
   * `which` defaults to the active slot. RMB drag should pass `'secondary'`
   * explicitly so right-button strokes paint with the secondary color. The
   * dropper ignores `which` for paint purposes — when tool === 'dropper'
   * `paintAt` becomes a color sample that writes to the active slot (the
   * DrawPanel dropper handler threads `which` from `e.button`).
   */
  paintAt(x: number, y: number, which: ColorSlot | null = null): void {
    if (x < 0 || y < 0 || x >= this.pattern.value.width || y >= this.pattern.value.height) return;
    const tool = this.tool.value;
    if (tool === "dropper") {
      this.pickColor(this.pattern.value.cells[y * this.pattern.value.width + x], which);
      return;
    }
    const slot = which ?? this.activeColorSlot.value;
    const c = tool === "eraser" ? 0 : this.readSlot(slot);
    this.applyCells([[x, y]], c);
  }

  /** Bridge from previous pointer position to current, hitting every cell
   * via Bresenham along the way. Mirroring handled at the cell level. */
  paintLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    which: ColorSlot | null = null,
  ): void {
    if (this.tool.value === "dropper") {
      this.paintAt(x1, y1, which);
      return;
    }
    const slot = which ?? this.activeColorSlot.value;
    const c = this.tool.value === "eraser" ? 0 : this.readSlot(slot);
    const hits = bridgeLine(
      x0, y0, x1, y1,
      this.pattern.value.width,
      this.pattern.value.height,
      this.mirrorMode.value,
    );
    this.applyCells(hits, c);
  }

  bucketFillAt(x: number, y: number, which: ColorSlot | null = null): void {
    if (this.tool.value !== "bucket") return;
    this.beginStroke();
    const p = this.pattern.value;
    if (x < 0 || y < 0 || x >= p.width || y >= p.height) return;
    const target = p.cells[y * p.width + x];
    const slot = which ?? this.activeColorSlot.value;
    const color = this.readSlot(slot);
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

  fillPattern(which: ColorSlot | null = null): void {
    const slot = which ?? this.activeColorSlot.value;
    const c = this.readSlot(slot);
    this.beginStroke();
    if (fillPattern(this.pattern.value, c)) this.bumpRev();
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
    const trimmed = name.trim();
    // Guard at the store layer so a flaw in any UI validation (or a
    // programmatic caller) can't persist an empty-named slot that would be
    // indistinguishable from a typo / browser autofill misfire.
    if (!trimmed) return;
    const list = this.slots.value.slice();
    const preset: SlotSerialized = {
      name: trimmed,
      createdAt: Date.now(),
      thumb: thumbFromPattern(this.pattern.value, this.mirrorMode.value),
      pattern: encodePattern(this.pattern.value),
      mirrorMode: this.mirrorMode.value,
    };
    const idx = list.findIndex((s) => s.name === trimmed);
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
      color: this.primaryColor.value,
      alpha01: this.primaryAlpha01.value,
      secondaryColor: this.secondaryColor.value,
      secondaryAlpha01: this.secondaryAlpha01.value,
      activeColorSlot: this.activeColorSlot.value,
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
      this.primaryColor.value = decoded.color;
      this.primaryAlpha01.value = cellAlpha01(decoded.color);
    }
    if (decoded.secondaryColor !== undefined && decoded.secondaryColor !== 0) {
      this.secondaryColor.value = decoded.secondaryColor;
      this.secondaryAlpha01.value = cellAlpha01(decoded.secondaryColor);
    }
    if (decoded.activeColorSlot) this.activeColorSlot.value = decoded.activeColorSlot;
    this.syncColorProjection();
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
      hex: cellToHex(this.primaryColor.value),
      secondaryHex: cellToHex(this.secondaryColor.value),
      alpha01: this.primaryAlpha01.value,
      secondaryAlpha01: this.secondaryAlpha01.value,
      activeColorSlot: this.activeColorSlot.value,
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
    // Primary
    if (typeof s.hex === "string") {
      const alpha = typeof s.alpha01 === "number" ? s.alpha01 : 1;
      this.primaryColor.value = hexToCell(s.hex, alpha);
    }
    if (typeof s.alpha01 === "number") this.primaryAlpha01.value = s.alpha01;
    // Secondary (backward-compat: defaults to white at full opacity if absent)
    if (typeof s.secondaryHex === "string") {
      const alpha = typeof s.secondaryAlpha01 === "number" ? s.secondaryAlpha01 : 1;
      this.secondaryColor.value = hexToCell(s.secondaryHex, alpha);
    } else if (!this.secondaryColor.value) {
      this.secondaryColor.value = makeDefaultSecondaryColor();
    }
    if (typeof s.secondaryAlpha01 === "number") {
      this.secondaryAlpha01.value = s.secondaryAlpha01;
    }
    if (s.activeColorSlot === "primary" || s.activeColorSlot === "secondary") {
      this.activeColorSlot.value = s.activeColorSlot;
    }
    this.syncColorProjection();
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
    this.primaryColor.value = makeDefaultColor();
    this.primaryAlpha01.value = 1;
    this.secondaryColor.value = makeDefaultSecondaryColor();
    this.secondaryAlpha01.value = 1;
    this.activeColorSlot.value = "primary";
    this.recentCells.value = [];
    this.tool.value = "pencil";
    this.syncColorProjection();
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