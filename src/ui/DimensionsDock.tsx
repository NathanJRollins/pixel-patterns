import { store } from "../state/store.js";
import { MAX_DIM } from "../domain/pattern.js";
import type { Signal } from "@preact/signals";

/**
 * Dimensions dock: pattern width/height, preview cell scale, page-bg scale,
 * and page-bg / grid / mirror-axis toggles. Includes odd/even indicators on
 * the dimension sliders — odd values allow more pleasingly round shapes and
 * tighter mirror joins, an old TODO idea we keep.
 */
export function DimensionsDock() {
  const odd = (n: number) => n % 2 === 1;

  return (
    <div class="dock">
      <div class="dock-title">Dimensions</div>
      <SliderRow
        label="Width"
        value={store.pattern.value.width}
        min={1}
        max={MAX_DIM}
        step={1}
        onChange={(n) => store.setDimensions(n, store.pattern.value.height)}
        badge={odd(store.pattern.value.width) ? <Odd /> : <Even />}
      />
      <SliderRow
        label="Height"
        value={store.pattern.value.height}
        min={1}
        max={MAX_DIM}
        step={1}
        onChange={(n) => store.setDimensions(store.pattern.value.width, n)}
        badge={odd(store.pattern.value.height) ? <Odd /> : <Even />}
      />
      <SliderRow
        label="Cell size"
        value={store.previewCellScale.value}
        min={1}
        max={32}
        step={1}
        onChange={(n) => store.setPreviewCellScale(n)}
        badge={<span class="value">{store.previewCellScale.value}px</span>}
      />
      <SliderRow
        label="Page scale"
        value={store.bgScale.value}
        min={1}
        max={32}
        step={1}
        onChange={(n) => store.setBgScale(n)}
        badge={<span class="value">{store.bgScale.value}px</span>}
      />

      <div class="dock-title" style={{ marginTop: 6 }}>
        View
      </div>
      <ToggleRow
        label="Page background"
        signal={store.showPageBg}
        onChange={(b) => store.setShowPageBg(b)}
      />
      <ToggleRow
        label="Grid lines"
        signal={store.showGridLines}
        onChange={(b) => store.setShowGridLines(b)}
      />
      {/* Mirror-axis toggle moved up to the Toolbar, next to the mirror-mode
          buttons — keeps all the mirror-related controls in one place. */}
    </div>
  );
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  badge?: preact.JSX.Element | null;
}

function SliderRow(props: SliderRowProps) {
  return (
    <div class="row">
      <label>{props.label}</label>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onInput={(e) => props.onChange(parseInt((e.currentTarget as HTMLInputElement).value, 10))}
      />
      <span class="value">{props.value}</span>
      {props.badge}
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  signal: Signal<boolean>;
  onChange: (v: boolean) => void;
}

function ToggleRow(props: ToggleRowProps) {
  return (
    <label class="checkbox">
      <input
        type="checkbox"
        checked={props.signal.value}
        onInput={(e) => props.onChange((e.currentTarget as HTMLInputElement).checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

function Odd() {
  return <span class="odd-even-mark is-odd">odd</span>;
}
function Even() {
  return <span class="odd-even-mark">even</span>;
}