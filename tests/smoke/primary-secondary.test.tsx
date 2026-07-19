/**
 * @vitest-environment happy-dom
 *
 * Primary/secondary color regression suite. Pins the two-color-slot model
 * the operator asked for (MSPaint-style): LMB → primary, RMB → secondary,
 * clicking a swatch with LMB fills the active slot, with RMB fills the
 * inactive slot, `X` swaps.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { store } from "../../src/state/store.js";
import { boot } from "../../src/state/init.js";
import { packRGBA, unpackRGBA } from "../../src/domain/color.js";

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  store.clearAllData();
});

describe("primary / secondary color slots", () => {
  it("defaults: primary magenta full opacity; secondary white full opacity; active = primary", () => {
    boot();
    expect(store.primaryColor.value).toBe(packRGBA(0xcc, 0x33, 0xcc, 255));
    expect(store.primaryAlpha01.value).toBe(1);
    expect(store.secondaryColor.value).toBe(packRGBA(0xff, 0xff, 0xff, 255));
    expect(store.secondaryAlpha01.value).toBe(1);
    expect(store.activeColorSlot.value).toBe("primary");
  });

  it("color/alpha01 projections follow the active slot", () => {
    boot();
    store.setActiveColorSlot("secondary");
    store.setHex("#00ff00");
    expect(store.color.value).toBe(packRGBA(0, 255, 0, 255));
    expect(store.alpha01.value).toBe(1);
    // Switching back to primary, the projection reflects primary again
    store.setActiveColorSlot("primary");
    expect(store.color.value).toBe(packRGBA(0xcc, 0x33, 0xcc, 255));

    // And primary is undisturbed by edits to secondary
    store.setActiveColorSlot("secondary");
    store.setHex("#123456");
    expect(store.primaryColor.value).toBe(packRGBA(0xcc, 0x33, 0xcc, 255));
  });

  it("swapColors swaps both color and alpha", () => {
    boot();
    store.setHex("#ff0000"); // primary
    store.commitRecent();
    store.setActiveColorSlot("secondary");
    store.setHex("#0000ff"); // secondary
    store.setAlpha01(0.5);
    store.setActiveColorSlot("primary");

    store.swapColors();

    // Primary is now blue at 0.5; secondary is now red at 1.0.
    expect(store.primaryColor.value).toBe(packRGBA(0, 0, 255, Math.round(0.5 * 255)));
    expect(store.primaryAlpha01.value).toBeCloseTo(0.5, 4);
    expect(store.secondaryColor.value).toBe(packRGBA(255, 0, 0, 255));
    expect(store.secondaryAlpha01.value).toBe(1);
  });

  it("paintAt with which='primary' paints primary; with which='secondary' paints secondary", () => {
    boot();
    store.setHex("#ff0000"); // primary
    store.commitRecent();
    store.setActiveColorSlot("secondary");
    store.setHex("#00ff00"); // secondary
    store.setActiveColorSlot("primary");

    store.setTool("pencil");
    // RMB-like call paints secondary
    store.beginStroke();
    store.paintAt(0, 0, "secondary");
    store.endStroke();
    expect(store.pattern.value.cells[0]).toBe(packRGBA(0, 255, 0, 255));

    // LMB-like call paints primary at (1,0)
    store.beginStroke();
    store.paintAt(1, 0, "primary");
    store.endStroke();
    expect(store.pattern.value.cells[1]).toBe(packRGBA(255, 0, 0, 255));
  });

  it("paintAt without `which` defaults to the active slot", () => {
    boot();
    store.setHex("#ff0000"); // primary
    store.commitRecent();
    store.setActiveColorSlot("secondary");
    store.setHex("#0000ff"); // secondary

    store.setTool("pencil");
    store.beginStroke();
    store.paintAt(0, 0); // no `which` → active = secondary
    store.endStroke();
    expect(store.pattern.value.cells[0]).toBe(packRGBA(0, 0, 255, 255));
  });

  it("pickSwatch with which='secondary' fills the secondary slot; active slot is undisturbed", () => {
    boot();
    const swatch = packRGBA(0x88, 0x44, 0x22, 0xff);
    store.pickSwatch(swatch, "secondary");
    expect(store.secondaryColor.value).toBe(packRGBA(0x88, 0x44, 0x22, 0xff));
    // Primary unchanged.
    expect(store.primaryColor.value).toBe(packRGBA(0xcc, 0x33, 0xcc, 255));
  });

  it("pickColor (dropper) writes to the slot specified by `which`", () => {
    boot();
    // Paint one red cell at (0,0).
    store.setTool("pencil");
    store.setHex("#ff0000");
    store.commitRecent();
    store.beginStroke();
    store.paintAt(0, 0);
    store.endStroke();

    // Switch to dropper; sample at (0,0) but with which='secondary'
    store.setTool("dropper");
    store.pickColor(store.pattern.value.cells[0], "secondary");
    expect(store.secondaryColor.value).toBe(packRGBA(255, 0, 0, 255));
    // Primary untouched.
    expect(store.primaryColor.value).toBe(packRGBA(0xff, 0, 0, 255));

    // And the projection stayed on primary — the alpha of primary descends
    // from the brush state, not from the dropper's RMB sample:
    expect(store.activeColorSlot.value).toBe("primary");
  });

  it("recents list is unified — both primary and secondary picks land in the same list", () => {
    boot();
    // Two recent pushes from primary; two from secondary — all dedup'd
    // into a single 4-entry-by-this-point list.
    store.setHex("#ff0000");
    store.commitRecent(); // primary red
    store.setActiveColorSlot("secondary");
    store.setHex("#00ff00");
    store.commitRecent(); // secondary green
    store.setHex("#0000ff");
    store.commitRecent(); // secondary blue
    store.setActiveColorSlot("primary");
    store.setHex("#ffff00");
    store.commitRecent(); // primary yellow
    expect(store.recentCells.value.length).toBe(4);
    // LIFO ordering: most recent push first.
    const first = store.recentCells.value[0];
    const [r, g, b] = unpackRGBA(first);
    expect([r, g, b]).toEqual([255, 255, 0]);
  });

  it("recents list cap is 24 (doubled from the original 12)", () => {
    boot();
    for (let i = 0; i < 30; i++) {
      // Generate 30 distinct RGB hues.
      const r = (i * 17) & 0xff;
      const g = (i * 31) & 0xff;
      const b = (i * 53) & 0xff;
      const hex = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
      store.setHex(hex);
      store.commitRecent();
    }
    expect(store.recentCells.value.length).toBe(24);
  });

  it("snapshot/restore round-trips both color slots + active slot", () => {
    boot();
    store.setHex("#aabbcc");
    store.commitRecent();
    store.setActiveColorSlot("secondary");
    store.setHex("#112233");
    store.setAlpha01(0.5);
    store.setActiveColorSlot("primary");

    const snap = store.snapshot();
    const ser = JSON.stringify(snap);

    // Wipe state and restore from the serialized payload.
    store.clearAllData();
    expect(store.primaryColor.value).toBe(packRGBA(0xcc, 0x33, 0xcc, 255)); // back to default
    store.restore(JSON.parse(ser));
    expect(store.primaryColor.value).toBe(packRGBA(0xaa, 0xbb, 0xcc, 255));
    expect(store.secondaryColor.value).toBe(packRGBA(0x11, 0x22, 0x33, Math.round(0.5 * 255)));
    expect(store.activeColorSlot.value).toBe("primary");
  });

  it("restore from a pre-v2 snapshot (no secondary fields) keeps the default secondary", () => {
    boot();
    // Hand-construct a v1-style Savestate without secondaryHex etc.
    const legacy: Record<string, unknown> = {
      pattern: "5x5:" + "--".repeat(25),
      mirrorMode: "HV",
      tool: "pencil",
      hex: "#abcdef",
      alpha01: 1,
      recentCells: [],
      previewCellScale: 8,
      bgScale: 4,
      showPageBg: true,
      showGridLines: true,
      showMirrorAxis: true,
      theme: "dark",
      saveEnabled: true,
      slots: [],
    };
    store.restore(legacy as never);
    expect(store.primaryColor.value).toBe(packRGBA(0xab, 0xcd, 0xef, 255));
    // Secondary kept its in-place value (default white) — restore's
    // back-compat leaves the secondary slot alone if absent in payload.
    expect(store.secondaryColor.value).toBe(packRGBA(0xff, 0xff, 0xff, 255));
  });
});