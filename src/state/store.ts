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

/**
 * Schema version for the {@link Savestate} payload. Bump when an
 * incompatible field change lands, and add a row to {@link MIGRATIONS}
 * describing how to upgrade older records in place. The persisted
 * payload at any moment carries whatever version was current when it
 * was last saved (or no `version` at all for records saved before this
 * field existed — treated as version ``0`` by {@link migrateSavestate}).
 *
 * Backwards-compat policy: any prior-version record must continue to
 * restore at least as gracefully as before — we never silently drop
 * user data, we never throw on unknown fields, we always "upgrade" or
 * "best-effort". A future *removal* of a field that today exists is
 * forward-compatible (read-side gates should make us tolerate its
 * absence) provided the new code doesn't *rely* on it. A future *rename*
 * or *re-interpretation* must ship with a real migration step here —
 * version-only behaviour changes are forbidden.
 *
 * This is the addressing mechanism the operator asked for in #4 in
 * todo.txt — pushing a new deployment shouldn't wipe a returning user's
 * autosave unless we deliberately bumped the schema version AND shipped
 * a migration (which can be a no-op for non-breaking changes).
 */
export const SAVE_STATE_VERSION = 1;

export interface Savestate {
  /** Schema version. Older records may lack this; {@link migrateSavestate}
   * normalises the gap. Future fields added to Savestate that aren't a
   * breaking change should NOT bump this — only renames / reinterpreted
   * shapes need a bump. */
  version: number;
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

/**
 * Collision strategy for {@link Store.mergeSlots} — addressed by the
 * import flow (#9 in todo.txt):
 *
 *   - ``replace`` — overwrite an existing same-named slot.
 *   - ``suffix``  — append the incoming slot with ``Name (2)``, ``(3)`` …
 *                   so it lands without touching the existing one.
 *   - ``skip``    — drop the incoming colliding slot entirely.
 */
export type SlotMergeStrategy = "replace" | "suffix" | "skip";

/** Tally result returned from {@link Store.mergeSlots}. */
export interface SlotMergeStats {
  added: number;
  replaced: number;
  skipped: number;
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
    // Flood fill via an iterative 4-way DFS. We write directly to `p.cells`
    // (with the same mirror expansion `applyCells` would apply) and bump
    // `rev` exactly once at the end. The previous implementation called
    // `applyCells([[cx, cy]], color)` per visited cell — and `applyCells`
    // ends with `bumpRev()` — so a 64×64 fill synchronously wrote `rev`
    // ~4096×, each notifying every rev-subscriber (draw panel repaint,
    // preview panel repaint, favicon repaint, page-bg rasterize) and
    // allocating a fresh `[[cx, cy]]` per cell. Empirically that took
    // ~20s on a 64×64 grid. Batching the rev bump collapses the work to
    // a single invalidate per fill, taking the same fill to single-digit
    // milliseconds.
    const mode = this.mirrorMode.value;
    const W = p.width;
    const H = p.height;
    const stack: Array<[number, number]> = [[x, y]];
    const visited = new Uint8Array(W * H);
    let changed = false;
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      const idx = cy * W + cx;
      if (visited[idx]) continue;
      visited[idx] = 1;
      if (p.cells[idx] !== target) continue;
      for (const [mx, my] of mirrorCell(cx, cy, W, H, mode)) {
        if (setCell(p, mx, my, color)) changed = true;
      }
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    if (changed) this.bumpRev();
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
      // Stamped at the top so a future migration knows which schema it
      // received. See {@link SAVE_STATE_VERSION} + {@link migrateSavestate}
      // for the upgrade path.
      version: SAVE_STATE_VERSION,
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

  restore(s: Partial<Savestate>, opts: { skipSlots?: boolean } = {}): void {
    // Walk any outstanding migrations first so the read-side code below
    // sees a record at the current schema. {@link migrateSavestate}
    // is a no-op for the v1 ⇄ v0 shapes (the only difference is the
    // addition of the `version` field itself); future renames /
    // re-interpretations would live as `MIGRATIONS` rows. If the
    // record is from a *future* version (forward-version mismatch) we
    // log and best-effort restore rather than throw.
    const migrated = migrateSavestate(s);
    if (migrated.pattern) {
      const p = decodePattern(migrated.pattern);
      if (p) this.pattern.value = p;
    }
    if (migrated.mirrorMode) this.mirrorMode.value = migrated.mirrorMode;
    if (migrated.tool) this.tool.value = migrated.tool;
    // Primary
    if (typeof migrated.hex === "string") {
      const alpha = typeof migrated.alpha01 === "number" ? migrated.alpha01 : 1;
      this.primaryColor.value = hexToCell(migrated.hex, alpha);
    }
    if (typeof migrated.alpha01 === "number") this.primaryAlpha01.value = migrated.alpha01;
    // Secondary (backward-compat: defaults to white at full opacity if absent)
    if (typeof migrated.secondaryHex === "string") {
      const alpha = typeof migrated.secondaryAlpha01 === "number" ? migrated.secondaryAlpha01 : 1;
      this.secondaryColor.value = hexToCell(migrated.secondaryHex, alpha);
    } else if (!this.secondaryColor.value) {
      this.secondaryColor.value = makeDefaultSecondaryColor();
    }
    if (typeof migrated.secondaryAlpha01 === "number") {
      this.secondaryAlpha01.value = migrated.secondaryAlpha01;
    }
    if (migrated.activeColorSlot === "primary" || migrated.activeColorSlot === "secondary") {
      this.activeColorSlot.value = migrated.activeColorSlot;
    }
    this.syncColorProjection();
    if (Array.isArray(migrated.recentCells)) this.recentCells.value = migrated.recentCells as Cell[];
    if (typeof migrated.previewCellScale === "number") this.previewCellScale.value = migrated.previewCellScale;
    if (typeof migrated.bgScale === "number") this.bgScale.value = migrated.bgScale;
    if (typeof migrated.showPageBg === "boolean") this.showPageBg.value = migrated.showPageBg;
    if (typeof migrated.showGridLines === "boolean") this.showGridLines.value = migrated.showGridLines;
    if (typeof migrated.showMirrorAxis === "boolean") this.showMirrorAxis.value = migrated.showMirrorAxis;
    if (migrated.theme === "light" || migrated.theme === "dark") this.setTheme(migrated.theme);
    if (typeof migrated.saveEnabled === "boolean") this.saveEnabled.value = migrated.saveEnabled;
    // Slots: gated by the new `opts.skipSlots` flag so the import flow
    // (#9 in todo.txt) can apply the rest of the Savestate WITHOUT
    // overwriting the user's existing slot list — leaving the merge to
    // `mergeSlots` below for collision strategies.
    if (!opts.skipSlots && Array.isArray(migrated.slots)) this.slots.value = migrated.slots;
    this.history.reset(this.pattern.value);
    this.bumpRev();
  }

  /**
   * Merge incoming slots into the user's existing saves. Three collision
   * strategies — see {@link SlotMergeStrategy}. Returns a small tally so
   * the import modal (#9 in todo.txt) can toast "Added X / replaced Y /
   * skipped Z".
   *
   * ``replace`` (default) — overwrite an existing same-named slot. The
   * operation is limited to colliding slots — every other slot in the
   * existing list is preserved (as opposed to ``restore({slots})`` which
   * replaces the whole list).
   *
   * ``suffix`` — non-destructive. Find the next unique ``Name (N)`` /
   * ``Name (2)`` where ``N`` increments; rename the incoming slot to
   * that and add it. Existing same-named slots are left untouched.
   *
   * ``skip`` — non-destructive. Collisions don't land at all; only the
   * incoming slots whose names don't match an existing one are added.
   */
  mergeSlots(
    incoming: SlotSerialized[],
    strategy: SlotMergeStrategy = "replace",
  ): SlotMergeStats {
    const existing = this.slots.value.slice();
    const names = new Set(existing.map((s) => s.name));
    let added = 0;
    let replaced = 0;
    let skipped = 0;
    for (const raw of incoming) {
      const trimmed = raw.name?.trim();
      if (!trimmed) continue;
      if (names.has(trimmed)) {
        if (strategy === "replace") {
          const idx = existing.findIndex((s) => s.name === trimmed);
          if (idx >= 0) {
            existing[idx] = { ...raw, name: trimmed };
            replaced++;
          }
        } else if (strategy === "skip") {
          skipped++;
        } else {
          // suffix: find a unique ``Name (N)``, N starting at 2.
          let counter = 2;
          let candidate = `${trimmed} (${counter})`;
          while (names.has(candidate)) {
            counter++;
            candidate = `${trimmed} (${counter})`;
          }
          existing.unshift({ ...raw, name: candidate });
          names.add(candidate);
          added++;
        }
      } else {
        existing.unshift({ ...raw, name: trimmed });
        names.add(trimmed);
        added++;
      }
    }
    this.slots.value = existing;
    return { added, replaced, skipped };
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
    this.openPickerRequest.value = null;
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

// ---------------------------------------------------------------------------
// Savestate schema upgrade machinery.
//
// This is the addressing mechanism for #4 in todo.txt: a *structured,
// versioned* migration ladder so a returning user's autosave (saved by an
// older build that wouldn't have known about new fields / a renamed hook)
// still loads gracefully on a fresh build, rather than silently half-
// restoring or throwing on `JSON.parse`. New builds always ship with
// ``SAVE_STATE_VERSION`` at the head of the ladder; each prior version has
// an explicit `migrate(oldSnapshot): newSnapshot` step in ``MIGRATIONS``.
//
// Today (v1) the migrations table is empty — v0 corresponds exactly to the
// shape this code restores under the defensive read-side conditionals in
// `restore()`, and the only addition the current build makes is the
// `version` field itself. The scaffold is in place so the first future
// breaking change has a clear home.
// ---------------------------------------------------------------------------

/**
 * Per-version migrations. Each function transforms a snapshot at version
 * ``from`` into a snapshot at version ``from + 1``. Missing entries mean
 * "identity (no migration needed)" — which is true for the v0 → v1 step at
 * head, since the current schema is a strict superset of v0 with no field
 * that was renamed OR had its interpretation changed.
 *
 * Add a row at key ``(SAVE_STATE_VERSION + 1)`` when shipping the next
 * breaking change. The function MUST return a new object (it doesn't have
 * to copy fields it hasn't touched) and SHOULD set ``version`` to its own
 * target if it touches the field.
 */
const MIGRATIONS: Partial<Record<number, (s: Partial<Savestate>) => Partial<Savestate>>> = {
  // 1: from-v0-to-v1 migration — left implicit because the only delta
  //    is the addition of the `version` field itself, which
  //    `migrateSavestate` stamps below. Future real-world shape changes
  //    would slot their transform function in here.
};

/**
 * Bring an arbitrary snapshot up to {@link SAVE_STATE_VERSION}, applying
 * the chain of migrations. Records without a `version` field are treated
 * as v0 — that covers the realistic case of a returning user whose
 * autosave was written by an older build that predated the `version`
 * field.
 *
 * Forward-version mismatches (a snapshot stamped with a *newer* version
 * than the running build was written by) log a warning and best-effort
 * restore rather than throw: better to half-restore than to wipe a
 * returning user's data on a downgrade.
 */
export function migrateSavestate(s: Partial<Savestate>): Partial<Savestate> {
  let version = typeof s.version === "number" ? s.version : 0;
  let out = s;
  while (version < SAVE_STATE_VERSION) {
    const step = MIGRATIONS[version + 1];
    if (!step) {
      // No explicit migration registered for this step — by convention
      // (and the current empty MIGRATIONS table) this means "identity":
      // every prior-version snapshot's fields already match what the
      // current `restore()` reads defensively. We stamp `version` so the
      // next save persists it and skip ahead.
      out = { ...out, version: version + 1 };
    } else {
      out = step(out);
      out.version = (out.version ?? 0) || (version + 1);
    }
    version = out.version ?? version + 1;
    // Guard against pathological cycles / bad migration that didn't
    // bump version.
    if ((out.version ?? 0) <= (s.version ?? 0) && version <= (s.version ?? 0)) break;
  }
  if (version > SAVE_STATE_VERSION) {
    // The snapshot was written by a newer build. Best-effort: don't
    // throw, don't wipe. The defensive read-side in `restore()` will
    // happily skip any unfamiliar fields and apply the rest.
    console.warn(
      `[pixel-patterns] autosave version ${version} > current ${SAVE_STATE_VERSION}; restoring best-effort.`,
    );
  }
  return out;
}