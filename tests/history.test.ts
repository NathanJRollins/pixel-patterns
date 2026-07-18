import { describe, it, expect } from "vitest";
import { History } from "../src/domain/history.js";
import { clonePattern, emptyPattern, patternsEqual } from "../src/domain/pattern.js";
import { packRGBA } from "../src/domain/color.js";
import { setCell } from "../src/domain/pattern.js";

describe("history", () => {
  it("starts empty: canUndo and canRedo are false", () => {
    const h = new History();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });

  it("push once enables undo; returns last snapshot via undoStep", () => {
    const h = new History();
    const p = emptyPattern(2, 2);
    setCell(p, 0, 0, packRGBA(255, 0, 0, 255));
    h.push(p);
    expect(h.canUndo()).toBe(true);
    // mutate the live pattern after the snapshot
    const edited = clonePattern(p);
    setCell(edited, 1, 1, packRGBA(0, 255, 0, 255));
    const prev = h.undoStep(edited);
    expect(prev).not.toBeNull();
    expect(patternsEqual(prev!, p)).toBe(true);
    // original got pushed onto the redo stack
    expect(h.canRedo()).toBe(true);
  });

  it("redoStep swaps back to the post-edit pattern", () => {
    const h = new History();
    const p0 = emptyPattern(2, 2);
    setCell(p0, 0, 0, packRGBA(255, 0, 0, 255));
    h.push(p0);
    // The "current" pattern at the moment of undo: mutated p
    const p1 = clonePattern(p0);
    setCell(p1, 1, 1, packRGBA(0, 255, 0, 255));
    const prev = h.undoStep(p1);
    expect(prev && patternsEqual(prev, p0)).toBe(true);
    // redoStep expects the *current* pattern (which is now prev/p0) and returns
    // the snapshot it stashed away (which is p1).
    const back = h.redoStep(prev || p0);
    expect(back && patternsEqual(back, p1)).toBe(true);
  });

  it("pushing after an undo clears the redo stack (standard behaviour)", () => {
    const h = new History();
    const p0 = emptyPattern(2, 2);
    h.push(p0);
    const p1 = clonePattern(p0);
    h.undoStep(p1);
    expect(h.canRedo()).toBe(true);
    const p2 = clonePattern(p0);
    h.push(p2);
    expect(h.canRedo()).toBe(false);
  });

  it("history caps at 64 entries (FIFO)", () => {
    const h = new History();
    for (let i = 0; i < 100; i++) {
      const p = emptyPattern(2, 2);
      setCell(p, 0, 0, packRGBA(i, i, i, 255));
      h.push(p);
    }
    let count = 0;
    let cur = emptyPattern(2, 2);
    while (h.canUndo()) {
      const prev = h.undoStep(cur);
      if (!prev) break;
      cur = prev;
      count++;
    }
    expect(count).toBe(64);
  });

  it("reset re-baselines against a fresh pattern", () => {
    const h = new History();
    const p = emptyPattern(2, 2);
    h.push(p);
    h.push(p);
    h.reset(p);
    // After reset there's exactly one undo step (the pushed baseline).
    expect(h.canUndo()).toBe(true);
    const prev = h.undoStep(p);
    expect(prev && patternsEqual(prev, p)).toBe(true);
    expect(h.canUndo()).toBe(false);
  });
});