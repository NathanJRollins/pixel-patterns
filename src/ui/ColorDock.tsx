import { cellAlpha01, cellToCss, cellToHex, unpackRGBA } from "../domain/color.js";
import { store } from "../state/store.js";
import { saveToast } from "./toast.js";

/**
 * Color picker + alpha + recent swatches. The HTML5 `<input type="color">`
 * doesn't itself carry an alpha channel, so alpha is a separate slider.
 *
 * Recents & current-alpha model:
 *   - The recents panel stores RGB only — alpha is global to the brush
 *     (governed by the alpha slider). Two picks of the same hue at two
 *     different alphas share one recents entry.
 *   - Recents *display* at the current alpha, so dragging the alpha slider
 *     re-tints every recent swatch in lockstep with the main colour preview.
 *     This is the "ideal way to operate" the operator's UX note asked for.
 *   - Clicking a recent swatch keeps the current alpha; only the RGB is
 *     picked onto the brush.
 *   - The HTML5 color picker fires `input` continuously while the user
 *     drags; that's a live preview path and does NOT push to recents. The
 *     `change` event fires when the picker is released → that's the moment
 *     we commit the colour to recents. (Otherwise dragging the picker
 *     wipes the recents list in one stroke.)
 */
export function ColorDock() {
  const hex = cellToHex(store.color.value) || "#cc33cc";
  const cssColor = cellToCss(store.color.value);
  const alpha01 = store.alpha01.value;

  return (
    <div class="dock">
      <div class="dock-title">Color</div>
      <div class="row">
        <input
          type="color"
          value={hex}
          onInput={(e) => {
            // Live preview as the user drags through the spectrum — no
            // recent-push (that would wipe 1 swatch per drag-pixel).
            store.setHex((e.currentTarget as HTMLInputElement).value);
          }}
          onChange={(e) => {
            // User released the picker — commit this colour to recents.
            store.setHex((e.currentTarget as HTMLInputElement).value);
            store.commitRecent();
          }}
          aria-label="Pick color"
        />
        <div class="overlay-strip" aria-hidden="true">
          <div
            class="swatch"
            style={{
              width: "32px",
              height: "32px",
              border: "1px solid var(--border-strong)",
              position: "relative",
              background: `
                linear-gradient(45deg, var(--checker-a) 25%, transparent 25%, transparent 75%, var(--checker-a) 75%) 0 0/8px 8px,
                linear-gradient(45deg, var(--checker-a) 25%, transparent 25%, transparent 75%, var(--checker-a) 75%) 4px 4px/8px 8px
              `,
            }}
          >
            <div class="swatch-fill" style={{ background: cssColor }} />
          </div>
          <code style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-2)" }}>
            {hex.slice(1)} · {Math.round(cellAlpha01(store.color.value) * 100)}%
          </code>
        </div>
      </div>
      <div class="row">
        <label>Opacity</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={store.alpha01.value}
          onInput={(e) => store.setAlpha01(parseFloat((e.currentTarget as HTMLInputElement).value))}
        />
        <span class="value">{Math.round(store.alpha01.value * 100)}%</span>
      </div>
      <div>
        <div class="dock-title" style={{ marginTop: 4 }}>
          Recent
        </div>
        {store.recentCells.value.length === 0 ? (
          <div class="list-empty">No colors yet — pick one to start.</div>
        ) : (
          <div class="swatches">
            {store.recentCells.value.map((c, i) => {
              const [r, g, b] = unpackRGBA(c);
              // Display at current alpha so the recents panel re-tints in
              // lockstep with the alpha slider.
              const displayCss = `rgba(${r},${g},${b},${alpha01.toFixed(4)})`;
              const isCurrent =
                ((store.color.value >>> 8) & 0xffffff) === ((c >>> 8) & 0xffffff);
              return (
                <button
                  key={i}
                  class={"swatch" + (isCurrent ? " is-active" : "")}
                  title={`${cellToHex(c)} (at current opacity)`}
                  onClick={() => store.pickSwatch(c)}
                >
                  <div class="swatch-fill" style={{ background: displayCss }} />
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div>
        <div class="dock-title">Palette</div>
        <div class="swatches">
          {BUILTIN_PALETTE.map((h) => (
            <button
              class="swatch"
              key={h}
              title={h}
              onClick={() => {
                store.setHex(h);
                store.commitRecent();
                saveToast(`Color: ${h}`);
              }}
            >
              <div class="swatch-fill" style={{ background: h }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const BUILTIN_PALETTE: string[] = [
  "#000000",
  "#1a1a1a",
  "#ffffff",
  "#cc33cc",
  "#ff6188",
  "#2196ff",
  "#21d4fd",
  "#99ffcd",
  "#fff18f",
  "#fdca40",
  "#ff7f50",
  "#8a5ca2",
  "#52b788",
  "#ef4444",
];