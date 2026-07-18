import type { MirrorMode, Pattern } from "../domain/types.js";
import { superTileCanvas } from "./super-tile-canvas.js";

/**
 * Tile the current super-tile across the entire page background. This is the
 * redesign's headliner: every stroke lands *everywhere* on the page.
 *
 * The fetch is rAF-batched: rev-bumps during a fast drag coalesce into one
 * rasterize per animation frame, which keeps the body `background-image`
 * swap cheap on rapid strokes. We don't cache the data URL here — the
 * super-tile canvas is already content-fingerprint-memoised in
 * {@link superTileCanvas}, so when the pattern is unchanged (but rev still
 * bumps, e.g. on a no-op stroke) `toDataURL` runs against the already-built
 * canvas (cheap). When content DOES change, the fingerprint differs, a
 * fresh super-tile canvas is built, and the body background updates with
 * it. The old code had a content-unaware cache here, which made the page
 * background freeze in place when only the cells changed (the dimensions
 * had to change for the cache to miss).
 */

let pending: null | { pattern: Pattern; mode: MirrorMode; bgScale: number } = null;
let rafId = 0;

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
  document.body.style.backgroundImage = "";
  document.body.style.backgroundSize = "";
  document.body.style.backgroundRepeat = "";
  document.body.style.backgroundPosition = "";
  document.body.style.backgroundAttachment = "";
}

function applyBg(url: string, w: number, h: number): void {
  document.body.style.backgroundImage = `url("${url}")`;
  document.body.style.backgroundRepeat = "repeat";
  document.body.style.backgroundSize = `${w}px ${h}px`;
  document.body.style.backgroundPosition = "0 0";
  document.body.style.backgroundAttachment = "fixed";
}