/**
 * @vitest-environment happy-dom
 *
 * Savestate schema versioning + migration ladder (#4 in todo.txt).
 *
 * Today the migrations table is empty because v0 ⇄ v1 differ only by the
 * addition of the `version` field itself. These tests pin:
 *
 *   - `snapshot()` stamps the head version (`SAVE_STATE_VERSION` = 1).
 *   - `migrateSavestate` upgrades a v0 (field absent) snapshot to v1,
 *     preserving every other field untouched.
 *   - `migrateSavestate` is a no-op on already-current snapshots (v1).
 *   - A forward-version mismatch (snapshot stamped with v99 against the
 *     running build's SAVE_STATE_VERSION=1) does NOT throw; it warns
 *     and best-effort-restores — the operator's #4 directive: never wipe
 *     user data on a downgrade.
 *   - `store.restore()` accepts a v0 record (no `version` field) and
 *     applies it normally — i.e. existing users returning to the
 *     deployment post-update should NOT see their data wiped because
 *     their autosave was last written by an older build.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  store,
  SAVE_STATE_VERSION,
  migrateSavestate,
  type Savestate,
} from "../src/state/store.js";

beforeEach(() => {
  store.clearAllData();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function emptySnapshotV0(): Partial<Savestate> {
  // A snapshot as it would be written by a build that predated the
  // `version` field — no `version` property at all.
  return {
    pattern: "7x7:",
    mirrorMode: "HV",
    tool: "pencil",
    hex: "#cc33cc",
    secondaryHex: "#ffffff",
    alpha01: 1,
    secondaryAlpha01: 1,
    activeColorSlot: "primary",
    recentCells: [],
    previewCellScale: 3,
    bgScale: 1,
    showPageBg: true,
    showGridLines: true,
    showMirrorAxis: true,
    theme: "dark",
    saveEnabled: true,
    slots: [],
  };
}

describe("SAVE_STATE_VERSION", () => {
  it("is pinned at 1 at the head of the migration ladder", () => {
    expect(SAVE_STATE_VERSION).toBe(1);
  });
});

describe("snapshot stamping", () => {
  it("store.snapshot() stamps `version` at SAVE_STATE_VERSION", () => {
    const s = store.snapshot();
    expect(s.version).toBe(SAVE_STATE_VERSION);
  });

  it("snapshot carries the rest of the Savestate fields expected by restore()", () => {
    const s = store.snapshot();
    // Spot-check a few fields we know restore reads — exercising the whole
    // set here would just duplicate the Savestate interface; we just want
    // a smoke test that snapshot isn't empty.
    expect(typeof s.pattern).toBe("string");
    expect(s.mirrorMode).toBe("HV" as const);
    expect(Array.isArray(s.recentCells)).toBe(true);
    expect(Array.isArray(s.slots)).toBe(true);
    expect(typeof s.alpha01).toBe("number");
  });
});

describe("migrateSavestate", () => {
  it("upgrades a v0 (missing version) snapshot to the head version", () => {
    const v0 = emptySnapshotV0();
    expect(v0.version).toBeUndefined();
    const out = migrateSavestate(v0);
    expect(out.version).toBe(SAVE_STATE_VERSION);
  });

  it("does NOT mutate the input — returns a new object with bumped version", () => {
    const v0 = emptySnapshotV0();
    const out = migrateSavestate(v0);
    expect(out).not.toBe(v0);
    expect(v0.version).toBeUndefined();
    expect(out.version).toBe(SAVE_STATE_VERSION);
  });

  it("preserves every other field from the v0 input across the migration", () => {
    const v0 = emptySnapshotV0();
    const out = migrateSavestate(v0);
    // Strip the version key for shallow equality against the original
    // (migration ADDS the version field; everything else must be stale-
    // preserved).
    const { version: _v, ...payload } = out;
    void _v;
    expect(payload).toEqual(v0);
  });

  it("is a no-op on a snapshot already at the head version", () => {
    const v1 = { ...emptySnapshotV0(), version: SAVE_STATE_VERSION };
    const out = migrateSavestate(v1);
    expect(out.version).toBe(SAVE_STATE_VERSION);
    expect(out).toEqual(v1);
  });

  it("on a forward-version mismatch (v99 > SAVE_STATE_VERSION) it does NOT throw and best-effort preserves the record", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const v99 = { ...emptySnapshotV0(), version: 99 };
    const out = migrateSavestate(v99);
    expect(out.version).toBe(99);
    // The "best-effort" guarantee is the operator's #4 directive: never
    // wipe user data on a downgrade. Preserving every field on a v99 →
    // current v1 mismatch is exactly that — and a console.warn is the
    // surface signal something happened.
    expect(out.pattern).toBe(v99.pattern);
    expect(out.mirrorMode).toBe(v99.mirrorMode);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("store.restore handles pre-version field autosaves (real downgraded returning users)", () => {
  it("restore(s) with no version field applies everything else from the snapshot", () => {
    const v0 = emptySnapshotV0();
    expect(v0.version).toBeUndefined();
    store.restore(v0);
    // A few observable consequences: tool, mirrorMode, color, etc.
    expect(store.mirrorMode.value).toBe("HV");
    expect(store.tool.value).toBe("pencil");
    expect(store.previewCellScale.value).toBe(3);
    expect(store.showPageBg.value).toBe(true);
  });

  it("restore(s) with version: SAVE_STATE_VERSION applies just as cleanly", () => {
    const v1 = { ...emptySnapshotV0(), version: SAVE_STATE_VERSION };
    store.restore(v1);
    expect(store.mirrorMode.value).toBe("HV");
    expect(store.previewCellScale.value).toBe(3);
  });

  it("restore(s) with version: 99 (forward mismatch) still applies (best-effort, no wipe)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const v99 = { ...emptySnapshotV0(), version: 99 };
    store.restore(v99);
    expect(store.mirrorMode.value).toBe("HV");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});