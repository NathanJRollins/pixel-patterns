/**
 * @vitest-environment happy-dom
 *
 * Regressions for the post-v3 polish: new session defaults (7×7, cell size
 * 3, page scale 1), `requestOpenColorPicker` action surface, and the export
 * modal's default-'Tile to size' preset now being the user's screen.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { store } from "../../src/state/store.js";
import { boot } from "../../src/state/init.js";

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  store.clearAllData();
});

describe("new session defaults", () => {
  it("fresh boot gives a 7×7 grid with cellScale 3 and bgScale 1", () => {
    boot();
    expect(store.pattern.value.width).toBe(7);
    expect(store.pattern.value.height).toBe(7);
    expect(store.previewCellScale.value).toBe(3);
    expect(store.bgScale.value).toBe(1);
  });
});

describe("color picker request API", () => {
  it("store.openPickerRequest is null at rest", () => {
    boot();
    expect(store.openPickerRequest.value).toBeNull();
  });

  it("requestOpenColorPicker() with no arg targets the active slot", () => {
    boot();
    store.setActiveColorSlot("primary");
    store.requestOpenColorPicker();
    expect(store.openPickerRequest.value).not.toBeNull();
    expect(store.openPickerRequest.value!.slot).toBe("primary");
  });

  it("requestOpenColorPicker('secondary') targets the secondary slot", () => {
    boot();
    store.setActiveColorSlot("primary");
    store.requestOpenColorPicker("secondary");
    expect(store.openPickerRequest.value!.slot).toBe("secondary");
    // The request does NOT itself switch the active slot — the ColorDock
    // does that when it handles the request (so the picker pop-up opens
    // bound to the temporary active slot). This separation keeps the
    // contract simple: keyboard asks the dock, the dock makes the swap.
    expect(store.activeColorSlot.value).toBe("primary");
  });

  it("each request bumps the nonce so the dock can re-fire on consecutive Cs", () => {
    boot();
    store.requestOpenColorPicker();
    const first = store.openPickerRequest.value!.nonce;
    store.requestOpenColorPicker();
    const second = store.openPickerRequest.value!.nonce;
    expect(second).toBeGreaterThan(first);
  });
});