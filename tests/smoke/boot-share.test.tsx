/**
 * @vitest-environment happy-dom
 *
 * Reproduce the share-URL-loading bug: boot the app with a URL hash carrying
 * a non-default pattern, assert the store took on that pattern. Tests use
 * the current v2 share-URL format (8 comma parts: head,mode,hexP,alphaP,
 * hexS,alphaS,slot,body).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { store } from "../../src/state/store.js";
import { boot } from "../../src/state/init.js";
import { saveToast } from "../../src/ui/toast.js";

void saveToast; // keep import warm

function setHash(hash: string): void {
  (globalThis as unknown as { window: { location: { hash: string } } }).window.location.hash = hash;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  try {
    setHash("#p=5x5,hv,cc33cc,1.00,ffffff,1.00,p,----------");
  } catch {
    Object.defineProperty(window.location, "hash", {
      get() {
        return (window as unknown as { __hash?: string }).__hash ?? "";
      },
      set(v: string) {
        (window as unknown as { __hash?: string }).__hash = v as string;
      },
      configurable: true,
    });
  }
  store.clearAllData();
});

afterEach(() => {
  setHash("");
});

describe("boot → load share URL", () => {
  it("boots with the default-app url hash and the store is the default (7x7)", () => {
    setHash("");
    boot();
    expect(store.pattern.value.width).toBe(7);
    expect(store.pattern.value.height).toBe(7);
    let nonZero = 0;
    for (let i = 0; i < store.pattern.value.cells.length; i++) {
      if (store.pattern.value.cells[i] !== 0) nonZero++;
    }
    expect(nonZero).toBe(0);
  });

  it("boots with a v2 share-URL hash carrying a painted cell and the store loads it", () => {
    // 5×5 pattern (25 cells); cell 0 = red, rest transparent.
    const body = "ff0000ff" + "--".repeat(24);
    const hash = `#p=5x5,hv,cc33cc,1.00,ffffff,1.00,p,${body}`;
    setHash(hash);
    boot();
    expect(store.pattern.value.width).toBe(5);
    expect(store.pattern.value.height).toBe(5);
    expect(store.pattern.value.cells[0]).not.toBe(0);
    expect(store.pattern.value.cells[1]).toBe(0);
    let nonZero = 0;
    for (let i = 0; i < store.pattern.value.cells.length; i++) {
      if (store.pattern.value.cells[i] !== 0) nonZero++;
    }
    expect(nonZero).toBe(1);
  });

  it("boots with a v2 share-URL hash with a different mirror mode and loads it", () => {
    const body = "--".repeat(25);
    // V mirror; primary cc33cc @1.00; secondary white @0.50; active = secondary.
    const hash = `#p=5x5,v,cc33cc,1.00,ffffff,0.50,s,${body}`;
    setHash(hash);
    boot();
    expect(store.mirrorMode.value).toBe("V");
    expect(store.activeColorSlot.value).toBe("secondary");
    expect(store.alpha01.value).toBeCloseTo(0.5, 2);
    expect(store.secondaryAlpha01.value).toBeCloseTo(0.5, 2);
    expect(store.primaryAlpha01.value).toBe(1);
  });

  it("boot detects share URL via hasShareUrl", () => {
    const body = "--".repeat(25);
    const hash = `#p=5x5,hv,cc33cc,1.00,ffffff,1.00,p,${body}`;
    setHash(hash);
    expect(store.hasShareUrl()).toBe(true);
  });

  it("malformed v1-style hash (5 fields) is rejected — no back-compat", () => {
    // Old single-color format with 5 parts is no longer something we accept.
    const body = "ff0000ff" + "--".repeat(24);
    setHash(`#p=5x5,hv,cc33cc,1.00,${body}`);
    expect(store.hasShareUrl()).toBe(false);
    boot();
    // Falls back to defaults — share URL's payload decoded as null.
    expect(store.pattern.value.width).toBe(7);
  });

  it("malformed hash with wrong field count rejected", () => {
    setHash("#p=5x5,hv,cc33cc");
    expect(store.hasShareUrl()).toBe(false);
  });
});