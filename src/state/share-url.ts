import { decodePattern, encodePattern } from "../domain/pattern.js";
import { packRGBA, unpackRGBA } from "../domain/color.js";
import type { Cell, ColorSlot, MirrorMode, Pattern } from "../domain/types.js";

/**
 * Share-URL encoding.
 *
 * Compact hash encoding of `{ pattern, mode, primaryColor + alpha,
 * secondaryColor + alpha, activeColorSlot }` into `location.hash` so a
 * copied URL alone reconstructs the user's work.
 *
 * Format:
 *   `#p=WxH,mode,RRGGBBp,alphaP,RRGGBBs,alphaS,slot,cells`
 *   - width/height are decimal
 *   - mode is `n | h | v | hv`
 *   - hex is `RRGGBB` (alpha carried explicitly)
 *   - alpha is decimal 0..1, 2 digits
 *   - slot is `p | s` (which is the active slot)
 *   - cells is the {@link encodePattern} body from pattern.ts
 *
 * (No back-compat shim for a previous single-color format — the operator
 * confirmed that no shipped URLs exist in the wild yet, so we keep the
 * codec clean and refuse anything malformed. The pattern content can
 * never contain a `,' in the current encoding, so the 8-way comma split
 * is unambiguous.)
 *
 * Typical sizes: a 7×7 with a few cells is 100–150 chars, well under any
 * URL length limit.
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

const SLOT_SHORT: Record<ColorSlot, string> = {
  primary: "p",
  secondary: "s",
};

const SHORT_SLOT: Record<string, ColorSlot> = {
  p: "primary",
  s: "secondary",
};

export interface SharePayload {
  pattern: Pattern;
  mode: MirrorMode;
  color: Cell; // primary
  alpha01: number; // primary
  secondaryColor?: Cell;
  secondaryAlpha01?: number;
  activeColorSlot?: ColorSlot;
}

export function shareUrlEncode(p: SharePayload): string {
  const primary = p.color === 0 ? packRGBA(0xcc, 0x33, 0xcc, 255) : p.color;
  const [pr, pg, pb] = unpackRGBA(primary);
  const hexP = hex2(pr) + hex2(pg) + hex2(pb);
  const alphaP = p.alpha01.toFixed(2);

  // Secondary — if missing, encode default-white at full opacity.
  const secColor = p.secondaryColor === undefined || p.secondaryColor === 0 ? packRGBA(0xff, 0xff, 0xff, 255) : p.secondaryColor;
  const [sr, sg, sb] = unpackRGBA(secColor);
  const hexS = hex2(sr) + hex2(sg) + hex2(sb);
  const alphaS = (p.secondaryAlpha01 ?? 1).toFixed(2);

  const slot = SLOT_SHORT[p.activeColorSlot ?? "primary"];

  const body = encodePattern(p.pattern).split(":")[1] ?? "";
  const head = `${p.pattern.width}x${p.pattern.height}`;
  return `#p=${head},${MODE_SHORT[p.mode]},${hexP},${alphaP},${hexS},${alphaS},${slot},${body}`;
}

export function shareUrlDecode(): SharePayload | null {
  const hash = window.location.hash;
  if (!hash || !hash.startsWith("#p=")) return null;
  const payload = hash.slice(3);
  const parts = payload.split(",");
  if (parts.length !== 8) return null;
  const [head, modeShort, hexP, alphaP, hexS, alphaS, slotShort, body] = parts;

  const x = head.indexOf("x");
  if (x < 0) return null;
  const w = parseInt(head.slice(0, x), 10);
  const h = parseInt(head.slice(x + 1), 10);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;

  const mode = SHORT_MODE[modeShort] ?? "none";

  const a01P = Math.max(0, Math.min(1, parseFloat(alphaP) || 1));
  const pr = parseInt(hexP.slice(0, 2), 16);
  const pg = parseInt(hexP.slice(2, 4), 16);
  const pb = parseInt(hexP.slice(4, 6), 16);
  const color = packRGBA(pr, pg, pb, Math.round(a01P * 255));

  const a01S = Math.max(0, Math.min(1, parseFloat(alphaS) || 1));
  const sr = parseInt(hexS.slice(0, 2), 16);
  const sg = parseInt(hexS.slice(2, 4), 16);
  const sb = parseInt(hexS.slice(4, 6), 16);
  const secondaryColor = packRGBA(sr, sg, sb, Math.round(a01S * 255));

  const activeColorSlot = SHORT_SLOT[slotShort] ?? "primary";

  const pattern = decodePattern(`${w}x${h}:${body ?? ""}`);
  if (!pattern) return null;

  return {
    pattern,
    mode,
    color,
    alpha01: a01P,
    secondaryColor,
    secondaryAlpha01: a01S,
    activeColorSlot,
  };
}

/** Replace the URL hash without scrolling/without dispatching a hashchange
 * that would re-trigger loadFromShareUrl loops. */
export function replaceShareHash(hash: string): void {
  if (hash === window.location.hash) return;
  history.replaceState(null, "", hash || "#");
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, "0");
}