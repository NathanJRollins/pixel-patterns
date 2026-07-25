/**
 * @vitest-environment happy-dom
 *
 * Line tool end-to-end regression: confirms the snapshot-revert-and-repaint
 * approach used by DrawPanel's pointermove handler produces the correct
 * pattern after each move — i.e. the visible line at any moment is exactly
 * "anchor → cursor", not "anchor → every intermediate cursor position".
 *
 * We exercise the store directly (rather than synthesizing pointer events)
 * because the smoke environment has no real cursor; the line tool's
 * snapshot/revert bookkeeping lives in DrawPanel's closure and isn't easy
 * to drive from a test. What we *can* do is simulate the same observable
 * sequence the handler would emit: pre-snapshot, paint anchor, then on
 * each move revert to snap + paint line from anchor → current.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { store } from "../../src/state/store.js";
import { boot } from "../../src/state/init.js";
import { clonePattern } from "../../src/domain/pattern.js";
import { packRGBA } from "../../src/domain/color.js";

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  store.clearAllData();
});

describe("line tool model: snapshot-revert-repaint", () => {
  it("after a stroke the visible cells are exactly anchor → final cursor", () => {
    boot();
    store.setTool("line");
    store.setHex("#ff0000");

    // Simulate pointerdown at (0,0):
    //   - take a snapshot of the (empty) cells
    //   - beginStroke paints (0,0)
    const snapshot = clonePattern(store.pattern.value);
    store.beginStroke();
    store.paintAt(0, 0);

    // Simulate pointermove to (1,1): revert to snap, paint (0,0)→(1,1)
    store.pattern.value.cells.set(snapshot.cells);
    store.paintLine(0, 0, 1, 1);

    // After this move, the painted cells should be exactly (0,0) and (1,1)
    // (plus their HV-mirror reflections because the default mode is HV on
    // the 5×5 grid: (0,0)→4 corners, (1,1)→4 cells but (1,1) differs from
    // (3,3) etc.) — so the *non-mirrored* base hits are (0,0) and (1,1),
    // and the mirror fan-out is the four-way symmetric set of each.
    {
      const cells = store.pattern.value.cells;
      const W = store.pattern.value.width;
      const expected = new Set<string>();
      for (const [x, y] of [
        [0, 0], [1, 1],
      ]) {
        expected.add(`${x},${y}`);
        // HV mirrors
        expected.add(`${W - 1 - x},${y}`);
        expected.add(`${x},${W - 1 - y}`);
        expected.add(`${W - 1 - x},${W - 1 - y}`);
      }
      let nonZero = 0;
      let allExpected = true;
      for (let y = 0; y < W; y++) {
        for (let x = 0; x < W; x++) {
          if (cells[y * W + x] !== 0) {
            nonZero++;
            if (!expected.has(`${x},${y}`)) allExpected = false;
          }
        }
      }
      expect(allExpected).toBe(true);
      expect(nonZero).toBe(expected.size);
    }

    // Simulate pointermove to (3,3): revert to snap, paint (0,0)→(3,3)
    store.pattern.value.cells.set(snapshot.cells);
    store.paintLine(0, 0, 3, 3);

    // After this move, the painted cells should be exactly the Bresenham
    // line (0,0)→(3,3): (0,0), (1,1), (2,2), (3,3), with HV mirror fan-out.
    {
      const cells = store.pattern.value.cells;
      const W = store.pattern.value.width;
      const hits: Array<[number, number]> = [
        [0, 0], [1, 1], [2, 2], [3, 3],
      ];
      const expected = new Set<string>();
      for (const [x, y] of hits) {
        expected.add(`${x},${y}`);
        expected.add(`${W - 1 - x},${y}`);
        expected.add(`${x},${W - 1 - y}`);
        expected.add(`${W - 1 - x},${W - 1 - y}`);
      }
      let allExpected = true;
      let nonZero = 0;
      for (let y = 0; y < W; y++) {
        for (let x = 0; x < W; x++) {
          if (cells[y * W + x] !== 0) {
            nonZero++;
            if (!expected.has(`${x},${y}`)) allExpected = false;
          }
        }
      }
      expect(allExpected).toBe(true);
      // The expected set may collapse some of the mirror points when cell
      // positions overlap (e.g. center of an odd grid). Use set size.
      expect(nonZero).toBe(expected.size);
    }

    // pointerup ends the stroke; undo removes it (back to snapshot).
    store.endStroke();
    store.undo();
    let remaining = 0;
    for (let i = 0; i < store.pattern.value.cells.length; i++) {
      if (store.pattern.value.cells[i] !== 0) remaining++;
    }
    expect(remaining).toBe(0);
  });

  it("snapshot-reverts do NOT carry over residue from prior moves", () => {
    boot();
    store.setTool("line");
    store.setHex("#00ff00");

    const snapshot = clonePattern(store.pattern.value);
    store.beginStroke();
    store.paintAt(2, 2);

    // simulate several pointermoves through cells that would normally leave
    // a fat trail: at each move we revert to the empty snap then repaint
    // anchor → cur.
    const moves: Array<[number, number]> = [[0, 0], [1, 2], [3, 3], [4, 2], [0, 0]];
    for (const [mx, my] of moves) {
      store.pattern.value.cells.set(snapshot.cells);
      store.paintLine(2, 2, mx, my);
    }
    // Final paint: anchor (2,2) → last move (0,0). The line tool's visible
    // state is "anchor → final cursor"; intermediate moves should be gone.
    const W = store.pattern.value.width;
    const expected = new Set<string>();
    const lineHits: Array<[number, number]> = [
      [2, 2], [1, 1], [0, 0],
    ]; // Bresenham from (2,2) to (0,0)
    for (const [x, y] of lineHits) {
      expected.add(`${x},${y}`);
      expected.add(`${W - 1 - x},${y}`);
      expected.add(`${x},${W - 1 - y}`);
      expected.add(`${W - 1 - x},${W - 1 - y}`);
    }
    let allExpected = true;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const v = store.pattern.value.cells[y * W + x];
        if (v === packRGBA(0x00, 0xff, 0x00, 0xff)) {
          if (!expected.has(`${x},${y}`)) allExpected = false;
        }
      }
    }
    expect(allExpected).toBe(true);
  });
});