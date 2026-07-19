import { cellAlpha01, cellToCss, cellToHex, unpackRGBA } from "../domain/color.js";
import { store } from "../state/store.js";
import { saveToast } from "./toast.js";
import type { ColorSlot } from "../domain/types.js";

/**
 * Color picker + alpha + recent swatches. The HTML5 `<input type="color">`
 * doesn't itself carry an alpha channel, so alpha is a separate slider.
 *
 * Two color slots (MSPaint-style primary / secondary):
 *   - The double-square at the top shows both slots overlapping. Click the
 *     front square → active slot = primary. Click the back square →
 *     active slot = secondary. The active slot is what the picker / alpha
 *     / recents / palette bind to.
 *   - LMB click on a recent / palette swatch fills the *active* slot.
 *   - RMB click on a swatch fills the *inactive* slot directly, leaving
 *     the active slot untouched. Touch long-press on a swatch also fills
 *     the inactive slot (since touch users have no RMB).
 *   - `X` swaps primary ↔ secondary.
 *
 * Recents model (unchanged from prior v2 polish):
 *   - Recents are RGB-only — alpha is governed per-slot. The same hue at
 *     two different alphas shares one recents entry.
 */
export function ColorDock() {
  // Read per-slot state so the dock re-renders when either slot changes.
  const primaryHex = cellToHex(store.primaryColor.value) || DEFAULT_HEX;
  const secondaryHex = cellToHex(store.secondaryColor.value) || "#ffffff";
  const activeSlot = store.activeColorSlot.value;
  // HTML picker binds to the *active* slot's hex+alpha.
  const activeHex = activeSlot === "primary" ? primaryHex : secondaryHex;
  const activeColor = activeSlot === "primary" ? store.primaryColor.value : store.secondaryColor.value;
  const activeAlpha01 = activeSlot === "primary" ? store.primaryAlpha01.value : store.secondaryAlpha01.value;
  const activeCssColor = cellToCss(activeColor);

  return (
    <div class="dock">
      <div class="dock-title">Color</div>

      {/* MSPaint-style double-square: front = primary, back = secondary.
          Click either one to make it the active slot. The active square
          gets a ring + raises above the inactive one. */}
      <div class="color-square-wrap" onMouseDown={(e) => e.stopPropagation()}>
        <button
          class={"color-square color-square-back" + (activeSlot === "secondary" ? " is-active" : "")}
          title="Secondary color — Right-click swatches to fill"
          onClick={() => store.setActiveColorSlot("secondary")}
          aria-pressed={activeSlot === "secondary"}
        >
          <div class="swatch-fill" style={{ background: cellToCss(store.secondaryColor.value) }} />
        </button>
        <button
          class={"color-square color-square-front" + (activeSlot === "primary" ? " is-active" : "")}
          title="Primary color — Left-click swatches to fill"
          onClick={() => store.setActiveColorSlot("primary")}
          aria-pressed={activeSlot === "primary"}
        >
          <div class="swatch-fill" style={{ background: cellToCss(store.primaryColor.value) }} />
        </button>
        <button
          class="color-square-swap"
          title="Swap primary ↔ secondary  (X)"
          onClick={() => store.swapColors()}
          aria-label="Swap colors"
        >
          ⇄
        </button>
      </div>

      <div class="row">
        <input
          type="color"
          value={activeHex}
          onInput={(e) => {
            // Live preview — no recent-push (picker drags one colour per
            // pixel which would wipe the recents list).
            store.setHex((e.currentTarget as HTMLInputElement).value);
          }}
          onChange={(e) => {
            // Release → commit the colour to recents.
            store.setHex((e.currentTarget as HTMLInputElement).value);
            store.commitRecent();
          }}
          aria-label={`Pick ${activeSlot} color`}
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
            <div class="swatch-fill" style={{ background: activeCssColor }} />
          </div>
          <code style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-2)" }}>
            {activeHex.slice(1)} · {Math.round(activeAlpha01 * 100)}%
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
          value={activeAlpha01}
          onInput={(e) => store.setAlpha01(parseFloat((e.currentTarget as HTMLInputElement).value))}
        />
        <span class="value">{Math.round(activeAlpha01 * 100)}%</span>
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
              // Display at the *active* slot's current alpha, so the recents
              // panel re-tints in lockstep with the alpha slider.
              const displayCss = `rgba(${r},${g},${b},${activeAlpha01.toFixed(4)})`;
              const isCurrent =
                ((activeColor >>> 8) & 0xffffff) === ((c >>> 8) & 0xffffff);
              return (
                <SwatchButton
                  key={i}
                  css={displayCss}
                  title={`${cellToHex(c)} — LMB fills ${activeSlot}; RMB fills ${otherSlot(activeSlot)}`}
                  onPickActive={() => store.pickSwatch(c)}
                  onPickInactive={() => store.pickSwatch(c, otherSlot(activeSlot))}
                  isActive={isCurrent}
                />
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div class="dock-title">Palette</div>
        <div class="swatches">
          {BUILTIN_PALETTE.map((h) => (
            <SwatchButton
              key={h}
              css={h}
              title={`${h} — LMB fills ${activeSlot}; RMB fills ${otherSlot(activeSlot)}`}
              onPickActive={() => {
                store.setHex(h);
                store.commitRecent();
                saveToast(`Color: ${h}`);
              }}
              onPickInactive={() => store.setHex(h, otherSlot(activeSlot))}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A swatch button. LMB click → calls `onPickActive` (fills the active slot).
 * RMB click → calls `onPickInactive` (fills the inactive slot directly,
 * leaving the active slot untouched). Touch long-press → calls
 * `onPickInactive` (touch users have no RMB, so this is their path to
 * setting the secondary). Plain touch tap → `onPickActive`.
 */
function SwatchButton(props: {
  css: string;
  title: string;
  isActive?: boolean;
  onPickActive: () => void;
  onPickInactive: () => void;
}) {
  const longPressTimer: { current: ReturnType<typeof setTimeout> | null } = { current: null };
  const startPt: { current: { x: number; y: number } | null } = { current: null };
  const LONG_PRESS_MS = 450;
  const SLACK_PX = 10;

  function clearLongPress(): void {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.pointerType === "touch") {
      clearLongPress();
      startPt.current = { x: e.clientX, y: e.clientY };
      longPressTimer.current = setTimeout(() => {
        longPressTimer.current = null;
        // Long-press on swatch → fill the inactive slot.
        props.onPickInactive();
        saveToast(`Color → ${otherSlot(store.activeColorSlot.value)}`);
      }, LONG_PRESS_MS);
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (longPressTimer.current && startPt.current) {
      const dx = e.clientX - startPt.current.x;
      const dy = e.clientY - startPt.current.y;
      if (Math.hypot(dx, dy) > SLACK_PX) clearLongPress();
    }
  }

  function onPointerUp(): void {
    clearLongPress();
    startPt.current = null;
  }

  function onMouseDown(e: MouseEvent): void {
    if (e.button === 2) {
      e.preventDefault();
      props.onPickInactive();
    }
  }

  return (
    <button
      class={"swatch" + (props.isActive ? " is-active" : "")}
      title={props.title}
      onClick={props.onPickActive}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onMouseDown={onMouseDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div class="swatch-fill" style={{ background: props.css }} />
    </button>
  );
}

function otherSlot(slot: ColorSlot): ColorSlot {
  return slot === "primary" ? "secondary" : "primary";
}

const DEFAULT_HEX = "#cc33cc";

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
// Keep imports warm.
void cellAlpha01;