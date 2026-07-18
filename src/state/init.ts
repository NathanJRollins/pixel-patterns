import { effect } from "@preact/signals";
import { store } from "./store.js";
import { loadAutosave, scheduleAutosave } from "./persistence.js";

/**
 * App boot order:
 *
 *   1. If `location.hash` carries a share payload, decode + apply; that
 *      takes precedence over autosave (sharing a URL should always win).
 *   2. Otherwise try to restore from localStorage autosave.
 *   3. Otherwise fall back to the baked-in defaults (which is what the
 *      store already initialised to).
 *
 * After the initial load we wire up an autosave effect that fires on every
 * `rev` bump (which is every pattern mutation), debounced 250 ms by
 * `scheduleAutosave`. Theme is also persisted via the same payload.
 *
 * We set `document.body.dataset['theme']` from the restored theme so the
 * very first paint uses the right colors.
 */

export function boot(): void {
  let didLoad = false;

  if (store.hasShareUrl()) {
    didLoad = store.loadFromShareUrl();
  }
  if (!didLoad) {
    const saved = loadAutosave();
    if (saved) store.restore(saved);
  }

  // Apply current theme to the body so the first paint is correct.
  document.body.dataset["theme"] = store.theme.value;

  // Autosave on every mutation delta (debounced).
  effect(() => {
    // Subscribe to rev + relevant signals so the effect runs on each change.
    const _rev = store.rev.value;
    const _mode = store.mirrorMode.value;
    const _tool = store.tool.value;
    const _hex = store.color.value;
    const _alpha = store.alpha01.value;
    const _recent = store.recentCells.value;
    const _previewScale = store.previewCellScale.value;
    const _bgScale = store.bgScale.value;
    const _showBg = store.showPageBg.value;
    const _showGrid = store.showGridLines.value;
    const _showAxis = store.showMirrorAxis.value;
    const _theme = store.theme.value;
    const _saveEnabled = store.saveEnabled.value;
    const _slots = store.slots.value;
    void [
      _rev, _mode, _tool, _hex, _alpha, _recent,
      _previewScale, _bgScale, _showBg, _showGrid, _showAxis,
      _theme, _saveEnabled, _slots,
    ];
    if (store.saveEnabled.value) {
      scheduleAutosave(() => store.snapshot());
    }
  });
}