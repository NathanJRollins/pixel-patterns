import { useEffect, useState } from "preact/hooks";
import { store } from "../state/store.js";
import { clearAutosave } from "../state/persistence.js";
import { saveToast } from "./toast.js";
import type { Theme } from "../domain/types.js";

interface SettingsDrawerProps {
  onClose: () => void;
}

/**
 * Settings drawer: theme, autosave toggle, viewport toggles mirrored here
 * too (single source of truth is {@link store}), and a "clear all data"
 * button with the same two-tap confirm the toolbar uses.
 *
 * The drawer slides in from the right; a backdrop click closes.
 */
export function SettingsDrawer(props: SettingsDrawerProps) {
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    // Auto-clear confirm state if anything in the store mutates from under us.
    const unsub = store.rev.subscribe(() => setConfirmClear(false));
    return () => unsub();
  }, []);

  return (
    <>
      <div class="modal-backdrop" onMouseDown={props.onClose} />
      <aside class="drawer">
        <div class="drawer-header">
          <span>Settings</span>
          <button class="btn btn-ghost btn-icon" onClick={props.onClose} title="Close">×</button>
        </div>

        <div class="field">
          <label>Theme</label>
          <div class="toolbar">
            <button
              class="btn"
              aria-pressed={store.theme.value === "dark"}
              onClick={() => store.setTheme("dark" as Theme)}
            >
              Dark
            </button>
            <button
              class="btn"
              aria-pressed={store.theme.value === "light"}
              onClick={() => store.setTheme("light" as Theme)}
            >
              Light
            </button>
          </div>
        </div>

        <div class="field">
          <label>Autosave</label>
          <label class="checkbox">
            <input
              type="checkbox"
              checked={store.saveEnabled.value}
              onInput={(e) => {
                const on = (e.currentTarget as HTMLInputElement).checked;
                store.setSaveEnabled(on);
                saveToast(on ? "Autosave on" : "Autosave off");
                if (!on) clearAutosave();
              }}
            />
            <span>Save state locally (localStorage)</span>
          </label>
        </div>

        <div class="field">
          <label>Viewport</label>
          <label class="checkbox">
            <input
              type="checkbox"
              checked={store.showPageBg.value}
              onInput={(e) => store.setShowPageBg((e.currentTarget as HTMLInputElement).checked)}
            />
            <span>Tile pattern across the page background</span>
          </label>
          <label class="checkbox">
            <input
              type="checkbox"
              checked={store.showGridLines.value}
              onInput={(e) => store.setShowGridLines((e.currentTarget as HTMLInputElement).checked)}
            />
            <span>Show draw-grid lines</span>
          </label>
          <label class="checkbox">
            <input
              type="checkbox"
              checked={store.showMirrorAxis.value}
              onInput={(e) => store.setShowMirrorAxis((e.currentTarget as HTMLInputElement).checked)}
            />
            <span>Show mirror-axis overlay</span>
          </label>
        </div>

        <div class="field">
          <label>Data</label>
          <button
            class={confirmClear ? "btn btn-danger" : "btn"}
            data-confirming={confirmClear ? "true" : "false"}
            onClick={() => {
              if (confirmClear) {
                store.clearAllData();
                clearAutosave();
                saveToast("All local data cleared");
                setConfirmClear(false);
                props.onClose();
              } else {
                setConfirmClear(true);
              }
            }}
          >
            {confirmClear ? "Confirm — wipe everything" : "Clear all local data"}
          </button>
          <div class="list-empty">
            Removes the autosave entry, all slots, and the current pattern.
            Cannot be undone.
          </div>
        </div>

        <section style={{ marginTop: "auto", color: "var(--text-3)", fontSize: 12, lineHeight: 1.5 }}>
          <strong>pixel-patterns</strong> · TypeScript + Vite + Preact. Paint a
          small grid with a mirror mode and your design tiles seamlessly across
          the whole page. See <code>SPEC.md</code> for the design.
        </section>
      </aside>
    </>
  );
}