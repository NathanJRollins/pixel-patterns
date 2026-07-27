import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { effect } from "@preact/signals";
import { store } from "../state/store.js";
import {
  mountPageBackground,
  unmountPageBackground,
  updatePageBackground,
  clearPageBackground,
} from "../render/page-bg.js";
import { updateFavicon } from "../render/favicon.js";
import { invalidateSuperTileCache } from "../render/super-tile-canvas.js";
import { attachKeyboard } from "./keyboard.js";
import { ToastHost, saveToast } from "./toast.js";
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
import { CheatsheetModal } from "./CheatsheetModal.js";
import { ImportModal, type ImportSource } from "./ImportModal.js";
import { parseSaveBundle } from "../state/save-export.js";

/**
 * Top-level app shell. Wires UI panels to the central {@link store} and
 * attaches headless effects (page background + favicon + theme) + global
 * keyboard shortcuts.
 */
export function App() {
  const showShare = useSignal(false);
  const showExport = useSignal(false);
  const showSettings = useSignal(false);
  const showCheatsheet = useSignal(false);
  const showHint = useSignal(!store.hasShareUrl());
  // Import-modal state. `null` ⇒ modal hidden; an `ImportSource` value ⇒
  // the modal is open with that source already loaded (file + bundle).
  const importSource = useSignal<ImportSource | null>(null);
  // Page-wide file-drag overlay visibility. Hidden when there's no drag
  // OR when the user's pointer leaves the page mid-drag.
  const dragOverlay = useSignal(false);
  const dragCounterRef = useRef(0);
  // Page-bg target canvas — see `page-bg.ts` mount/unmount lifecycle.
  // The canvas is rendered as the first child of the App container so
  // it stays behind every other UI affordance via z-index: -1.
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);

  // Mount the page-bg-target canvas once on app mount; tear down on
  // component unmount. We rely on this single canvas for the whole
  // session — the observer auto-re-tracks if the canvas DOM element
  // ever moves.
  useEffect(() => {
    if (bgCanvasRef.current) {
      mountPageBackground(bgCanvasRef.current);
    }
    return () => unmountPageBackground();
  }, []);

  useEffect(() => {
    // Page background: tiles the super-tile across `<body>`. Live update on
    // every rev / mode / bg-scale change. The render layer's own rAF
    // coalescing handles paint-frequency throttling.
    const disposeBg = effect(() => {
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

    // Favicon: rAF-coalesced inside `updateFavicon` itself; just call it on
    // every relevant signal change.
    const disposeFav = effect(() => {
      const _rev = store.rev.value;
      const _mode = store.mirrorMode.value;
      void [_rev, _mode];
      updateFavicon(store.pattern.value, store.mirrorMode.value);
    });

    // Theme: set body attribute; invalidate cached canvases so colour
    // blending recomputes against the new checkerboard.
    const disposeTheme = effect(() => {
      const _t = store.theme.value;
      void _t;
      document.body.dataset["theme"] = store.theme.value;
      invalidateSuperTileCache();
    });

    // Keyboard shortcuts.
    const detach = attachKeyboard(showShare, showExport, showSettings, showCheatsheet);

    // Page-wide drop-target for SaveBundle JSON files (#9 in todo.txt):
    // drag a .json (or any .pixpat.json) onto the window and we open the
    // Import modal pre-loaded with the file's parsed bundle. The user
    // confirms in the modal before anything mutates the store.
    const fileReaders = new Map<File, ReturnType<typeof setTimeout>>();
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounterRef.current++;
      dragOverlay.value = true;
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) dragOverlay.value = false;
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      dragOverlay.value = false;
      const files = droppedFiles(e);
      if (!files.length) return;
      void pickDropFile(files[0]).finally(() => {
        // Revoke any worst-case held readers; not strictly needed since
        // `pickDropFile` resolves itself but a safety brush keeps the
        // map empty in case `readAsText` rejected mid-flight.
        for (const [f, t] of fileReaders) {
          fileReaders.delete(f);
          clearTimeout(t);
        }
      });
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);

    return () => {
      detach();
      disposeBg();
      disposeFav();
      disposeTheme();
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  // Dismiss hint rail on first paint interaction.
  // First rev bump after mount hides the hint and unsubscribes itself. Uses
  // a `done` flag rather than self-dispose so subscribe's synchronous first
  // call can't hit a TDZ on `unsub`.
  useEffect(() => {
    let done = false;
    let unsub: (() => void) | null = null;
    unsub = store.rev.subscribe(() => {
      if (done) return;
      done = true;
      if (showHint.value) showHint.value = false;
      if (unsub) {
        const fn = unsub;
        unsub = null;
        fn();
      }
    });
    return () => {
      done = true;
      unsub?.();
    };
  }, []);

  return (
    <div class="app">
      <canvas
        ref={bgCanvasRef}
        class="page-bg-canvas"
        aria-hidden="true"
      />
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
          <button
            class="btn btn-icon"
            onClick={() => (showCheatsheet.value = true)}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts  (?)"
          >
            ?
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
      {showExport.value && (
        <ExportModal
          onClose={() => (showExport.value = false)}
          onOpenImport={(source) => {
            showExport.value = false;
            importSource.value = source;
          }}
        />
      )}
      {showSettings.value && (
        <SettingsDrawer onClose={() => (showSettings.value = false)} />
      )}
      {showCheatsheet.value && (
        <CheatsheetModal onClose={() => (showCheatsheet.value = false)} />
      )}
      {importSource.value && (
        <ImportModal
          source={importSource.value}
          onClose={() => (importSource.value = null)}
        />
      )}
      {dragOverlay.value && (
        <div class="dropzone-overlay" aria-hidden="true">
          <div class="dropzone-bracket">
            <span>Drop .json to import</span>
          </div>
        </div>
      )}
      <ToastHost />
    </div>
  );

  /** Helper: does a drag event carry real files (not just text)? */
  function hasFiles(e: DragEvent): boolean {
    return !!e.dataTransfer && Array.from(e.dataTransfer.types ?? []).includes("Files");
  }

  /** Pull real files out of the drag's `files` or `items` list. */
  function droppedFiles(e: DragEvent): File[] {
    if (!e.dataTransfer) return [];
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) return files;
    // Some browsers only populate `items` when dropping comes from
    // outside the page. Walk them too.
    const out: File[] = [];
    const items = e.dataTransfer.items ?? [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) out.push(f);
      }
    }
    return out;
  }

  /** Read the first dropped file as text, parse, and open the Import modal. */
  async function pickDropFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const result = parseSaveBundle(text);
      if (!result.ok) {
        saveToast(`Import failed: ${result.error}`);
        return;
      }
      importSource.value = { bundle: result.bundle, fileName: file.name };
    } catch (e) {
      saveToast(`Import failed: ${(e as Error).message}`);
    }
  }
}