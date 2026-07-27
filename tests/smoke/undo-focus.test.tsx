/**
 * @vitest-environment happy-dom
 *
 * Regression for the `Ctrl+Z` focus leak (#7 in todo.txt). Two
 * contributors compounded:
 *
 *   1. `SaveSlots.commitSave` re-focused its name `<input>` after an
 *      Enter-save. With focus glued to the input, the page-wide `keydown`
 *      handler (`src/ui/keyboard.ts`) bailed on
 *      `target.tagName === "INPUT"`, silently swallowing `Ctrl+Z` until
 *      the user clicked on something inert.
 *   2. The draw canvas wasn't focusable, so clicking a cell to draw didn't
 *      steal focus from a stray input — focus stayed put.
 *
 * The fix: (a) `commitSave` blurs its input; (b) the canvas gets
 * `tabindex={-1}` and DrawPanel's pointerdown handler calls `.focus()`
 * explicitly (because `preventDefault` blocks the browser's automatic
 * focus-on-mousedown). After a save-with-Enter OR after any cell click,
 * the next `Ctrl+Z` propagates to the page-wide handler with a non-input
 * `target` and so the undo fires.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "preact";
import { store } from "../../src/state/store.js";
import { App } from "../../src/ui/App.js";
import { boot } from "../../src/state/init.js";

let container: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  store.clearAllData();
});

function nonZero(): number {
  let n = 0;
  const cells = store.pattern.value.cells;
  for (let i = 0; i < cells.length; i++) if (cells[i] !== 0) n++;
  return n;
}

function paintOneCell(): void {
  store.setTool("pencil");
  store.beginStroke();
  store.paintAt(0, 0);
  store.endStroke();
}

/**
 * Dispatch a pointerdown on the canvas at client (0,0). happy-dom has no
 * layout engine so the cell math returns whatever offset the layout falls
 * back to (see draw-grid-render); what we care about here is purely the
 * focus side effect of `handlePointerDown`, so we only need the handler to
 * *run*, not to paint the right cell.
 */
function dispatchCanvasPointerdown(canvas: HTMLCanvasElement): void {
  canvas.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 0,
      clientY: 0,
      button: 0,
      buttons: 1,
    }),
  );
}

/** Flush the microtask queue — Preact's `useEffect` (which installs the
 * page-wide `keydown` listener via `attachKeyboard`) runs in a microtask
 * after the synchronous render. We need that microtask to drain before we
 * dispatch a keydown we expect that listener to handle. Cf. the same trick
 * in `tests/smoke/picker-restore.test.tsx`. */
function tick(r = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), r));
}

describe("Ctrl+Z focus regression (#7)", () => {
  it("SaveSlots.commitSave blurs the slot-name input after an Enter-commit", () => {
    boot();
    render(<App />, container);

    const input = container.querySelector(
      ".dock .row input[type='text']",
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();

    input!.focus();
    expect(document.activeElement).toBe(input);

    input!.value = "slot-name";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    input!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    // The slot was saved.
    expect(store.slots.value.length).toBe(1);
    expect(store.slots.value[0].name).toBe("slot-name");

    // The fix: the input lost focus. Real browsers will move `activeElement`
    // back to `<body>`; happy-dom may leave it null. Either way, it should
    // not remain on the input itself.
    expect(document.activeElement).not.toBe(input);
  });

  it("DrawPanel canvas has tabindex=-1 so a pointerdown focuses it (a focus sink)", () => {
    boot();
    render(<App />, container);

    const canvas = container.querySelector(".drawgrid") as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    expect(canvas.getAttribute("tabindex")).toBe("-1");

    // Seed an input focus the same way the bug precondition would.
    const input = container.querySelector(
      ".dock .row input[type='text']",
    ) as HTMLInputElement | null;
    input!.focus();
    expect(document.activeElement).toBe(input);

    // Pointer-down on the canvas: handler prevents default + calls focus().
    dispatchCanvasPointerdown(canvas);

    // Canvas now holds focus, not the previously-focused input.
    expect(document.activeElement).toBe(canvas);
    expect(document.activeElement).not.toBe(input);
  });

  it("Ctrl+Z dispatched from the canvas fires undo (cells clear)", async () => {
    boot();
    render(<App />, container);
    // Let App's useEffect (which installs the page-wide `keydown` listener
    // via `attachKeyboard`) settle. Without this the listener isn't yet
    // attached and our dispatched keydown never lands.
    await tick(50);

    paintOneCell();
    expect(nonZero()).toBeGreaterThan(0);

    // Move focus onto the canvas directly (no pointer event synthesised —
    // under happy-dom there's no layout engine so a pointerdown would
    // paint a cell at (4,4) and pollute the undo count). The behaviour
    // under test is the keyboard dispatch path, not the focus sink.
    const canvas = container.querySelector(".drawgrid") as HTMLCanvasElement;
    canvas.focus();
    expect(document.activeElement).toBe(canvas);

    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
    );

    expect(nonZero()).toBe(0);
  });
});