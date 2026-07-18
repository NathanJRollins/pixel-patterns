import type { Cell } from "./types.js";

/**
 * Color helpers for the {@link Cell} packed-RGBA representation.
 *
 * Invariants enforced here:
 *   - `alpha === 0` always normalises to the sentinel `0` (transparent).
 *     So `cell !== 0 ⟺ cell is visible`.
 *   - Channels are read with unsigned right shift so `r` is always 0..255.
 */

export function packRGBA(r: number, g: number, b: number, a: number): Cell {
  if (a === 0) return 0;
  // `>>> 0` coerces to unsigned Uint32 so the returned value compares equal
  // when read back from a Uint32Array (which always yields unsigned values).
  return ((((r & 0xff) << 24) |
    ((g & 0xff) << 16) |
    ((b & 0xff) << 8) |
    (a & 0xff)) >>> 0) as Cell;
}

export function unpackRGBA(cell: Cell): [r: number, g: number, b: number, a: number] {
  if (cell === 0) return [0, 0, 0, 0];
  return [
    (cell >>> 24) & 0xff,
    (cell >>> 16) & 0xff,
    (cell >>> 8) & 0xff,
    cell & 0xff,
  ];
}

/** CSS color string, or `'transparent'` for the sentinel. */
export function cellToCss(cell: Cell): string {
  if (cell === 0) return "transparent";
  const [r, g, b, a] = unpackRGBA(cell);
  return `rgba(${r},${g},${b},${(a / 255).toFixed(4)})`;
}

/**
 * Parse a `#rrggbb` string into a {@link Cell} at the given opacity (0..1).
 * Hex shorthand `#rgb` is also accepted.
 */
export function hexToCell(hex: string, alpha01 = 1): Cell {
  let h = hex.trim();
  if (h.startsWith("#")) h = h.slice(1);
  let r: number, g: number, b: number;
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16);
    g = parseInt(h[1] + h[1], 16);
    b = parseInt(h[2] + h[2], 16);
  } else if (h.length === 6) {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    return 0;
  }
  if ([r, g, b].some((v) => !Number.isFinite(v))) return 0;
  const a = Math.max(0, Math.min(255, Math.round(alpha01 * 255)));
  return packRGBA(r, g, b, a);
}

/** Render a {@link Cell} back as `#rrggbb` (alpha dropped). */
export function cellToHex(cell: Cell): string {
  if (cell === 0) return "#000000";
  const [r, g, b] = unpackRGBA(cell);
  return (
    "#" +
    r.toString(16).padStart(2, "0") +
    g.toString(16).padStart(2, "0") +
    b.toString(16).padStart(2, "0")
  );
}

/** Alpha (0..1) of a {@link Cell}. */
export function cellAlpha01(cell: Cell): number {
  return cell === 0 ? 0 : (cell & 0xff) / 255;
}

/**
 * Linear blend `src` over `dst` using `src`'s alpha. (Not used in v1's
 * default replace-tool semantics, but kept for tools/dropper and future
 * paint-mode toggle from the original TODO.)
 */
export function blendCells(dst: Cell, src: Cell): Cell {
  if (src === 0) return dst;
  if (dst === 0) return src;
  const [dr, dg, db, da] = unpackRGBA(dst);
  const [sr, sg, sb, sa] = unpackRGBA(src);
  const saN = sa / 255;
  const daN = da / 255;
  const outA = saN + daN * (1 - saN);
  if (outA <= 0) return 0;
  const outR = Math.round((sr * saN + dr * daN * (1 - saN)) / outA);
  const outG = Math.round((sg * saN + dg * daN * (1 - saN)) / outA);
  const outB = Math.round((sb * saN + db * daN * (1 - saN)) / outA);
  return packRGBA(outR, outG, outB, Math.round(outA * 255));
}