import { useEffect, useRef } from "preact/hooks";
import { effect } from "@preact/signals";
import { store } from "../state/store.js";
import { renderPreview } from "../render/preview-render.js";
import { superTileDimensions } from "../domain/mirror.js";

/** Live tiling preview — `createPattern` + one `fillRect`. */
export function PreviewPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const dispose = effect(() => {
      const _rev = store.rev.value;
      const _mode = store.mirrorMode.value;
      const _cellScale = store.previewCellScale.value;
      void [_rev, _mode, _cellScale];
      const canvas = canvasRef.current;
      if (!canvas) return;
      renderPreview(canvas, {
        pattern: store.pattern.value,
        mode: store.mirrorMode.value,
        cellPx: store.previewCellScale.value,
      });
    });
    return () => dispose();
  }, []);

  // Resize observer → re-render backing store on layout changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      renderPreview(canvas, {
        pattern: store.pattern.value,
        mode: store.mirrorMode.value,
        cellPx: store.previewCellScale.value,
      });
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  const dims = superTileDimensions(
    store.pattern.value.width,
    store.pattern.value.height,
    store.mirrorMode.value,
  );

  return (
    <div class="panel">
      <div class="panel-header">
        <span>Preview</span>
        <span class="panel-sub">
          {dims.w} × {dims.h} super-tile, {store.previewCellScale.value}px cells
        </span>
      </div>
      <div class="panel-body">
        <canvas ref={canvasRef} class="preview" />
      </div>
    </div>
  );
}