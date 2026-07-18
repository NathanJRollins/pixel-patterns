import type { MirrorMode, Pattern } from "../domain/types.js";
import { superTileCanvas } from "./super-tile-canvas.js";

/**
 * Tile the current super-tile across the entire page background. This is the
 * redesign's headliner: every stroke lands *everywhere* on the page.
 *
 * We render the super-tile to an offscreen canvas at a small cell scale, get
 * a data URL, and set `document.body.style.backgroundImage`. Cost is one
 * brief re-rasterize on stroke end — cheap once the super-tile canvas is
 * memoised.
 *
 * `bgScale` multiplies the per-tile cell size, letting the user make the
 * page scale bigger or smaller independently of the preview panel.
 */

let lastKey: string | null = null;
let lastUrl: string | null = null;

export function updatePageBackground(
  pattern: Pattern,
  mode: MirrorMode,
  bgScale: number,
): void {
  const cellPx = Math.max(1, Math.round(bgScale));
  const tile = superTileCanvas(pattern, mode, cellPx);
  const key = `${mode}:${pattern.width}:${pattern.height}:${cellPx}:${tile.width}x${tile.height}`;
  if (key === lastKey && lastUrl) {
    applyBg(lastUrl, tile.width, tile.height);
    return;
  }
  lastKey = key;
  lastUrl = tile.toDataURL("image/png");
  applyBg(lastUrl, tile.width, tile.height);
}

export function clearPageBackground(): void {
  lastKey = null;
  lastUrl = null;
  document.body.style.backgroundImage = "";
  document.body.style.backgroundSize = "";
}

function applyBg(url: string, w: number, h: number): void {
  document.body.style.backgroundImage = `url("${url}")`;
  document.body.style.backgroundRepeat = "repeat";
  document.body.style.backgroundSize = `${w}px ${h}px`;
  document.body.style.backgroundPosition = "0 0";
  document.body.style.backgroundAttachment = "fixed";
}