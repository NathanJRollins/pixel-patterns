import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { store } from "../state/store.js";
import { saveToast } from "./toast.js";
import type { SlotSerialized } from "../state/store.js";

/**
 * Save slots: client-only named slots in localStorage. Each slot stores a
 * 32×32 PNG thumbnail of the super-tile plus the encoded pattern; loading
 * restores pattern and mirror mode.
 *
 * Saving: enter a name and hit "Save"; an existing slot with the same name
 * is replaced. Slots survive across sessions via the autosave payload.
 */
export function SaveSlots() {
  const name = useSignal("");

  useEffect(() => {
    // No subscription work needed — the slots signal is already wired.
  }, []);

  const inputRef = useRef<HTMLInputElement>(null);

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
            <SlotChip key={s.name} slot={s} />
          ))}
        </div>
      )}
      {store.slots.value.length > 0 && (
        <div class="row">
          <button
            class="btn btn-ghost"
            onClick={() => {
              store.clearAllSlots();
              saveToast("All slots cleared");
            }}
            title="Remove all saved slots"
          >
            Clear all slots
          </button>
        </div>
      )}
    </div>
  );

  function commitSave() {
    const trimmed = name.value.trim();
    if (!trimmed) return;
    store.saveSlot(trimmed);
    saveToast(`Saved to "${trimmed}"`);
    name.value = "";
    inputRef.current?.focus();
  }
}

function SlotChip({ slot }: { slot: SlotSerialized }) {
  return (
    <div class="chip" title={`${slot.name} — click to load`}>
      <img
        src={slot.thumb}
        alt=""
        width={30}
        height={30}
        class="chip-thumb"
        onClick={() => {
          store.loadSlot(slot.name);
          saveToast(`Loaded "${slot.name}"`);
        }}
      />
      <span class="chip-label">{slot.name}</span>
      <button
        class="chip-del"
        title="Delete"
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