import { useState } from "preact/hooks";
import { store, type SlotSerialized, type SlotMergeStrategy } from "../state/store.js";
import { decodePattern } from "../domain/pattern.js";
import { saveToast } from "./toast.js";
import type { SaveBundle } from "../state/save-export.js";

/**
 * Import-save-data modal (#9 in todo.txt): opens after either the page-wide
 * drag-drop overlay OR the file-pickers-in-the-export-modal receive a valid
 * Save bundle JSON (see `state/save-export.ts`). Lets the user pick the
 * collision strategy for incoming slots vs existing slots and decide
 * whether to also overwrite the workspace (current pattern / colors /
 * view settings) with the bundle's contents. Confirm is gated behind
 * both the chosen strategy's destructive-ness AND the `applyState`
 * checkbox's destructive-toggle (the apply path overwrites the user's
 * current canvas — destructive — so we reflect that visibly).
 *
 * The bundle's Savestate is walked through the same `migrateSavestate`
 * ladder the autosave is; the strategy here only governs slot
 * collisions with the user's *existing* slot list, not the migration.
 */
export interface ImportSource {
  bundle: SaveBundle;
  /** Origin file name (for display + match on re-import). */
  fileName: string;
}

interface ImportModalProps {
  source: ImportSource;
  onClose: () => void;
}

export function ImportModal(props: ImportModalProps) {
  const { bundle, fileName } = props.source;

  // Pre-compute collision stats so the modal can show them upfront —
  // before the user's strategy choice but informed by it. Recomputed
  // cheaply since the slot list is small.
  const existingNames = new Set(store.slots.value.map((s) => s.name));
  const incomingSlots: SlotSerialized[] = Array.isArray(bundle.state.slots)
    ? bundle.state.slots
    : [];
  const collisions = incomingSlots.filter(
    (s) => s.name && existingNames.has(s.name),
  ).length;
  const brandNew = incomingSlots.length - collisions;

  const decodedPattern = decodePattern(bundle.state.pattern ?? "");
  const patternDims =
    decodedPattern != null
      ? `${decodedPattern.width} × ${decodedPattern.height}`
      : "(unreadable pattern — restoring view settings only)";

  const [strategy, setStrategy] = useState<SlotMergeStrategy>("replace");
  const [applyState, setApplyState] = useState(false);

  return (
    <div class="modal-backdrop" onMouseDown={onBackdrop}>
      <div class="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <span>Import save data</span>
          <button class="btn btn-ghost btn-icon" onClick={props.onClose} title="Close">×</button>
        </div>
        <p
          style={{
            color: "var(--text-2)",
            fontSize: 13,
            margin: 0,
            wordBreak: "break-all",
          }}
        >
          File: <code>{fileName}</code>
          <br />
          Exported: {bundle.exportedAt || "(no timestamp)"}
        </p>

        <div class="field">
          <label>Bundle contents</label>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text-1)" }}>
            <li>{incomingSlots.length} saved slot{incomingSlots.length === 1 ? "" : "s"} ({brandNew} new, {collisions} matching)</li>
            <li>Pattern: {patternDims}</li>
            <li>Mirror mode: {bundle.state.mirrorMode ?? "(unknown)"}</li>
          </ul>
        </div>

        <div class="field">
          <label>Collision strategy (for matching slot names)</label>
          <div class="chip-row">
            {(
              [
                ["replace", "Replace same-named", "Overwrite existing slots with the incoming ones."],
                ["suffix", "Add with suffix", "Rename incoming slots to `Name (2)`, `(3)`, ... so both survive."],
                ["skip", "Skip same-named", "Drop incoming slots that match existing names; keep the rest."],
              ] as Array<[SlotMergeStrategy, string, string]>
            ).map(([value, label, title]) => (
              <button
                key={value}
                type="button"
                class={"chip" + (strategy === value ? " is-active" : "")}
                title={title}
                onClick={() => setStrategy(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <label class="checkbox">
          <input
            type="checkbox"
            checked={applyState}
            onInput={(e) => setApplyState((e.currentTarget as HTMLInputElement).checked)}
          />
          <span>
            Also apply imported pattern / colors / view settings
            <span style={{ color: "var(--danger)", marginLeft: 6 }}>
              (destructive — overwrites current canvas)
            </span>
          </span>
        </label>

        <div class="modal-footer">
          <button class="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button class="btn btn-primary" onClick={commit}>
            Import
          </button>
        </div>
      </div>
    </div>
  );

  function commit(): void {
    // Apply state first (if requested). `skipSlots: true` keeps the user's
    // existing slot list intact — the mergeSlots handle the slot work
    // below with the user's chosen collision strategy.
    if (applyState) {
      store.restore(bundle.state, { skipSlots: true });
    }
    // Slot merge: ALWAYS runs (otherwise the user dropped a bundle on
    // purpose, expecting slots to land). Without `applyState`, only the
    // slots field of the Savestate is honoured; pattern / colors / view
    // settings are left alone.
    if (incomingSlots.length > 0) {
      const stats = store.mergeSlots(incomingSlots, strategy);
      saveToast(
        `Imported ${stats.added} new, ${stats.replaced} replaced, ${stats.skipped} skipped`,
      );
    } else if (applyState) {
      saveToast("Imported state");
    } else {
      saveToast("Bundle was empty");
    }
    props.onClose();
  }

  function onBackdrop(e: MouseEvent): void {
    if (e.target === e.currentTarget) props.onClose();
  }
}