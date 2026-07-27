/**
 * @vitest-environment happy-dom
 *
 * Regression test for the "share URL doesn't apply on in-tab navigation"
 * bug: when only the URL hash changes (clicking a `#p=...` link or pasting
 * a share URL in the address bar of an already-open tab), browsers fire
 * `hashchange` but do NOT reload the page — so `boot()` never re-runs and
 * the share payload never gets applied. The fix lives in `init.ts` as a
 * `hashchange` event listener that re-applies the share payload on every
 * hashchange that carries one.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { store } from "../../src/state/store.js";
import { boot } from "../../src/state/init.js";
import { packRGBA } from "../../src/domain/color.js";

function setHash(hash: string): void {
  // happy-dom honors `window.location.hash = ...` as a setter.
  window.location.hash = hash as unknown as string;
}

function fireHashChange(): void {
  // happy-dom doesn't auto-dispatch hashchange on a programmatic set; do it
  // ourselves the way the browser would.
  window.dispatchEvent(new Event("hashchange"));
}

beforeEach(() => {
  localStorage.clear();
  // Sweep any prior listeners so each test starts clean.
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  store.clearAllData();
  setHash("");
});

describe("share URL loads on in-tab hash change", () => {
  it("boot applies a share URL if present on first load", () => {
    // Initial state: empty pattern (from clearAllData).
    expect(store.pattern.value.cells.every((c) => c === 0)).toBe(true);
    // Stage a share URL with one red cell before boot. v2 format: 8 fields.
    const body = "ff0000ff" + "--".repeat(24); // 5x5, cell 0 = red
    setHash(`#p=5x5,hv,cc33cc,1.00,ffffff,1.00,p,${body}`);
    boot();
    expect(store.pattern.value.cells[0]).toBe(packRGBA(255, 0, 0, 255));
    expect(store.pattern.value.cells[1]).toBe(0);
  });

  it("when the app is already booted and a share URL arrives via hash change, the store applies it WITHOUT a page reload", () => {
    // Boot with no share URL — store starts empty/default.
    setHash("");
    boot();
    expect(store.pattern.value.cells.every((c) => c === 0)).toBe(true);

    // Simulate the user clicking a share URL in an email / pasting it in
    // the address bar. The browser fires hashchange; it does NOT reload.
    const body = "00ff00ff" + "--".repeat(24); // 5x5, cell 0 = green
    setHash(`#p=5x5,hv,00ff00,1.00,ffffff,1.00,p,${body}`);
    fireHashChange();

    // The store now carries the share payload — without any reload.
    expect(store.pattern.value.cells[0]).toBe(packRGBA(0, 255, 0, 255));
    expect(store.mirrorMode.value).toBe("HV");
  });

  it("hashchange without a share payload (#whatever) does not mutate the pattern", () => {
    setHash("");
    boot();
    // Paint a single cell so we have non-empty state to preserve.
    store.setHex("#cc33cc");
    store.commitRecent();
    store.beginStroke();
    store.paintAt(0, 0);
    store.endStroke();
    const cellsBefore = Array.from(store.pattern.value.cells);

    setHash("#some-other-anchor");
    fireHashChange();

    expect(Array.from(store.pattern.value.cells)).toEqual(cellsBefore);
  });

  it("erasing the hash (nav to bare URL) does not wipe the in-progress pattern", () => {
    // Stage a share URL then boot.
    const body = "ff0000ff" + "--".repeat(24);
    setHash(`#p=5x5,hv,cc33cc,1.00,ffffff,1.00,p,${body}`);
    boot();
    expect(store.pattern.value.cells[0]).toBe(packRGBA(255, 0, 0, 255));

    // Now erase the hash. This should NOT silently clear the user's
    // loaded pattern — they may have started painting on top.
    setHash("");
    fireHashChange();
    expect(store.pattern.value.cells[0]).toBe(packRGBA(255, 0, 0, 255));
  });
});