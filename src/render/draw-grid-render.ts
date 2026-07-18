import { cellToCss } from "../domain/color.js";
import type { MirrorMode, Pattern } from "../domain/types.js";

/**
 * Render the input draw grid.
 *
 * Layout rule: regardless of the pattern's aspect ratio, the grid is fit
 * inside the canvas with 1:1 cell aspect ratio (square cells). Padding is
 * applied symmetrically so the drawable area is centred. This matches the
 * pixel-art-editor convention the original spec called out and keeps every
 * cell readable.
 *
 * Layers drawn in order (back to front):
 *   1. Transparent-cell checkerboard (subtle, so empty cells are legible).
 *   2. Painted cells.
 *   3. Cell grid lines (1 device px, theme-aware via {@link ThemeColors}).
 *   4. Mirror axis (heavier line) where the user grid's halves meet.
 *   5. Hover cursor (single-cell outline).
 */

const DPR_CAP = 3; // cap backing-store scale so huge monitors don't choke

export interface ThemeColors {
  gridLine: string;
  mirrorAxis: string;
  hover: string;
  checkerA: string;
  checkerB: string;
}

export interface GridRenderInput {
  pattern: Pattern;
  mode: MirrorMode;
  colors: ThemeColors;
  hover: { x: number; y: number } | null;
  /** Draw the mirror axis overlay (where the user grid's halves meet). */
  showMirrorAxis: boolean;
  /** Draw the 1-device-px cell grid lines. When false, only the outer
   * border around the drawable area is drawn. */
  showGridLines: boolean;
}

interface Layout {
  cellPx: number; // device px
  offsetX: number; // device px
  offsetY: number; // device px
}

export function renderDrawGrid(
  canvas: HTMLCanvasElement,
  input: GridRenderInput,
): void {
  const dpr = Math.min(DPR_CAP, Math.max(1, Math.floor(window.devicePixelRatio || 1)));
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW === 0 || cssH === 0) return;
  const backingW = Math.floor(cssW * dpr);
  const backingH = Math.floor(cssH * dpr);
  if (canvas.width !== backingW) canvas.width = backingW;
  if (canvas.height !== backingH) canvas.height = backingH;

  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const { pattern, colors, mode, hover, showMirrorAxis, showGridLines } = input;
  const layout = computeLayout(pattern.width, pattern.height, cssW, cssH);
  const { cellPx, offsetX, offsetY } = layout;

  // 1. checkerboard just for the drawable area
  ctx.save();
  ctx.beginPath();
  ctx.rect(offsetX, offsetY, pattern.width * cellPx, pattern.height * cellPx);
  ctx.clip();
  ctx.fillStyle = colors.checkerA;
  ctx.fillRect(offsetX, offsetY, pattern.width * cellPx, pattern.height * cellPx);
  ctx.fillStyle = colors.checkerB;
  const sq = Math.max(4, cellPx);
  for (let y = 0; y < pattern.height * cellPx; y += sq) {
    for (let x = 0; x < pattern.width * cellPx; x += sq) {
      if ((((x / sq) | 0) + ((y / sq) | 0)) % 2 === 0) {
        ctx.fillRect(offsetX + x, offsetY + y, sq, sq);
      }
    }
  }
  ctx.restore();

  // 2. painted cells
  for (let y = 0; y < pattern.height; y++) {
    for (let x = 0; x < pattern.width; x++) {
      const cell = pattern.cells[y * pattern.width + x];
      if (cell === 0) continue;
      ctx.fillStyle = cellToCss(cell);
      ctx.fillRect(offsetX + x * cellPx, offsetY + y * cellPx, cellPx, cellPx);
    }
  }

  // 3. grid lines — gated by UI toggle. When toggled off, we still draw the
// outer border around the drawable area so the user can see where it is.
  ctx.strokeStyle = colors.gridLine;
  ctx.lineWidth = 1;
  if (showGridLines) {
    ctx.beginPath();
    for (let x = 0; x <= pattern.width; x++) {
      const px = Math.round(offsetX + x * cellPx) + 0.5;
      ctx.moveTo(px, offsetY);
      ctx.lineTo(px, offsetY + pattern.height * cellPx);
    }
    for (let y = 0; y <= pattern.height; y++) {
      const py = Math.round(offsetY + y * cellPx) + 0.5;
      ctx.moveTo(offsetX, py);
      ctx.lineTo(offsetX + pattern.width * cellPx, py);
    }
    ctx.stroke();
  }

  // 4. mirror axis — only where the user grid's halves join (not at the
  // outermost edges). For "H" it's the horizontal line at row H/2; for "V"
  // the vertical at col W/2; for "HV" both.
  if (showMirrorAxis && mode !== "none") {
    ctx.strokeStyle = colors.mirrorAxis;
    ctx.lineWidth = Math.max(1.5, cellPx * 0.075);
    ctx.beginPath();
    if (mode === "H" || mode === "HV") {
      const yLine = offsetY + (pattern.height / 2) * cellPx;
      ctx.moveTo(offsetX, yLine);
      ctx.lineTo(offsetX + pattern.width * cellPx, yLine);
    }
    if (mode === "V" || mode === "HV") {
      const xLine = offsetX + (pattern.width / 2) * cellPx;
      ctx.moveTo(xLine, offsetY);
      ctx.lineTo(xLine, offsetY + pattern.height * cellPx);
    }
    ctx.stroke();
  }

  // 5. hover indicator
  if (hover && hover.x >= 0 && hover.y >= 0 && hover.x < pattern.width && hover.y < pattern.height) {
    ctx.strokeStyle = colors.hover;
    ctx.lineWidth = 2;
    ctx.strokeRect(
      offsetX + hover.x * cellPx + 1,
      offsetY + hover.y * cellPx + 1,
      cellPx - 2,
      cellPx - 2,
    );
  }

  // 6. outer border so the drawable area is unmistakable
  ctx.strokeStyle = colors.gridLine;
  ctx.lineWidth = 1;
  ctx.strokeRect(
    Math.round(offsetX) + 0.5,
    Math.round(offsetY) + 0.5,
    pattern.width * cellPx,
    pattern.height * cellPx,
  );
}

/**
 * Map a pointer event's CSS-pixel client coordinates to a grid cell, using
 * the same layout rule as {@link renderDrawGrid}. Returns `{x,y}` or null
 * if outside the drawable area.
 */
export function clientToCell(
  canvas: HTMLCanvasElement,
  pattern: Pattern,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  const cssW = rect.width;
  const cssH = rect.height;
  const layout = computeLayout(pattern.width, pattern.height, cssW, cssH);
  const localX = clientX - rect.left - layout.offsetX;
  const localY = clientY - rect.top - layout.offsetY;
  if (localX < 0 || localY < 0) return null;
  const x = Math.floor(localX / layout.cellPx);
  const y = Math.floor(localY / layout.cellPx);
  if (x < 0 || y < 0 || x >= pattern.width || y >= pattern.height) return null;
  return { x, y };
}

function computeLayout(w: number, h: number, cssW: number, cssH: number): Layout {
  const pad = 4; // small inset so the outer border isn't flush against canvas edge
  const availW = cssW - pad * 2;
  const availH = cssH - pad * 2;
  const cellPx = Math.max(1, Math.floor(Math.min(availW / w, availH / h)));
  const drawW = w * cellPx;
  const drawH = h * cellPx;
  const offsetX = Math.floor((cssW - drawW) / 2);
  const offsetY = Math.floor((cssH - drawH) / 2);
  return { cellPx, offsetX, offsetY };
}