/** Tiny toast notification helper: enqueues a message, auto-dismisses. */

import { signal } from "@preact/signals";

const queue = signal<Array<{ id: number; text: string }>>([]);
let idCounter = 0;

export function saveToast(text: string): void {
  const id = ++idCounter;
  queue.value = [...queue.value, { id, text }];
  setTimeout(() => {
    queue.value = queue.value.filter((t) => t.id !== id);
  }, 1800);
}

export function ToastHost() {
  return (
    <div class="toast-area">
      {queue.value.map((t) => (
        <div class="toast" key={t.id}>
          {t.text}
        </div>
      ))}
    </div>
  );
}