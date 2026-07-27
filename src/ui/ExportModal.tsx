import { useRef, useState } from "preact/hooks";
import { store } from "../state/store.js";
import { superTileDimensions } from "../domain/mirror.js";
import { downloadBlob, exportPatternPng } from "../render/export-png.js";
import { saveToast } from "./toast.js";
import {
  buildSaveBundle,
  parseSaveBundle,
  defaultBundleFilename,
} from "../state/save-export.js";
import type { ImportSource } from "./ImportModal.js";

interface ExportModalProps {
  onClose: () => void;
  /** Called with an `ImportSource` so the App can host the ImportModal.
   * Routing the import-open request through the Export modal keeps the
   * bundle state machine in App.tsx (the only place that owns the
   * ImportModal mount). */
  onOpenImport?: (source: ImportSource) => void;
}

const PRESET_CELL_SCALES: number[] = [2, 4, 8, 16, 24, 32, 48, 64];

/**
 * Output mode.
 *
 * - `single`: the super-tile *once*, scaled by `cellScale`. This is what
 *   OS-level wallpaper tiling expects when the user wants the OS to repeat
 *   the pattern themselves (Windows desktop backgrounds, macOS desktop
 *   pattern mode, etc.). The output canvas is exactly the super-tile's
 *   dimensions × cellScale.
 * - `tile`: the super-tile repeats to fill a chosen output canvas (e.g.
 *   1920×1080 for a fullscreen wallpaper that already has the tiling baked
 *   in). The output dimensions are the chosen preset / custom pair; the
 *   pattern tiles across them via `createPattern('repeat')`.
 */
type Mode = "single" | "tile";

interface SizePreset {
  id: string;
  label: string;
  w: number;
  h: number;
}

const TILE_PRESETS: SizePreset[] = [
  { id: "fhd", label: "1920 × 1080 (FHD)", w: 1920, h: 1080 },
  { id: "qhd", label: "2560 × 1440 (QHD)", w: 2560, h: 1440 },
  { id: "uhd", label: "3840 × 2160 (4K)", w: 3840, h: 2160 },
  { id: "square", label: "1024 × 1024 (square)", w: 1024, h: 1024 },
  // "Screen" preset is computed in render; id reserved here so the buttons
  // array order stays predictable.
];

function detectScreenPreset(): SizePreset {
  const sw = Math.max(1, Math.round(window.screen.width * (window.devicePixelRatio || 1)));
  const sh = Math.max(1, Math.round(window.screen.height * (window.devicePixelRatio || 1)));
  return { id: "screen", label: `Screen (${sw} × ${sh})`, w: sw, h: sh };
}

/** Export the tiled pattern as a PNG at a chosen cell scale. */
export function ExportModal(props: ExportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function onPickImportFile(): void {
    fileInputRef.current?.click();
  }

  function onImportFileChosen(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // RESET the input even if the user cancels, so the same file picked
    // twice in a row still fires `change` on the second click.
    input.value = "";
    if (!file) return;
    void file
      .text()
      .then((text: string) => {
        const result = parseSaveBundle(text);
        if (!result.ok) {
          saveToast(`Import failed: ${result.error}`);
          return;
        }
        props.onOpenImport?.({ bundle: result.bundle, fileName: file.name });
      })
      .catch((e: unknown) => saveToast(`Import failed: ${(e as Error).message}`));
  }

  function onDumpSaveData(): void {
    const bundle = buildSaveBundle(store.snapshot());
    const text = JSON.stringify(bundle, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    downloadBlob(blob, defaultBundleFilename());
    saveToast(`Saved ${bundle.state.slots?.length ?? 0} slots to disk`);
  }
  // The export modal's cell-scale is *bound to* `store.previewCellScale`, not
  // a local copy. Rationale: dragging this slider re-tints the live page
  // background + preview panel in real time, so the user can see how big
  // one cell is about to be in the exported PNG without a separate preview.
  // "What you see is what you get." Whatever cell scale they leave it at
  // when they close the modal persists into the main app, which is what
  // they'd expect from a continuous slider. (Local copy would force them
  // to mentally recompute scale on every drag.)
  const cellScale = store.previewCellScale.value;
  const setCellScale = (n: number) => store.setPreviewCellScale(n);
  const [interpolate, setInterpolate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("single");
  // Default "Tile to size" preset is the user's screen resolution — the
    // operator's preference. detectScreenPreset() reads window.screen so we
    // call it lazily here; this is the value the chip-row will start with.
    const [chosenPresetId, setChosenPresetId] = useState<string>("screen");
  const [customW, setCustomW] = useState(1920);
  const [customH, setCustomH] = useState(1080);
  const [useCustom, setUseCustom] = useState(false);

  const dims = superTileDimensions(
    store.pattern.value.width,
    store.pattern.value.height,
    store.mirrorMode.value,
  );

  const screenPreset = detectScreenPreset();

  // Effective output dims per mode.
  let outW: number, outH: number;
  if (mode === "single") {
    outW = dims.w * cellScale;
    outH = dims.h * cellScale;
  } else if (useCustom) {
    outW = customW;
    outH = customH;
  } else {
    const preset =
      chosenPresetId === "screen"
        ? screenPreset
        : TILE_PRESETS.find((p) => p.id === chosenPresetId) ?? TILE_PRESETS[0];
    outW = preset.w;
    outH = preset.h;
  }

  async function onDownload() {
    setBusy(true);
    try {
      const { blob } = await exportPatternPng(store.pattern.value, store.mirrorMode.value, {
        cellScale,
        interpolate,
        // For `single` mode, undefined → export fn uses tile.width/height
        // (i.e. one super-tile, scaled). For `tile` mode, pass outW/outH.
        outWidth: mode === "single" ? undefined : outW,
        outHeight: mode === "single" ? undefined : outH,
      });
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const dimsTag =
        mode === "single" ? `${dims.w}x${dims.h}@${cellScale}` : `${outW}x${outH}@${cellScale}tiled`;
      downloadBlob(blob, `pixel-pattern-${ts}-${dimsTag}.png`);
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
          The seamless super-tile is {dims.w} × {dims.h} cells.
          One cell = <strong>{cellScale}px</strong> in the output.
        </p>

        <div class="field">
          <label>Output mode</label>
          <div class="toolbar">
            <button
              class="btn"
              aria-pressed={mode === "single"}
              onClick={() => setMode("single")}
              title="Single super-tile — for OS-level wallpaper tiling"
            >
              Single tile
            </button>
            <button
              class="btn"
              aria-pressed={mode === "tile"}
              onClick={() => setMode("tile")}
              title="Pattern repeats to fill the output size — for one-image wallpapers"
            >
              Tile to size
            </button>
          </div>
        </div>

        {mode === "tile" && (
          <>
            <div class="field">
              <label>Output size</label>
              <div class="chip-row">
                {TILE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    class={"chip" + (chosenPresetId === p.id && !useCustom ? " is-active" : "")}
                    onClick={() => {
                      setChosenPresetId(p.id);
                      setUseCustom(false);
                    }}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  class={"chip" + (chosenPresetId === "screen" && !useCustom ? " is-active" : "")}
                  onClick={() => {
                    setChosenPresetId("screen");
                    setUseCustom(false);
                  }}
                  title="Match this screen's full resolution"
                >
                  {screenPreset.label}
                </button>
                <button
                  class={"chip" + (useCustom ? " is-active" : "")}
                  onClick={() => setUseCustom(true)}
                  title="Specify a custom pixel size"
                >
                  Custom
                </button>
              </div>
            </div>
            {useCustom && (
              <div class="row">
                <label>Width</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={String(customW)}
                  onInput={(e) => {
                    const n = parseInt((e.currentTarget as HTMLInputElement).value, 10);
                    if (Number.isFinite(n) && n > 0) setCustomW(n);
                  }}
                  style={{ flex: 1 }}
                />
                <label>Height</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={String(customH)}
                  onInput={(e) => {
                    const n = parseInt((e.currentTarget as HTMLInputElement).value, 10);
                    if (Number.isFinite(n) && n > 0) setCustomH(n);
                  }}
                  style={{ flex: 1 }}
                />
              </div>
            )}
          </>
        )}

        <div class="field">
          <label>Cell size</label>
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
            <input
              type="range"
              min={1}
              max={64}
              step={1}
              value={cellScale}
              onInput={(e) => setCellScale(parseInt((e.currentTarget as HTMLInputElement).value, 10))}
            />
            <span class="value">{cellScale}px</span>
          </div>
        </div>

        <div style={{ fontSize: 12, color: "var(--text-3)" }}>
          Output: {outW} × {outH} px
        </div>

        <label class="checkbox">
          <input
            type="checkbox"
            checked={interpolate}
            onInput={(e) => setInterpolate((e.currentTarget as HTMLInputElement).checked)}
          />
          <span>Bilinear smoothing (pixel-perfect off)</span>
        </label>

        {/* Save-data portability panel — #9 in todo.txt:
              - "Dump save data"   : exports a .pixpat.json file
                                     containing the Savestate (slots, pattern,
                                     view settings, palette) for backup /
                                     transport / migration across devices.
              - "Import save data" : opens an OS file picker; selecting a
                                     previously-dumped bundle hands it to App
                                     so the Import modal opens and lets the
                                     user pick a collision strategy + decide
                                     whether to also apply the imported
                                     pattern / colors / view settings. */}
        <div class="field">
          <label>Save data</label>
          <div class="chip-row">
            <button class="chip" onClick={onDumpSaveData} title="Export your saves + canvas to a portable JSON file">
              Dump save data
            </button>
            <button
              class="chip"
              onClick={onPickImportFile}
              title="Import a previously-dumped .pixpat.json bundle (drag-drop also works)"
            >
              Import save data
            </button>
            {/* Hidden file input — opens the OS file picker on click.
                Doesn't render visibly; loans the click→change plumbing. */}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json,.pixpat.json"
              onChange={onImportFileChosen}
              style={{ display: "none" }}
            />
          </div>
        </div>

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