import { describe, it, expect } from "vitest";
import {
  clearPattern,
  clonePattern,
  decodePattern,
  emptyPattern,
  encodeHexPlain,
  encodePattern,
  fillPattern,
  getCell,
  patternsEqual,
  resizePattern,
  setCell,
} from "../src/domain/pattern.js";
import { packRGBA } from "../src/domain/color.js";

describe("pattern: construction", () => {
  it("emptyPattern has the expected shape", () => {
    const p = emptyPattern(2, 3);
    expect(p.width).toBe(2);
    expect(p.height).toBe(3);
    expect(p.cells.length).toBe(6);
    expect(p.cells.every((c) => c === 0)).toBe(true);
  });

  it("throws on out-of-range dimensions", () => {
    expect(() => emptyPattern(0, 5)).toThrow();
    expect(() => emptyPattern(5, 0)).toThrow();
    expect(() => emptyPattern(-3, 5)).toThrow();
    expect(() => emptyPattern(200, 5)).toThrow(); // > MAX_DIM
  });
});

describe("pattern: cell ops", () => {
  it("setCell writes in-bounds and returns true on change", () => {
    const p = emptyPattern(3, 3);
    expect(setCell(p, 1, 1, packRGBA(255, 0, 0, 255))).toBe(true);
    expect(getCell(p, 1, 1)).toBe(packRGBA(255, 0, 0, 255));
    // setting to the same value: false
    expect(setCell(p, 1, 1, packRGBA(255, 0, 0, 255))).toBe(false);
  });

  it("setCell out of bounds: no-op and returns false", () => {
    const p = emptyPattern(3, 3);
    expect(setCell(p, -1, 0, 1)).toBe(false);
    expect(setCell(p, 0, -1, 1)).toBe(false);
    expect(setCell(p, 3, 0, 1)).toBe(false);
    expect(setCell(p, 0, 3, 1)).toBe(false);
    expect(p.cells.every((c) => c === 0)).toBe(true);
  });

  it("getCell returns 0 for out-of-bounds queries", () => {
    const p = emptyPattern(3, 3);
    expect(getCell(p, 100, 100)).toBe(0);
  });
});

describe("pattern: aggregates", () => {
  it("clearPattern zeroes the cells", () => {
    const p = emptyPattern(2, 2);
    setCell(p, 0, 0, packRGBA(0, 255, 0, 255));
    expect(clearPattern(p)).toBe(true);
    expect(p.cells.every((c) => c === 0)).toBe(true);
    expect(clearPattern(p)).toBe(false);
  });

  it("fillPattern covers every cell with the same color", () => {
    const p = emptyPattern(2, 2);
    const c = packRGBA(0, 255, 0, 255);
    expect(fillPattern(p, c)).toBe(true);
    expect(p.cells.every((x) => x === c)).toBe(true);
    expect(fillPattern(p, c)).toBe(false);
  });

  it("clonePattern deep-copies the cells", () => {
    const p = emptyPattern(2, 2);
    setCell(p, 0, 0, packRGBA(1, 2, 3, 255));
    const q = clonePattern(p);
    setCell(q, 0, 0, packRGBA(9, 9, 9, 255));
    expect(getCell(p, 0, 0)).toBe(packRGBA(1, 2, 3, 255));
    expect(getCell(q, 0, 0)).toBe(packRGBA(9, 9, 9, 255));
  });

  it("patternsEqual is value-equal", () => {
    const a = emptyPattern(2, 2);
    const b = emptyPattern(2, 2);
    expect(patternsEqual(a, b)).toBe(true);
    setCell(a, 0, 0, packRGBA(1, 2, 3, 255));
    expect(patternsEqual(a, b)).toBe(false);
    const c = clonePattern(a);
    expect(patternsEqual(a, c)).toBe(true);
  });
});

describe("pattern: resize preserves data", () => {
  it("Same-size resize: identity shape, same data", () => {
    const p = emptyPattern(3, 3);
    setCell(p, 0, 0, packRGBA(1, 1, 1, 255));
    const q = resizePattern(p, 3, 3);
    expect(patternsEqual(p, q)).toBe(true);
  });

  it("Shrink: corner cells drop, overlap kept", () => {
    const p = emptyPattern(4, 4);
    setCell(p, 0, 0, packRGBA(1, 1, 1, 255));
    setCell(p, 3, 3, packRGBA(2, 2, 2, 255));
    const q = resizePattern(p, 2, 2);
    expect(getCell(q, 0, 0)).toBe(packRGBA(1, 1, 1, 255));
    expect(getCell(q, 1, 1)).toBe(0); // (3,3) cropped out
  });

  it("Grow: new cells translucent, existing kept", () => {
    const p = emptyPattern(2, 2);
    setCell(p, 0, 0, packRGBA(1, 1, 1, 255));
    const q = resizePattern(p, 4, 4);
    expect(getCell(q, 0, 0)).toBe(packRGBA(1, 1, 1, 255));
    expect(getCell(q, 3, 3)).toBe(0);
  });
});

describe("pattern: serialization", () => {
  it("encodePattern starts with width × height", () => {
    const p = emptyPattern(3, 2);
    expect(encodePattern(p).startsWith("3x2:")).toBe(true);
  });

  it("encodeHexPlain uses '--' for transparent, 8 hex chars per visible cell", () => {
    const p = emptyPattern(2, 1);
    setCell(p, 0, 0, packRGBA(0xff, 0x88, 0x44, 0xcc));
    const s = encodeHexPlain(p);
    expect(s).toBe("ff8844cc--");
  });

  it("round-trips through encodePattern / decodePattern", () => {
    const p = emptyPattern(4, 4);
    setCell(p, 0, 0, packRGBA(0xff, 0x88, 0x44, 0xcc));
    setCell(p, 3, 3, packRGBA(1, 2, 3, 255));
    setCell(p, 1, 1, 0);
    const decoded = decodePattern(encodePattern(p));
    expect(decoded).not.toBeNull();
    expect(patternsEqual(p, decoded!)).toBe(true);
  });

  it("decodePattern rejects malformed input", () => {
    expect(decodePattern("")).toBeNull();
    expect(decodePattern("3x3")).toBeNull();
    expect(decodePattern("abc:--")).toBeNull();
    expect(decodePattern("3x3:--")).not.toBeNull();
  });

  it("decodePattern rejects oversized dimensions", () => {
    expect(decodePattern("200x3:--")).toBeNull();
  });
});