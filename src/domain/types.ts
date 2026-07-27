/**
 * Foundational types for the pixel-patterns domain.
 *
 * A {@link Pattern} is the user's drawn grid of pixels.
 * A {@link Cell} is a single packed RGBA color value; the sentinel `0`
 * denotes "transparent" (no pixel placed). All other values are visible
 * colors with non-zero alpha. Domain helpers guarantee that any cell with
 * alpha === 0 is normalised to `0`, so `cell !== 0` is the canonical "is
 * a pixel placed here" check everywhere.
 */

/** Packed RGBA color; `0` is the transparent sentinel. */
export type Cell = number;

export type MirrorMode = "none" | "H" | "V" | "HV";

export type Tool = "pencil" | "eraser" | "bucket" | "line" | "dropper";

/** Which of the two paint colour slots an action affects. LMB paints
 * primary, RMB paints secondary. Most paint actions accept a `which`
 * parameter (default 'primary') so the caller can route a right-button
 * stroke to the secondary slot's colour. */
export type ColorSlot = "primary" | "secondary";

export interface Pattern {
  readonly width: number;
  readonly height: number;
  /** Length = `width * height`, row-major: index = `y * width + x`. */
  readonly cells: Uint32Array;
}

export type Theme = "light" | "dark";

/** A preset pattern entry; stored compactly so the source stays readable. */
export interface Preset {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly mode: MirrorMode;
  /** Plain hex-encoded cells (`decodeHexPlain`): `--` or `RRGGBBAA` per cell. */
  readonly cells: string;
}