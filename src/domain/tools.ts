import { mirrorCell } from "./mirror.js";
import type { MirrorMode } from "./types.js";

/**
 * Tool-behaviour helpers that are pure (no Preact, no store).
 *
 * Mutation paths (pencil / eraser / bucket / dropper) live in the store
 * (`Store.bucketFillAt`, `Store.paintAt`, `Store.paintLine`) so they can
 * bump `rev`, thread the active slot's colour, and push history. This
 * module only owns {@link bridgeLine}, the Bresenham helper the UI calls
 * on `pointermove` to avoid skipping cells on fast drags.
 *
 * A "stroke" is the sequence of mutations between pointer-down and
 * pointer-up. Drag continuity: when the pointer moves fast enough to
 * skip cells, the UI bridge calls {@link bridgeLine} to Bresenham-fill
 * every cell between the previous and current hit, with mirror expansion
 * applied per hit so the fill lands symmetrically.
 */

/**
 * Bridge between two cells (inclusive) using Bresenham. Returns the
 * ordered list of cells to visit, with mirror expansion. Used by the UI
 * on `pointermove` to avoid skipping cells on fast drags.
 */
export function bridgeLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  height: number,
  mode: MirrorMode,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let cx = x0;
  let cy = y0;
  // safety bound: never iterate more than width+height times
  const cap = width + height + 4;
  let n = 0;
  for (;;) {
    for (const [px, py] of mirrorCell(cx, cy, width, height, mode)) {
      out.push([px, py]);
    }
    if (cx === x1 && cy === y1) break;
    if (n++ > cap) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      cx += sx;
    }
    if (e2 <= dx) {
      err += dx;
      cy += sy;
    }
  }
  return out;
}