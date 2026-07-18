import type { MirrorMode, Pattern } from "../domain/types.js";
import { superTileCanvas } from "./super-tile-canvas.js";

/**
 * Render the preview panel. The hot path is one `fillRect` with a
 * `createPattern('repeat')` fillStyle — constant cost, independent of the
 * preview canvas size. The expensive bit (rendering the offscreen super-tile
 * canvas) is memoised in {@link superTileCanvas}; here we just wrap that
 * canvas in a `CanvasPattern` and fill the panel once.
 *
 * DPR handling: the canvas element's backing store is scaled to
 * `devicePixelRatio` so the preview stays pixel-crisp on HiDPI screens.
 * `image-rendering: pixelated` on the element (set in CSS) ensures the GL
 * blit uses nearest-neighbour, so on-screen tile pixels stay sharp.
 */

export interface PreviewRenderInput {
  pattern: Pattern;
  mode: MirrorMode;
  cellPx: number; // size of one super-tile cell in device px on the offscreen canvas
}

export function renderPreview(
  canvas: HTMLCanvasElement,
  input: PreviewRenderInput,
): void {
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW === 0 || cssH === 0) return;
  const backingW = Math.floor(cssW * dpr);
  const backingH = Math.floor(cssH * dpr);
  if (canvas.width !== backingW) canvas.width = backingW;
  if (canvas.height !== backingH) canvas.height = backingH;

  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const tile = superTileCanvas(input.pattern, input.mode, input.cellPx);
  const pattern = ctx.createPattern(tile, "repeat");
  if (!pattern) return;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}