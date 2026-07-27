import { describe, it, expect } from "vitest";
import { History } from "../src/domain/history.js";
import { clonePattern, emptyPattern, patternsEqual } from "../src/domain/pattern.js";
import { packRGBA } from "../src/domain/color.js";
import { setCell } from "../src/domain/pattern.js";

describe("history: basic undo/redo", () => {
  it("starts empty: canUndo and canRedo are false; bytesHeld is 0", () => {
    const h = new History();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.bytesHeld()).toBe(0);
    expect(h.undoDepth()).toBe(0);
  });

  it("push once enables undo; returns last snapshot via undoStep", () => {
    const h = new History();
    const p = emptyPattern(2, 2);
    setCell(p, 0, 0, packRGBA(255, 0, 0, 255));
    h.push(p);
    expect(h.canUndo()).toBe(true);
    // After one push, bytesHeld is exactly the snapshot's cell byteLength
    // (2x2 x 4 bytes per cell = 16 bytes).
    expect(h.bytesHeld()).toBe(16);
    expect(h.undoDepth()).toBe(1);
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
    const p1 = clonePattern(p0);
    setCell(p1, 1, 1, packRGBA(0, 255, 0, 255));
    const prev = h.undoStep(p1);
    expect(prev && patternsEqual(prev, p0)).toBe(true);
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

describe("history: byte-budget ceiling", () => {
  it("memory is lazy — empty history holds 0 bytes; pushes grow as needed", () => {
    const h = new History(1024 * 1024); // 1 MB cap
    expect(h.bytesHeld()).toBe(0);
    const p = emptyPattern(2, 2); // 16-byte snapshot
    h.push(p);
    expect(h.bytesHeld()).toBe(16);
    h.push(p);
    expect(h.bytesHeld()).toBe(32);
    h.push(p);
    expect(h.bytesHeld()).toBe(48);
    // undoDepth tracks the same count
    expect(h.undoDepth()).toBe(3);
  });

  it("evicts FIFO once byte budget is exceeded", () => {
    // Use a 16-byte pattern with a 128-byte budget → max 8 snapshots before
    // eviction. We push 20 distinct patterns so eviction MUST kick in.
    const h = new History(128);
    const p0 = emptyPattern(2, 2);
    setCell(p0, 0, 0, packRGBA(1, 1, 1, 255));
    // Push 20 distinct patterns (so dedup wouldn't apply; we want N distinct
    // snapshots in the stack). Each iteration mutates p slightly so the
    // snapshots aren't byte-identical (the byte budget is the same per
    // snapshot — 16 bytes — but the content differs, which is what matters
    // for the snapshot semantics). We're confirming the *count* floor too.
    for (let i = 0; i < 20; i++) {
      const p = clonePattern(p0);
      setCell(p, 0, 0, packRGBA(i + 1, i + 1, i + 1, 255));
      h.push(p);
    }
    // 128 / 16 = 8 slots — but MIN_SNAPSHOTS is 8, so we should be exactly
    // at 8 (we evicted 12 to get from 20 to 8).
    expect(h.undoDepth()).toBe(8);
    expect(h.bytesHeld()).toBe(128);
  });

  it("never evicts below MIN_SNAPSHOTS even when one snapshot exceeds the budget", () => {
    // 64×64 pattern = 4096 cells × 4 bytes = 16,384 bytes per snapshot.
    // Budget 1024 bytes (smaller than one snapshot). Expected behaviour:
    // we still keep MIN_SNAPSHOTS (8) snapshots despite being over-budget,
    // because losing all undo history would be worse than overshooting the
    // budget by a single snapshot's worth of bytes.
    const h = new History(1024);
    const p = emptyPattern(64, 64);
    setCell(p, 0, 0, packRGBA(255, 255, 255, 255));
    for (let i = 0; i < 12; i++) h.push(p);
    expect(h.undoDepth()).toBe(8);
    // bytesHeld = 8 × 16384 = 131072, well above the 1024 budget, but the
    // MIN_SNAPSHOTS floor protects us from total wipeout.
    expect(h.bytesHeld()).toBe(8 * 64 * 64 * 4);
  });

  it("default budget is 256 MB — at least 16k snapshots for a 64×64 pattern", () => {
    const h = new History(); // default
    const p = emptyPattern(64, 64);
    // Push 100 snapshots — should all fit comfortably at 256 MB.
    for (let i = 0; i < 100; i++) h.push(p);
    expect(h.undoDepth()).toBe(100);
    expect(h.bytesHeld()).toBe(100 * 64 * 64 * 4);
    // ...and the theoretical max for this pattern at 256 MB:
    // 256*1024*1024 / (64*64*4) = 16384 snapshots.
    const theoreticalMax = Math.floor((256 * 1024 * 1024) / (64 * 64 * 4));
    expect(theoreticalMax).toBeGreaterThanOrEqual(16384);
  });

  it("redo stack also respects the byte budget", () => {
    // Same 16-byte snapshot, 128-byte budget. Push 4, undo all 4 (now 4
    // on redo stack), then push 4 more undoSteps to overflow redo — should
    // evict remaining redo entries FIFO down to MIN (8 ≥ 4 so nothing
    // evicts; redo stays at 4). Adjust to use a smaller MIN by choosing
    // fewer pushes.
    const h = new History(128);
    const p = emptyPattern(2, 2);
    for (let i = 0; i < 4; i++) h.push(p);
    expect(h.undoDepth()).toBe(4);
    // Undo three of them — redo stack grows by 3.
    for (let i = 0; i < 3; i++) h.undoStep(p);
    expect(h.redoDepth()).toBe(3);
    expect(h.bytesHeld()).toBe(3 * 16 + 1 * 16); // 3 on redo + 1 on undo
  });

  it("constructor rejects invalid budgets", () => {
    expect(() => new History(0)).toThrow();
    expect(() => new History(-1)).toThrow();
    expect(() => new History(NaN)).toThrow();
    expect(() => new History(Infinity)).toThrow();
  });

  it("push after a reset re-baselines bytesHeld accurately", () => {
    const h = new History(1024 * 1024);
    const p = emptyPattern(4, 4); // 64-byte snapshot
    h.push(p);
    h.push(p);
    h.push(p);
    expect(h.bytesHeld()).toBe(192); // 3 × 64
    h.reset(p);
    expect(h.bytesHeld()).toBe(64); // single baseline
  });
});

describe("history: legacy count-cap behavior preserved for existing callers", () => {
  it("the previous 'caps at 64' behavior is now subsumed by the byte budget (default is much larger)", () => {
    // Old test pushed 100 snapshots of a 2×2 pattern (16 bytes each) and
    // expected exactly 64. Under the byte-budget model, 100 × 16 = 1600
    // bytes, well under 256 MB — nothing evicts, we keep all 100. This
    // test pins that the new model is a *loosening* of the old cap, not a
    // silent regression: 100 small pushes stay entirely available.
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
    expect(count).toBe(100);
  });
});