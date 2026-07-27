/** Keyboard shortcut handler. Attached once on app mount. */

import type { Signal } from "@preact/signals";
import { store } from "../state/store.js";
import { saveToast } from "./toast.js";
import { MIRROR_LABELS } from "../domain/mirror.js";
import type { MirrorMode } from "../domain/types.js";

const MIRROR_CYCLE: MirrorMode[] = ["none", "H", "V", "HV"];

export function attachKeyboard(
  showShare: Signal<boolean>,
  showExport: Signal<boolean>,
  showSettings: Signal<boolean>,
  showCheatsheet: Signal<boolean>,
): () => void {
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
      return; // let inputs handle typing
    }
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (meta && e.key.toLowerCase() === "y") {
      e.preventDefault();
      store.redo();
      return;
    }
    if (meta && e.key.toLowerCase() === "s") {
      e.preventDefault();
      const name = `slot-${store.slots.value.length + 1}`;
      store.saveSlot(name);
      saveToast(`Saved to "${name}"`);
      return;
    }
    if (meta) return; // let other Cmd/Ctrl shortcuts pass to the browser

    if (e.key === "Escape") {
      showShare.value = false;
      showExport.value = false;
      showSettings.value = false;
      showCheatsheet.value = false;
      return;
    }
    // `?` (Shift+/) opens cheatsheet. Match either shifted key — some Linux
    // layouts produce the literal "?" at e.key without shift; handle both.
    if (e.key === "?" || (e.shiftKey && e.key === "/")) {
      e.preventDefault();
      showCheatsheet.value = !showCheatsheet.value;
      return;
    }
    switch (e.key.toLowerCase()) {
      case "b":
        store.setTool("pencil");
        break;
      case "e":
        store.setTool("eraser");
        break;
      case "g":
        store.setTool("bucket");
        break;
      case "l":
        store.setTool("line");
        break;
      case "i":
        store.setTool("dropper");
        break;
      case "m":
        cycleMirror();
        break;
      case "x":
        store.swapColors();
        break;
      case "c":
        // Open the native color picker. Plain `C` opens for the active
        // slot; Shift+C opens for the secondary slot (temporarily
        // switching the active slot so the picker binds to the right
        // colour via the dock's existing plumbing — the dock restores
        // the previous active slot after the picker closes).
        if (e.shiftKey) store.requestOpenColorPicker("secondary");
        else store.requestOpenColorPicker();
        break;
      case "r":
        store.randomize();
        break;
      case "backspace":
      case "delete":
        store.clearPattern();
        saveToast("Cleared");
        break;
      case "f":
        store.fillPattern();
        break;
      case "[":
        store.setPreviewCellScale(store.previewCellScale.value - 1);
        break;
      case "]":
        store.setPreviewCellScale(store.previewCellScale.value + 1);
        break;
      case ",":
        store.setBgScale(store.bgScale.value - 1);
        break;
      case ".":
        store.setBgScale(store.bgScale.value + 1);
        break;
      default:
        return; // ignore unmapped keys
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

function cycleMirror(): void {
  const cur = store.mirrorMode.value;
  const i = MIRROR_CYCLE.indexOf(cur);
  const next = MIRROR_CYCLE[(i + 1) % MIRROR_CYCLE.length];
  store.setMirrorMode(next);
  saveToast(`Mirror: ${MIRROR_LABELS[next]}`);
}