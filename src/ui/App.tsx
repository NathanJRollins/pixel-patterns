import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { effect } from "@preact/signals";
import { store } from "../state/store.js";
import { updatePageBackground, clearPageBackground } from "../render/page-bg.js";
import { updateFavicon } from "../render/favicon.js";
import { invalidateSuperTileCache } from "../render/super-tile-canvas.js";
import { attachKeyboard } from "./keyboard.js";
import { ToastHost } from "./toast.js";
import { Toolbar } from "./Toolbar.js";
import { DrawPanel } from "./DrawPanel.js";
import { PreviewPanel } from "./PreviewPanel.js";
import { ColorDock } from "./ColorDock.js";
import { DimensionsDock } from "./DimensionsDock.js";
import { PresetsBar } from "./PresetsBar.js";
import { SaveSlots } from "./SaveSlots.js";
import { ShareModal } from "./ShareModal.js";
import { ExportModal } from "./ExportModal.js";
import { SettingsDrawer } from "./SettingsDrawer.js";

/**
 * Top-level app shell. Wires UI panels to the central {@link store} and
 * attaches headless effects (page background + favicon + theme) + global
 * keyboard shortcuts.
 */
export function App() {
  const showShare = useSignal(false);
  const showExport = useSignal(false);
  const showSettings = useSignal(false);
  const showHint = useSignal(!store.hasShareUrl());

  useEffect(() => {
    // Page background: tiles the super-tile across `<body>`. Live update on
    // every rev / mode / bg-scale change.
    effect(() => {
      const _rev = store.rev.value;
      const _mode = store.mirrorMode.value;
      const _showBg = store.showPageBg.value;
      const _bgScale = store.bgScale.value;
      void [_rev, _mode, _showBg, _bgScale];
      if (store.showPageBg.value) {
        updatePageBackground(
          store.pattern.value,
          store.mirrorMode.value,
          store.bgScale.value,
        );
      } else {
        clearPageBackground();
      }
    });

    // Favicon: deferred with rAF so we don't pay the toDataURL cost on every
    // single pointermove — only at the next animation frame after a rev bump.
    let rafId = 0;
    effect(() => {
      const _rev = store.rev.value;
      const _mode = store.mirrorMode.value;
      void [_rev, _mode];
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        updateFavicon(store.pattern.value, store.mirrorMode.value);
      });
    });

    // Theme: set body attribute; invalidate cached canvases so colour
    // blending recomputes against the new checkerboard.
    effect(() => {
      document.body.dataset["theme"] = store.theme.value;
      invalidateSuperTileCache();
    });

    // Keyboard shortcuts.
    const detach = attachKeyboard(showShare, showExport, showSettings);

    // Resize handler: nothing yet — canvas DPR handling re-reads on demand.
    return () => {
      detach();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  // Dismiss hint rail on first paint interaction.
  useEffect(() => {
    const unsub = store.rev.subscribe(() => {
      if (showHint.value) showHint.value = false;
      unsub();
    });
    return () => unsub();
  }, []);

  return (
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <span class="logo">▦</span>
          <span class="title">pixel-patterns</span>
        </div>
        <Toolbar />
        <div class="topbar-actions">
          <button class="btn" onClick={() => (showShare.value = true)}>
            Share
          </button>
          <button class="btn" onClick={() => (showExport.value = true)}>
            Export
          </button>
          <button
            class="btn btn-icon"
            onClick={() => (showSettings.value = true)}
            aria-label="Settings"
            title="Settings"
          >
            ⚙
          </button>
          <a
            class="btn btn-icon"
            href="https://github.com/NathanJRollins/pixel-patterns"
            aria-label="View source on GitHub"
            title="Source"
            target="_blank"
            rel="noreferrer"
          >
            ↗
          </a>
        </div>
      </header>
      <main class="main">
        {showHint.value && (
          <div class="hint-rail">
            <span>
              Paint a small pattern — it tiles seamlessly by default.
              Try the mirror modes (press <kbd>M</kbd>) or the presets below.
            </span>
            <button class="btn btn-ghost" onClick={() => (showHint.value = false)}>
              dismiss
            </button>
          </div>
        )}
        <div class="canvas-split">
          <DrawPanel />
          <PreviewPanel />
        </div>
        <div class="dock-row">
          <DimensionsDock />
          <ColorDock />
        </div>
        <div class="shelf">
          <PresetsBar />
          <SaveSlots />
        </div>
      </main>
      {showShare.value && <ShareModal onClose={() => (showShare.value = false)} />}
      {showExport.value && <ExportModal onClose={() => (showExport.value = false)} />}
      {showSettings.value && (
        <SettingsDrawer onClose={() => (showSettings.value = false)} />
      )}
      <ToastHost />
    </div>
  );
}