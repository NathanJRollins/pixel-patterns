import type { MirrorMode, Pattern } from "../domain/types.js";
import { superTileCanvas } from "./super-tile-canvas.js";

/**
 * Render the current pattern to a full-image canvas at a chosen target size
 * (in CSS px) and return a PNG `Blob`. Tiling uses `createPattern` + a
 * single `fillRect`, same as the preview, so even large exports are one
 * GPU blit after the super-tile is built.
 *
 * `cellScale` controls how big one super-tile cell is in the output image;
 * e.g. `cellScale = 16` means each ·pattern cell becomes a 16-pixel block.
 * Output dimensions are computed as `superW * cellScale × superH * cellScale`,
 * rounded to the nearest 8 px so the result crops cleanly on the tile grid.
 *
 * `interpolate` flips on bilinear smoothing — for users who want the soft
 * look on a wireframe pattern. Default off (pixel-perfect is the spec).
 */
export interface ExportOptions {
  cellScale: number;
  interpolate: boolean;
}

export interface ExportResult {
  blob: Blob;
  width: number;
  height: number;
}

export async function exportPatternPng(
  pattern: Pattern,
  mode: MirrorMode,
  opts: ExportOptions,
): Promise<ExportResult> {
  const cellScale = Math.max(1, Math.round(opts.cellScale));
  const tile = superTileCanvas(pattern, mode, cellScale);
  const outW = tile.width;
  const outH = tile.height;
  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = opts.interpolate;
  ctx.clearRect(0, 0, outW, outH);
  const pat = ctx.createPattern(tile, "repeat");
  if (!pat) throw new Error("createPattern returned null");
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, outW, outH);
  const blob = await new Promise<Blob | null>((resolve) =>
    out.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("toBlob returned null");
  return { blob, width: outW, height: outH };
}

/** Trigger a download for an exported PNG blob. No-op outside a user gesture
 * would be browser-blocked, so UI callers must invoke this from a click handler. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click handler has unwound; immediate revoke sometimes
  // racing the download on Firefox.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}