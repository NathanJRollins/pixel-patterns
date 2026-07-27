import type { Savestate } from "./store.js";

/**
 * Save-bundle format for export / import (#9 in todo.txt).
 *
 * A "bundle" is a small envelope around the autosave-shaped {@link Savestate}
 * that adds a stable ``kind`` discriminator and its own ``version`` field
 * (independent of the autosave's internal ``SAVE_STATE_VERSION`` — the
 * Savestate carries its *own* version too; the bundle's version tracks
 * the *wrapper shape*). This separates "the file format" from "the
 * Savestate schema", so we can rename an envelope field (or add a second
 * Savestate arm) without forcing the autosave migration chain forward.
 *
 * Format overview (current v1):
 *
 *   {
 *     "kind":        "pixel-patterns/save",
 *     "version":     1,
 *     "exportedAt":  "2026-07-25T09:38:14.000Z",
 *     "state":       Savestate   ← same shape localStorage persists
 *   }
 *
 * The ``state`` itself is {@link migrateSavestate}-aware — when we apply
 * an imported bundle, the Savestate is walked through the same migration
 * ladder the autosave walks through, so a returning user importing a
 * bundle saved by an older build still restores gracefully.
 *
 * Top-level ``version`` is bumped ONLY when we rename / reinterpret an
 * envelope field. Bumping the Savestate schema (see
 * `SAVE_STATE_VERSION`) is independent and does NOT require a bundle
 * bump — the Savestate's own ``version`` field does the work.
 */

export const BUNDLE_KIND = "pixel-patterns/save";
export const BUNDLE_VERSION = 1;

export interface SaveBundle {
  /** Constant discriminator: `pixel-patterns/save`. */
  kind: string;
  /** Bundle format version (independent of the Savestate's `version`). */
  version: number;
  /** ISO timestamp when the bundle was exported (for human reference). */
  exportedAt: string;
  /** The Savestate payload (carries its own per-record `version`). */
  state: Savestate;
}

/** Build a bundle for export from an existing Savestate. */
export function buildSaveBundle(s: Savestate): SaveBundle {
  // `new Date().toISOString()` could throw in some sandboxes; fall back
  // to an empty string and let the rest of the bundle carry the day.
  let exportedAt = "";
  try {
    exportedAt = new Date().toISOString();
  } catch {
    exportedAt = "";
  }
  return {
    kind: BUNDLE_KIND,
    version: BUNDLE_VERSION,
    exportedAt,
    state: s,
  };
}

export type ParseResult = ParseOk | ParseFailed;

export interface ParseOk {
  ok: true;
  bundle: SaveBundle;
}
export interface ParseFailed {
  ok: false;
  error: string;
}

/**
 * Parse and validate an import candidate. Strict — the ``kind``
 * discriminator MUST match exactly, the envelope ``version`` MUST be a
 * supported value, and the ``state`` field MUST be an object. We
 * validate the wrapper here and leave the Savestate contents to the
 * downstream ``Store.restore`` / ``migrateSavestate`` path's defensive
 * read-side conditionals. On any envelope problem, we return a
 * ParseFailed with a human-readable reason suitable for a toast / modal
 * line; we never throw here.
 */
export function parseSaveBundle(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${(e as Error).message}` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Top-level value is not an object" };
  }
  const p = parsed as Record<string, unknown>;
  if (p["kind"] !== BUNDLE_KIND) {
    return {
      ok: false,
      error: `Missing \`kind\` field — expected "${BUNDLE_KIND}" (got "${String(p["kind"])}").`,
    };
  }
  if (typeof p["version"] !== "number" || !Number.isFinite(p["version"])) {
    return { ok: false, error: "Missing or non-numeric `version` field" };
  }
  if (p["version"] > BUNDLE_VERSION) {
    return {
      ok: false,
      error: `Bundle version ${p["version"]} is newer than this build supports (${BUNDLE_VERSION}). Export from a newer build, or update pixel-patterns.`,
    };
  }
  if (!p["state"] || typeof p["state"] !== "object" || Array.isArray(p["state"])) {
    return { ok: false, error: "Missing `state` object" };
  }
  return { ok: true, bundle: p as unknown as SaveBundle };
}

/** Suggested file extension for SaveBundles on disk. */
export const SAVE_BUNDLE_EXTENSION = ".pixpat.json";

/** Default filename for an exported bundle (callers can override). */
export function defaultBundleFilename(prefix = "pixel-patterns"): string {
  // YYYYMMDD-HHMMSS prefix on disk so multiple exports can stack visually
  // without overwriting one another.
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${prefix}-${ts}${SAVE_BUNDLE_EXTENSION}`;
}