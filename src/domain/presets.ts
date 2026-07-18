import { encodeHexPlain, emptyPattern, setCell } from "./pattern.js";
import { packRGBA } from "./color.js";
import type { Pattern, Preset } from "./types.js";

/**
 * Hand-curated preset patterns. Each is constructed programmatically with a
 * little builder helper — clearer in source than pouring hex strings by
 * hand — and serialised via {@link encodeHexPlain} so the {@link Preset}
 * structure stays JSON-friendly (no closures, no live refs).
 *
 * For all presets whose mirror mode is `HV` / `V` / `H`, the builder paints
 * only the top-left quadrant and lets the mirror do the rest at draw time
 * (so the user sees the symmetry tighten as they paint — that's the point).
 */

interface Builder {
  width: number;
  height: number;
  draw: (p: Pattern) => void;
}

const C = {
  magenta: packRGBA(0xcc, 0x33, 0xcc, 0xff),
  pink: packRGBA(0xff, 0x61, 0x88, 0xff),
  blue: packRGBA(0x21, 0x96, 0xff, 0xff),
  cyan: packRGBA(0x21, 0xd4, 0xfd, 0xff),
  mint: packRGBA(0x99, 0xff, 0xcd, 0xff),
  yellow: packRGBA(0xff, 0xf1, 0x8f, 0xff),
  amber: packRGBA(0xfd, 0xca, 0x40, 0xff),
  coral: packRGBA(0xff, 0x7f, 0x50, 0xff),
  violet: packRGBA(0x8a, 0x5c, 0xa2, 0xff),
  jade: packRGBA(0x52, 0xb7, 0x88, 0xff),
  white: packRGBA(0xff, 0xff, 0xff, 0xff),
  black: packRGBA(0x10, 0x10, 0x12, 0xff),
};

function build(b: Builder): string {
  const p = emptyPattern(b.width, b.height);
  b.draw(p);
  return encodeHexPlain(p);
}

const BUILDERS: Builder[] = [
  // 1. Checkerboard (no mirror — it tiles by construction).
  {
    width: 2, height: 2,
    draw: (p) => {
      setCell(p, 0, 0, C.magenta);
      setCell(p, 1, 1, C.magenta);
    },
  },
  // 2. Diamond — center cell + diagonals in one quadrant, HV.
  {
    width: 5, height: 5,
    draw: (p) => {
      setCell(p, 2, 2, C.amber);
      setCell(p, 1, 2, C.amber);
      setCell(p, 2, 1, C.amber);
      setCell(p, 0, 2, C.amber);
      setCell(p, 2, 0, C.amber);
    },
  },
  // 3. Plus / cross — HV.
  {
    width: 5, height: 5,
    draw: (p) => {
      setCell(p, 2, 2, C.coral);
      setCell(p, 1, 2, C.coral);
      setCell(p, 2, 1, C.coral);
    },
  },
  // 4. Brick wall — staggered rows, vertical mirror.
  {
    width: 4, height: 4,
    draw: (p) => {
      // Fill rows with staggered gaps to imply a brick bond.
      for (let y = 0; y < 4; y++) {
        const offset = y % 2 === 0 ? 0 : 2;
        for (let x = 0; x < 4; x++) {
          if ((x + offset) % 4 < 3) setCell(p, x, y, C.amber);
        }
      }
    },
  },
  // 5. Wave — gentle vertical sine; HV.
  {
    width: 5, height: 5,
    draw: (p) => {
      setCell(p, 0, 2, C.cyan);
      setCell(p, 1, 1, C.cyan);
      setCell(p, 2, 0, C.cyan);
      setCell(p, 2, 2, C.cyan);
    },
  },
  // 6. Dots — uniform grid, no mirror (tiles by repetition).
  {
    width: 3, height: 3,
    draw: (p) => {
      setCell(p, 1, 1, C.jade);
    },
  },
  // 7. Arrow leaf — HV, asymmetric petal in one quadrant.
  {
    width: 5, height: 5,
    draw: (p) => {
      setCell(p, 2, 2, C.violet);
      setCell(p, 3, 1, C.violet);
      setCell(p, 3, 2, C.violet);
    },
  },
  // 8. Zigzag chevron — HV.
  {
    width: 4, height: 4,
    draw: (p) => {
      setCell(p, 0, 1, C.pink);
      setCell(p, 1, 0, C.pink);
      setCell(p, 2, 1, C.pink);
      setCell(p, 3, 0, C.pink);
    },
  },
  // 9. Heart — pudgy classic; HV.
  {
    width: 7, height: 6,
    draw: (p) => {
      setCell(p, 1, 1, C.pink);
      setCell(p, 2, 0, C.pink);
      setCell(p, 2, 1, C.pink);
      setCell(p, 2, 2, C.pink);
      setCell(p, 3, 1, C.pink);
      setCell(p, 3, 2, C.pink);
      setCell(p, 3, 3, C.pink);
      setCell(p, 2, 3, C.pink);
      setCell(p, 1, 2, C.pink);
    },
  },
  // 10. Star burst — HV, asymmetric.
  {
    width: 5, height: 5,
    draw: (p) => {
      setCell(p, 2, 2, C.yellow);
      setCell(p, 1, 2, C.yellow);
      setCell(p, 2, 1, C.yellow);
      setCell(p, 3, 2, C.yellow);
      setCell(p, 2, 3, C.yellow);
    },
  },
  // 11. Triangle motif — HV.
  {
    width: 5, height: 5,
    draw: (p) => {
      setCell(p, 0, 0, C.blue);
      setCell(p, 0, 1, C.blue);
      setCell(p, 0, 2, C.blue);
      setCell(p, 0, 3, C.blue);
      setCell(p, 0, 4, C.blue);
      setCell(p, 1, 4, C.blue);
      setCell(p, 2, 4, C.blue);
    },
  },
  // 12. Weave — pairs of opposite corners; HV.
  {
    width: 4, height: 4,
    draw: (p) => {
      setCell(p, 0, 0, C.mint);
      setCell(p, 1, 0, C.mint);
      setCell(p, 0, 1, C.mint);
      setCell(p, 3, 3, C.violet);
      setCell(p, 2, 3, C.violet);
      setCell(p, 3, 2, C.violet);
    },
  },
];

const PRESET_META: Array<{ id: string; label: string; mode: Preset["mode"] }> = [
  { id: "checkerboard", label: "Checkerboard", mode: "none" },
  { id: "diamond", label: "Diamond", mode: "HV" },
  { id: "plus", label: "Plus", mode: "HV" },
  { id: "brick", label: "Brick", mode: "V" },
  { id: "wave", label: "Wave", mode: "HV" },
  { id: "dots", label: "Dots", mode: "none" },
  { id: "leaf", label: "Leaf", mode: "HV" },
  { id: "zigzag", label: "Zigzag", mode: "HV" },
  { id: "heart", label: "Heart", mode: "HV" },
  { id: "star", label: "Star", mode: "HV" },
  { id: "triangle", label: "Triangle", mode: "HV" },
  { id: "weave", label: "Weave", mode: "HV" },
];

export const PRESETS: Preset[] = BUILDERS.map((b, i) => {
  const meta = PRESET_META[i];
  if (!meta) throw new Error(`Preset meta missing at index ${i}`);
  return {
    id: meta.id,
    label: meta.label,
    width: b.width,
    height: b.height,
    mode: meta.mode,
    cells: build(b),
  };
});