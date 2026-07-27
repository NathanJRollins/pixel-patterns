import { packRGBA } from "./color.js";
import { setCell } from "./pattern.js";
import { mirrorCell } from "./mirror.js";
import { emptyPattern } from "./pattern.js";
import type { Cell, MirrorMode, Pattern } from "./types.js";

/**
 * Biased random seamless pattern generator.
 *
 * Goal: a one-click "Randomize" button that produces a *starter* pattern the
 * user wants to keep painting on. We bias toward outputs that read as
 * "patterns" rather than noise:
 *
 *   1. Limited palette: 2–4 colors drawn from a curated list, biased toward
 *      harmonious hues.
 *   2. Sparse + clustered: ~30% fill, with cells placed as short line
 *      strokes (Bresenham) so neighbours tend to connect.
 *   3. Symmetry: writes go through {@link mirrorCell} so the default `HV`
 *      mirror mode produces a seamless tile by construction.
 *   4. Deterministic option: a `seed` string feeds a `mulberry32` PRNG so
 *      the same seed → the same pattern.
 *
 * Per the spec, randomize defaults to mirror mode `HV`.
 */

const PALETTE: Cell[] = [
  packRGBA(0xcc, 0x33, 0xcc, 0xff), // callback to original default
  packRGBA(0xff, 0x61, 0x88, 0xff),
  packRGBA(0x21, 0x96, 0xff, 0xff),
  packRGBA(0x21, 0xd4, 0xfd, 0xff),
  packRGBA(0x99, 0xff, 0xcd, 0xff),
  packRGBA(0xff, 0xf1, 0x8f, 0xff),
  packRGBA(0xfd, 0xca, 0x40, 0xff),
  packRGBA(0xff, 0x7f, 0x50, 0xff),
  packRGBA(0x8a, 0x5c, 0xa2, 0xff),
  packRGBA(0x52, 0xb7, 0x88, 0xff),
];

export const RANDOMIZE_DEFAULT_MODE: MirrorMode = "HV";

/** Hash a string into a 32-bit seed for the PRNG. */
function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — tiny, fast, well-mixed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RandomizeOptions {
  width: number;
  height: number;
  mode?: MirrorMode;
  seed?: string;
  density?: number; // 0..1, default 0.3
  paletteSize?: number; // default 3
  palette?: Cell[];
}

export function randomPattern(opts: RandomizeOptions): Pattern {
  const mode = opts.mode ?? RANDOMIZE_DEFAULT_MODE;
  const density = opts.density ?? 0.3;
  const paletteSize = opts.paletteSize ?? 3;
  const palette =
    opts.palette && opts.palette.length
      ? opts.palette
      : samplePalette(paletteSize, opts.seed ? mulberry32(hashSeed(opts.seed)) : Math.random);

  const rng = opts.seed ? mulberry32(hashSeed(opts.seed)) : Math.random;
  const p = emptyPattern(opts.width, opts.height);

  // Distance the strokes can travel; for HV we paint in just one quadrant and
  // let the mirror do the work, but `mirrorCell` handles the dup so writes
  // are idempotent.
  const targetCells = Math.floor(opts.width * opts.height * density);
  let placed = 0;
  let attempts = 0;
  const cap = targetCells * 20 + 32;
  while (placed < targetCells && attempts < cap) {
    attempts++;
    const color = palette[Math.floor(rng() * palette.length)];
    const strokeLen = 1 + Math.floor(rng() * 3); // 1..3 cells per stroke
    const x0 = Math.floor(rng() * opts.width);
    const y0 = Math.floor(rng() * opts.height);
    const dx = Math.floor(rng() * 3) - 1;
    const dy = Math.floor(rng() * 3) - 1;
    let cx = x0;
    let cy = y0;
    for (let s = 0; s < strokeLen; s++) {
      if (cx < 0 || cy < 0 || cx >= opts.width || cy >= opts.height) break;
      for (const [mx, my] of mirrorCell(cx, cy, opts.width, opts.height, mode)) {
        setCell(p, mx, my, color);
      }
      cx += dx;
      cy += dy;
      placed++;
    }
  }
  return p;
}

function samplePalette(size: number, rng: () => number): Cell[] {
  const copy = PALETTE.slice();
  // Fisher–Yates partial shuffle.
  for (let i = 0; i < size; i++) {
    const j = i + Math.floor(rng() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, size);
}