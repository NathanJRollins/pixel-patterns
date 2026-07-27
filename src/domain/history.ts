import { clonePattern, patternsEqual } from "./pattern.js";
import type { Pattern } from "./types.js";

/**
 * Undo / redo history.
 *
 * A snapshot is a deep clone of the {@link Pattern} (small: a few hundred
 * bytes for typical grids). We push a snapshot at the *start* of each
 * stroke — i.e. before a mutating tool fires — so `undo` reverts the most
 * recent stroke.
 *
 * Memory model — lazy grow, byte-budget ceiling:
 *
 *   - The history starts empty. Zero strokes painted = zero bytes held.
 *   - Each push allocates one `Uint32Array(width × height)` clone.
 *   - Eviction is FIFO once the byte budget is exceeded. We never evict
 *     below {@link HISTORY_MIN_SNAPSHOTS} so the user always has a few undo
 *     steps even on a giant pattern that itself approaches the budget.
 *   - The budget is a ceiling, not a reservation. The user pays only for
 *     what they actually paint.
 *
 * History stores *patterns only*; UI state (tool, color, mode) is fine to
 * mutate freely between strokes — undo/redo won't disturb those.
 *
 * Default budget: 256 MB. That's desktop-comfortable and big enough to
 * hold an effectively unbounded number of strokes for any realistic
 * session — at max grid (64×64) it's 16,384 snapshots; at the default 5×5
 * it's ~2.7 million. The budget is the per-`History` instance ceiling; it
 * can be overridden via the constructor for tests or constrained
 * environments (e.g. a low-memory phone that wants to clamp to 32 MB).
 *
 * History is **not** persisted — autosave stores only the current pattern
 * + UI state, so a page refresh wipes history and frees the memory.
 *
 * Eviction cost: when the budget is hit, `Array.shift()` is O(n). For a
 * 64×64 pattern at 256 MB / ~16k snapshots, that's a ~64 KB copy per
 * eviction stroke — negligible. A true O(1) ring buffer would only matter
 * if we raised the budget into the GB range; not worth the complexity here.
 */

const DEFAULT_HISTORY_BYTES_BUDGET = 256 * 1024 * 1024;

/** Never evict below this many undo snapshots, no matter the byte budget. */
const HISTORY_MIN_SNAPSHOTS = 8;

export class History {
  private undo: Pattern[] = [];
  private redo: Pattern[] = [];
  private undoBytes = 0;
  private redoBytes = 0;
  private readonly maxBytes: number;

  constructor(maxBytes: number = DEFAULT_HISTORY_BYTES_BUDGET) {
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
      throw new RangeError(`History budget must be a positive number; got ${maxBytes}`);
    }
    this.maxBytes = Math.floor(maxBytes);
  }

  /** Snapshot the *current* (pre-mutation) state, clearing the redo stack. */
  push(p: Pattern): void {
    const snap = clonePattern(p);
    const cost = snap.cells.byteLength;
    this.undo.push(snap);
    this.undoBytes += cost;
    if (this.redo.length) {
      this.redo.length = 0;
      this.redoBytes = 0;
    }
    // Evict oldest FIFO until we're back under budget AND we still have
    // > HISTORY_MIN_SNAPSHOTS undo entries. (When an individual snapshot
    // is itself a large fraction of the budget — e.g. a 64×64 pattern
    // at a 16 MB budget — we still keep MIN_SNAPSHOTS even if that pushes
    // us over. Better to have a few undo steps than zero.)
    while (
      this.undoBytes > this.maxBytes &&
      this.undo.length > HISTORY_MIN_SNAPSHOTS
    ) {
      const evicted = this.undo.shift()!;
      this.undoBytes -= evicted.cells.byteLength;
    }
  }

  canUndo(): boolean {
    return this.undo.length > 0;
  }

  canRedo(): boolean {
    return this.redo.length > 0;
  }

  /**
   * Pop the previous pattern off the stack. The *current* pattern is
   * pushed onto the redo stack so the caller can swap straight back.
   * Returns null if nothing to undo.
   */
  undoStep(current: Pattern): Pattern | null {
    if (!this.undo.length) return null;
    const cur = clonePattern(current);
    this.redo.push(cur);
    this.redoBytes += cur.cells.byteLength;
    const popped = this.undo.pop()!;
    this.undoBytes -= popped.cells.byteLength;
    // Redo stack respects the same byte budget — but never below MIN.
    while (
      this.redoBytes > this.maxBytes &&
      this.redo.length > HISTORY_MIN_SNAPSHOTS
    ) {
      const evicted = this.redo.shift()!;
      this.redoBytes -= evicted.cells.byteLength;
    }
    return popped;
  }

  /** Symmetric inverse of {@link undoStep}. */
  redoStep(current: Pattern): Pattern | null {
    if (!this.redo.length) return null;
    const cur = clonePattern(current);
    this.undo.push(cur);
    this.undoBytes += cur.cells.byteLength;
    const popped = this.redo.pop()!;
    this.redoBytes -= popped.cells.byteLength;
    while (
      this.undoBytes > this.maxBytes &&
      this.undo.length > HISTORY_MIN_SNAPSHOTS
    ) {
      const evicted = this.undo.shift()!;
      this.undoBytes -= evicted.cells.byteLength;
    }
    return popped;
  }

  reset(p: Pattern): void {
    this.undo.length = 0;
    this.redo.length = 0;
    this.undoBytes = 0;
    this.redoBytes = 0;
    const snap = clonePattern(p);
    this.undo.push(snap);
    this.undoBytes = snap.cells.byteLength;
  }

  /** Replace current snapshot if the new pattern differs from the top. */
  replaceIfChanged(p: Pattern): void {
    const top = this.undo[this.undo.length - 1];
    if (!top || !patternsEqual(top, p)) {
      this.reset(p);
    }
  }

  /** Live memory (bytes) held by both undo + redo stacks. For diagnostics. */
  bytesHeld(): number {
    return this.undoBytes + this.redoBytes;
  }

  /** Number of undo snapshots currently held. */
  undoDepth(): number {
    return this.undo.length;
  }

  /** Number of redo snapshots currently held. */
  redoDepth(): number {
    return this.redo.length;
  }
}