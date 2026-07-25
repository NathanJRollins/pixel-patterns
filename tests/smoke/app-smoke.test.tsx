/**
 * Smoke test: mount the real `<App />` under happy-dom, verify the boot
 * sequence runs without crashing, the toolbar renders, the store responds
 * to actions, and render-layer canvas codepaths don't throw (via the
 * stub installed in `canvas-stub.setup.ts`).
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "preact";
import { store } from "../../src/state/store.js";
import { App } from "../../src/ui/App.js";
import { boot } from "../../src/state/init.js";
import { canvasCallTotal } from "./canvas-stub.setup.js";

let container: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  container = document.createElement("div");
  container.id = "app";
  document.body.appendChild(container);
  // Each test starts from a clean store. `clearAllData` resets pattern
  // dimensions, mode, tool, color, history, and slots — so a prior test's
  // mutations (e.g. applyPreset with different dims) don't bleed through.
  store.clearAllData();
});

describe("App + boot (happy-dom smoke)", () => {
  it("boots without throwing and renders the brand and a toolbar", () => {
    expect(() => boot()).not.toThrow();
    expect(() => render(<App />, container)).not.toThrow();

    const title = container.querySelector(".brand .title");
    expect(title?.textContent).toBe("pixel-patterns");

    const toolButtons = container.querySelectorAll(".toolbar [aria-pressed]");
    expect(toolButtons.length).toBeGreaterThan(0);
  });

  it("fresh boot leaves the store in its configured defaults", () => {
    boot();
    render(<App />, container);
    expect(store.pattern.value.width).toBe(7);
    expect(store.pattern.value.height).toBe(7);
    expect(store.mirrorMode.value).toBe("HV");
    expect(store.tool.value).toBe("pencil");
    expect(store.previewCellScale.value).toBe(3);
    expect(store.bgScale.value).toBe(1);
  });

  it("changing the tool via the store updates the store's tool signal", () => {
    boot();
    render(<App />, container);
    expect(store.tool.value).toBe("pencil");
    store.setTool("eraser");
    expect(store.tool.value).toBe("eraser");
    store.setTool("bucket");
    expect(store.tool.value).toBe("bucket");
  });

  it("pencil stroke via mirror HV produces multi-cell writes; undo/redo round-trip", () => {
    boot();
    render(<App />, container);
    store.setTool("pencil");
    store.beginStroke();
    store.paintAt(0, 0);
    store.paintAt(1, 0);
    store.endStroke();

    let nonZero = 0;
    for (let i = 0; i < store.pattern.value.cells.length; i++) {
      if (store.pattern.value.cells[i] !== 0) nonZero++;
    }
    // (0,0) and (1,0) each fan out to 4 mirrored cells on a 7×7 odd grid:
    // (0,0)→4 cells, (1,0)→4 cells → 8 painted cells minimum.
    expect(nonZero).toBeGreaterThanOrEqual(8);

    store.undo();
    let afterUndo = 0;
    for (let i = 0; i < store.pattern.value.cells.length; i++) {
      if (store.pattern.value.cells[i] !== 0) afterUndo++;
    }
    expect(afterUndo).toBe(0);

    store.redo();
    let afterRedo = 0;
    for (let i = 0; i < store.pattern.value.cells.length; i++) {
      if (store.pattern.value.cells[i] !== 0) afterRedo++;
    }
    expect(afterRedo).toBe(nonZero);
  });

  it("fill fills; clear empties", () => {
    boot();
    render(<App />, container);
    store.fillPattern();
    let nonZero = 0;
    for (let i = 0; i < store.pattern.value.cells.length; i++) {
      if (store.pattern.value.cells[i] !== 0) nonZero++;
    }
    expect(nonZero).toBe(49); // 7×7 default grid

    store.clearPattern();
    let remaining = 0;
    for (let i = 0; i < store.pattern.value.cells.length; i++) {
      if (store.pattern.value.cells[i] !== 0) remaining++;
    }
    expect(remaining).toBe(0);
  });

  it("applyPreset mutates pattern + mirror mode", () => {
    boot();
    render(<App />, container);
    store.applyPreset("checkerboard");
    expect(store.mirrorMode.value).toBe("none");
    let nonZero = 0;
    for (let i = 0; i < store.pattern.value.cells.length; i++) {
      if (store.pattern.value.cells[i] !== 0) nonZero++;
    }
    expect(nonZero).toBe(2);

    store.applyPreset("heart");
    expect(store.mirrorMode.value).toBe("HV");
  });

  it("saveSlot / loadSlot / deleteSlot round-trip", () => {
    boot();
    render(<App />, container);
    store.fillPattern();
    store.saveSlot("alpha");
    expect(store.slots.value.length).toBe(1);
    expect(store.slots.value[0].name).toBe("alpha");

    store.clearPattern();
    let remaining = 0;
    for (let i = 0; i < store.pattern.value.cells.length; i++) {
      if (store.pattern.value.cells[i] !== 0) remaining++;
    }
    expect(remaining).toBe(0);

    store.loadSlot("alpha");
    let fired = 0;
    for (let i = 0; i < store.pattern.value.cells.length; i++) {
      if (store.pattern.value.cells[i] !== 0) fired++;
    }
    expect(fired).toBe(49); // 7×7 default grid

    store.deleteSlot("alpha");
    expect(store.slots.value.length).toBe(0);
  });

  it("render-layer canvas codepaths don't throw on mutation", () => {
    boot();
    render(<App />, container);
    const callsBefore = canvasCallTotal();
    store.fillPattern();
    store.paintAt(0, 0);
    const callsAfter = canvasCallTotal();
    expect(callsAfter).toBeGreaterThanOrEqual(callsBefore);
  });
});