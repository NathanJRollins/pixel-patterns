import { useEffect, useRef } from "preact/hooks";
import { effect } from "@preact/signals";
import { store } from "../state/store.js";
import {
  clientToCell,
  renderDrawGrid,
  type ThemeColors,
} from "../render/draw-grid-render.js";
import { invalidateSuperTileCache } from "../render/super-tile-canvas.js";

/**
 * Input draw grid. Pointer events are routed through the store; cell math
 * is shared with the renderer via {@link clientToCell}.
 *
 * Stroke model: `pointerdown` → `beginStroke()`; `pointermove` →
 * `paintLine(prev, cur)` (Bresenham bridges fast-drag skips); `pointerup` →
 * `endStroke()`. Bucket tool fires once on down. Dropper fires on down +
 * drag. Line tool (reserved) uses the same Bresenham bridge as pencil but
 * could later split anchor/current into a preview layer — left for v2.
 */
export function DrawPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastCellRef = useRef<{ x: number; y: number } | null>(null);

  // Subscribe to all signals that change what we draw.
  useEffect(() => {
    const dispose = effect(() => {
      const _rev = store.rev.value;
      const _mode = store.mirrorMode.value;
      const _hover = store.hover.value;
      const _showGrid = store.showGridLines.value;
      const _showAxis = store.showMirrorAxis.value;
      void [_rev, _mode, _hover, _showGrid, _showAxis];
      const canvas = canvasRef.current;
      if (!canvas) return;
      const colors = colorsForTheme(store.theme.value);
      renderDrawGrid(canvas, {
        pattern: store.pattern.value,
        mode: store.mirrorMode.value,
        colors,
        hover: store.hover.value,
        showMirrorAxis: store.showMirrorAxis.value,
      });
    });
    return () => dispose();
  }, []);

  // Theme change: bump us to re-render against the new colors. (The above
  // effect already tracks showGrid/showAxis but not theme directly — read
  // it here so a theme swap re-runs the paint.)
  useEffect(() => {
    const dispose = effect(() => {
      const t = store.theme.value;
      void t;
      invalidateSuperTileCache();
      const canvas = canvasRef.current;
      if (canvas) {
        renderDrawGrid(canvas, {
          pattern: store.pattern.value,
          mode: store.mirrorMode.value,
          colors: colorsForTheme(store.theme.value),
          hover: store.hover.value,
          showMirrorAxis: store.showMirrorAxis.value,
        });
      }
    });
    return () => dispose();
  }, []);

  // Resize observer → re-render with new canvas size backing store.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      // The above effects will run on the resize via signal subscriptions
      // (canvas.clientWidth/Height are read inside renderDrawGrid) — but it
      // costs an extra rev bump they wouldn't otherwise have, so trigger an
      // explicit re-render via the invalidatePreviewPattern skip path:
      // easiest: trigger the same effect by reading once more.
      renderDrawGrid(canvas, {
        pattern: store.pattern.value,
        mode: store.mirrorMode.value,
        colors: colorsForTheme(store.theme.value),
        hover: store.hover.value,
        showMirrorAxis: store.showMirrorAxis.value,
      });
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  function handlePointerDown(e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const cell = cellFromEvent(e);
    if (!cell) return;
    lastCellRef.current = cell;
    if (store.tool.value === "bucket") {
      store.bucketFillAt(cell.x, cell.y);
      return;
    }
    store.beginStroke();
    store.paintAt(cell.x, cell.y);
  }

  function handlePointerMove(e: PointerEvent) {
    const cell = cellFromEvent(e);
    if (cell) store.hover.value = cell;
    else store.hover.value = null;
    if (!store.strokeActive.value && store.tool.value !== "bucket") return;
    if (!cell) return;
    const prev = lastCellRef.current;
    lastCellRef.current = cell;
    if (!prev || (prev.x === cell.x && prev.y === cell.y)) return;
    store.paintLine(prev.x, prev.y, cell.x, cell.y);
  }

  function handlePointerUp(_e: PointerEvent) {
    lastCellRef.current = null;
    if (store.strokeActive.value) store.endStroke();
  }

  function handlePointerLeave(_e: PointerEvent) {
    store.hover.value = null;
  }

  function cellFromEvent(e: PointerEvent): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return clientToCell(canvas, store.pattern.value, e.clientX, e.clientY);
  }

  const label = `${store.pattern.value.width} × ${store.pattern.value.height}`;

  return (
    <div class="panel">
      <div class="panel-header">
        <span>Draw</span>
        <span class="panel-sub">{label} cells</span>
      </div>
      <div class="panel-body">
        <canvas
          ref={canvasRef}
          class="drawgrid"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onPointerCancel={handlePointerUp}
        />
      </div>
    </div>
  );
}

function colorsForTheme(_theme: "light" | "dark"): ThemeColors {
  // Theme is applied via `body[data-theme]` CSS; we read the *current* values
  // out at render time so a theme swap is reflected on the next paint.
  void _theme;
  const css = getComputedStyle(document.body);
  return {
    gridLine: css.getPropertyValue("--grid-line").trim() || "rgba(255,255,255,0.1)",
    mirrorAxis: css.getPropertyValue("--mirror-axis").trim() || "rgba(255,198,88,0.55)",
    hover: css.getPropertyValue("--hover-outline").trim() || "rgba(255,255,255,0.55)",
    checkerA: css.getPropertyValue("--checker-a").trim() || "rgba(255,255,255,0.05)",
    checkerB: css.getPropertyValue("--checker-b").trim() || "transparent",
  };
}