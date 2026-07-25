import { clonePattern } from "./pattern.js";
import type { MirrorMode, Pattern } from "./types.js";

/**
 * Mirror composition.
 *
 * A seamless pattern tiles with no seam only when opposite edges match.
 * The cleanest way to *guarantee* this — without the user worrying about
 * it — is to compose the user's drawn grid into a larger super-tile that
 * is mirror-symmetric along the axes the user picked.
 *
 * Modes (axis letters mean "the super-tile is mirrored about THIS axis"):
 *   "none" — drawn grid as-is (the user is responsible for seamlessness).
 *   "H"    — super-tile is `cols × (2·rows)`, flipped vertical below.
 *   "V"    — super-tile is `(2·cols) × rows`, flipped horizontal right.
 *   "HV"   — super-tile is `(2·cols) × (2·rows)`, four-way symmetric.
 *
 * The super-tile is what every renderer (preview, page bg, favicon, export)
 * tiles. Cell writes from the input grid are *mirrored* by the tool layer:
 * when the user paints at (x, y) under "HV", they actually write to the
 * four symmetric positions of the user grid — so the selected mirror mode
 * is a painting constraint, not just a display transform. {@link mirrorCell}
 * lists the equivalent cells for a given paint hit.
 */

/** Human label for a mirror mode. */
export const MIRROR_LABELS: Record<MirrorMode, string> = {
  none: "None",
  H: "H — flip rows",
  V: "V — flip cols",
  HV: "HV — four-way",
};

/** Width/height multipliers each mode applies to the user grid. */
export const MIRROR_SCALE: Record<MirrorMode, { w: number; h: number }> = {
  none: { w: 1, h: 1 },
  H: { w: 1, h: 2 },
  V: { w: 2, h: 1 },
  HV: { w: 2, h: 2 },
};

/** Equivalent `cells.length` of the user grid copy + mirror the mode needs. */

/**
 * Build the mirror-symmetric super-tile from a user grid.
 *
 * The output has dimensions determined by {@link superTileDimensions}. The
 * four quadrants are laid out:
 *
 *   HV / V / H arrangement — see inline below — only the quadrants the
 *   mode requests are filled; "none" returns a clone of the input.
 */
export function composeSuperTile(input: Pattern, mode: MirrorMode): Pattern {
  const { w, h } = superTileDimensions(input.width, input.height, mode);
  if (mode === "none") {
    // Still return a clone so callers can't accidentally alias the user grid.
    return clonePattern(input);
  }
  const out: Pattern = {
    width: w,
    height: h,
    cells: new Uint32Array(w * h),
  };
  const W = input.width;
  const H = input.height;
  // Stride of the *output* super-tile — NOT the input width. Writing into
  // `out.cells` requires the *super-tile* stride, which is 2× input width
  // under HV / V modes (and input width for H / none).
  const sw = w;
  // Quadrant 0 (top-left): identity copy.
  copyBlock(input, 0, 0, W, H, out, 0, 0, sw);
  if (mode === "H") {
    // Bottom half = top flipped vertically (rows reversed).
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        out.cells[(H + (H - 1 - y)) * sw + x] = input.cells[y * W + x];
      }
    }
  } else if (mode === "V") {
    // Right half = left flipped horizontally (columns reversed).
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        out.cells[y * sw + (W + (W - 1 - x))] = input.cells[y * W + x];
      }
    }
  } else {
    // mode === "HV": four-way.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = input.cells[y * W + x];
        // top-right: horizontal flip
        out.cells[y * sw + (W + (W - 1 - x))] = c;
        // bottom-left: vertical flip
        out.cells[(H + (H - 1 - y)) * sw + x] = c;
        // bottom-right: both flips
        out.cells[(H + (H - 1 - y)) * sw + (W + (W - 1 - x))] = c;
      }
    }
  }
  return out;
}

/** Compute the super-tile dimensions for a given mode. */
export function superTileDimensions(
  width: number,
  height: number,
  mode: MirrorMode,
): { w: number; h: number } {
  return {
    w: width * MIRROR_SCALE[mode].w,
    h: height * MIRROR_SCALE[mode].h,
  };
}

/**
 * For a paint hit at user-grid cell `(x, y)`, return every equivalent cell
 * the tool should also write under the current mirror mode. Always includes
 * `(x, y)` itself.
 *
 * This is the painting-side mirror. With it, "HV mirror" is symmetric
 * *before* super-tile composition, which means: even "none"-mode tools
 * that just display the user grid (e.g. the draw panel grid overlay)
 * already look seamless; and the live super-tile preview matches what the
 * user sees in the draw panel.
 */
export function mirrorCell(
  x: number,
  y: number,
  width: number,
  height: number,
  mode: MirrorMode,
): Array<[number, number]> {
  if (mode === "none") return [[x, y]];
  const out: Array<[number, number]> = [[x, y]];
  if (mode === "H" || mode === "HV") {
    out.push([x, height - 1 - y]);
  }
  if (mode === "V" || mode === "HV") {
    out.push([width - 1 - x, y]);
  }
  if (mode === "HV") {
    out.push([width - 1 - x, height - 1 - y]);
  }
  // De-duplicate (painted the center cell of an odd grid, for example).
  const seen = new Set<string>();
  const uniq: Array<[number, number]> = [];
  for (const [px, py] of out) {
    const k = `${px},${py}`;
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push([px, py]);
    }
  }
  return uniq;
}

// ---------------------------------------------------------------------------
// Internal: copy an arbitrary rectangular block between patterns.
// ---------------------------------------------------------------------------

function copyBlock(
  src: Pattern,
  sx: number,
  sy: number,
  bw: number,
  bh: number,
  dst: Pattern,
  dx: number,
  dy: number,
  dWidth: number,
): void {
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      dst.cells[(dy + y) * dWidth + (dx + x)] = src.cells[(sy + y) * src.width + (sx + x)];
    }
  }
}