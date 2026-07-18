import type { MirrorMode, Pattern } from "../domain/types.js";
import { superTileCanvas } from "./super-tile-canvas.js";

/**
 * Update the document favicon to the current super-tile. Called at stroke
 * end (cheap once the tile canvas is memoised) so the browser tab badge
 * becomes the user's current pattern. Falls back silently if no favicon link
 * element is present.
 *
 * We render at a fixed target of 32 × 32 device px by picking the largest
 * integer cellScale that keeps the super-tile ≤ that size. That keeps the
 * icon crisp without forcing a particular grid dimension.
 */

const FAVICON_PX = 32;

let lastKey: string | null = null;
let lastDataUrl: string | null = null;
let linkEl: HTMLLinkElement | null = null;

export function updateFavicon(pattern: Pattern, mode: MirrorMode): void {
  const tile = superTileCanvas(pattern, mode, 1);
  const targetScale = Math.max(
    1,
    Math.floor(FAVICON_PX / Math.max(tile.width, tile.height)),
  );
  // Use the larger of (targetScale, FAVICON_PX / MAX_DIM) so even a small
  // pattern still produces a centered icon: we scale the underlying canvas
  // to roughly FAVICON_PX square via `drawImage` with `imageSmoothingEnabled=false`.
  const out = document.createElement("canvas");
  out.width = FAVICON_PX;
  out.height = FAVICON_PX;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  // Build a thumbnail at integer cellScale so cells are pixel-perfect.
  const srcScale = superTileCanvas(pattern, mode, targetScale);
  // Centre inside the 32×32 canvas.
  const w = srcScale.width;
  const h = srcScale.height;
  const dx = Math.floor((FAVICON_PX - w) / 2);
  const dy = Math.floor((FAVICON_PX - h) / 2);
  ctx.drawImage(srcScale, dx, dy);

  const key = `${mode}:${pattern.width}:${pattern.height}:${pattern.cells.length}:${targetScale}:${tile === srcScale ? 1 : 0}`;
  if (key === lastKey && lastDataUrl) {
    applyFavicon(lastDataUrl);
    return;
  }
  lastKey = key;
  lastDataUrl = out.toDataURL("image/png");
  applyFavicon(lastDataUrl);
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