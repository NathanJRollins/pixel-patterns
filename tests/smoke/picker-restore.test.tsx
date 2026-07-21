// @vitest-environment happy-dom
/**
 * Regression: Shift+C opens the native color picker bound to the secondary
 * slot — temporarily flipping activeColorSlot to 'secondary' — then
 * restoreTempSlot() in onPickerChange OR onPickerBlur returns to primary
 * when the picker closes. Two close paths: `change` (pick a color) and
 * `blur` (dismiss). Tested in isolation; each case fully tests its own
 * setup/teardown to avoid cross-test state accumulation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "preact";
import { store } from "../../src/state/store.js";
import { boot } from "../../src/state/init.js";
import { ColorDock } from "../../src/ui/ColorDock.js";

async function freshBoot(): Promise<void> {
  // Drain any prior test's pending autosave (250 ms debounce) so it
  // doesn't fire during this test's boot and restore a stale slot.
  await new Promise((r) => setTimeout(r, 280));
  localStorage.clear();
  document.body.innerHTML = "";
  store.clearAllData();
  boot();
}

/** Wait for the picker effect (signals `effect` runs in a microtask
 * after the request signal bumps). 50 ms is consistently enough across
 * happy-dom + Preact + signals. */
function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 50));
}

async function mountDock(): Promise<{ container: HTMLDivElement; unmount: () => void }> {
  const c = document.createElement("div");
  document.body.appendChild(c);
  render(<ColorDock />, c);
  // Let mount effects settle before issuing a request.
  await tick();
  return {
    container: c,
    unmount: () => render(null, c),
  };
}

beforeEach(async () => {
  await freshBoot();
});

afterEach(async () => {
  // Restore to primary at end so any pending autosave callback reads
  // primary, not whatever temp slot the test was inspecting.
  store.setActiveColorSlot("primary");
  await new Promise((r) => setTimeout(r, 0));
});

describe("picker temp-slot restore on close", () => {
  it("requesting the picker doesn't itself swap active slot (the dock does)", () => {
    expect(store.activeColorSlot.value).toBe("primary");
    store.requestOpenColorPicker("secondary");
    // The synchronous store action only emits a request; the dock's
    // effect runs the swap async.
    expect(store.activeColorSlot.value).toBe("primary");
  });

  it("mounted dock consumes the request and swaps active to secondary", async () => {
    const { unmount } = await mountDock();
    store.requestOpenColorPicker("secondary");
    await tick();
    expect(store.activeColorSlot.value).toBe("secondary");
    unmount();
    // afterEach restores active to primary before yielding.
  });

  it("dispatching a blur event restores active to primary after the swap", async () => {
    const { container, unmount } = await mountDock();
    store.requestOpenColorPicker("secondary");
    await tick();
    expect(store.activeColorSlot.value).toBe("secondary");
    const input = container.querySelector('input[type="color"]') as HTMLInputElement;
    // Focus + blur simulates the picker dismissing.
    input.focus();
    input.dispatchEvent(new Event("blur"));
    expect(store.activeColorSlot.value).toBe("primary");
    unmount();
  });

  it("dispatching a change event restores active and stores the picked color on secondary", async () => {
    const { container, unmount } = await mountDock();
    store.requestOpenColorPicker("secondary");
    await tick();
    expect(store.activeColorSlot.value).toBe("secondary");
    const input = container.querySelector('input[type="color"]') as HTMLInputElement;
    input.value = "#abcdef";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new Event("change"));
    expect(store.activeColorSlot.value).toBe("primary");
    expect(store.secondaryColor.value).toBe(
      (((0xab << 24) | (0xcd << 16) | (0xef << 8) | 255) >>> 0) as never,
    );
    unmount();
  });
});