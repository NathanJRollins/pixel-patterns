import { useEffect, useRef } from "preact/hooks";

/**
 * Context menu — a small, focus-stealing strip of buttons positioned at a
 * viewport-relative (clientX, clientY) anchor. Used by right-click handlers
 * on the preset chips and the save-slot chips (see #10 in todo.txt).
 *
 * Lifecycle:
 *   - Mounts on demand (parent renders it only when a `contextmenu` event
 *     opens it) and unmounts on close.
 *   - Auto-dismisses on off-click / Escape / page scroll. Mouse-down capture
 *     on anything outside the menu closes it (so the next menu interaction
 *     can open fresh without an extra click).

Inventory of items is provided by the caller as ``MenuItem[]``. Each item's
click handler becomes the menu item's click handler — the menu auto-closes
after the action fires via ``onMouseUp`` (click) on the button.
 */
export interface MenuItem {
  label: string;
  /** Tooltip / aria-label. */
  title?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

const APPROX_MENU_WIDTH = 200;
const APPROX_ITEM_HEIGHT = 32;
const APPROX_MENU_PADDING = 8;

export function ContextMenu(props: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function offClick(e: MouseEvent): void {
      const root = ref.current;
      if (!root) return;
      if (!root.contains(e.target as Node)) props.onClose();
    }
    function escape(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        props.onClose();
      }
    }
    function scrollOff(): void {
      // Any scroll closes — the menu was anchored in screen coords and an
      // underlying scroll would visually detach from its trigger.
      props.onClose();
    }
    function blurOff(): void {
      // Window losing focus (tab switch, alt-tab) — close rather than
      // leave an orphaned menu.
      props.onClose();
    }
    // Capture-phase mousedown so we beat the chip's own click handler in
    // closing-then-reopening when an outside click lands on the trigger
    // for a different chip.
    window.addEventListener("mousedown", offClick, true);
    window.addEventListener("keydown", escape);
    window.addEventListener("scroll", scrollOff, true);
    window.addEventListener("blur", blurOff);
    return () => {
      window.removeEventListener("mousedown", offClick, true);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", scrollOff, true);
      window.removeEventListener("blur", blurOff);
    };
  }, [props]);

  // Clamp inside the viewport so the menu can't open offscreen past the
  // right/bottom edges. We can't measure precisely before the first paint
  // (the menu isn't yet in the DOM), so we use generous approximations and
  // the actual element's overflow IS hidden via CSS so a longer label
  // wraps onto a second line rather than overflowing the menu box.
  const margin = 8;
  const maxRight = (typeof window !== "undefined" ? window.innerWidth : 1024) - margin;
  const maxBottom = (typeof window !== "undefined" ? window.innerHeight : 768) - margin;
  const approxHeight = props.items.length * APPROX_ITEM_HEIGHT + APPROX_MENU_PADDING * 2;
  const x = Math.min(props.x, maxRight - APPROX_MENU_WIDTH);
  const y = Math.min(props.y, maxBottom - approxHeight);

  return (
    <div ref={ref} class="ctx-menu" style={{ left: `${Math.max(margin, x)}px`, top: `${Math.max(margin, y)}px` }} role="menu">
      {props.items.map((it) => (
        <button
          type="button"
          role="menuitem"
          class={"ctx-item" + (it.danger ? " ctx-item-danger" : "")}
          title={it.title}
          disabled={it.disabled}
          onClick={() => {
            // Run the action first, then close. The close fires in the same
            // tick so there's no flash of "still-open" between the click
            // and its effect.
            try {
              it.onClick();
            } finally {
              props.onClose();
            }
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}