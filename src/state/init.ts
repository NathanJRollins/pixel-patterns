import { effect } from "@preact/signals";
import { store } from "./store.js";
import { loadAutosave, scheduleAutosave } from "./persistence.js";

/**
 * App boot order:
 *
 *   1. If `location.hash` carries a share payload, decode + apply; that
 *      takes precedence over autosave (sharing a URL should always win).
 *   2. Otherwise try to restore from localStorage autosave.
 *   3. Otherwise fall back to the baked-in defaults. As part of that
 *      fallback, we honour the OS `prefers-color-scheme` so a brand-new
 *      user with a light-theme OS preference doesn't get a dark app.
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
    if (saved) {
      store.restore(saved);
    } else {
      // First-visit (or wiped localStorage) user → honour the OS theme
      // preference as the default instead of forcing dark.
      const prefers = prefersLightScheme() ? "light" : "dark";
      store.setTheme(prefers);
    }
  }

  // Apply current theme to the body so the first paint is correct.
  document.body.dataset["theme"] = store.theme.value;

  // Listen for hash changes: browsers do NOT reload the page when only the
  // URL hash changes (e.g. clicking a `#p=...` share link or pasting a share
  // URL into the address bar of an already-open tab). Without this listener
  // the share URL would silently fail to apply until the user did a manual
  // hard refresh, which is exactly the symptom the operator reported.
  // We re-apply the share payload on every hashchange that *carries* one.
  // Pasting a non-share hash (or erasing the hash) is a no-op.
  window.addEventListener("hashchange", onHashChange);

  // Suppress middle-click auto-scroll. The browser's middle-mouse "round
  // cursor with scroll arrows" mode is a navigation aid for long pages —
  // on a single-viewport paint app it's only ever triggered by accident
  // and feels broken. We absorb the middle-click on `mousedown` (and the
  // `auxclick` that follows in some browsers) so it stays inert.
  // Wheel scrolling and keyboard scrolling are unaffected.
  window.addEventListener("mousedown", suppressMiddleClick, { passive: false });
  window.addEventListener("auxclick", suppressMiddleClick, { passive: false });

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

function prefersLightScheme(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches;
  } catch {
    return false;
  }
}

/**
 * Hashchange handler: when the URL's hash changes and now carries a share
 * payload (`#p=...`), re-apply it. The store's {@link Store.loadFromShareUrl}
 * doesn't write to `location.hash`, so there's no risk of an infinite
 * re-apply loop. If the hash is cleared or becomes a non-share value, we
 * silently do nothing — the user's current pattern is preserved.
 */
function onHashChange(): void {
  if (!store.hasShareUrl()) return;
  store.loadFromShareUrl();
}

/**
 * Middle-click (button 1) suppression. Browsers' default middle-click
 * behaviour on a page is the auto-scroll "round cursor with arrows" mode,
 * which is only ever triggered accidentally on a paint app and feels
 * broken. `preventDefault` on `mousedown` reliably suppresses it across
 * Chromium / Firefox / Safari. The `auxclick` listener catches browsers
 * that fire the click event separately from the mousedown.
 */
function suppressMiddleClick(e: MouseEvent): void {
  if (e.button === 1) {
    e.preventDefault();
    e.stopPropagation();
  }
}