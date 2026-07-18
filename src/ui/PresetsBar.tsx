import { store } from "../state/store.js";
import { PRESETS } from "../domain/presets.js";
import { decodePattern } from "../domain/pattern.js";
import { superTileCanvas } from "../render/super-tile-canvas.js";
import { saveToast } from "./toast.js";

// Pre-rendered preset thumbnails (computed once at module load so the chips
// can render immediately on first paint).
const PRESET_THUMBS: Record<string, string> = bakePresetThumbs();

/**
 * Curated preset patterns, displayed as a row of chips the user can apply
 * with one click. Each chip shows the seamless-super-tile preview, so the
 * picker instantly hints at how the preset tiles.
 */
export function PresetsBar() {
  return (
    <div class="dock">
      <div class="dock-title">Presets</div>
      <div class="chip-row">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            class="chip"
            title={`Load preset: ${p.label}`}
            onClick={() => {
              store.applyPreset(p.id);
              saveToast(`Loaded "${p.label}"`);
            }}
          >
            <img
              src={PRESET_THUMBS[p.id] || ""}
              alt=""
              class="chip-thumb"
              width={30}
              height={30}
            />
            <span class="chip-label">{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function bakePresetThumbs(): Record<string, string> {
  const out: Record<string, string> = {};
  const target = 32;
  for (const p of PRESETS) {
    const decoded = decodePattern(`${p.width}x${p.height}:${p.cells}`);
    if (!decoded) continue;
    const tile = superTileCanvas(decoded, p.mode, 1);
    const scale = Math.max(1, Math.floor(target / Math.max(tile.width, tile.height)));
    const scaled = superTileCanvas(decoded, p.mode, scale);
    const canvas = document.createElement("canvas");
    canvas.width = target;
    canvas.height = target;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      scaled,
      Math.floor((target - scaled.width) / 2),
      Math.floor((target - scaled.height) / 2),
    );
    out[p.id] = canvas.toDataURL("image/png");
  }
  return out;
}