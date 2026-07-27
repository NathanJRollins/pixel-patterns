import type { MirrorMode, Pattern } from "../domain/types.js";
import { superTileCanvas } from "./super-tile-canvas.js";

/**
 * Tile the current super-tile across the entire page background. This is the
 * redesign's headliner: every stroke lands *everywhere* on the page.
 *
 * The previous implementation set the body element's `background-image` to a
 * PNG data URL — which two problems (#3 in todo.txt): (1) the browser paints
 * the body's `background-size` in CSS px, so page zoom scales the tile along
 * with the rest of the UI (the user explicitly wanted the tile to stay at N
 * real device px no matter the zoom); (2) swapping the bg URL at a high
 * re-render cadence rebuilt / decoded the PNG every stroke, with a small but
 * real flash window between the old URL being invalidated and the new one's
 * `Image.onload` firing. The previous fix for (2) was a preload-`Image`-then-
 * swap dance that this file no longer needs at all.
 *
 * The new approach replaces the CSS body-background entirely with a
 * **single fixed full-viewport `<canvas>`** mounted behind everything else
 * (see `App.tsx`'s `<canvas class="page-bg-canvas">`). The canvas's backing
 * store is sized at `devicePixelRatio × clientWidth/Height`; the rasterize
 * pass paints the super-tile as a `createPattern('repeat')` *directly onto
 * the canvas*, at `cellPx = bgScale` *device* px per pattern cell. Because
 * the browser renders the canvas's backing store 1:1 to real device pixels
 * (the canvas CSS-size is `100vw × 100vh`), each super-tile cell ends up at
 * exactly `bgScale` real physical px on screen — independent of zoom.
 *
 * Repaints are rAF-batched (rev bumps during a fast drag coalesce into a
 * single paint per frame). ResizeObserver on the canvas fires on every
 * CSS-pixel layout change — which includes browser zoom, since browsers
 * shrink `clientWidth`/`clientHeight` in proportion to zoom — so the
 * backing store re-sizes at paint time to match the user's current zoom.
 *
 * Lifecycle:
 *   - {@link mountPageBackground} is called once on app mount.
 *   - {@link updatePageBackground} is called on every rev / mode / bgScale
 *     change with the new (pattern, mode, scale) — coalesced by rAF.
 *   - {@link clearPageBackground} paints empty when the user disables the
 *     page-bg toggle.
 *   - {@link unmountPageBackground} is called on app teardown.
 */

/** Device-px-cap on the backing store per side. At 8K that's already 64 MP
 * device px, which on a 4-byte RGBA backing would be 256 MB raw — the
 * realistic-usefulness limit before paint performance starts to suffer
 * catastrophically on the body bg. */
const DEVICE_PX_MAX_DIM = 8192;

let canvasEl: HTMLCanvasElement | null = null;
let resizeObs: ResizeObserver | null = null;
let pending: { pattern: Pattern; mode: MirrorMode; bgScale: number } | null = null;
let rafId = 0;
let lastPaintedKey = "";

/** Mount the page-bg target. Idempotent — re-mounting (or mounting a
 * different canvas) re-targets without leaking the old observer. */
export function mountPageBackground(canvas: HTMLCanvasElement): void {
  if (canvasEl === canvas && resizeObs) return;
  // Ensure any prior canvas is unmounted (no observer leak).
  if (canvasEl) unmountPageBackground();
  canvasEl = canvas;
  if (typeof ResizeObserver !== "undefined") {
    resizeObs = new ResizeObserver(() => scheduleRepaint(/* force */ true));
    resizeObs.observe(canvas);
  }
  scheduleRepaint(true);
}

/** Disconnect observers and stop pending rAF — used for app teardown. */
export function unmountPageBackground(): void {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (resizeObs) {
    resizeObs.disconnect();
    resizeObs = null;
  }
  if (canvasEl) {
    const ctx = canvasEl.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  }
  pending = null;
  lastPaintedKey = "";
  canvasEl = null;
}

/**invalidate the cached `paint key` so the next `paintNow` doesn't
 * short-circuit on the "nothing changed" path. Needed because the
 * ResizeObserver path means the backing-store dimensions changed even
 * if the (pattern, mode, bgScale) tuple is identical.
 */
function scheduleRepaint(force = false): void {
  if (force) lastPaintedKey = "";
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    paintNow();
  });
}

/** Replace the body background with the current super-tile pattern. */
export function updatePageBackground(
  pattern: Pattern,
  mode: MirrorMode,
  bgScale: number,
): void {
  pending = { pattern, mode, bgScale };
  scheduleRepaint();
}

/** Clear the page bg (visible toggle off). */
export function clearPageBackground(): void {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  pending = null;
  lastPaintedKey = "";
  if (canvasEl) {
    const ctx = canvasEl.getContext("2d");
    if (ctx && canvasEl.width > 0 && canvasEl.height > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    }
  }
}

/** Force a repaint during the current rAF tick — exposed for tests so
 * they can drive a synchronous flutter of paint code paths. */
export function repaintPageBackgroundNow(): void {
  paintNow();
}

function paintNow(): void {
  if (!canvasEl || !pending) return;
  const { pattern, mode, bgScale } = pending;
  // dpr is a real fraction on most HiDPI setups (1.25, 1.5, 2.5 …) — keep
  // it as the raw `window.devicePixelRatio` and only floor when computing
  // the integer backing-store dims. This keeps a 1.5× display from losing
  // 25% of its DPI in the canvas; the alternative path (flooring dpr) was
  // borrowed from the draw-grid-render code but isn't right here because
  // we draw at integer device px (identity transform) so dpr doesn't have
  // to be integer.
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = canvasEl.clientWidth;
  const cssH = canvasEl.clientHeight;
  if (cssW === 0 || cssH === 0) return;
  let backingW = Math.floor(cssW * dpr);
  let backingH = Math.floor(cssH * dpr);
  if (backingW > DEVICE_PX_MAX_DIM) backingW = DEVICE_PX_MAX_DIM;
  if (backingH > DEVICE_PX_MAX_DIM) backingH = DEVICE_PX_MAX_DIM;

  // Short-circuit: if neither the (pattern, mode, bgScale) job NOR the
  // backing-store dimensions changed since the last paint, the live
  // canvas already reflects what we'd repaint. This was previously
  // cached at the `superTileCanvas` level too; the extra explicit key
  // here covers the (resize → same job) case which the underlying cache
  // would also handle, but skipping the rAF-bound paint entirely is a
  // bigger win on rapid rev bumps that aren't actually different.
  const key = `${backingW}x${backingH}:${mode}:${bgScale}:${patternFingerprint(pattern)}`;
  if (key === lastPaintedKey) return;

  if (canvasEl.width !== backingW) canvasEl.width = backingW;
  if (canvasEl.height !== backingH) canvasEl.height = backingH;
  // Identity transform — paintNow draws in device-px units on the
  // backing store directly. (The previous `setTransform(dpr, ...)` was
  // an alternative path where we'd paint in CSS units and let the
  // canvas scale — that ended up reintroducing the very zoom scaling
  // we set out to defeat in #3, so we draw in device px here.)
  const ctx = canvasEl.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, backingW, backingH);
  const cellPx = Math.max(1, Math.round(bgScale));
  // `superTileCanvas`'s cache is keyed on (pattern object identity, mode,
  // cellPx) — so this stays cheap across rev bumps that don't actually
  // change the super-tile (the dominant path during a paint stroke).
  const tile = superTileCanvas(pattern, mode, cellPx);
  const fillPattern = ctx.createPattern(tile, "repeat");
  if (!fillPattern) return;
  ctx.fillStyle = fillPattern;
  ctx.fillRect(0, 0, backingW, backingH);

  // Hide old CSS-body-bg residue from the previous implementation.
  // The very first paint on a fresh user moves the bg out of the body's
  // `style.backgroundImage`; subsequent paints maintain it empty.
  if (document.body && document.body.style.backgroundImage) {
    document.body.style.backgroundImage = "";
    document.body.style.backgroundSize = "";
    document.body.style.backgroundRepeat = "";
    document.body.style.backgroundPosition = "";
    document.body.style.backgroundAttachment = "";
  }

  lastPaintedKey = key;
}

/** A cheap-ish content fingerprint so the paint short-circuit doesn't
 * false-match when the pattern object identity changed but the cells
 * differ. Re-uses the same FNV-1a striding as `super-tile-canvas.ts`'s
 * `cellFingerprint`, so the cache there and the cache here move together:
 * whenever `superTileCanvas` rebuilds, paintNow repaints — and never the
 * reverse. */
function patternFingerprint(p: Pattern): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < p.cells.length; i++) {
    h ^= p.cells[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}