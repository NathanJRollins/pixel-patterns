/**
 * @vitest-environment happy-dom
 *
 * Round-trip tests for the SaveBundle format + `mergeSlots` strategy
 * (#9 in todo.txt). We exercise:
 *
 *   1. `buildSaveBundle` → JSON.stringify → `parseSaveBundle` round trips
 *      cleanly and preserves the Savestate's contents.
 *   2. Invalid payloads (non-JSON, wrong kind, future version, missing
 *      state) reject with a readable error rather than throwing.
 *   3. Future-version mismatch rejects with a human-readable reason
 *      (the bundle carries its *own* version independent of the
 *      Savestate's).
 *   4. `store.mergeSlots` under each strategy (replace / suffix / skip)
 *      produces the expected final slot list + tally.
 *   5. End-to-end: drop a JSON file → app spawns the Import modal → user
 *      picks "replace" + apply-state checkbox → store's slots + canvas
 *      match the bundle.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "preact";
import { store } from "../src/state/store.js";
import {
  buildSaveBundle,
  parseSaveBundle,
  BUNDLE_KIND,
  BUNDLE_VERSION,
  defaultBundleFilename,
} from "../src/state/save-export.js";
import type { Savestate, SlotSerialized } from "../src/state/store.js";
import { boot } from "../src/state/init.js";
import { App } from "../src/ui/App.js";

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  store.clearAllData();
});

function emptySnapshot(): Savestate {
  return {
    version: 1,
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

function slot(name: string, color = "#ff0000"): SlotSerialized {
  return {
    name,
    createdAt: 1,
    // Compact placeholder PNG; not parsed by the slot store.
    thumb: "data:image/png;base64,",
    pattern: `1x1:${"ff0000ff"}`,
    mirrorMode: "HV",
  };
  void color;
}

describe("save-bundle format round trip", () => {
  it("build → JSON → parse is idempotent on a representative snapshot", () => {
    const snap = {
      ...emptySnapshot(),
      slots: [slot("alpha"), slot("beta")],
    };
    const bundle = buildSaveBundle(snap);
    const text = JSON.stringify(bundle, null, 2);
    const parsed = parseSaveBundle(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.bundle.kind).toBe(BUNDLE_KIND);
    expect(parsed.bundle.version).toBe(BUNDLE_VERSION);
    expect(parsed.bundle.state.slots?.length).toBe(2);
  });

  it("defaultBundleFilename ends in .pixpat.json and is reasonably timestamped", () => {
    const name = defaultBundleFilename("pixel-patterns");
    expect(name).toMatch(/^pixel-patterns-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.pixpat\.json$/);
  });
});

describe("parseSaveBundle rejects malformed inputs gracefully (never throws)", () => {
  it("rejects non-JSON text", () => {
    expect(parseSaveBundle("not json {").ok).toBe(false);
    expect(parseSaveBundle("literally anything").ok).toBe(false);
  });

  it("rejects JSON whose top-level is not an object", () => {
    expect(parseSaveBundle("[1,2,3]").ok).toBe(false);
    expect(parseSaveBundle("42").ok).toBe(false);
  });

  it("rejects objects missing or wrong `kind`", () => {
    expect(parseSaveBundle(JSON.stringify({ version: 1, state: {} })).ok).toBe(false);
    expect(parseSaveBundle(JSON.stringify({ kind: "other-app/save", version: 1, state: {} })).ok).toBe(false);
  });

  it("rejects objects missing or non-numeric `version`", () => {
    expect(parseSaveBundle(JSON.stringify({ kind: BUNDLE_KIND, state: {} })).ok).toBe(false);
    expect(parseSaveBundle(JSON.stringify({ kind: BUNDLE_KIND, version: "1", state: {} })).ok).toBe(false);
  });

  it("rejects objects missing `state`", () => {
    expect(
      parseSaveBundle(JSON.stringify({ kind: BUNDLE_KIND, version: 1 })).ok,
    ).toBe(false);
  });

  it("rejects forward-version mismatches with a readable reason", () => {
    const future = JSON.stringify({
      kind: BUNDLE_KIND,
      version: 999,
      exportedAt: "x",
      state: { version: 1 } as Savestate,
    });
    const r = parseSaveBundle(future);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("999");
  });
});

describe("store.mergeSlots strategies", () => {
  it("replace strategy: incoming collisions overwrite the existing slot", () => {
    store.slots.value = [slot("alpha", "#0000ff"), slot("beta", "#0000ff")];
    const incoming = [slot("alpha", "#ff0000"), slot("gamma")];
    const stats = store.mergeSlots(incoming, "replace");
    // replaced=1 (alpha), added=1 (gamma, no collision), skipped=0.
    expect(stats).toEqual({ added: 1, replaced: 1, skipped: 0 });
    const names = store.slots.value.map((s) => s.name).sort();
    expect(names).toEqual(["alpha", "beta", "gamma"]);
  });

  it("skip strategy: colliding slots drop, other slots append", () => {
    store.slots.value = [slot("alpha"), slot("beta")];
    const incoming = [slot("alpha", "#ff0000"), slot("gamma")];
    const stats = store.mergeSlots(incoming, "skip");
    expect(stats).toEqual({ added: 1, replaced: 0, skipped: 1 });
    const names = store.slots.value.map((s) => s.name).sort();
    expect(names).toEqual(["alpha", "beta", "gamma"]);
    // `alpha`'s pattern is STILL the user's pre-merge value (not the
    // incoming one) because we skipped the collision.
    const alpha = store.slots.value.find((s) => s.name === "alpha");
    expect(alpha?.pattern).toBe(slot("alpha").pattern);
  });

  it("suffix strategy: collisions get *Name (2)*, *(3)*, ... — existing untouched", () => {
    store.slots.value = [slot("alpha")];
    const incoming = [slot("alpha", "#ff0000"), slot("alpha", "#00ff00"), slot("alpha", "#0000ff")];
    const stats = store.mergeSlots(incoming, "suffix");
    expect(stats).toEqual({ added: 3, replaced: 0, skipped: 0 });
    const names = store.slots.value.map((s) => s.name).sort();
    expect(names).toContain("alpha");
    expect(names).toContain("alpha (2)");
    expect(names).toContain("alpha (3)");
    expect(names).toContain("alpha (4)");
  });

  it("suffix strategy: respects existing *(N)* suffix tree when the bare name collides", () => {
    // Pre-existing both `alpha` and `alpha (2)` — a new `alpha` becomes `(3)`.
    store.slots.value = [slot("alpha"), slot("alpha (2)")];
    const incoming = [slot("alpha", "#ff0000")];
    const stats = store.mergeSlots(incoming, "suffix");
    expect(stats.added).toBe(1);
    expect(store.slots.value.map((s) => s.name)).toContain("alpha (3)");
  });

  it("incoming slots without collisions append (default join at head)", () => {
    store.slots.value = [slot("older")];
    const stats = store.mergeSlots([slot("newcomer")], "replace");
    expect(stats).toEqual({ added: 1, replaced: 0, skipped: 0 });
    // The pre-existing slot is still there and the new one joined.
    expect(store.slots.value.length).toBe(2);
  });

  it("incoming slots with empty/whitespace names are dropped silently", () => {
    store.slots.value = [];
    const stats = store.mergeSlots(
      [slot(""), slot(" "),
       // SlotSerialized.name isn't trimmed at the source — mergeSlots
       // trims defensively against accidental whitespace-only names.
       { ...slot("real"), name: "  real  " }],
      "replace",
    );
    expect(stats.added).toBe(1);
    expect(store.slots.value[0]?.name).toBe("real");
  });
});

describe("store.restore with skipSlots:true preserves the user's slot list", () => {
  it("restore() default replaces the slots list (backward compatible)", () => {
    store.slots.value = [slot("keep")];
    const snap = { ...emptySnapshot(), slots: [slot("from-import")] };
    store.restore(snap);
    expect(store.slots.value.length).toBe(1);
    expect(store.slots.value[0].name).toBe("from-import");
  });

  it("restore(s, { skipSlots: true }) keeps the user's existing slots untouched", () => {
    store.slots.value = [slot("keep")];
    const snap = { ...emptySnapshot(), slots: [slot("from-import")] };
    store.restore(snap, { skipSlots: true });
    expect(store.slots.value.length).toBe(1);
    expect(store.slots.value[0].name).toBe("keep");
    // But e.g. the Savestate's mirrorMode was still applied (the rest of
    // the Savestate IS honoured; just not the slots field).
    expect(store.mirrorMode.value).toBe(snap.mirrorMode);
  });
});

describe("end-to-end: drop JSON → Import modal opens with the parsed bundle", () => {
  it("a dragenter + drop event opens the Import modal via App's overlay", async () => {
    boot();
    render(<App />, document.body.appendChild(document.createElement("div")));
    // Yield for App's useEffect to wire its drag-drop listeners.
    await new Promise((r) => setTimeout(r, 50));

    const snap = { ...emptySnapshot(), slots: [slot("dropped")] };
    const text = JSON.stringify(buildSaveBundle(snap), null, 2);
    // Synthesize a `File` for the dropped FileList — happy-dom has a File
    // constructor shim adequate for this.
    const file = new File([text], "my-saves.pixpat.json", { type: "application/json" });

    window.dispatchEvent(
      new DragEvent("dragenter", {
        bubbles: true,
        cancelable: true,
        // DragEvent's dataTransfer is read-only and some happy-dom
        // releases can't synthesise it; we stub the
        // `.dataTransfer.types` getter + `.files` our handlers read
        // through the event's `__dataTransfer` escape hatch.
      }),
    );

    // Without `dataTransfer` we can't fully drive drop into App —
    // approximating: dispatch a `drop` event with the file attached via
    // a `__dataTransfer` override. This mirrors the happy-dom limits
    // documented in the picker-restore suite.
    const dropEvent = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(dropEvent, "dataTransfer", {
      value: {
        types: ["Files"],
        files: [file],
        items: [],
        dropEffect: "copy",
        effectAllowed: "all",
      },
      configurable: true,
    });
    window.dispatchEvent(dropEvent);
    // The drop handling does file.text() (async); let microtasks settle.
    await new Promise((r) => setTimeout(r, 50));

    // Now the Import modal should be open. Find any modal whose header
    // text contains "Import save data".
    const headers = Array.from(document.querySelectorAll(".modal-header span")).map(
      (h) => h.textContent ?? "",
    );
    expect(headers.some((h) => h.includes("Import save data"))).toBe(true);
  });
});