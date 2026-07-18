import { getCell, setCell } from "./pattern.js";
import { mirrorCell } from "./mirror.js";
import type { Cell, MirrorMode, Pattern, Tool } from "./types.js";

/**
 * Tool behaviours.
 *
 * Each tool produces a list of grid cells to mutate for a given pointer
 * event. Pointer → cell mapping happens in the render/UI layer; this module
 * owns *what happens to the pattern* once a cell is hit.
 *
 * A "stroke" is the sequence of mutations between pointerdown and
 * pointer-up. `applyTool` mutates the pattern in place under that cell and
 * mirrors it under the current mode. The UI batches stroke end as the
 * history_push boundary.
 *
 * Drag continuity: when the pointer moves fast enough to skip cells, the UI
 * bridge calls {@link bridgeLine} to Bresenham-fill every cell between the
 * previous and current hit.
 */

export interface ToolContext {
  pattern: Pattern;
  color: Cell;
  mirrorMode: MirrorMode;
  /** Whether this is the first cell of a new stroke. */
  firstOfStroke: boolean;
}

export interface ToolResult {
  /** Whether any cell actually changed. */
  changed: boolean;
  /** If `dropper` was active, the sampled color (caller writes it to state). */
  sampled?: Cell;
}

/** Apply a tool at a single grid cell. Mutates `ctx.pattern` in place. */
export function applyToolAt(
  tool: Tool,
  x: number,
  y: number,
  ctx: ToolContext,
): ToolResult {
  switch (tool) {
    case "pencil":
      return paintCells(tool, [[x, y]], ctx);
    case "eraser":
      return paintCells(tool, [[x, y]], ctx);
    case "bucket":
      return bucketFill(ctx.pattern, x, y, ctx.color, ctx.mirrorMode);
    case "dropper":
      return { changed: false, sampled: sampleCell(ctx.pattern, x, y) };
    case "line":
      // The UI manages the line's anchor via {@link bridgeLine}; the per-cell
      // action for a line stroke is the same as pencil.
      return paintCells(tool, [[x, y]], ctx);
  }
}

/**
 * Bridge between two cells (inclusive) using Bresenham. Returns the ordered
 * list of cells to visit, with mirror expansion. Used by the UI on
 * `pointermove` to avoid skipping cells on fast drags.
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

function paintCells(
  tool: Tool,
  hits: Array<[number, number]>,
  ctx: ToolContext,
): ToolResult {
  const { pattern, color, mirrorMode } = ctx;
  const c = tool === "eraser" ? 0 : color;
  let changed = false;
  for (const [hx, hy] of hits) {
    for (const [px, py] of mirrorCell(hx, hy, pattern.width, pattern.height, mirrorMode)) {
      if (setCell(pattern, px, py, c)) changed = true;
    }
  }
  return { changed };
}

/** Flood fill in the contiguous region of the cell's current color. */
function bucketFill(
  pattern: Pattern,
  x: number,
  y: number,
  color: Cell,
  mode: MirrorMode,
): ToolResult {
  if (x < 0 || y < 0 || x >= pattern.width || y >= pattern.height) {
    return { changed: false };
  }
  const target = getCell(pattern, x, y);
  if (target === color) return { changed: false };
  const W = pattern.width;
  const H = pattern.height;
  const visited = new Uint8Array(W * H);
  const stack: Array<[number, number]> = [[x, y]];
  let changed = false;
  while (stack.length) {
    const [cx, cy] = stack.pop()!;
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
    const idx = cy * W + cx;
    if (visited[idx]) continue;
    visited[idx] = 1;
    if (getCell(pattern, cx, cy) !== target) continue;
    // Mirror the fill writes.
    for (const [mx, my] of mirrorCell(cx, cy, W, H, mode)) {
      if (setCell(pattern, mx, my, color)) changed = true;
    }
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  return { changed };
}

function sampleCell(pattern: Pattern, x: number, y: number): Cell {
  return getCell(pattern, x, y);
}