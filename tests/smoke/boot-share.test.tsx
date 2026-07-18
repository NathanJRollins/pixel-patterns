/**
 * @vitest-environment happy-dom
 *
 * Reproduce the share-URL-loading bug: boot the app with a URL hash carrying
 * a non-default pattern, assert the store took on that pattern.
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
  // Ensure happy-dom has a real `window.location.hash` setter we can control.
  // Some happy-dom builds have a read-only location.hash; if so, swap it.
  try {
    setHash("#p=5x5,hv,cc33cc,1.00,----------");
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
  // Reset store to defaults so the boot's share load is observable.
  store.clearAllData();
});

afterEach(() => {
  setHash("");
});

describe("boot → load share URL", () => {
  it("boots with the default-app url hash and the store is the default", () => {
    setHash("");
    boot();
    expect(store.pattern.value.width).toBe(5);
    expect(store.pattern.value.height).toBe(5);
    let nonZero = 0;
    for (let i = 0; i < store.pattern.value.cells.length; i++) {
      if (store.pattern.value.cells[i] !== 0) nonZero++;
    }
    expect(nonZero).toBe(0);
  });

  it("boots with a share-URL hash carrying a painted cell and the store loads it", () => {
    // Encode a pattern with one red cell at (0,0) under HV mode.
    // Manually construct the body: 5x5=25 cells; cell 0 = ff0000ff, rest = "--".
    const body = "ff0000ff" + "--".repeat(24); // 8 + 48 = 56 chars
    const hash = `#p=5x5,hv,cc33cc,1.00,${body}`;
    setHash(hash);
    boot();
    expect(store.pattern.value.width).toBe(5);
    expect(store.pattern.value.height).toBe(5);
    expect(store.pattern.value.cells[0]).not.toBe(0);
    expect(store.pattern.value.cells[1]).toBe(0);
    // Mirror HV should also have painted (0,4), (4,0), (4,4) — wait, no: the
    // decoded pattern is the *store's saved pattern*, NOT its mirror
    // composition. We just stored one cell. Mirror composition happens at
    // render-time. So cells[] should have exactly one non-zero entry.
    let nonZero = 0;
    for (let i = 0; i < store.pattern.value.cells.length; i++) {
      if (store.pattern.value.cells[i] !== 0) nonZero++;
    }
    expect(nonZero).toBe(1);
  });

  it("boots with a share-URL hash with a different mirror mode and loads it", () => {
    const body = "--".repeat(25); // 5x5 empty
    const hash = `#p=5x5,v,00ff00,0.50,${body}`;
    setHash(hash);
    boot();
    expect(store.mirrorMode.value).toBe("V");
    expect(store.alpha01.value).toBeCloseTo(0.5, 2);
  });

  it("boot detects share URL via hasShareUrl", () => {
    const body = "--".repeat(25);
    const hash = `#p=5x5,hv,cc33cc,1.00,${body}`;
    setHash(hash);
    expect(store.hasShareUrl()).toBe(true);
  });
});