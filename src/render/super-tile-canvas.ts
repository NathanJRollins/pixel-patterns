import { composeSuperTile } from "../domain/mirror.js";
import type { MirrorMode, Pattern } from "../domain/types.js";
import { renderPatternToCanvas } from "./pattern-canvas.js";

/**
 * Compose the seamless super-tile to an offscreen canvas at the given cell
 * scale. The output is what every tiler (preview, page bg, favicon, export)
 * feeds to `ctx.createPattern(..., 'repeat')`.
 *
 * Memoised on (pattern object identity, mode, cellPx) — the dominant hot
 * path is `pattern unchanged across a redraw trigger`, where skipping the
 * rebuild saves ~`width*height*cellPx²` work each time.
 */
let cachedKey: string | null = null;
let cachedCanvas: HTMLCanvasElement | null = null;

function key(p: Pattern, mode: MirrorMode, cellPx: number): string {
  // Identity + a content fingerprint via the cells byte length is good
  // enough: we never hold two patterns of equal shape but differing content
  // and the same reference simultaneously without a content change.
  return `${mode}:${p.width}:${p.height}:${cellPx}:${cellFingerprint(p)}`;
}

function cellFingerprint(p: Pattern): string {
  // Tiny: just hash a few striding samples. Worst case is a missed cache
  // invalidation and a redraw — never incorrect output. For typical 5×5 this
  // is cheap and tends to be exact anyway because we hash every cell.
  let h = 0x811c9dc5;
  for (let i = 0; i < p.cells.length; i++) {
    h ^= p.cells[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export function superTileCanvas(
  pattern: Pattern,
  mode: MirrorMode,
  cellPx: number,
): HTMLCanvasElement {
  const k = key(pattern, mode, cellPx);
  if (cachedCanvas && cachedKey === k) return cachedCanvas;
  const superTile = composeSuperTile(pattern, mode);
  const canvas = renderPatternToCanvas(superTile, cellPx);
  cachedCanvas = canvas;
  cachedKey = k;
  return canvas;
}

/** Invalidate the cache (e.g. on theme change so colors reblend cleanly). */
export function invalidateSuperTileCache(): void {
  cachedKey = null;
  cachedCanvas = null;
}