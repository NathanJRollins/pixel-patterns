import { decodePattern, encodePattern } from "../domain/pattern.js";
import { packRGBA, unpackRGBA } from "../domain/color.js";
import type { Cell, MirrorMode, Pattern } from "../domain/types.js";

/**
 * Share-URL encoding.
 *
 * Compact hash encoding of `{ pattern, mode, color, alpha01 }` into the
 * URL `location.hash` so a copied URL alone reconstructs the user's work.
 *
 * Format:
 *   `#p=<width>x<height>,<mode>,<hexcolor>,<alpha01>,<encodedCells>`
 * where:
 *   - width/height are decimal integers
 *   - mode is one of `n | h | v | hv` (single-char-ish)
 *   - hexcolor is `RRGGBB` (alpha carried separately so we don't bloat)
 *   - alpha01 is decimal 0..1 with up to 2 digits of precision
 *   - encodedCells is the {@link encodeHexPlain} form.
 *
 * Typical sizes: a 5×5 with a few cells lands around 80–120 chars, well
 * under any URL length limit.
 */

const MODE_SHORT: Record<MirrorMode, string> = {
  none: "n",
  H: "h",
  V: "v",
  HV: "hv",
};

const SHORT_MODE: Record<string, MirrorMode> = {
  n: "none",
  h: "H",
  v: "V",
  hv: "HV",
};

interface SharePayload {
  pattern: Pattern;
  mode: MirrorMode;
  color: Cell;
  alpha01: number;
}

export function shareUrlEncode(p: SharePayload): string {
  // Use the original default color if the user is somehow on the transparent
  // sentinel, so the share URL always carries a usable paint color.
  const color = p.color === 0 ? packRGBA(0xcc, 0x33, 0xcc, 255) : p.color;
  const [r, g, b] = unpackRGBA(color);
  const hex = hex2(r) + hex2(g) + hex2(b);
  const alpha = p.alpha01.toFixed(2);
  const body = encodePattern(p.pattern).split(":")[1] ?? "";
  const head = `${p.pattern.width}x${p.pattern.height}`;
  return `#p=${head},${MODE_SHORT[p.mode]},${hex},${alpha},${body}`;
}

export function shareUrlDecode(): SharePayload | null {
  const hash = window.location.hash;
  if (!hash || !hash.startsWith("#p=")) return null;
  const payload = hash.slice(3);
  const parts = payload.split(",");
  if (parts.length < 5) return null;
  const [head, modeShort, hex, alpha, body] = parts;
  const x = head.indexOf("x");
  if (x < 0) return null;
  const w = parseInt(head.slice(0, x), 10);
  const h = parseInt(head.slice(x + 1), 10);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  const mode = SHORT_MODE[modeShort] ?? "none";
  const a01 = Math.max(0, Math.min(1, parseFloat(alpha) || 1));
  const alpha255 = Math.round(a01 * 255);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const color = packRGBA(r, g, b, alpha255);
  const pattern = decodePattern(`${w}x${h}:${body ?? ""}`);
  if (!pattern) return null;
  return { pattern, mode, color, alpha01: a01 };
}

/** Replace the URL hash without scrolling/without dispatching a hashchange
 * that would re-trigger loadFromShareUrl loops. */
export function replaceShareHash(hash: string): void {
  if (hash === window.location.hash) return;
  // `replaceState` avoids the user's back button swallowing intermediate
  // share states.
  history.replaceState(null, "", hash || "#");
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, "0");
}