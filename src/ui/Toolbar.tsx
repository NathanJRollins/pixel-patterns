import { useEffect } from "preact/hooks";
import { useSignal, effect } from "@preact/signals";
import { store } from "../state/store.js";
import { MIRROR_LABELS } from "../domain/mirror.js";
import { saveToast } from "./toast.js";
import type { MirrorMode, Tool } from "../domain/types.js";

interface ToolDef {
  id: Tool;
  label: string;
  glyph: string;
  key: string;
}

const TOOLS: ToolDef[] = [
  { id: "pencil", label: "Pencil", glyph: "✎", key: "B" },
  { id: "eraser", label: "Eraser", glyph: "⌫", key: "E" },
  { id: "bucket", label: "Bucket", glyph: "▣", key: "G" },
  { id: "line", label: "Line", glyph: "╱", key: "L" },
  { id: "dropper", label: "Dropper", glyph: "✲", key: "I" },
];

const MIRROR_MODES: MirrorMode[] = ["none", "H", "V", "HV"];

/**
 * Horizontal toolbar: tools, mirror-mode segmented control, undo/redo,
 * clear (with in-place confirm), fill, randomize.
 *
 * History's `canUndo/canRedo` aren't signal-backed, but every rev bump
 * re-renders this component (we read `store.rev.value`), which re-evaluates
 * the disabled state. Undo/redo themselves bump rev.
 */
export function Toolbar() {
  const confirmingClear = useSignal(false);

  // Read rev so any pattern mutation / undo / redo re-renders us.
  const _rev = store.rev.value;
  void _rev;

  // Reset the confirm state if the pattern mutates underneath (so the user
  // doesn't accidentally double-clear after they kept painting).
  useEffect(() => {
    const dispose = effect(() => {
      const _r = store.rev.value;
      void _r;
      confirmingClear.value = false;
    });
    return () => dispose();
  }, []);

  return (
    <div class="toolbar" role="toolbar" aria-label="Editor toolbar">
      <div class="tool-group" aria-label="Tool">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            class="btn"
            aria-pressed={store.tool.value === t.id}
            title={`${t.label}  (${t.key})`}
            onClick={() => store.setTool(t.id)}
          >
            <span aria-hidden="true">{t.glyph}</span>&nbsp;{t.label}
          </button>
        ))}
      </div>
      <div class="tool-group" aria-label="Mirror mode">
        {MIRROR_MODES.map((m) => (
          <button
            key={m}
            class="btn"
            aria-pressed={store.mirrorMode.value === m}
            title={`Mirror: ${MIRROR_LABELS[m]}`}
            onClick={() => store.setMirrorMode(m)}
          >
            {m === "none" ? "None" : m}
          </button>
        ))}
        {/* Mirror-axis overlay toggle lives next to the mode buttons so everything
            mirror-related is in one place. (Earlier it was buried deep in the
            DimensionsDock with the dimension sliders.) */}
        <button
          class="btn"
          aria-pressed={store.showMirrorAxis.value}
          title={`Toggle mirror-axis overlay`}
          onClick={() => store.setShowMirrorAxis(!store.showMirrorAxis.value)}
        >
          Axis
        </button>
      </div>
      <div class="tool-group">
        <button
          class="btn"
          onClick={() => store.undo()}
          disabled={!store.history.canUndo()}
          title="Undo  (Ctrl/Cmd+Z)"
        >
          ↶
        </button>
        <button
          class="btn"
          onClick={() => store.redo()}
          disabled={!store.history.canRedo()}
          title="Redo  (Ctrl/Cmd+Shift+Z)"
        >
          ↷
        </button>
      </div>
      <div class="tool-group">
        <button
          class={confirmingClear.value ? "btn btn-danger" : "btn"}
          data-confirming={confirmingClear.value ? "true" : "false"}
          onClick={() => {
            if (confirmingClear.value) {
              store.clearPattern();
              saveToast("Cleared");
              confirmingClear.value = false;
            } else {
              confirmingClear.value = true;
            }
          }}
          title="Clear pattern  (click twice to confirm)"
        >
          {confirmingClear.value ? "Confirm?" : "Clear"}
        </button>
        <button
          class="btn"
          onClick={() => store.fillPattern()}
          title="Fill with current color  (F)"
        >
          Fill
        </button>
        <button
          class="btn"
          onClick={() => store.randomize()}
          title="Randomize  (R)"
        >
          Randomize
        </button>
      </div>
    </div>
  );
}