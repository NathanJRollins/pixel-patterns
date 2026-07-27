interface CheatsheetModalProps {
  onClose: () => void;
}

/**
 * Cheatsheet modal (`?` to open): single place that lists every keyboard
 * shortcut. Discoverability matters — most users will stumble onto one or
 * two by accident and never find the rest. This modal is the surfacing.
 *
 * Grouped by purpose: Tools, Mirror, History, Color, View, etc.
 */
interface Shortcut {
  keys: string;
  label: string;
}

interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: "Tools",
    items: [
      { keys: "B", label: "Pencil" },
      { keys: "E", label: "Eraser" },
      { keys: "G", label: "Bucket (flood fill)" },
      { keys: "L", label: "Line (drag from anchor)" },
      { keys: "I", label: "Dropper" },
    ],
  },
  {
    title: "Mirror",
    items: [
      { keys: "M", label: "Cycle mirror mode (None → H → V → HV)" },
    ],
  },
  {
    title: "Color",
    items: [
      { keys: "X", label: "Swap primary ↔ secondary color" },
      { keys: "C", label: "Open the native color picker for the active slot" },
      { keys: "Shift+C", label: "Open the native color picker for the secondary slot" },
      { keys: "LMB click swatch", label: "Fill the active color slot" },
      { keys: "RMB click swatch", label: "Fill the inactive slot directly (touch: long-press)" },
      { keys: "LMB paint", label: "Paint with primary color" },
      { keys: "RMB paint", label: "Paint with secondary color" },
    ],
  },
  {
    title: "Stroke / paint",
    items: [
      { keys: "Backspace / Delete", label: "Clear pattern (toolbar has two-tap confirm)" },
      { keys: "F", label: "Fill pattern with the active color slot's color" },
      { keys: "R", label: "Randomize (seeded HV-biased)" },
    ],
  },
  {
    title: "History",
    items: [
      { keys: "Ctrl/Cmd+Z", label: "Undo" },
      { keys: "Ctrl/Cmd+Shift+Z  /  Ctrl/Cmd+Y", label: "Redo" },
      { keys: "Ctrl/Cmd+S", label: "Save current pattern to a numbered slot" },
    ],
  },
  {
    title: "View",
    items: [
      { keys: "[", label: "Decrease preview cell size" },
      { keys: "]", label: "Increase preview cell size" },
      { keys: ",", label: "Decrease page background scale" },
      { keys: ".", label: "Increase page background scale" },
      { keys: "?", label: "This cheatsheet" },
      { keys: "Esc", label: "Close any open modal / drawer" },
    ],
  },
  {
    title: "Touch (mobile)",
    items: [
      { keys: "Hold still 0.45s on canvas", label: "Temporarily switch to dropper for the rest of the gesture" },
      { keys: "Hold still 0.45s on swatch", label: "Fill the inactive color slot (touch has no RMB)" },
      { keys: "Two-finger pinch", label: "Adjust preview cell size" },
    ],
  },
];

export function CheatsheetModal(props: CheatsheetModalProps) {
  return (
    <div class="modal-backdrop" onMouseDown={onBackdrop}>
      <div class="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <span>Keyboard shortcuts</span>
          <button class="btn btn-ghost btn-icon" onClick={props.onClose} title="Close">×</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div class="dock-title" style={{ marginBottom: 6 }}>
                {g.title}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {g.items.map((s) => (
                  <div
                    key={s.keys}
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      fontSize: 13,
                    }}
                  >
                    <code
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        background: "var(--surface-2)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        padding: "2px 7px",
                        minWidth: "8rem",
                        display: "inline-block",
                        color: "var(--text-1)",
                      }}
                    >
                      {s.keys}
                    </code>
                    <span style={{ color: "var(--text-2)" }}>{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div class="modal-footer">
          <button class="btn" onClick={props.onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) props.onClose();
  }
}