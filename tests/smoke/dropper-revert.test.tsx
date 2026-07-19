/**
 * @vitest-environment happy-dom
 *
 * Dropper auto-revert regression: clicking a cell while the dropper tool
 * is active should sample the color AND automatically switch back to
 * whatever tool the user had active before they picked the dropper.
 *
 * The long-press dropper path (touch only) is separate and uses its own
 * `savedToolRef` in DrawPanel; here we exercise the manually-selected
 * dropper path via the store + visible UI events as far as happy-dom
 * can synthesize them.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { store } from "../../src/state/store.js";
import { boot } from "../../src/state/init.js";
import { packRGBA } from "../../src/domain/color.js";

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  store.clearAllData();
});

describe("dropper auto-revert", () => {
  it("store tracks the previous tool when switching TO the dropper", () => {
    boot();
    store.setTool("pencil"); // baseline
    store.setTool("dropper");
    expect(store.tool.value).toBe("dropper");
    expect(store.revertDropper());
    expect(store.tool.value).toBe("pencil");
  });

  it("revertDropper is a no-op when the current tool is not dropper", () => {
    boot();
    store.setTool("pencil");
    store.revertDropper();
    expect(store.tool.value).toBe("pencil");
  });

  it("revertDropper doesn't bounce back through several tool switches", () => {
    boot();
    // pencil → eraser → dropper → revert should land on `eraser`, not pencil.
    store.setTool("eraser");
    store.setTool("dropper");
    store.revertDropper();
    expect(store.tool.value).toBe("eraser");
  });

  it("sampling a cell via pickColor no longer changes the tool (the UI's end-stroke revert is responsible for that); the store API alone keeps the tool", () => {
    boot();
    store.setTool("pencil");
    store.setTool("dropper");
    // Dropper samples a non-transparent cell. The pickColor mutate the
    // brush but is not responsible for tool reversion (that happens on
    // pointerup in DrawPanel). So this is a sanity check on the store
    // boundary: pure color sampling does NOT auto-revert.
    const c = packRGBA(10, 20, 30, 255);
    store.pickColor(c);
    expect(store.color.value).toBe(c);
    expect(store.tool.value).toBe("dropper");
    // The UI side calls revertDropper explicitly on pointerup:
    store.revertDropper();
    expect(store.tool.value).toBe("pencil");
  });

  it("switching dropper→dropper (already-dropper) does not lose the prev tool", () => {
    boot();
    store.setTool("bucket");
    store.setTool("dropper");
    // Press `I` again while already on dropper — should be a no-op, prevTool
    // stays as bucket.
    store.setTool("dropper");
    store.revertDropper();
    expect(store.tool.value).toBe("bucket");
  });

  it("switching to another tool from dropper then back to dropper captures the most recent non-dropper tool", () => {
    boot();
    store.setTool("pencil");
    store.setTool("dropper");
    store.setTool("line");
    store.setTool("dropper");
    store.revertDropper();
    expect(store.tool.value).toBe("line");
  });
});