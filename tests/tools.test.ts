import { describe, it, expect } from "vitest";
import { bridgeLine } from "../src/domain/tools.js";
import { emptyPattern, getCell, setCell } from "../src/domain/pattern.js";
import { packRGBA } from "../src/domain/color.js";
import { mirrorCell } from "../src/domain/mirror.js";

describe("tools: bridgeLine", () => {
  it("horizontal line covers every intermediate cell", () => {
    const cells = bridgeLine(0, 0, 4, 0, 5, 5, "none");
    const xs = Array.from(new Set(cells.map(([x]) => x))).sort((a, b) => a - b);
    expect(xs).toEqual([0, 1, 2, 3, 4]);
    expect(cells.every(([, y]) => y === 0)).toBe(true);
  });

  it("vertical line covers every intermediate cell", () => {
    const cells = bridgeLine(0, 0, 0, 4, 5, 5, "none");
    const ys = Array.from(new Set(cells.map(([, y]) => y))).sort((a, b) => a - b);
    expect(ys).toEqual([0, 1, 2, 3, 4]);
    expect(cells.every(([x]) => x === 0)).toBe(true);
  });

  it("diagonal line includes start and end and stays on the diagonal", () => {
    const cells = bridgeLine(0, 0, 4, 4, 5, 5, "none");
    const set = new Set(cells.map(([x, y]) => `${x},${y}`));
    expect(set.size).toBe(5);
    expect(set.has("0,0")).toBe(true);
    expect(set.has("4,4")).toBe(true);
    for (const [x, y] of cells) expect(x).toBe(y);
  });

  it("HV mode mirrors each bridge hit into the four symmetric cells", () => {
    const cells = bridgeLine(0, 0, 1, 1, 5, 5, "HV");
    // Each input hit (0,0), (1,1) expands to 4 mirror targets — but (2,2) would
    // collapse to 1; here we drew on the diagonal of a 5x5 odd grid so corner
    // expansion produces 8 unique cells.
    const set = new Set(cells.map(([x, y]) => `${x},${y}`));
    // Sanity: each original cell is preserved
    expect(set.has("0,0")).toBe(true);
    expect(set.has("1,1")).toBe(true);
    // And mirrors exist
    expect(set.has("4,4")).toBe(true); // mirror of (0,0)
    expect(set.has("3,3")).toBe(true); // mirror of (1,1)
  });
});

describe("tools: end-to-end pencil via direct mutate + mirrorCell", () => {
  it("Painting one corner cell under HV produces a four-fold symmetric pattern", () => {
    const p = emptyPattern(4, 4);
    const color = packRGBA(255, 0, 0, 255);
    for (const [mx, my] of mirrorCell(0, 0, p.width, p.height, "HV")) {
      setCell(p, mx, my, color);
    }
    expect(getCell(p, 0, 0)).toBe(color);
    expect(getCell(p, 0, 3)).toBe(color);
    expect(getCell(p, 3, 0)).toBe(color);
    expect(getCell(p, 3, 3)).toBe(color);
    // And nothing else
    expect(getCell(p, 1, 1)).toBe(0);
  });
});