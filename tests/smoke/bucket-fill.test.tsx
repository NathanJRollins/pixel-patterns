/**
 * @vitest-environment happy-dom
 *
 * Regression for the bucket-fill perf cliff. The previous
 * `Store.bucketFillAt` called `Store.applyCells([[cx, cy]], color)` per
 * visited cell — and `applyCells` ends with `bumpRev()` — so a 64×64 fill
 * synchronously wrote `rev` ~4096× in one tight loop. Each `rev` write
 * notified every rev-subscriber (draw-panel repaint, preview-panel
 * repaint, favicon repaint, page-bg rasterize), allocating a fresh
 * `[[cx, cy]]` per cell and re-running each effect per cell. Empirically
 * the operator saw ~20 s on a 64×64 fill on a fast desktop.
 *
 * The refactor batches mirror writes (still hits the same cells) and
 * bumps `rev` exactly once per fill. Here we mount the real `<App/>`
 * (so the rev-subscribed effect loop is live), then assert: (a) a 64×64
 * fill completes well under 2 s on any reasonable CI host; (b) every
 * cell ends up coloured by the bucket colour; (c) the `rev` signal bumps
 * a bounded handful of times, not 4096×.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "preact";
import { store } from "../../src/state/store.js";
import { App } from "../../src/ui/App.js";
import { boot } from "../../src/state/init.js";
import { packRGBA } from "../../src/domain/color.js";

let container: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  store.clearAllData();
});

describe("bucket fill perf (64×64 grid)", () => {
  it("completes well under 2 s, colours every cell, and bumps rev < handful of times", () => {
    boot();
    render(<App />, container);
    // Avoid letting the autosave timer (debounced 250 ms) bleed across
    // test boundaries while we're hammering the rev signal.
    store.setSaveEnabled(false);

    store.setDimensions(64, 64);
    store.setMirrorMode("none");
    store.setTool("bucket");

    // Paint the whole grid with colour A so the bucket has real work to do.
    store.setHex("#112233");
    store.fillPattern();
    const fillBefore = packRGBA(0x11, 0x22, 0x33, 0xff);
    {
      let painted = 0;
      const cells = store.pattern.value.cells;
      for (let i = 0; i < cells.length; i++) if (cells[i] === fillBefore) painted++;
      expect(painted).toBe(64 * 64);
    }

    // Switch brush to colour B, then bucket-fill the contiguous region.
    store.setHex("#cc6633");
    const expectAfter = packRGBA(0xcc, 0x66, 0x33, 0xff);

    const revBefore = store.rev.value;
    const start = (typeof performance !== "undefined" ? performance.now() : Date.now());
    store.bucketFillAt(0, 0);
    const elapsed =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - start;

    // 2 s is a 10× margin over the operator's "20 s" report. The
    // refactored fill runs in single-digit milliseconds even under
    // happy-dom; this guard catches a return to per-cell rev bumps.
    expect(elapsed).toBeLessThan(2000);

    {
      let painted = 0;
      const cells = store.pattern.value.cells;
      for (let i = 0; i < cells.length; i++) if (cells[i] === expectAfter) painted++;
      expect(painted).toBe(64 * 64);
    }

    // Bounded rev delta — the refactor bumps `rev` exactly once per fill.
    // Allow a small slack for incidental bookkeeping nudges; the previous
    // per-cell bump implementation would have blown past this many
    // hundreds of times over.
    const revDelta = store.rev.value - revBefore;
    expect(revDelta).toBeLessThanOrEqual(4);
  });
});