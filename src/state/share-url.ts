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
 * Two coexisting formats are decoded for back-compat:
 *
 *   - v1 (the original 5-field format): `#p=WxH,mode,RRGGBB,alpha,cells`
 *     Decoded if the post-`#p=` body splits into exactly 5 comma parts.
 *     The single color becomes the primary; the secondary defaults to
 *     white at full opacity, active slot is primary.
 *
 *   - v2 (the new 8-field format): `#p=WxH,mode,RRGGBBp,alphaP,RRGGBBs,alphaS,slot,cells`
 *     Decoded if the body splits into exactly 8 comma parts. `slot` is
 *     `p` or `s`. New share URLs always use v2.
 *
 * Both formats keep the same head (`WxH`, mode, hex, alpha) so users
 * copy-pasting an old share URL — or one another user sent them when the
 * app was on v1 — still get the pattern + primary color loaded; only the
 * secondary is forced to its default.
 *
 * Mode token: `n`/`h`/`v`/`hv`.
 *
 * Typical sizes: a 5×5 with a few cells is 80–130 chars, well under any
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

/** A paint colour slot — paired with a Cell + an alpha 0..1. */
export interface SharePayload {
  pattern: Pattern;
  mode: MirrorMode;
  color: Cell;
  alpha01: number;
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
  // The body can never contain a ',' in our current encoding, so this split
  // is safe. v1 = 5 parts; v2 = 8 parts. Anything else is malformed.
  if (parts.length === 5) return decodeV1(parts);
  if (parts.length === 8) return decodeV2(parts);
  return null;
}

/** v1 format: `WxH,mode,RRGGBB,alpha,cells`. Single-color share. */
function decodeV1(parts: string[]): SharePayload | null {
  const [head, modeShort, hex, alpha, body] = parts;
  return decodeCommon(head, modeShort, hex, alpha, "ffffff", "1.00", "p", body, false);
}

/** v2 format: `WxH,mode,RRGGBBp,alphaP,RRGGBBs,alphaS,slot,cells`. */
function decodeV2(parts: string[]): SharePayload | null {
  const [head, modeShort, hexP, alphaP, hexS, alphaS, slotShort, body] = parts;
  return decodeCommon(head, modeShort, hexP, alphaP, hexS, alphaS, slotShort, body, true);
}

function decodeCommon(
  head: string,
  modeShort: string,
  hexP: string,
  alphaP: string,
  hexS: string,
  alphaS: string,
  slotShort: string,
  body: string,
  includeSecondary: boolean,
): SharePayload | null {
  const x = head.indexOf("x");
  if (x < 0) return null;
  const w = parseInt(head.slice(0, x), 10);
  const h = parseInt(head.slice(x + 1), 10);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;

  const mode = SHORT_MODE[modeShort] ?? "none";
  const a01P = Math.max(0, Math.min(1, parseFloat(alphaP) || 1));
  const r = parseInt(hexP.slice(0, 2), 16);
  const g = parseInt(hexP.slice(2, 4), 16);
  const b = parseInt(hexP.slice(4, 6), 16);
  const color = packRGBA(r, g, b, Math.round(a01P * 255));

  let secondaryColor: Cell | undefined;
  let secondaryAlpha01: number | undefined;
  let activeColorSlot: ColorSlot | undefined;
  if (includeSecondary) {
    const a01S = Math.max(0, Math.min(1, parseFloat(alphaS) || 1));
    const sr = parseInt(hexS.slice(0, 2), 16);
    const sg = parseInt(hexS.slice(2, 4), 16);
    const sb = parseInt(hexS.slice(4, 6), 16);
    secondaryColor = packRGBA(sr, sg, sb, Math.round(a01S * 255));
    secondaryAlpha01 = a01S;
    activeColorSlot = SHORT_SLOT[slotShort] ?? "primary";
  }

  const pattern = decodePattern(`${w}x${h}:${body ?? ""}`);
  if (!pattern) return null;
  return {
    pattern,
    mode,
    color,
    alpha01: a01P,
    secondaryColor,
    secondaryAlpha01,
    activeColorSlot,
  };
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