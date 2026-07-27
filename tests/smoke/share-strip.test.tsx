/**
 * @vitest-environment happy-dom
 *
 * Regression tests for the share-URL strip (#5 in todo.txt). After a
 * share URL (`#p=...`) is loaded into the store, the address bar should
 * be rewritten to its bare path so a subsequent refresh doesn't re-apply
 * the share URL and overwrite any edits the user performed since loading
 * it. Both the boot-time path and the in-tab `hashchange` path must strip
 * the hash — see `loadShareAndStripHash` in `init.ts`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { store } from "../../src/state/store.js";
import { boot } from "../../src/state/init.js";
import { packRGBA } from "../../src/domain/color.js";

function setHash(hash: string): void {
  // happy-dom honours `window.location.hash = ...` as a setter.
  window.location.hash = hash as unknown as string;
}

function fireHashChange(): void {
  // happy-dom doesn't auto-dispatch hashchange on a programmatic set; do
  // it ourselves the way a real browser would.
  window.dispatchEvent(new Event("hashchange"));
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  store.clearAllData();
  setHash("");
});

describe("share URL strip (#5)", () => {
  it("boot strips the share hash after loading the payload", () => {
    const body = "ff0000ff" + "--".repeat(24); // 5x5, cell 0 = red
    setHash(`#p=5x5,hv,cc33cc,1.00,ffffff,1.00,p,${body}`);
    boot();

    // Pattern WAS loaded (share applied once).
    expect(store.pattern.value.cells[0]).toBe(packRGBA(255, 0, 0, 255));
  });

  it("boot silently rewrites location.hash to the empty string", () => {
    const body = "ff0000ff" + "--".repeat(24);
    setHash(`#p=5x5,hv,cc33cc,1.00,ffffff,1.00,p,${body}`);
    boot();

    expect(window.location.hash).toBe("");
  });

  it("after boot-with-share, hasShareUrl() returns false (next refresh would fall through to autosave)", () => {
    const body = "ff0000ff" + "--".repeat(24);
    setHash(`#p=5x5,hv,cc33cc,1.00,ffffff,1.00,p,${body}`);
    boot();

    // A second boot call would read location.hash; the strip above ensures
    // no share URL remains so a hypothetical refresh would NOT re-apply the
    // share URL and overwrite any edits the user made after the first load.
    expect(store.hasShareUrl()).toBe(false);
  });

  it("hashchange with a share URL applies the payload AND strips the hash", () => {
    setHash("");
    boot();
    expect(store.pattern.value.cells.every((c) => c === 0)).toBe(true);

    const body = "00ff00ff" + "--".repeat(24); // 5x5, cell 0 = green
    setHash(`#p=5x5,hv,00ff00,1.00,ffffff,1.00,p,${body}`);
    fireHashChange();

    expect(store.pattern.value.cells[0]).toBe(packRGBA(0, 255, 0, 255));
    expect(window.location.hash).toBe("");
  });

  it("hashchange WITHOUT a share payload does NOT mutate the pattern and does NOT clear the hash", () => {
    // Plant a first cell so we have non-empty state to preserve.
    store.setHex("#cc33cc");
    store.commitRecent();
    store.beginStroke();
    store.paintAt(0, 0);
    store.endStroke();
    const cellsBefore = Array.from(store.pattern.value.cells);

    setHash("#some-other-anchor");
    fireHashChange();

    expect(Array.from(store.pattern.value.cells)).toEqual(cellsBefore);
    // Non-share hashes are left alone — we don't strip those.
    expect(window.location.hash).toBe("#some-other-anchor");
  });
});