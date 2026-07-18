import { packRGBA, unpackRGBA } from "./color.js";
import type { Cell, Pattern } from "./types.js";

/**
 * Pattern construction and pure operations.
 *
 * The whole app reads from and writes to one {@link Pattern}. These
 * helpers are the only sanctioned ways to create and mutate patterns;
 * they keep `cells.length === width * height` invariant and normalise
 * transparent cells to the {@link Cell} sentinel `0`.
 */

export const DEFAULT_WIDTH = 5;
export const DEFAULT_HEIGHT = 5;

/** Maximum per-side dimension the UI will allow. */
export const MAX_DIM = 64;

/** Create a fully transparent pattern of the given dimensions. */
export function emptyPattern(width: number, height: number): Pattern {
  assertDims(width, height);
  return {
    width,
    height,
    cells: new Uint32Array(width * height),
  };
}

/** Create a pattern filled with a single color. */
export function filledPattern(
  width: number,
  height: number,
  color: Cell,
): Pattern {
  assertDims(width, height);
  const cells = new Uint32Array(width * height);
  if (color !== 0) cells.fill(color);
  return { width, height, cells };
}

/** Deep copy (the cells array is duplicated so callers can mutate safely). */
export function clonePattern(p: Pattern): Pattern {
  return {
    width: p.width,
    height: p.height,
    cells: new Uint32Array(p.cells),
  };
}

/** Equal-by-value comparison. */
export function patternsEqual(a: Pattern, b: Pattern): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.cells.length; i++) {
    if (a.cells[i] !== b.cells[i]) return false;
  }
  return true;
}

/** Read the cell at `(x, y)`, transparent (`0`) if out of bounds. */
export function getCell(p: Pattern, x: number, y: number): Cell {
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return 0;
  return p.cells[y * p.width + x];
}

/**
 * Write a cell at `(x, y)`. No-op out of bounds. Returns true if the
 * pattern actually changed (used to suppress redundant history pushes).
 */
export function setCell(p: Pattern, x: number, y: number, c: Cell): boolean {
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return false;
  const i = y * p.width + x;
  if (p.cells[i] === c) return false;
  p.cells[i] = c;
  return true;
}

/**
 * Resize a pattern, preserving every overlapping cell. Smaller dimensions
 * crop; larger dimensions pad with transparency. (The original TODO asked
 * for this: "Retain what existed before when dimensions shrink, rather than
 * tossing away?")
 */
export function resizePattern(
  src: Pattern,
  newWidth: number,
  newHeight: number,
): Pattern {
  assertDims(newWidth, newHeight);
  const out = emptyPattern(newWidth, newHeight);
  const copyW = Math.min(src.width, newWidth);
  const copyH = Math.min(src.height, newHeight);
  for (let y = 0; y < copyH; y++) {
    for (let x = 0; x < copyW; x++) {
      out.cells[y * newWidth + x] = src.cells[y * src.width + x];
    }
  }
  return out;
}

/** Fill the entire pattern with a single color. Returns whether it changed. */
export function fillPattern(p: Pattern, c: Cell): boolean {
  let changed = false;
  for (let i = 0; i < p.cells.length; i++) {
    if (p.cells[i] !== c) {
      p.cells[i] = c;
      changed = true;
    }
  }
  return changed;
}

/** Clear the entire pattern to transparent. */
export function clearPattern(p: Pattern): boolean {
  let changed = false;
  for (let i = 0; i < p.cells.length; i++) {
    if (p.cells[i] !== 0) {
      p.cells[i] = 0;
      changed = true;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Serialization — compact, URL-safe. Two flavours:
//   - plain hex (every cell = 2 chars '--' or 8 hex RRGGBBAA)
//   - run-length hex (presets: 1 char run, '.' transparent / 6 hex RRGGBB)
// The plain form is what share-URLs use: short enough for typical patterns
// (~80 chars for a 5x5) and trivially reversible. The RLE form is for
// hand-curated presets where compression matters more.
// ---------------------------------------------------------------------------

export function encodePattern(p: Pattern): string {
  return `${p.width}x${p.height}:${encodeHexPlain(p)}`;
}

export function decodePattern(s: string): Pattern | null {
  const colon = s.indexOf(":");
  if (colon < 0) return null;
  const head = s.slice(0, colon);
  const body = s.slice(colon + 1);
  const x = head.indexOf("x");
  if (x < 0) return null;
  const w = parseInt(head.slice(0, x), 10);
  const h = parseInt(head.slice(x + 1), 10);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  try {
    return decodeHexPlain(body, w, h);
  } catch {
    return null;
  }
}

export function encodeHexPlain(p: Pattern): string {
  let out = "";
  const cells = p.cells;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c === 0) {
      out += "--";
    } else {
      const [r, g, b, a] = unpackRGBA(c);
      out += hex2(r) + hex2(g) + hex2(b) + hex2(a);
    }
  }
  return out;
}

function decodeHexPlain(s: string, w: number, h: number): Pattern {
  assertDims(w, h);
  const total = w * h;
  const cells = new Uint32Array(total);
  let i = 0;
  let pos = 0;
  if (s.length < total * 2) throw new Error("decodeHexPlain: input too short");
  while (i < total && pos + 2 <= s.length) {
    if (s[pos] === "-" && s[pos + 1] === "-") {
      cells[i] = 0;
      pos += 2;
    } else {
      if (pos + 8 > s.length) throw new Error("decodeHexPlain: truncated cell");
      const r = parseInt(s.slice(pos, pos + 2), 16);
      const g = parseInt(s.slice(pos + 2, pos + 4), 16);
      const b = parseInt(s.slice(pos + 4, pos + 6), 16);
      const a = parseInt(s.slice(pos + 6, pos + 8), 16);
      cells[i] = packRGBA(r, g, b, a);
      pos += 8;
    }
    i++;
  }
  return { width: w, height: h, cells };
}

/** Run-length-decode preset hex. Format per token: `<runLen><color>` where
 * `runLen` is one hex char (0 means 16) and `color` is either `.` for
 * transparent or 6 hex RRGGBB at full alpha. Tokens fill `w*h` cells in order. */
export function decodeHexRuns(s: string, w: number, h: number): Pattern {
  assertDims(w, h);
  const total = w * h;
  const cells = new Uint32Array(total);
  let i = 0;
  let pos = 0;
  while (i < total && pos < s.length) {
    const runChar = s[pos];
    pos++;
    const run = runChar === "." ? 1 : parseInt(runChar, 16) || 16;
    let c: Cell;
    if (s[pos] === ".") {
      c = 0;
      pos++;
    } else {
      const r = parseInt(s.slice(pos, pos + 2), 16);
      const g = parseInt(s.slice(pos + 2, pos + 4), 16);
      const b = parseInt(s.slice(pos + 4, pos + 6), 16);
      c = packRGBA(r, g, b, 255);
      pos += 6;
    }
    const end = Math.min(i + run, total);
    for (let j = i; j < end; j++) cells[j] = c;
    i = end;
  }
  return { width: w, height: h, cells };
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, "0");
}

function assertDims(w: number, h: number): void {
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < 1 ||
    h < 1 ||
    w > MAX_DIM ||
    h > MAX_DIM
  ) {
    throw new RangeError(`Invalid pattern dimensions: ${w}x${h}`);
  }
}