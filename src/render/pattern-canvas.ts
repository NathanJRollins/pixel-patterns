import { cellToCss } from "../domain/color.js";
import type { Pattern } from "../domain/types.js";

/**
 * Render a {@link Pattern} to an offscreen canvas at a chosen cell pixel
 * size. Returns the canvas; the caller owns it (no caching here).
 *
 * Used by the super-tile compositor (which then feeds `createPattern`) and
 * directly by export-png. Drawn cell sizes are integers in device pixels so
 * `imageSmoothingEnabled = false` on the consumer produces pixel-perfect
 * tiling with no sub-pixel slop.
 */
export function renderPatternToCanvas(
  p: Pattern,
  cellPx: number,
  opts: { checkerboard?: boolean } = {},
): HTMLCanvasElement {
  const w = p.width * cellPx;
  const h = p.height * cellPx;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);

  if (opts.checkerboard) {
    drawCheckerboard(ctx, w, h, cellPx);
  }

  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      const cell = p.cells[y * p.width + x];
      if (cell === 0) continue;
      ctx.fillStyle = cellToCss(cell);
      ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
    }
  }
  return canvas;
}

/** Subtle light-gray + transparent checkerboard so transparent cells are legible. */
export function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cellPx: number,
): void {
  // 8 device-px squares is the standard pixel-art-editor scale.
  const sq = Math.max(4, cellPx);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  for (let y = 0; y < h; y += sq) {
    for (let x = 0; x < w; x += sq) {
      if ((((x / sq) | 0) + ((y / sq) | 0)) % 2 === 0) {
        ctx.fillRect(x, y, sq, sq);
      }
    }
  }
}