/**
 * @vitest-environment happy-dom
 *
 * Smoke tests for the chip-pass todos (#1, #2, #10):
 *
 *   #1  Save-slot chip load now fires from *anywhere* on the chip (was:
 *       only the inner `<img>` had an onClick). Test: click on the chip's
 *       text label (not the thumb) and assert the slot's pattern restored.
 *   #2  Chip labels aren't truncated to a 100-px cap anymore. Test: a slot
 *       with a long name has its full text in the DOM (we can't really
 *       inspect CSS ellipsis under happy-dom, so the test just verifies
 *       the label isn't cut in the DOM model).
 *   #10 Right-click a chip → ContextMenu opens with the expected items;
 *       off-click or Escape closes it; clicking an action item fires the
 *       store action and closes the menu.
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

/** Flush Preact's microtask queue so a `.value = ...` change has time to
 * re-render. Picker-restore uses the same ~50 ms idiom. */
function tick(ms = 30): Promise<void> {
  return new Promise((r) => setTimeout(() => r(), ms));
}

function nonZero(): number {
  let n = 0;
  const cells = store.pattern.value.cells;
  for (let i = 0; i < cells.length; i++) if (cells[i] !== 0) n++;
  return n;
}

/** Locate the save-slot chip whose `.chip-label` matches `name`. */
function findSlotChip(name: string): HTMLElement | null {
  const lbls = container.querySelectorAll(".shelf .chip-row .chip .chip-label");
  for (const lbl of Array.from(lbls)) {
    if ((lbl as HTMLElement).textContent === name) {
      return (lbl as HTMLElement).closest(".chip") as HTMLElement;
    }
  }
  return null;
}

function findPresetChip(label: string): HTMLElement | null {
  const lbls = container.querySelectorAll(".shelf .chip-row .chip .chip-label");
  for (const lbl of Array.from(lbls)) {
    if ((lbl as HTMLElement).textContent === label) {
      return (lbl as HTMLElement).closest(".chip") as HTMLElement;
    }
  }
  return null;
}

describe("chip load target (#1)", () => {
  it("clicking the chip TEXT (not the thumb) loads the slot", async () => {
    boot();
    render(<App />, container);

    store.fillPattern();
    expect(nonZero()).toBe(store.pattern.value.width * store.pattern.value.height);
    store.saveSlot("alpha");
    await tick();
    expect(store.slots.value.length).toBe(1);

    store.clearPattern();
    await tick();
    expect(nonZero()).toBe(0);

    const chip = findSlotChip("alpha");
    expect(chip).not.toBeNull();
    const label = chip!.querySelector(".chip-label") as HTMLElement;
    label.click();

    expect(nonZero()).toBe(store.pattern.value.width * store.pattern.value.height);
  });

  it("deleting via the chip's × button does NOT fire the chip's click (load)", async () => {
    boot();
    render(<App />, container);
    store.fillPattern();
    store.saveSlot("alpha");
    await tick();
    store.clearPattern();
    await tick();

    const chip = findSlotChip("alpha");
    expect(chip).not.toBeNull();
    const del = chip!.querySelector(".chip-del") as HTMLButtonElement;
    del.click();

    expect(store.slots.value.length).toBe(0);
    expect(nonZero()).toBe(0);
  });
});

describe("chip labels render full text (#2)", () => {
  it("a long slot name is fully present in the DOM label (no truncation)", async () => {
    boot();
    render(<App />, container);
    const LONG = "Some Awfully Long Slot Name That Used To Truncate";
    store.fillPattern();
    store.saveSlot(LONG);
    await tick();

    const chip = findSlotChip(LONG);
    expect(chip).not.toBeNull();
    const label = chip!.querySelector(".chip-label") as HTMLElement;
    // DOM faithfully carries the full label; the fix removed the CSS
    // `max-width: 100px` + ellipsis so the *visible* chip can now grow to
    // fit it rather than clipping at 100 px. Under happy-dom there's no
    // layout engine to enforce the CSS cap so we assert the DOM strings,
    // which is what the user sees when ellipsis clip does NOT hide glyphs.
    expect(label.textContent).toBe(LONG);
  });
});

describe("chip context menu (#10)", () => {
  it("right-clicking a save slot opens a menu with Load / Overwrite / Copy / Delete", async () => {
    boot();
    render(<App />, container);
    store.fillPattern();
    store.saveSlot("alpha");
    await tick();

    const chip = findSlotChip("alpha");
    expect(chip).not.toBeNull();
    expect(container.querySelector(".ctx-menu")).toBeNull();

    chip!.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
        button: 2,
      }),
    );
    await tick();

    const menu = container.querySelector(".ctx-menu") as HTMLElement | null;
    expect(menu).not.toBeNull();

    const items = Array.from(menu!.querySelectorAll(".ctx-item")) as HTMLElement[];
    expect(items.length).toBe(4);
    expect(items.map((i) => i.textContent)).toEqual([
      "Load",
      "Overwrite with current",
      "Copy share URL",
      "Delete",
    ]);
  });

  it("clicking Load from the slot menu loads the slot and closes the menu", async () => {
    boot();
    render(<App />, container);
    store.fillPattern();
    store.saveSlot("alpha");
    await tick();
    store.clearPattern();
    await tick();
    expect(nonZero()).toBe(0);

    const chip = findSlotChip("alpha");
    chip!.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
        button: 2,
      }),
    );
    await tick();
    const menu = container.querySelector(".ctx-menu") as HTMLElement;
    const loadItem = Array.from(menu.querySelectorAll(".ctx-item")).find(
      (i) => i.textContent === "Load",
    ) as HTMLButtonElement;
    loadItem.click();
    // The `loadSlot` action mutates the store synchronously (no DOM pass
    // needed for this assertion).
    expect(nonZero()).toBe(store.pattern.value.width * store.pattern.value.height);
    // ...but confirming the menu is gone needs the wipe-from-DOM microtask.
    await tick();
    expect(container.querySelector(".ctx-menu")).toBeNull();
  });

  it("clicking Overwrite from the slot menu re-saves the current pattern over the slot", async () => {
    boot();
    render(<App />, container);
    store.fillPattern();
    store.saveSlot("alpha");
    await tick();
    store.clearPattern();
    await tick();
    expect(nonZero()).toBe(0);

    const chip = findSlotChip("alpha");
    chip!.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
        button: 2,
      }),
    );
    await tick();
    const menu = container.querySelector(".ctx-menu") as HTMLElement;
    const overwrite =
      Array.from(menu.querySelectorAll(".ctx-item")).find(
        (i) => i.textContent === "Overwrite with current",
      ) as HTMLButtonElement;
    overwrite.click();

    expect(store.slots.value[0].pattern).toContain(
      `${store.pattern.value.width}x${store.pattern.value.height}:${"--".repeat(
        store.pattern.value.width * store.pattern.value.height,
      )}`,
    );
  });

  it("right-clicking a preset chip opens a menu with Load / Copy share URL", async () => {
    boot();
    render(<App />, container);

    const chip = findPresetChip("Heart");
    expect(chip).not.toBeNull();

    chip!.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
        button: 2,
      }),
    );
    await tick();

    const menu = container.querySelector(".ctx-menu") as HTMLElement;
    const items = Array.from(menu.querySelectorAll(".ctx-item")).map((i) => i.textContent);
    expect(items).toEqual(["Load", "Copy share URL"]);
  });

  it("clicking Load from the preset menu applies the preset", async () => {
    boot();
    render(<App />, container);

    const chip = findPresetChip("Checkerboard");
    chip!.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
        button: 2,
      }),
    );
    await tick();
    const menu = container.querySelector(".ctx-menu") as HTMLElement;
    const load =
      Array.from(menu.querySelectorAll(".ctx-item")).find(
        (i) => i.textContent === "Load",
      ) as HTMLButtonElement;
    load.click();

    expect(store.mirrorMode.value).toBe("none");
    let painted = 0;
    for (let i = 0; i < store.pattern.value.cells.length; i++) {
      if (store.pattern.value.cells[i] !== 0) painted++;
    }
    expect(painted).toBe(2);
  });
});

describe("Clear-all-slots 2-step confirm (#8)", () => {
  function findClearAllSlotsBtn(): HTMLButtonElement | null {
    const btns = container.querySelectorAll("button");
    for (const b of Array.from(btns)) {
      if (b.textContent === "Clear all slots" || b.textContent === "Confirm?") {
        return b as HTMLButtonElement;
      }
    }
    return null;
  }

  it("first click arms the confirm; second click clears all slots", async () => {
    boot();
    render(<App />, container);
    store.fillPattern();
    store.saveSlot("alpha");
    store.saveSlot("beta");
    await tick();
    expect(store.slots.value.length).toBe(2);

    const btn = findClearAllSlotsBtn()!;
    expect(btn.textContent).toBe("Clear all slots");

    btn.click();
    await tick();
    // Still armed but not yet cleared.
    expect(store.slots.value.length).toBe(2);
    expect(btn.textContent).toBe("Confirm?");
    expect(btn.getAttribute("data-confirming")).toBe("true");
    expect(btn.classList.contains("btn-danger")).toBe(true);

    btn.click();
    expect(store.slots.value.length).toBe(0);
    // After clear, the button is removed (length===0 hides it).
    await tick();
    expect(findClearAllSlotsBtn()).toBeNull();
  });

  it("saving a slot between arm and confirm cancels the arm (revert on slots change)", async () => {
    boot();
    render(<App />, container);
    store.fillPattern();
    store.saveSlot("alpha");
    await tick();

    const btn = findClearAllSlotsBtn()!;
    btn.click();
    await tick();
    expect(btn.textContent).toBe("Confirm?");

    // A slots change (save another slot) should reset the confirm state.
    store.saveSlot("beta");
    await tick();
    expect(btn.textContent).toBe("Clear all slots");
    expect(btn.getAttribute("data-confirming")).toBe("false");
    expect(store.slots.value.length).toBe(2);
  });

  it("the confirm arm auto-reverts after 3 s of inactivity", async () => {
    boot();
    render(<App />, container);
    store.fillPattern();
    store.saveSlot("alpha");
    await tick();

    const btn = findClearAllSlotsBtn()!;
    btn.click();
    await tick();
    expect(btn.textContent).toBe("Confirm?");

    // Advance vitest's fake timers past the 3 s auto-revert.
    await new Promise((r) => setTimeout(r, 3100));
    expect(btn.textContent).toBe("Clear all slots");
  });
});