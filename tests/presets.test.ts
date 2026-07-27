import { describe, it, expect } from "vitest";
import { PRESETS } from "../src/domain/presets.js";
import { decodePattern, getCell } from "../src/domain/pattern.js";
import { composeSuperTile } from "../src/domain/mirror.js";

describe("presets", () => {
  it("exposes a non-empty list of curated patterns", () => {
    expect(PRESETS.length).toBeGreaterThan(8);
    for (const p of PRESETS) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.label).toBe("string");
      expect(typeof p.cells).toBe("string");
      expect(p.width).toBeGreaterThan(0);
      expect(p.height).toBeGreaterThan(0);
    }
  });

  it("each preset's encoded cells decode to the documented dimensions", () => {
    for (const p of PRESETS) {
      const decoded = decodePattern(`${p.width}x${p.height}:${p.cells}`);
      expect(decoded).not.toBeNull();
      expect(decoded!.width).toBe(p.width);
      expect(decoded!.height).toBe(p.height);
    }
  });

  it("each mirror-mode preset's super-tile is seamlessly tileable along the mirrored axes", () => {
    for (const p of PRESETS) {
      if (p.mode === "none") continue;
      const decoded = decodePattern(`${p.width}x${p.height}:${p.cells}`);
      if (!decoded) throw new Error(`preset ${p.id} did not decode`);
      const s = composeSuperTile(decoded, p.mode);
      // "H" guarantees top/bottom seamlessness; "V" guarantees left/right;
      // "HV" guarantees both. (Compose-only modes like `none` are skipped.)
      if (p.mode === "H" || p.mode === "HV") {
        for (let x = 0; x < s.width; x++) {
          expect(getCell(s, x, 0)).toBe(getCell(s, x, s.height - 1));
        }
      }
      if (p.mode === "V" || p.mode === "HV") {
        for (let y = 0; y < s.height; y++) {
          expect(getCell(s, 0, y)).toBe(getCell(s, s.width - 1, y));
        }
      }
    }
  });

  it("checkerboard preset is unchanged by composeSuperTile (mode=none)", () => {
    const checker = PRESETS.find((p) => p.id === "checkerboard")!;
    const decoded = decodePattern(`${checker.width}x${checker.height}:${checker.cells}`);
    expect(decoded).not.toBeNull();
    const s = composeSuperTile(decoded!, "none");
    expect(getCell(s, 0, 0)).toBe(getCell(s, 1, 1));
    expect(getCell(s, 0, 1)).toBe(getCell(s, 1, 0));
    // top-left and bottom-right are the same color, top-right and bottom-left
    // are transparent (or vice versa — symmetry is what we check):
    expect(getCell(s, 0, 0)).not.toBe(getCell(s, 0, 1));
  });
});