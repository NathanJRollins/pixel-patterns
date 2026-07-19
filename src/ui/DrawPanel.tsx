import { useEffect, useRef } from "preact/hooks";
import { effect } from "@preact/signals";
import { store } from "../state/store.js";
import {
  clientToCell,
  renderDrawGrid,
  type ThemeColors,
} from "../render/draw-grid-render.js";
import { invalidateSuperTileCache } from "../render/super-tile-canvas.js";
import type { Tool } from "../domain/types.js";

// Long-press: hold a single-touch pointer still on the canvas for this many
// milliseconds and the gesture temporarily switches to the dropper tool,
// sampling under the cursor until release.
const LONG_PRESS_MS = 450;
// Slack within which the long-press timer stays armed — small finger
// jitter on a touchscreen shouldn't cancel the gesture.
const LONG_PRESS_SLACK_PX = 10;
// Bounds for the pinch gesture. Same range as the cell-size slider in
// DimensionsDock and the cell-scale field on the store.
const PINCH_MIN_SCALE = 1;
const PINCH_MAX_SCALE = 64;

/**
 * Module-level pointer footprint. Browsers don't expose a "currently-down
 * pointers" API at the canvas level, so we keep a small map keyed by
 * `pointerId` (a stable per-gesture id) populated from `PointerEvent`s on
 * this canvas. Used only by `activeTouchPointers` and
 * `currentPinchDistance` — both pinch helpers.
 *
 * Couldn't live in a `useRef` because the second pointer's `pointerdown`
 * handler runs *before* the first pointer's `pointermove` was supposed to
 * update it, and refs holding maps were getting clobbered by per-render
 * closures. A module map is simpler.
 */
const activePointers = new Map<number, { x: number; y: number; type: string }>();

function trackPointer(e: PointerEvent): void {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
}
function untrackPointer(e: PointerEvent): void {
  activePointers.delete(e.pointerId);
}
function updatePointer(e: PointerEvent): void {
  const existing = activePointers.get(e.pointerId);
  if (existing) {
    existing.x = e.clientX;
    existing.y = e.clientY;
  } else {
    trackPointer(e);
  }
}
function activeTouchPointers(): number {
  let n = 0;
  for (const p of activePointers.values()) if (p.type === "touch") n++;
  return n;
}
function currentPinchDistance(): number | null {
  const pts: Array<{ x: number; y: number }> = [];
  for (const p of activePointers.values()) {
    if (p.type === "touch") pts.push({ x: p.x, y: p.y });
    if (pts.length === 2) break;
  }
  if (pts.length !== 2) return null;
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}

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
  // Line tool stroke state: anchor cell + pre-stroke pattern snapshot, so
  // we can revert + redraw on every pointermove as the user drags.
  const lineAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const lineSnapshotRef = useRef<Uint32Array | null>(null);

  // Long-press dropper: while a single touch pointer is held still for
  // LONG_PRESS_MS, we temporarily switch to a dropper for the rest of the
  // gesture. The original tool is restored on pointerup.
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedToolRef = useRef<Tool | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  // Pinch state. We track the *previous* distance between two pointers and
  // compare it on every move to scale `previewCellScale` up/down. Nothing
  // fancier — direct manipulation matches user expectation for canvas zoom.
  const pinchPrevDistRef = useRef<number | null>(null);

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
        showGridLines: store.showGridLines.value,
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
          showGridLines: store.showGridLines.value,
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
        showGridLines: store.showGridLines.value,
      });
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  function handlePointerDown(e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    trackPointer(e);
    pointerStartRef.current = { x: e.clientX, y: e.clientY };

    // Two-finger pinch: when the second touch lands we start tracking the
    // inter-pointer distance; rapid-mode the gesture, force-end any in-
    // flight stroke, and don't reopen one until both pointers lift.
    if (e.pointerType === "touch" && activeTouchPointers() >= 2) {
      cancelLongPress();
      pinchPrevDistRef.current = currentPinchDistance();
      if (store.strokeActive.value) store.endStroke();
      // Suppress paint for this and any other currently-active pointer; the
      // pinch handler in `handlePointerMove` is what does the work.
      store.hover.value = null;
      return;
    }

    const cell = cellFromEvent(e);
    if (!cell) return;
    lastCellRef.current = cell;

    // Long-press dropper: only for single-touch input on the canvas, where
    // the user has no RMB to swap tools. Mouse/pen already have right-click
    // coming soon and we don't want to interfere with fast mouse drags.
    if (e.pointerType === "touch") {
      armLongPress(e);
    }

    const tool = store.tool.value;
    if (tool === "bucket") {
      // Bucket fires once on the clicked cell; no drag.
      store.bucketFillAt(cell.x, cell.y);
      return;
    }
    if (tool === "dropper") {
      // Dropper samples on down (and on move, see handlePointerMove);
      // doesn't push history and doesn't open a stroke.
      store.paintAt(cell.x, cell.y);
      return;
    }
    if (tool === "line") {
      // Save a pre-stroke snapshot, mark the anchor, push history.
      lineAnchorRef.current = cell;
      lineSnapshotRef.current = new Uint32Array(store.pattern.value.cells);
      lastCellRef.current = cell;
      store.beginStroke();
      store.paintAt(cell.x, cell.y);
      return;
    }
    store.beginStroke();
    store.paintAt(cell.x, cell.y);
  }

  function handlePointerMove(e: PointerEvent) {
    updatePointer(e);

    // Pinch movement: when a second touch is down, treat the gesture as a
    // pinch-zoom on `previewCellScale` and don't paint any cells.
    if (e.pointerType === "touch" && activeTouchPointers() >= 2 && pinchPrevDistRef.current !== null) {
      cancelLongPress();
      handlePinchMove();
      return;
    }

    // Cancel the long-press dropper if the pointer drifts beyond the slack
    // radius — the user is drawing, not still-pressing.
    if (longPressTimerRef.current && pointerStartRef.current) {
      const dx = e.clientX - pointerStartRef.current.x;
      const dy = e.clientY - pointerStartRef.current.y;
      if (Math.hypot(dx, dy) > LONG_PRESS_SLACK_PX) cancelLongPress();
    }

    const cell = cellFromEvent(e);
    if (cell) store.hover.value = cell;
    else store.hover.value = null;
    const tool = store.tool.value;
    if (tool === "bucket") return; // bucket doesn't drag
    if (!cell) return;
    if (tool === "dropper") {
      // Sample ONLY while a button is held — never on bare hover. Hover
      // with the dropper would otherwise displace the brush colour with
      // whatever's under the cursor as the user slides out of the
      // canvas, which is exactly the operator's reported bug. Touch
      // long-press dropper holds button 1 (touch primary) during the
      // drag, so continuous sampling still works there. Bare mouse-move
      // over the canvas with no button → no pick; the hover cell outline
      // still shows which cell would be picked on click.
      if (e.buttons === 0) return;
      store.paintAt(cell.x, cell.y);
      return;
    }
    if (tool === "line") {
      const anchor = lineAnchorRef.current;
      const snap = lineSnapshotRef.current;
      if (!anchor || !snap) return;
      // Revert to pre-stroke state, then redraw the line from anchor → cell.
      store.pattern.value.cells.set(snap);
      store.paintLine(anchor.x, anchor.y, cell.x, cell.y);
      lastCellRef.current = cell;
      return;
    }
    if (!store.strokeActive.value) return;
    const prev = lastCellRef.current;
    lastCellRef.current = cell;
    if (!prev || (prev.x === cell.x && prev.y === cell.y)) return;
    store.paintLine(prev.x, prev.y, cell.x, cell.y);
  }

  function handlePointerUp(e: PointerEvent) {
    untrackPointer(e);
    cancelLongPress();

    // If a long-press dropper was active, restore the previous tool. This
    // runs first on purpose: after the long-press restore, `tool.value`
    // is no longer "dropper", so the manual-dropper `revertDropper` call
    // below becomes a no-op for that path. The two mechanisms compose.
    if (savedToolRef.current !== null) {
      store.setTool(savedToolRef.current);
      savedToolRef.current = null;
    }

    // Manual dropper path: after a one-shot dropper click (or a
    // continuous-sample drag), revert to whatever tool the user had
    // before they picked the dropper from the toolbar. No-op if the
    // long-press path above already restored.
    store.revertDropper();

    // Pinch telemetry is reset as soon as we drop below 2 touch pointers.
    if (e.pointerType === "touch" && activeTouchPointers() < 2) {
      pinchPrevDistRef.current = null;
    }

    if (store.tool.value === "line") {
      lineAnchorRef.current = null;
      lineSnapshotRef.current = null;
    }
    lastCellRef.current = null;
    pointerStartRef.current = null;
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

  // --- Long-press dropper helpers -----------------------------------------

  function armLongPress(_e: PointerEvent): void {
    cancelLongPress();
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      // Already on the dropper? skip the temp swap.
      if (store.tool.value === "dropper") return;
      savedToolRef.current = store.tool.value;
      store.setTool("dropper" as Tool);
      // Also end any in-flight stroke so the lifted-finger release doesn't
      // stamp a stray cell from the original tool after the user releases.
      if (store.strokeActive.value) store.endStroke();
    }, LONG_PRESS_MS);
  }

  function cancelLongPress(): void {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  // --- Pinch helpers ------------------------------------------------------

  function handlePinchMove(): void {
    const dist = currentPinchDistance();
    const prev = pinchPrevDistRef.current;
    if (prev === null || dist === null) return;
    // Linear sensitivity: 1px of pinch delta = a small step in cell scale.
    // We use the *ratio* of new/old distance so the same gesture scales the
    // same amount regardless of how far apart the fingers started.
    const ratio = dist / prev;
    if (Math.abs(ratio - 1) < 0.01) return; // ignore sub-pixel jitter
    const next = Math.round(store.previewCellScale.value * ratio);
    const clamped = Math.max(PINCH_MIN_SCALE, Math.min(PINCH_MAX_SCALE, next));
    if (clamped !== store.previewCellScale.value) {
      store.setPreviewCellScale(clamped);
    }
    pinchPrevDistRef.current = dist;
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