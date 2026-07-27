/**
 * @vitest-environment happy-dom
 *
 * Bug regression tests for the v2 polish pass. Each test pins a fix so a
 * future regression is loud.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { packRGBA, unpackRGBA } from "../../src/domain/color.js";
import { store } from "../../src/state/store.js";
import { boot } from "../../src/state/init.js";
import { canvasCallTotal } from "./canvas-stub.setup.js";

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  store.clearAllData();
});

describe("v2 polish regressions", () => {
  it("pickColor(transparent) is a no-op — preserves the currently-selected colour", () => {
    boot();
    store.setHex("#cc33cc");
    store.commitRecent();
    expect(store.color.value).not.toBe(0);
    const before = store.color.value;
    // Dropper sampled over a transparent cell — should NOT mutate the brush.
    store.pickColor(0);
    expect(store.color.value).toBe(before);
  });

  it("pickColor on a non-transparent cell captures RGB + alpha (dropper path)", () => {
    boot();
    const preset = packRGBA(0x10, 0x20, 0x30, 0x80);
    store.pickColor(preset);
    expect(store.color.value).toBe(preset);
    expect(store.alpha01.value).toBeCloseTo(0x80 / 255, 4);
  });

  it("pickSwatch keeps the currently-selected alpha when picking a swatch", () => {
    boot();
    store.setAlpha01(0.25);
    const swatch = packRGBA(0xff, 0x88, 0x44, 0xff); // swatch's stored alpha is opaque
    store.pickSwatch(swatch);
    // RGB matches swatch. Alpha comes from current alpha01, not the swatch.
    const [r, g, b, a] = unpackRGBA(store.color.value);
    expect([r, g, b]).toEqual([0xff, 0x88, 0x44]);
    expect(a).toBe(Math.round(0.25 * 255));
  });

  it("pickSwatch re-orders the swatch to the top of the recents panel (conventional UX)", () => {
    boot();
    // Stage two recents: red, then green. Recents reads top-down so green
    // should be at index 0.
    store.setHex("#ff0000");
    store.commitRecent();
    store.setHex("#00ff00");
    store.commitRecent();
    expect(store.recentCells.value[0]).toBe(packRGBA(0x00, 0xff, 0x00, 0xff));
    expect(store.recentCells.value[1]).toBe(packRGBA(0xff, 0x00, 0x00, 0xff));
    // Click the older entry (red) — it should re-order to the top.
    store.pickSwatch(store.recentCells.value[1]);
    expect(store.recentCells.value[0]).toBe(
      packRGBA(0xff, 0x00, 0x00, Math.round(1 * 255)),
    );
    expect(store.recentCells.value[1]).toBe(
      packRGBA(0x00, 0xff, 0x00, Math.round(1 * 255)),
    );
  });

  it("saveSlot ignores empty / whitespace-only names at the store layer", () => {
    boot();
    store.fillPattern();
    store.saveSlot("");
    store.saveSlot("   ");
    store.saveSlot("\t");
    expect(store.slots.value.length).toBe(0);
    store.saveSlot("real");
    expect(store.slots.value.length).toBe(1);
    // Saving a whitespace-only name shouldn't sneak past — and "real" +
    // whitespace should dedup to "real" rather than creating a second.
    store.saveSlot("real  ");
    expect(store.slots.value.length).toBe(1);
  });

  it("bumpRecent dedups by RGB only — picking the same hue at different alpha updates the entry in place", () => {
    boot();
    store.setHex("#cc33cc");
    store.commitRecent();
    expect(store.recentCells.value.length).toBe(1);
    store.setAlpha01(0.5);
    store.setHex("#cc33cc"); // same hue at half alpha via picker drag
    // Then a commitRecent reflecting the slider change before the next drag.
    store.commitRecent();
    const matching = store.recentCells.value.filter(
      (c) => ((c >>> 8) & 0xffffff) === ((0xcc << 16) | (0x33 << 8) | 0xcc),
    );
    expect(matching.length).toBe(1);
    const a255 = matching[0] & 0xff;
    expect(a255).toBe(Math.round(0.5 * 255));
  });

  it("HTML picker drag-style spam does not flood recents when commitRecent is gated to change", () => {
    boot();
    store.setHex("#ff0000");
    store.setHex("#00ff00");
    store.setHex("#0000ff");
    store.setHex("#ffff00");
    expect(store.recentCells.value.length).toBe(0);
    // On picker release, `change` fires → setHex + commitRecent:
    store.setHex("#ffff00");
    store.commitRecent();
    expect(store.recentCells.value.length).toBe(1);
  });

  it("superTileCanvas cache invalidates on cell-content change (the underlying cause of the bg-favicon-not-updating bug)", () => {
    // The original bug: page-bg / favicon had a content-blind cache of the
    // PNG data URL, so repainting a cell with the same dimensions + scale
    // reused the OLD url and the bg never visually updated. The fix moved
    // the platform cache into superTileCanvas, which DOES include a content
    // fingerprint in its cache key. This test pins that: two patterns with
    // the same dimensions but different cells produce two distinct offscreen
    // canvases (getContext fires twice, not once via the cache).
    boot();
    const before = canvasCallTotal();
    // First pattern: empty.
    const a = store.pattern.value;
    void a;
    superTileCanvasA();
    const afterA = canvasCallTotal();
    expect(afterA).toBeGreaterThan(before);
    // Paint one cell — content changes, fingerprint changes.
    store.setHex("#ff0000");
    store.beginStroke();
    store.paintAt(0, 0);
    store.endStroke();
    superTileCanvasA();
    const afterB = canvasCallTotal();
    expect(afterB).toBeGreaterThan(afterA);
  });
});

import { superTileCanvas } from "../../src/render/super-tile-canvas.js";
function superTileCanvasA(): void {
  // Invoke the memoised renderer so its getContext call fires during the
  // test (its `cachedCanvas` is module-scoped so subsequent calls with the
  // same signature skip the build; differ from the previous call and it
  // builds). This is the bit the original bug got wrong downstream.
  superTileCanvas(store.pattern.value, store.mirrorMode.value, 4);
}