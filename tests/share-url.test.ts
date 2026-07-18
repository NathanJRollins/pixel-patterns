import { describe, it, expect } from "vitest";
import { shareUrlEncode, shareUrlDecode } from "../src/state/share-url.js";
import { emptyPattern, setCell } from "../src/domain/pattern.js";
import { packRGBA } from "../src/domain/color.js";

/**
 * Stub a minimal `window.location.hash` so share-url.ts (which is browser-
 * only at runtime) can be tested under vitest's default node environment.
 */
function installWindowStub(initialHash = "") {
  const win = globalThis as unknown as { window?: unknown };
  if (!win.window) {
    win.window = { location: {} } as unknown;
  }
  let hash: string = initialHash;
  Object.defineProperty(
    (win.window as { location: unknown }).location as object,
    "hash",
    {
      get: () => hash,
      set: (v: string) => {
        hash = v;
      },
      configurable: true,
    },
  );
}

describe("share-url", () => {
  it("encodes a pattern into a hash starting with #p=", () => {
    installWindowStub();
    const p = emptyPattern(4, 4);
    setCell(p, 0, 0, packRGBA(255, 0, 0, 255));
    const url = shareUrlEncode({
      pattern: p,
      mode: "HV",
      color: packRGBA(0xcc, 0x33, 0xcc, 255),
      alpha01: 1,
    });
    expect(url.startsWith("#p=4x4,hv,cc33cc,1.00,")).toBe(true);
  });

  it("round-trips a pattern through encode + decode", () => {
    installWindowStub();
    const p = emptyPattern(5, 5);
    setCell(p, 0, 0, packRGBA(0, 0, 0, 255));
    setCell(p, 1, 2, packRGBA(50, 100, 150, 255));
    const url = shareUrlEncode({
      pattern: p,
      mode: "V",
      color: packRGBA(0x10, 0x20, 0x30, 255),
      alpha01: 0.5,
    });
    (globalThis as unknown as { window: { location: { hash: string } } }).window.location.hash = url;
    const decoded = shareUrlDecode();
    expect(decoded).not.toBeNull();
    expect(decoded!.mode).toBe("V");
    expect(decoded!.alpha01).toBeCloseTo(0.5, 1);
    expect(decoded!.pattern.width).toBe(5);
    expect(decoded!.pattern.height).toBe(5);
    for (let i = 0; i < p.cells.length; i++) {
      expect(decoded!.pattern.cells[i]).toBe(p.cells[i]);
    }
  });

  it("decodes null when no share hash is present", () => {
    installWindowStub("");
    expect(shareUrlDecode()).toBeNull();
  });

  it("decodes null on malformed hash", () => {
    installWindowStub("#p=garbage");
    expect(shareUrlDecode()).toBeNull();
  });
});