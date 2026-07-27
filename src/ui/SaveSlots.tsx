import { useEffect, useRef } from "preact/hooks";
import { useSignal, effect } from "@preact/signals";
import { store } from "../state/store.js";
import { saveToast } from "./toast.js";
import { ContextMenu, type MenuItem } from "./ContextMenu.js";
import { decodePattern } from "../domain/pattern.js";
import { shareUrlEncode } from "../state/share-url.js";
import type { MirrorMode, Pattern } from "../domain/types.js";
import type { SlotSerialized } from "../state/store.js";

/**
 * Save slots: client-only named slots in localStorage. Each slot stores a
 * 32×32 PNG thumbnail of the super-tile plus the encoded pattern; loading
 * restores pattern and mirror mode.
 *
 * UX:
 *   - Click anywhere on a chip → load (was: only the `<img>` was wired;
 *     #1 in todo.txt).
 *   - Right-click anywhere on a chip → context menu with Load, Save-to-it
 *     (overwrite), Copy share URL, Delete (#10 in todo.txt).
 *   - Enter a name and hit "Save" (or Ctrl+S from the keyboard); an
 *     existing slot with the same name is overwritten.
 *
 * Slots survive across sessions via the autosave payload.
 */
export function SaveSlots() {
  const name = useSignal("");
  const inputRef = useRef<HTMLInputElement>(null);
  const menu = useSignal<{ x: number; y: number; slot: SlotSerialized } | null>(null);
  // Two-step "Clear all slots" confirm — mirrors Toolbar.tsx's
  // `confirmingClear`: first click arms (button flips to danger
  // "Confirm?"), the second click within the window commits. Auto-reverts
  // on slots change OR after 3 s of inactivity so a stray arm doesn't
  // linger dangerously.
  const confirmingClear = useSignal(false);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Any change to the slots list (a save / load / delete outside this
    // button) cancels an in-flight arm — same reactive trick as Toolbar's
    // rev-bump reset on `confirmingClear`.
    const dispose = effect(() => {
      const _slots = store.slots.value;
      void _slots;
      cancelConfirmArm();
    });
    return () => {
      dispose();
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current);
        confirmTimeoutRef.current = null;
      }
    };
  }, []);

  return (
    <div class="dock">
      <div class="dock-title">Save slots</div>
      <div class="row">
        <input
          ref={inputRef}
          type="text"
          placeholder="slot name"
          value={name.value}
          onInput={(e) => (name.value = (e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitSave();
          }}
        />
        <button
          class="btn btn-primary"
          onClick={() => commitSave()}
          disabled={!name.value.trim()}
          title="Save current pattern to a slot"
        >
          Save
        </button>
      </div>
      {store.slots.value.length === 0 ? (
        <div class="list-empty">No saved patterns. Try the bake-in slots above.</div>
      ) : (
        <div class="chip-row">
          {store.slots.value.map((s) => (
            <SlotChip
              key={s.name}
              slot={s}
              onContextMenu={(e, slot) => {
                e.preventDefault();
                menu.value = { x: e.clientX, y: e.clientY, slot };
              }}
            />
          ))}
        </div>
      )}
      {store.slots.value.length > 0 && (
        <div class="row">
          <button
            class={confirmingClear.value ? "btn btn-danger" : "btn btn-ghost"}
            data-confirming={confirmingClear.value ? "true" : "false"}
            onClick={() => {
              if (confirmingClear.value) {
                store.clearAllSlots();
                saveToast("All slots cleared");
                cancelConfirmArm();
              } else {
                armConfirm();
              }
            }}
            title="Remove all saved slots (click twice to confirm)"
          >
            {confirmingClear.value ? "Confirm?" : "Clear all slots"}
          </button>
        </div>
      )}
      {menu.value && (
        <ContextMenu
          x={menu.value.x}
          y={menu.value.y}
          items={buildSlotMenuItems(menu.value.slot)}
          onClose={() => (menu.value = null)}
        />
      )}
    </div>
  );

  function commitSave(): void {
    const trimmed = name.value.trim();
    if (!trimmed) return;
    store.saveSlot(trimmed);
    saveToast(`Saved to "${trimmed}"`);
    name.value = "";
    // Blur (rather than re-focus) so a stray page-wide keydown handler
    // doesn't bail on `target.tagName === "INPUT"`. The previous
    // `focus()` kept focus on this input after Enter-saves, silently
    // disabling `Ctrl+Z` until the user clicked on something inert.
    // Operators typing multiple saves back-to-back can click back into
    // the field (a single mouse click). Cf. the #7 Ctrl+Z focus fix in
    // DrawPanel.tsx.
    inputRef.current?.blur();
  }

  function armConfirm(): void {
    confirmingClear.value = true;
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    confirmTimeoutRef.current = setTimeout(() => {
      confirmTimeoutRef.current = null;
      confirmingClear.value = false;
    }, 3000);
  }

  function cancelConfirmArm(): void {
    if (confirmTimeoutRef.current) {
      clearTimeout(confirmTimeoutRef.current);
      confirmTimeoutRef.current = null;
    }
    // Read via `.peek()` so the slots-subscribed effect (above) doesn't
    // also subscribe to `confirmingClear`. Without peek the effect would
    // re-fire on every arm, immediately cancelling it.
    if (confirmingClear.peek()) confirmingClear.value = false;
  }
}

/**
 * A save slot chip. The whole chip is the click target (`role="button"` so
 * it's keyboard-accessible without nesting an interactive button inside
 * another). The delete button is a real `<button>` nested inside the div;
 * its `stopPropagation` keeps the chip-click load from firing on a delete.
 * Right-click anywhere on the chip opens the context menu.
 */
function SlotChip(props: {
  slot: SlotSerialized;
  onContextMenu: (e: MouseEvent, slot: SlotSerialized) => void;
}) {
  const { slot } = props;
  return (
    <div
      class="chip chip-clickable"
      role="button"
      tabindex={0}
      title={`${slot.name} — click to load; right-click for more`}
      onClick={() => {
        store.loadSlot(slot.name);
        saveToast(`Loaded "${slot.name}"`);
      }}
      onKeyDown={(e) => {
        // Treat Enter / Space as click. Space scrolls in some layouts;
        // preventDefault so the page doesn't also jump.
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
          e.preventDefault();
          store.loadSlot(slot.name);
          saveToast(`Loaded "${slot.name}"`);
        }
      }}
      onContextMenu={(e) => props.onContextMenu(e, slot)}
    >
      <img src={slot.thumb} alt="" width={30} height={30} class="chip-thumb" />
      <span class="chip-label">{slot.name}</span>
      <button
        class="chip-del"
        title="Delete"
        // The delete button is a real button (it's never used as the load
        // trigger). stopPropagation keeps the chip's onClick (load) from
        // also firing when the × is clicked.
        onClick={(e) => {
          e.stopPropagation();
          store.deleteSlot(slot.name);
        }}
      >
        ×
      </button>
    </div>
  );
}

/** Build the context-menu items for a single slot. The items fire their
 * actions directly through the store; `ContextMenu` dismisses itself after
 * the action via its own `onClick` plumbing. */
function buildSlotMenuItems(slot: SlotSerialized): MenuItem[] {
  return [
    {
      label: "Load",
      title: `Load "${slot.name}"`,
      onClick: () => {
        store.loadSlot(slot.name);
        saveToast(`Loaded "${slot.name}"`);
      },
    },
    {
      label: "Overwrite with current",
      title: `Replace "${slot.name}" with the current pattern`,
      onClick: () => {
        store.saveSlot(slot.name);
        saveToast(`Re-saved "${slot.name}"`);
      },
    },
    {
      label: "Copy share URL",
      title: "Copy a share link to the clipboard",
      onClick: () => copyShareUrlForSlot(slot),
    },
    {
      label: "Delete",
      title: `Delete "${slot.name}"`,
      danger: true,
      onClick: () => {
        store.deleteSlot(slot.name);
        saveToast(`Deleted "${slot.name}"`);
      },
    },
  ];
}

/**
 * Encode a share URL for an arbitrary saved slot, using the user's current
 * primary / secondary palette + active-slot setting as the colour halves
 * of the payload. The pattern + mirror mode come from the slot itself; the
 * colours don't travel with the slot (see `SlotSerialized`), so we use the
 * currently-active palette as a sensible default.
 */
function shareUrlForPattern(pattern: Pattern, mode: MirrorMode): string {
  // The shared URL only needs a hash; we add the base URL only at copy time
  // so the encoder stays free of `location` access for env portability.
  return shareUrlEncode({
    pattern,
    mode,
    color: store.primaryColor.value,
    alpha01: store.primaryAlpha01.value,
    secondaryColor: store.secondaryColor.value,
    secondaryAlpha01: store.secondaryAlpha01.value,
    activeColorSlot: store.activeColorSlot.value,
  });
}

function copyShareUrlForSlot(slot: SlotSerialized): void {
  const decoded = decodePattern(slot.pattern);
  if (!decoded) {
    saveToast("Could not build URL");
    return;
  }
  const hash = shareUrlForPattern(decoded, slot.mirrorMode);
  const full = `${location.origin}${location.pathname}${location.search}${hash}`;
  void writeClipboard(full);
}

/** Write text to the clipboard with a graceful fallback when the API is
 * absent or blocked (older browsers, private-mode, tests, etc.). Resolves
 * to a boolean so callers can use it as fire-and-forget then toast. */
async function writeClipboard(text: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      saveToast("Share URL copied");
      return;
    }
  } catch {
    // Fall through to the legacy execCommand path.
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    ta.remove();
    saveToast("Share URL copied");
  } catch {
    saveToast("Copy failed — clipboard blocked");
  }
}