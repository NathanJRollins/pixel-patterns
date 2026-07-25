import type { MirrorMode, Pattern } from "../domain/types.js";
import { superTileCanvas } from "./super-tile-canvas.js";

/**
 * Tile the current super-tile across the entire page background. This is the
 * redesign's headliner: every stroke lands *everywhere* on the page.
 *
 * The rasterize pass is rAF-batched: rev-bumps during a fast drag coalesce
 * into one rasterize per animation frame, keeping the body `background-image`
 * swap cheap on rapid strokes. We don't cache the data URL here — the
 * super-tile canvas is already content-fingerprint-memoised in
 * {@link superTileCanvas}.
 *
 * Flicker handling: setting `body.style.backgroundImage = 'url("data:...")'`
 * atomically invalidates the previous URL the instant the new CSS value is
 * committed, but the *new* PNG still has to decode before it can paint. For
 * large super-tiles the decode window is noticeable and the body's
 * `background-color` (which is dark — `--surface-0`) flashes through for a
 * frame or two. We eliminate the flicker by **preloading** the new URL via
 * an `Image()` element and only swapping the body bg in the image's
 * `onload` callback — the old bg stays in place until the new PNG is
 * fully decoded and ready to paint immediately.
 */

let pending: null | { pattern: Pattern; mode: MirrorMode; bgScale: number } = null;
let rafId = 0;
let currentUrl = ""; // the most recent URL we successfully applied to body

export function updatePageBackground(
  pattern: Pattern,
  mode: MirrorMode,
  bgScale: number,
): void {
  pending = { pattern, mode, bgScale };
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    const job = pending;
    pending = null;
    if (!job) return;
    const cellPx = Math.max(1, Math.round(job.bgScale));
    const tile = superTileCanvas(job.pattern, job.mode, cellPx);
    const url = tile.toDataURL("image/png");
    applyBg(url, tile.width, tile.height);
  });
}

export function clearPageBackground(): void {
  pending = null;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  currentUrl = "";
  document.body.style.backgroundImage = "";
  document.body.style.backgroundSize = "";
  document.body.style.backgroundRepeat = "";
  document.body.style.backgroundPosition = "";
  document.body.style.backgroundAttachment = "";
}

function applyBg(url: string, w: number, h: number): void {
  if (url === currentUrl) return;
  const sizeRule = `${w}px ${h}px`;
  // Preload the new PNG before swapping the body bg. Data-URL decodes happen
  // off the main thread and may take a frame or two for very large
  // super-tiles; if we set the body bg first, the old image is invalidated
  // the instant the new CSS value commits and the dark `--surface-0` body
  // bg flashes through for that gap. Waiting for `img.onload` ensures the
  // swap is atomic from the user's perspective: the previous image is
  // shown right up until the new one is ready, and the new one is ready
  // the moment it's set.
  const img = new Image();
  img.onload = () => {
    document.body.style.backgroundImage = `url("${url}")`;
    document.body.style.backgroundRepeat = "repeat";
    document.body.style.backgroundSize = sizeRule;
    document.body.style.backgroundPosition = "0 0";
    document.body.style.backgroundAttachment = "fixed";
    currentUrl = url;
  };
  img.onerror = () => {
    // Fall back to swap-immediately if the preload fails for any reason;
    // better a flicker than a permanent blank.
    document.body.style.backgroundImage = `url("${url}")`;
    document.body.style.backgroundRepeat = "repeat";
    document.body.style.backgroundSize = sizeRule;
    document.body.style.backgroundPosition = "0 0";
    document.body.style.backgroundAttachment = "fixed";
    currentUrl = url;
  };
  img.src = url;
}