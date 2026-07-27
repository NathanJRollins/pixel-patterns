import type { MirrorMode, Pattern } from "../domain/types.js";
import { superTileCanvas } from "./super-tile-canvas.js";

/**
 * Render the current pattern to a full-image canvas and return a PNG `Blob`.
 * Tiling uses `createPattern` + a single `fillRect`, same as the preview,
 * so even large exports are one GPU blit after the super-tile is built.
 *
 * Output modes:
 *   - **Single tile** (default): no `outWidth`/`outHeight` provided. The
 *     output canvas is exactly the super-tile dimensions × `cellScale`. The
 *     user's OS can then tile it as a wallpaper without us baking in
 *     repeats.
 *   - **Tile to size**: `outWidth`/`outHeight` provided. The output canvas
 *     is sized to them; the super-tile repeats via `createPattern('repeat')`
 *     to fill the whole canvas. This is the "one-image desktop wallpaper"
 *     export.
 *
 * `cellScale` controls how big one super-tile cell is in the output image;
 *   `cellScale = 16` means each pattern cell becomes a 16-pixel block.
 *
 * `interpolate` flips on bilinear smoothing — for users who want the soft
 * look. Default off (pixel-perfect is the spec).
 */
export interface ExportOptions {
  cellScale: number;
  interpolate: boolean;
  /** If provided, tile to this width. If omitted, output is one super-tile. */
  outWidth?: number;
  /** If provided, tile to this height. If omitted, output is one super-tile. */
  outHeight?: number;
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
  const outW = Math.max(1, Math.round(opts.outWidth ?? tile.width));
  const outH = Math.max(1, Math.round(opts.outHeight ?? tile.height));
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