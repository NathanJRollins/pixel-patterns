import { useSignal } from "@preact/signals";
import { store } from "../state/store.js";
import { PRESETS } from "../domain/presets.js";
import { decodePattern } from "../domain/pattern.js";
import { shareUrlEncode } from "../state/share-url.js";
import { superTileCanvas } from "../render/super-tile-canvas.js";
import { saveToast } from "./toast.js";
import { ContextMenu, type MenuItem } from "./ContextMenu.js";
import type { Preset, MirrorMode } from "../domain/types.js";

// Pre-rendered preset thumbnails (computed once at module load so the chips
// can render immediately on first paint).
const PRESET_THUMBS: Record<string, string> = bakePresetThumbs();

/**
 * Curated preset patterns, displayed as a row of chips the user can apply
 * with one click. Each chip shows the seamless-super-tile preview, so
 * the user hint of how the preset tiles is upfront.
 *
 * Right-click a chip (#10 in todo.txt) → context menu: Load, Copy share
 * URL.
 */
export function PresetsBar() {
  const menu = useSignal<{ x: number; y: number; preset: Preset } | null>(null);

  return (
    <div class="dock">
      <div class="dock-title">Presets</div>
      <div class="chip-row">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            class="chip"
            title={`Load preset: ${p.label} — right-click for more`}
            onClick={() => {
              store.applyPreset(p.id);
              saveToast(`Loaded "${p.label}"`);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              menu.value = { x: e.clientX, y: e.clientY, preset: p };
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
      {menu.value && (
        <ContextMenu
          x={menu.value.x}
          y={menu.value.y}
          items={buildPresetMenuItems(menu.value.preset)}
          onClose={() => (menu.value = null)}
        />
      )}
    </div>
  );
}

function buildPresetMenuItems(p: Preset): MenuItem[] {
  return [
    {
      label: "Load",
      title: `Apply preset "${p.label}"`,
      onClick: () => {
        store.applyPreset(p.id);
        saveToast(`Loaded "${p.label}"`);
      },
    },
    {
      label: "Copy share URL",
      title: "Copy a share link to the clipboard",
      onClick: () => copyShareUrlForPreset(p),
    },
  ];
}

function copyShareUrlForPreset(p: Preset): void {
  const decoded = decodePattern(`${p.width}x${p.height}:${p.cells}`);
  if (!decoded) {
    saveToast("Could not build URL");
    return;
  }
  const hash = shareUrlEncode({
    pattern: decoded,
    mode: p.mode as MirrorMode,
    color: store.primaryColor.value,
    alpha01: store.primaryAlpha01.value,
    secondaryColor: store.secondaryColor.value,
    secondaryAlpha01: store.secondaryAlpha01.value,
    activeColorSlot: store.activeColorSlot.value,
  });
  const full = `${location.origin}${location.pathname}${location.search}${hash}`;
  void writeClipboard(full);
}

async function writeClipboard(text: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      saveToast("Share URL copied");
      return;
    }
  } catch {
    // Fall through to the legacy execCommand path.
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    ta.remove();
    saveToast("Share URL copied");
  } catch {
    saveToast("Copy failed — clipboard blocked");
  }
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