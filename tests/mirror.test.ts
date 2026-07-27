import { describe, it, expect } from "vitest";
import { composeSuperTile, MIRROR_SCALE, mirrorCell, superTileDimensions } from "../src/domain/mirror.js";
import { emptyPattern, getCell, setCell } from "../src/domain/pattern.js";
import { packRGBA } from "../src/domain/color.js";
import type { Pattern } from "../src/domain/types.js";

describe("mirror: mirrorCell expansion", () => {
  it("none expands to just the input cell", () => {
    expect(mirrorCell(2, 2, 5, 5, "none")).toEqual([[2, 2]]);
  });

  it("HV of a corner cell expands to all four corners", () => {
    const cells = mirrorCell(0, 0, 5, 5, "HV");
    expect(cells.length).toBe(4);
    const set = new Set(cells.map(([x, y]) => `${x},${y}`));
    expect(set.has("0,0")).toBe(true);
    expect(set.has("0,4")).toBe(true);
    expect(set.has("4,0")).toBe(true);
    expect(set.has("4,4")).toBe(true);
  });

  it("HV of an odd-grid center cell collapses to a single cell", () => {
    const cells = mirrorCell(2, 2, 5, 5, "HV");
    expect(cells).toEqual([[2, 2]]);
  });

  it("H mirrors only rows; V mirrors only cols", () => {
    const hCells = new Set(mirrorCell(1, 0, 5, 5, "H").map(([x, y]) => `${x},${y}`));
    expect(hCells.has("1,0")).toBe(true);
    expect(hCells.has("1,4")).toBe(true);
    expect(hCells.size).toBe(2);
    const vCells = new Set(mirrorCell(1, 2, 5, 5, "V").map(([x, y]) => `${x},${y}`));
    expect(vCells.has("1,2")).toBe(true);
    expect(vCells.has("3,2")).toBe(true);
    expect(vCells.size).toBe(2);
  });

  it("de-duplicates corners on even grids (where the mirror target lands on self)", () => {
    // Even 4×4 grid; cell (0, 0) HV expands to (0,0), (0,3), (3,0), (3,3)
    const cells = mirrorCell(0, 0, 4, 4, "HV");
    expect(new Set(cells.map(([x, y]) => `${x},${y}`)).size).toBe(cells.length);
  });
});

describe("mirror: scale of super-tile", () => {
  it("each mode picks the documented width/height multiplier", () => {
    expect(MIRROR_SCALE.none).toEqual({ w: 1, h: 1 });
    expect(MIRROR_SCALE.H).toEqual({ w: 1, h: 2 });
    expect(MIRROR_SCALE.V).toEqual({ w: 2, h: 1 });
    expect(MIRROR_SCALE.HV).toEqual({ w: 2, h: 2 });
  });

  it("superTileDimensions multiplies", () => {
    expect(superTileDimensions(5, 5, "HV")).toEqual({ w: 10, h: 10 });
    expect(superTileDimensions(5, 5, "H")).toEqual({ w: 5, h: 10 });
    expect(superTileDimensions(5, 5, "V")).toEqual({ w: 10, h: 5 });
    expect(superTileDimensions(5, 5, "none")).toEqual({ w: 5, h: 5 });
  });
});

describe("mirror: composeSuperTile symmetry", () => {
  const red = packRGBA(255, 0, 0, 255);

  it("none returns a clone of the input (same dimensions, equal cells)", () => {
    const p = emptyPattern(3, 2);
    setCell(p, 0, 0, red);
    const s = composeSuperTile(p, "none");
    expect(s.width).toBe(3);
    expect(s.height).toBe(2);
    expect(getCell(s, 0, 0)).toBe(red);
  });

  it("HV: a single painted cell appears at all four mirror-positions", () => {
    const p = emptyPattern(4, 4);
    setCell(p, 0, 0, red);
    const s = composeSuperTile(p, "HV");
    expect(s.width).toBe(8);
    expect(s.height).toBe(8);
    // TL quadrant
    expect(getCell(s, 0, 0)).toBe(red);
    // TR quadrant (horizontal flip)
    expect(getCell(s, 7, 0)).toBe(red);
    // BL quadrant (vertical flip)
    expect(getCell(s, 0, 7)).toBe(red);
    // BR quadrant (both flips)
    expect(getCell(s, 7, 7)).toBe(red);
  });

  it("H: top half is the source, bottom half is the vertically-flipped source", () => {
    const p = emptyPattern(3, 2);
    setCell(p, 1, 0, red);
    const s = composeSuperTile(p, "H");
    expect(s.width).toBe(3);
    expect(s.height).toBe(4);
    expect(getCell(s, 1, 0)).toBe(red);
    expect(getCell(s, 1, 3)).toBe(red); // mirrored
  });

  it("V: left half is the source, right half is the horizontally-flipped source", () => {
    const p = emptyPattern(2, 3);
    setCell(p, 0, 1, red);
    const s = composeSuperTile(p, "V");
    expect(s.width).toBe(4);
    expect(s.height).toBe(3);
    expect(getCell(s, 0, 1)).toBe(red);
    expect(getCell(s, 3, 1)).toBe(red); // mirrored
  });

  it("seamless: HV super-tile's opposite edges are equal (the core invariant)", () => {
    const p = emptyPattern(5, 5);
    setCell(p, 0, 0, red);
    setCell(p, 1, 2, packRGBA(0, 255, 0, 255));
    setCell(p, 4, 4, packRGBA(0, 0, 255, 255));
    const s: Pattern = composeSuperTile(p, "HV");
    // Top edge === bottom edge
    for (let x = 0; x < s.width; x++) {
      expect(getCell(s, x, 0)).toBe(getCell(s, x, s.height - 1));
    }
    // Left edge === right edge
    for (let y = 0; y < s.height; y++) {
      expect(getCell(s, 0, y)).toBe(getCell(s, s.width - 1, y));
    }
  });
});