import { useEffect, useRef, useState } from "preact/hooks";
import { store } from "../state/store.js";
import { saveToast } from "./toast.js";

interface ShareModalProps {
  onClose: () => void;
}

/**
 * Share modal: shows the shareable URL (with the current pattern, mirror
 * mode, color, and alpha encoded into the hash) and a Copy button.
 * "Open in new tab" duplicates the URL so the user can preview the share
 * payload on first load.
 *
 * The URL is built synchronously in a `useState` lazy initializer so it's
 * available the instant the modal mounts — no useEffect timing window
 * during which the input/anchor's `href` would still be empty (and a fast
 * Cmd-C or "Open in new tab" click could grab the empty URL).
 */
export function ShareModal(props: ShareModalProps) {
  const urlRef = useRef<HTMLInputElement>(null);
  const [url] = useState(() => {
    const u = store.buildShareUrl();
    const abs = new URL(window.location.href);
    abs.hash = u.slice(1); // omit the leading `#`
    return abs.toString();
  });

  useEffect(() => {
    // Focus + select the URL field for instant Cmd-C, now that the value is
    // already in place synchronously.
    urlRef.current?.select();
  }, []);

  function copy() {
    navigator.clipboard?.writeText(url).then(
      () => saveToast("Copied share URL"),
      () => saveToast("Copy failed — select and ⌘C"),
    );
  }

  return (
    <div class="modal-backdrop" onMouseDown={onBackdrop}>
      <div class="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <span>Share</span>
          <button class="btn btn-ghost btn-icon" onClick={props.onClose} title="Close">×</button>
        </div>
        <p style={{ color: "var(--text-2)", fontSize: 13, margin: 0 }}>
          The current pattern, mirror mode, color, and opacity are encoded into the
          URL hash. Open it anywhere — no backend, no account.
        </p>
        <input
          ref={urlRef}
          type="text"
          readOnly
          value={url}
          onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
        />
        <div class="modal-footer">
          <a class="btn" href={url} target="_blank" rel="noreferrer">
            Open in new tab
          </a>
          <button class="btn btn-primary" onClick={copy}>
            Copy URL
          </button>
        </div>
      </div>
    </div>
  );

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) props.onClose();
  }
}