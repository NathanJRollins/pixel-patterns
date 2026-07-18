import { useEffect, useRef, useState } from "preact/hooks";
import { store } from "../state/store.js";
import { superTileDimensions } from "../domain/mirror.js";
import { downloadBlob, exportPatternPng } from "../render/export-png.js";
import { saveToast } from "./toast.js";

interface ExportModalProps {
  onClose: () => void;
}

const PRESET_CELL_SCALES: number[] = [2, 4, 8, 16, 24, 32, 48, 64];

/** Export the tiled pattern as a PNG at a chosen cell scale. */
export function ExportModal(props: ExportModalProps) {
  const [cellScale, setCellScale] = useState(8);
  const [interpolate, setInterpolate] = useState(false);
  const [busy, setBusy] = useState(false);
  const dims = superTileDimensions(
    store.pattern.value.width,
    store.pattern.value.height,
    store.mirrorMode.value,
  );
  const outW = dims.w * cellScale;
  const outH = dims.h * cellScale;
  const sizeLabel = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    sizeLabel.current?.replaceChildren(document.createTextNode(`${outW} × ${outH} px`));
  }, [outW, outH]);

  async function onDownload() {
    setBusy(true);
    try {
      const { blob } = await exportPatternPng(store.pattern.value, store.mirrorMode.value, {
        cellScale,
        interpolate,
      });
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      downloadBlob(blob, `pixel-pattern-${ts}-${dims.w}x${dims.h}@${cellScale}.png`);
      saveToast("PNG exported");
      props.onClose();
    } catch (e) {
      console.error(e);
      saveToast("Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="modal-backdrop" onMouseDown={onBackdrop}>
      <div class="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <span>Export PNG</span>
          <button class="btn btn-ghost btn-icon" onClick={props.onClose} title="Close">×</button>
        </div>
        <p style={{ color: "var(--text-2)", fontSize: 13, margin: 0 }}>
          The seamless super-tile ({dims.w} × {dims.h}) tiled to a square PNG.
          One cell = <strong>{cellScale}px</strong> in the output.
        </p>
        <div class="chip-row">
          {PRESET_CELL_SCALES.map((n) => (
            <button
              key={n}
              class={"chip" + (cellScale === n ? " is-active" : "")}
              onClick={() => setCellScale(n)}
            >
              {n}px
            </button>
          ))}
        </div>
        <div class="row">
          <label>Cell size</label>
          <input
            type="range"
            min={1}
            max={64}
            step={1}
            value={cellScale}
            onInput={(e) => setCellScale(parseInt((e.currentTarget as HTMLInputElement).value, 10))}
          />
          <span class="value">{cellScale}</span>
        </div>
        <div>
          <span ref={sizeLabel} style={{ fontSize: 12, color: "var(--text-3)" }}>
            {outW} × {outH} px
          </span>
        </div>
        <label class="checkbox">
          <input
            type="checkbox"
            checked={interpolate}
            onInput={(e) => setInterpolate((e.currentTarget as HTMLInputElement).checked)}
          />
          <span>Bilinear smoothing (pixel-perfect off)</span>
        </label>
        <div class="modal-footer">
          <button class="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button class="btn btn-primary" onClick={onDownload} disabled={busy}>
            {busy ? "Rendering…" : "Download PNG"}
          </button>
        </div>
      </div>
    </div>
  );

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) props.onClose();
  }
}