import { clonePattern, patternsEqual } from "./pattern.js";
import type { Pattern } from "./types.js";

/**
 * Undo / redo history.
 *
 * A snapshot is a deep clone of the {@link Pattern} (small: a few hundred
 * bytes for typical grids). We push a snapshot at the *start* of each stroke
 * — i.e. before a mutating tool fires — so `undo` reverts the most recent
 * stroke. Cap at {@link HISTORY_CAP}; older snapshots drop FIFO.
 *
 * History stores *patterns only*; UI state (tool, color, mode) is fine to
 * mutate freely between strokes — undo/redo won't disturb those.
 */

const HISTORY_CAP = 64;

export class History {
  private undo: Pattern[] = [];
  private redo: Pattern[] = [];

  /** Snapshot the *current* (pre-mutation) state, clearing the redo stack. */
  push(p: Pattern): void {
    this.undo.push(clonePattern(p));
    if (this.undo.length > HISTORY_CAP) this.undo.shift();
    if (this.redo.length) this.redo.length = 0;
  }

  canUndo(): boolean {
    return this.undo.length > 0;
  }

  canRedo(): boolean {
    return this.redo.length > 0;
  }

  /**
   * Pop the previous pattern off the stack. The *current* pattern is pushed
   * onto the redo stack so the caller can swap straight back. Returns null
   * if nothing to undo.
   */
  undoStep(current: Pattern): Pattern | null {
    if (!this.undo.length) return null;
    this.redo.push(clonePattern(current));
    return this.undo.pop()!;
  }

  /** Symmetric inverse of {@link undoStep}. */
  redoStep(current: Pattern): Pattern | null {
    if (!this.redo.length) return null;
    this.undo.push(clonePattern(current));
    return this.redo.pop()!;
  }

  reset(p: Pattern): void {
    this.undo.length = 0;
    this.redo.length = 0;
    this.undo.push(clonePattern(p));
  }

  /** Replace current snapshot if the new pattern differs from the top. */
  replaceIfChanged(p: Pattern): void {
    const top = this.undo[this.undo.length - 1];
    if (!top || !patternsEqual(top, p)) {
      this.reset(p);
    }
  }
}