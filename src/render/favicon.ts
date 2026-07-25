import type { MirrorMode, Pattern } from "../domain/types.js";
import { superTileCanvas } from "./super-tile-canvas.js";

/**
 * Update the document favicon to the current super-tile. Called at stroke
 * end (cheap once the tile canvas is memoised) so the browser tab badge
 * becomes the user's current pattern. Falls back silently if no favicon
 * link element is present.
 *
 * Each call is rAF-batched so rapid strokes coalesce into one rasterize +
 * `toDataURL`. We render at a fixed 32×32 target size, picking the largest
 * integer `cellScale` that keeps the super-tile within that canvas, then
 * centring the result inside it. The old code cached the data URL by a key
 * that didn't include content — which made the favicon silently stick on
 * its first frame until dimensions changed. We dropped that cache.
 */

const FAVICON_PX = 32;

let pending: null | { pattern: Pattern; mode: MirrorMode } = null;
let rafId = 0;
let linkEl: HTMLLinkElement | null = null;

export function updateFavicon(pattern: Pattern, mode: MirrorMode): void {
  pending = { pattern, mode };
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    const job = pending;
    pending = null;
    if (!job) return;
    rasterize(job.pattern, job.mode);
  });
}

function rasterize(pattern: Pattern, mode: MirrorMode): void {
  // Pick the largest integer cellScale whose super-tile fits inside FAVICON_PX
  // so the rendered icon is crisp without forcing an arbitrary crop.
  const probe = superTileCanvas(pattern, mode, 1);
  const targetScale = Math.max(1, Math.floor(FAVICON_PX / Math.max(probe.width, probe.height)));
  const scaled = superTileCanvas(pattern, mode, targetScale);

  const out = document.createElement("canvas");
  out.width = FAVICON_PX;
  out.height = FAVICON_PX;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    scaled,
    Math.floor((FAVICON_PX - scaled.width) / 2),
    Math.floor((FAVICON_PX - scaled.height) / 2),
  );

  applyFavicon(out.toDataURL("image/png"));
}

function applyFavicon(href: string): void {
  if (!linkEl) {
    linkEl = document.head.querySelector('link[rel="icon"]');
    if (!linkEl) {
      linkEl = document.createElement("link");
      linkEl.rel = "icon";
      document.head.appendChild(linkEl);
    }
  }
  if (linkEl.getAttribute("href") !== href) linkEl.setAttribute("href", href);
}