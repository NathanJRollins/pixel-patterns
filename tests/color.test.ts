import { describe, it, expect } from "vitest";
import {
  packRGBA,
  unpackRGBA,
  cellToCss,
  cellToHex,
  hexToCell,
  cellAlpha01,
  blendCells,
} from "../src/domain/color.js";

describe("color", () => {
  it("packs alpha=0 to the transparent sentinel (0)", () => {
    expect(packRGBA(255, 255, 255, 0)).toBe(0);
    expect(packRGBA(0, 0, 0, 0)).toBe(0);
    expect(packRGBA(255, 0, 0, 0)).toBe(0);
  });

  it("packs opaque white to a non-zero Cell", () => {
    const c = packRGBA(255, 255, 255, 255);
    expect(c).not.toBe(0);
    expect(unpackRGBA(c)).toEqual([255, 255, 255, 255]);
  });

  it("unpacks red channel correctly via unsigned right shift (no negatives)", () => {
    const c = packRGBA(255, 0, 128, 200);
    expect(unpackRGBA(c)).toEqual([255, 0, 128, 200]);
  });

  it("cellToCss returns 'transparent' for the sentinel", () => {
    expect(cellToCss(0)).toBe("transparent");
  });

  it("hexToCell parses #rrggbb at the given alpha", () => {
    expect(hexToCell("#cc33cc", 1)).not.toBe(0);
    expect(hexToCell("#cc33cc", 0)).toBe(0);
    const c = hexToCell("#cc33cc", 0.5);
    const [r, g, b, a] = unpackRGBA(c);
    expect([r, g, b]).toEqual([0xcc, 0x33, 0xcc]);
    expect(a).toBe(Math.round(0.5 * 255));
  });

  it("hexToCell parses 3-char shorthand", () => {
    const c = hexToCell("#f0c", 1);
    expect(unpackRGBA(c)).toEqual([255, 0, 204, 255]);
  });

  it("cellToHex round-trips through hexToCell", () => {
    const c = hexToCell("#10ea44", 1);
    expect(cellToHex(c)).toBe("#10ea44");
  });

  it("cellAlpha01 reads alpha / 255", () => {
    expect(cellAlpha01(0)).toBe(0);
    const c = packRGBA(12, 34, 56, 128);
    expect(cellAlpha01(c)).toBeCloseTo(128 / 255, 5);
  });

  it("blendCells keeps src-over porter-duff", () => {
    // No destination → src wins
    expect(blendCells(0, packRGBA(10, 20, 30, 255))).toEqual(
      packRGBA(10, 20, 30, 255),
    );
    // Fully opaque src over anything → src
    expect(blendCells(packRGBA(0, 0, 0, 255), packRGBA(10, 20, 30, 255))).toEqual(
      packRGBA(10, 20, 30, 255),
    );
    // 50%-opaque red over 100%-opaque blue:
    const dst = packRGBA(0, 0, 255, 255);
    const src = packRGBA(255, 0, 0, 128);
    const out = blendCells(dst, src);
    const [or_, og, ob, oa] = unpackRGBA(out);
    const outA = 128 / 255 + 1 * (1 - 128 / 255);
    expect(oa).toBe(Math.round(outA * 255));
    // sanity: more red than blue in the output
    expect(or_).toBeGreaterThan(ob);
    void og;
  });
});