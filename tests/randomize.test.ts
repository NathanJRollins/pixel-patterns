import { describe, it, expect } from "vitest";
import { randomPattern } from "../src/domain/randomize.js";
import { getCell } from "../src/domain/pattern.js";
import { packRGBA } from "../src/domain/color.js";
import { composeSuperTile } from "../src/domain/mirror.js";

describe("randomize", () => {
  it("produces a pattern of the requested dimensions", () => {
    const p = randomPattern({ width: 6, height: 6, mode: "HV", seed: "x" });
    expect(p.width).toBe(6);
    expect(p.height).toBe(6);
    expect(p.cells.length).toBe(36);
  });

  it("same seed → same pattern (deterministic)", () => {
    const a = randomPattern({ width: 5, height: 5, mode: "HV", seed: "abc" });
    const b = randomPattern({ width: 5, height: 5, mode: "HV", seed: "abc" });
    for (let i = 0; i < a.cells.length; i++) {
      expect(a.cells[i]).toBe(b.cells[i]);
    }
  });

  it("different seeds → (typically) different patterns", () => {
    const a = randomPattern({ width: 7, height: 7, mode: "HV", seed: "1" });
    const b = randomPattern({ width: 7, height: 7, mode: "HV", seed: "2" });
    let diff = 0;
    for (let i = 0; i < a.cells.length; i++) {
      if (a.cells[i] !== b.cells[i]) diff++;
    }
    expect(diff).toBeGreaterThan(0);
  });

  it("HV-randomised patterns produce seamless super-tiles (opposite edges equal)", () => {
    const p = randomPattern({ width: 5, height: 5, mode: "HV", seed: "seamless" });
    const s = composeSuperTile(p, "HV");
    for (let x = 0; x < s.width; x++) {
      expect(getCell(s, x, 0)).toBe(getCell(s, x, s.height - 1));
    }
    for (let y = 0; y < s.height; y++) {
      expect(getCell(s, 0, y)).toBe(getCell(s, s.width - 1, y));
    }
  });

  it("custom palette is honoured", () => {
    const pale = [packRGBA(10, 10, 10, 255), packRGBA(20, 20, 20, 255)];
    const p = randomPattern({
      width: 4,
      height: 4,
      mode: "none",
      seed: "pal",
      density: 0.9,
      palette: pale,
    });
    for (let i = 0; i < p.cells.length; i++) {
      if (p.cells[i] === 0) continue;
      expect(pale).toContain(p.cells[i]);
    }
  });
});