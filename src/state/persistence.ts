import { signal } from "@preact/signals";
import type { Savestate } from "./store.js";

/**
 * localStorage persistence.
 *
 *   - `pixpat:autosave` → full {@link Savestate}, written on a debounced
 *     250 ms rhythm after any pattern mutation.
 *   - Slots live within the autosave payload (simpler than per-slot keys).
 *
 * The autosave wraps everything the user might miss: pattern, mode, color,
 * recent colors, view settings, theme, slots. It does NOT include history
 * (ram cost grows with no real benefit for a tool like this).
 *
 * {@link invalidationToken} is bumped by any external restore so the UI can
 * opportunistically refresh things that bypass signals (e.g. body background).
 */

const KEY = "pixpat:autosave";
const DEBOUNCE_MS = 250;

export const invalidationToken = signal<number>(0);

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleAutosave(getSnapshot: () => Savestate): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const payload = JSON.stringify(getSnapshot());
      localStorage.setItem(KEY, payload);
    } catch (e) {
      // Quota exceeded or storage disabled — silently drop; the app still works.
      console.warn("[pixel-patterns] autosave failed:", e);
    }
  }, DEBOUNCE_MS);
}

export function loadAutosave(): Partial<Savestate> | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<Savestate>;
  } catch (e) {
    console.warn("[pixel-patterns] autosave load failed:", e);
    return null;
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  bumpReload();
}

export function bumpReload(): void {
  invalidationToken.value++;
}