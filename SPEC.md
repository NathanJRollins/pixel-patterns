# pixel-patterns — Redesign Spec

> A tool for drawing tiny pixel patterns that tile seamlessly across the whole page.

This document is the design contract for the rewrite that replaced the original `script.js` / `index.html` / `style.css` with a typed, modular codebase. Later revisions (v2 / v3 / v4 / v5 polish passes) are captured in §13.

---

## 1. What this app *is*

A single-page web tool where you:

1. Paint a small pixel grid (e.g. 8 × 8 cells).
2. Pick a **mirror mode** that makes the pattern **seamlessly tile** by construction.
3. Watch the seamless tile repeat across the entire page background **in real time** — every stroke lands live, everywhere.
4. Save your work, share it via URL, or export a PNG at any size.

The whole experience is built around one central idea: **mirror painting guarantees a seamless tile**. That idea turns the original app — a slow sketchpad where seamless output was never the user's guarantee — into a tool whose default output is *always* clean.

---

## 2. The central concept: seamless mirror painting

A pattern you draw may tile with ugly seams. To guarantee a *seamless* tile, the tool assembles your drawn grid into a larger **seamless super-tile** that is mirror-symmetric:

- **Mirror mode `none`** — no mirroring. The drawn grid is the tile as-is; seamless output is up to you.
- **Mirror mode `H`** (horizontal) — super-tile is `cols × 2·rows`: drawn grid above, vertically-flipped grid below.
- **Mirror mode `V`** (vertical) — super-tile is `2·cols × rows`: drawn grid on the left, horizontally-flipped grid on the right.
- **Mirror mode `HV`** (both) — super-tile is `2·cols × 2·rows`: the four-way-reflected quadrant arrangement.

Because the super-tile's opposite edges are mirror images, **any grid drawn under a mirror mode tiles seamlessly**. The user always sees this in the preview: the page background tiles the super-tile, every edge meets its mirror twin, and seams disappear by construction.

This idea is the highest-leverage feature. It makes "pixel-patterns" actually about *patterns* — by default, the app produces them.

#### What the user sees

- **The draw grid** shows the user's `cols × rows` cells, with optional in-grid preview lines indicating the mirror axis (subtle, dimmer than the cell grid).
- **The preview panel** tiles the **seamless super-tile** at a chosen cell zoom.
- **The whole page background** tiles the same super-tile at real 1:1 size (configurable; toggleable), giving the user a full-bleed view of what they're making.

---

## 3. Tech stack

- **TypeScript** — type safety for the pattern/color/persistence/encoding math; this app has plenty of off-by-one waiting to leak.
- **Vite** — dev server with HMR, fast build, `base: '/pixel-patterns/'` so the static build lands at the same GitHub Pages URL the original serves.
- **Preact + `@preact/signals`** — a ~3 KB reconciler keeps the "Vanilla JS" spirit alive while letting us write component UI for tools, color, slots, presets, export, share, etc. `@preact/signals` for fine-grained reactive state without repaints.
- **No CSS framework.** Hand-rolled CSS with design tokens (CSS custom properties). Light/dark themes. The whole stylesheet should be a few hundred lines of intent.
- **No runtime backend.** 100% client-side. localStorage for state, URL hash for sharing.

The original repo was a single `script.js`. We're trading the romantic one-fileliness for a tidy module tree so we can keep adding features without re-explaining ourselves.

```
src/
  main.tsx                     — app entry, mounts <App/>, runs initial load
  state/
    store.ts                   — signals-based central state (single source of truth)
    persistence.ts             — localStorage save / load / autosave
    share-url.ts               — compact encode/decode of state into URL hash
  domain/
    pattern.ts                 — Pattern type, ops (set, fill, clear, resize-keeping)
    color.ts                   — RGBA helpers, HEX parsing, blend
    mirror.ts                  — mirror super-tile composition from pattern + mode
    tools.ts                   — tool behaviors: pencil, eraser, bucket, line, dropper
    history.ts                 — undo/redo stack of pattern snapshots
    randomize.ts               — biased random seamless pattern generator
    presets.ts                 — hand-curated preset patterns
  render/
    pattern-canvas.ts          — render base pattern to a small offscreen canvas
    super-tile-canvas.ts       — compose mirrored super-tile to an offscreen canvas
    preview-render.ts          — drawPanel: tiled preview via createPattern, one fillRect
    draw-grid-render.ts        — canvas for the input grid (cells + gridlines + mirror axis)
    favicon.ts                 — live favicon from current super-tile
    page-bg.ts                 — set page `<body>` background to tiled super-tile
    export-png.ts              — render at chosen output size + zoom → Blob → download
  ui/
    App.tsx                    — top-level layout
    Toolbar.tsx                — tools, mirror-mode segmented control, undo/redo, clear
    DrawPanel.tsx              — wraps the input grid canvas + pointer handling
    PreviewPanel.tsx           — wraps the preview canvas
    ColorDock.tsx              — color picker, alpha, recent colors, palette swatches
    DimensionsDock.tsx         — width/height sliders, cell-size slider, zoom slider
    SaveSlots.tsx              — named slots in localStorage with preview thumbnails
    Presets.tsx                — one-click load curated examples
    ShareModal.tsx             — copy URL with encoded state
    ExportModal.tsx            — pick size + zoom, download PNG
    SettingsDrawer.tsx         — save-state toggle, uiconfig toggle, page-bg toggle, theme
  styles/
    tokens.css                 — design tokens (colors, spacing, radii, fonts)
    app.css                    — layout
    components.css             — component-level styles
index.html
package.json
tsconfig.json
vite.config.ts
```

---

## 4. Domain model

### 4.1 `Pattern`

```ts
type Cell = number;          // packed RGBA: (r<<24)|(g<<16)|(b<<8)|a, 0 = transparent
type Pattern = {
  width:  number;            // cols
  height: number;            // rows
  cells:  Uint32Array;       // length = width * height, row-major (y * width + x)
};
```

- Packed `Uint32Array` — tiny, fast, easy to serialize (a few bytes per stroke delta), trivial to view in DevTools.
- `0` denotes transparency; non-zero cells store pre-multiplied-already-NO, straight alpha. Final `putImageData` / canvas routines unpack to RGBA bytes.

### 4.2 `Color` helpers

- `hexToCell(hex, alpha)` and `cellToHex(cell)` for the picker.
- `blendCell(dst, src, alpha)` if paint modes later use transparency merging — v1 keeps alpha as "replace or leave" (the original's "click same color to erase" → replace semantics).

### 4.3 `Mirror` modes

```ts
type MirrorMode = 'none' | 'H' | 'V' | 'HV';
function composeSuperTile(pattern: Pattern, mode: MirrorMode): Pattern;
//   none → pattern as-is
//   H    → width, height*2 with second half = first half vertically flipped
//   V    → width*2, height
//   HV   → width*2, height*2 four-way symmetric
```

The super-tile is what gets tiled. All rendering and export go through the super-tile.

### 4.4 Tools

Five tools. Mirroring applies to all of them.

- **Pencil** — paint clicked/dragged cells with current color. Drag between cells intersects the cell grid (Bresenham between last and current cell so fast drags don't skip cells).
- **Eraser** — same, but writes transparent.
- **Bucket** — flood fill contiguous region of the same color with the current color.
- **Line** — shift+drag = a line from anchor to cursor (live preview; commits on release).
- **Dropper** — sample color under cursor into the color picker.

Stroke semantics: drag continues to draw/erase (the original's "first cell determines draw-vs-erase" → replaced with explicit tool selection; no surprises). A **stroke** is the sequence of mutations between `pointerdown` and `pointerup`. `history.push()` snapshots at stroke end only.

### 4.5 History

- Snapshot is the entire `Pattern.cells` (a `Uint32Array` copy — small).
- Cap history to **64 snapshots**. Older snapshots drop off; if memory pressure becomes real we can compress, but 64 × 32×32 × 4B = 256 KB per pattern is nothing.
- `Ctrl/Cmd+Z` undo; `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` redo.

### 4.6 Randomize

One click generates a *starter* pattern. Heuristics:

- Limited palette (2–4 colors drawn from a curated list, or sampled from current recent colors).
- Sparse density (~30% of cells filled).
- Sparse clustered blobs, or short line strokes.
- Always default mirror mode set to `HV` so the result is seamless out of the box.
- Determinism via a `seed` string so the same seed → the same pattern.

### 4.7 Presets

A small curated set (8–12) of cool seamless patterns. Each preset stores `{ width, height, mode, cells }`. Example: a checkerboard, a brick wall, a Celtic-knot-ish thing, a wave, a couple of vines. Stored as packed hex strings for compactness in the source.

---

## 5. Rendering

The original app's display panel redraws each visible pixel with a separate `fillRect`. At 500 × 500 and 1× zoom that's **250,000 fillRects per frame**. On a drag, that happens repeatedly — the author knew this was bad (see `script.js` line ~322 "XXX: Optimise this").

We fix it properly with one Canvas2D primitive every browser has been optimizing for a decade:

### 5.1 Preview panel — `createPattern()` + one `fillRect`

```
1. Render the seamless super-tile to a tiny offscreen canvas,
   sized (superWidth × cellScale) by (superHeight × cellScale).
   cellScale controls the on-screen size of one cell. Default 8 px.
2. ctx.createPattern(superTileCanvas, 'repeat') → Pattern object.
3. ctx.fillStyle = pattern; ctx.fillRect(0, 0, W, H).
4. Done. Browser tiles it natively at GPU speed.
```

Redraw cost is **O(superWidth·superHeight·cellScale²)** to build the small canvas, then *constant* for the fill — independent of the preview canvas size. Recompose the super-tile canvas only when the pattern *or* mirror mode changes; recreate the `createPattern` object only when the cell-scale changes. Typical numbers: an 8-cell pattern with `HV` mirror is a 16 × 16 super-tile; at cellScale 8, that's a 128 × 128 offscreen canvas. Tiling that across a 1080p preview panel = one fill. Frame budget: indistinguishable from zero.

Crispness:

- `ctx.imageSmoothingEnabled = false` on the offscreen and on the preview.
- Canvas internal resolution scaled to `devicePixelRatio`.
- CSS `image-rendering: pixelated` on the preview canvas (browser-perfect).

### 5.2 Draw grid

- Internal resolution = `devicePixelRatio × CSS px size`.
- Each cell rendered as a `cellPx × cellPx` rect.
- Grid line overlay at cell boundaries (1 device pixel, alpha 0.5, theme-aware color).
- Mirror axis overlay at the appropriate `cols/2` / `rows/2` position(s), drawn slightly heavier than gridlines so the user sees what "seamless" means, but never bold.
- Hover indicator cell outline (1 device pixel).
- Pointer math returns cell `(x, y)`; Bresenham bridges drag jumps; mirror mode mirrors each touched cell.

### 5.3 Favicon (live)

- On every stroke end, render the seamless super-tile at 32 × 32 (or `superWidth ×superHeight`, whichever smaller) to an offscreen canvas, `toDataURL('image/png')`, and set `<link rel="icon" href=...>`.
- The tab badge becomes the user's current pattern. Delightful and free.

### 5.4 Page background (live)

- Same data URL → `document.body.style.backgroundImage = url(...)`.
- `background-size` set to `(superWidth × bgScale)px (superHeight × bgScale)px` so the user controls the page-scale of the tile.
- Toggleable from settings. Default **on** — it's the centerpiece of the redesign's "wow".

### 5.5 PNG export

- Build an offscreen canvas at `(targetWidth × targetHeight)` where the cell scale is `cellScale × zoomFactor`.
- `createPattern` + `fillRect`.
- Optional checkbox: *interpolate* (apply bilinear smoothing on export, for those who want the smooth look). Default off — pixel-perfect.
- Preset sizes: 16, 32, 64, 128, 256, 512, 1024, 2048, screen resolution (`window.screen.width ×height × devicePixelRatio`), and a custom input.
- Output filename: `pixel-pattern-<timestamp>-<w>x<h>.png`.

---

## 6. State & persistence

### 6.1 Central store

A single `store.ts` exposes a `state` object backed by Preact signals:

```ts
const state = {
  pattern:    signal<Pattern>(defaultPattern),
  mirrorMode: signal<MirrorMode>('HV'),
  tool:       signal<Tool>('pencil'),
  color:      signal<Cell>(...),
  cellScale:  signal<number>(8),
  zoom:       signal<number>(1),         // preview cell scale multiplier
  bgScale:    signal<number>(1),
  showPageBg: signal<boolean>(true),
  theme:      signal<'light'|'dark'>('dark'),
  saveState:  signal<boolean>(true),
  recentColors: signal<Cell[]>([]),
  // history, slots, preset selection...
};
```

All UI reads from signals; all mutations go through typed setter functions that also schedule downstream effects (re-render preview, push history, autosave).

### 6.2 localStorage persistence

- Key namespace: `pixpat:` (e.g. `pixpat:autosave`, `pixpat:slot:<name>`).
- Autosave (debounced 250 ms after last stroke):
  - `pixpat:autosave` → `{ pattern, mirrorMode, color, recentColors, cellScale, ... }`
- Slot save:
  - `pixpat:slots` → array of `{ name, createdAt, thumbDataURL, pattern, mirrorMode }`
  - `thumbDataURL` is a 32×32 PNG data URL preview.
- Saved silently; surfaces in the SaveSlots panel.
- A "Clear all data" button in Settings (with the same confirm-style interaction the original TODO asked for: button turns red, label becomes "Confirm?", re-click within 3 s wipes everything).

### 6.3 Share URL

- Encode `{ pattern (packed hex), width, height, mirrorMode, color }` into URL hash via a compact binary → base64url encoding (no external compression needed; the patterns are small enough that ~64-byte payloads encode to ~88 chars).
- `#/p=<...>` hash on the share URL.
- On load: if `#/p=` present, deserialize and load (takes precedence over autosave).
- ShareModal: copy-to-clipboard button, "open in new tab" button, QR code (optional, low priority).

---

## 7. UX & layout

### 7.1 First paint

Default state when there's no autosave and no share hash:

- **5 × 5 cells**, mirror mode **HV** (so first-time users get a seamless tile by default), color `#cc33cc` at full opacity (a callback to the original's default), randomize button obvious.
- A brief "hint" rail beneath the tools the first time you open the app (one line: "Paint a small pattern — it tiles seamlessly by default. Try the mirror presets.") — disappears on first stroke, dismissable.

### 7.2 Layout

Three-column app shell:

```
┌────────────────────────────────────────────────────────────────────────────┐
│  pixel-patterns      [undo redo]   [share] [export] [settings ⚙]   [GH]    │  ← top bar
├──────┬─────────────────────────────────┬──────────────────────────────────┤
│      │                                 │                                  │
│  T   │      DRAW GRID                  │        PREVIEW                   │
│  O   │      (cols × rows)              │        (tiled super-tile)        │
│  O   │                                 │                                  │
│  L   │                                 │                                  │
│  S  │                                  │                                  │
│      ├─────────────────────────────────┼──────────────────────────────────┤
│      │  dimensions · cell scale · zoom  │  color · alpha · swatches        │
└──────┴─────────────────────────────────┴──────────────────────────────────┘
                              Save slots · presets · randomize · clear
                              live in a collapsible bar below the controls.
```

- Left toolbar is a slim vertical rail of tool icons (and mirror-mode segmented control below them). Width ~52 px.
- Top bar is buttons + GitHub corner.
- Center split: draw grid on the left, preview on the right. Resize handles optional; panels are responsive — on narrow screens, they stack. Default ratio 1:1.
- Below the panels: dimensions sliders and cell-scale / zoom (left of split), color picker + recent colors (right of split).
- Below all that: a single row of preset chips, slot chips, and "Randomize" button. Collapsible.

### 7.3 Interaction details

- **Pointer events** (unifies mouse + touch). No mouse-events-only gotchas. The original mentioned lack of RMB on phones; we sidestep by leaning on explicit tools.
- **Touch**: one-finger draw. Long-press on the canvas → switch to dropper for the duration of the long-press (cute, low effort). Two-finger pinch → adjust cellScale.
- **Keyboard**:
  - `B` pencil, `E` eraser, `G` bucket (fill), `L` line, `I` dropper
  - `M` cycles mirror mode (none → H → V → HV → none)
  - `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` or `Y` redo
  - `Ctrl/Cmd+S` save to next free slot (intercept browser save)
  - `R` randomize
  - `C` clear (with in-place confirm interaction)
  - `[` / `]` decrease / increase cell scale
  - `,` / `.` decrease / increase zoom
- **Accessibility**: all tools reachable via keyboard, ARIA buttons/roles, `prefers-color-scheme` respected for default theme, focus-visible rings, `prefers-reduced-motion` honored for the rare transitions.

### 7.4 Visual design

- **Theme**: dark by default (silhouettes patterns well), light theme toggle.
- **Tokens**:
  - Surfaces: `--surface-0` (page bg), `--surface-1` (toolbar/panels), `--surface-2` (modals).
  - Text: `--text-1`/`--text-2`/`--text-3`.
  - Accent: indigo `#6366f1` for active tool, hover, focus.
  - Border: `--border` (subtle, theme-aware).
  - Grid + mirror-axis colors: dimmed neutrals.
- Typography: system UI stack, tight tracking on the app label.
- Radii: 4 px on buttons, 6 px on panels. No 999px pill overuse.
- Buttons sized to 40 px tap target. Sliders styled to match. Inputs use `accent-color`.
- The draw grid sits on a transparent-checkerboard background behind the canvas to make transparent cells legible (standard pixel-art editor convention, called out explicitly in the original TODO).
- Animation budget: 150 ms ease on drawer/modal, 80 ms on tool activation. `prefers-reduced-motion` → 0.

---

## 8. What I am dropping from the original TODO

The original `script.js` opened with ~50 aspirational lines. I'm explicitly not pursuing these — they're either dated, low-ROI, or belong in a second project:

- **Firefox plugin / new-tab patterns** — different project.
- **Upload-a-bitmap functionality** — adds a chunky edge (image → pixel-pattern pipeline) that distracts from this app's core. Out.
- **`sessionStorage` vs cookie debate** — moot, we use localStorage.
- **Pencil-pressure-sensitive drag lines** — touch pressure is unreliable across browsers; skip until we get a concrete need.
- **"inspired in part by" attribution** — left as a one-line ack in the README, not a project epic.

Everything else from those TODO lines — pixel-perfect rendering, logarithmic tiling, full-page live background, localStorage, tools, dropper, save slots, undo/redo, favicon from current pattern, shareable URL, settings drawer, cross-platform input handling, randomness with mirror bias, preset patterns, dimension-perfect resize that retains prior work, confirm-on-clear, odd/even indicator on the dimension sliders — is **in**.

---

## 9. Non-goals / Known scope

- We're not building an image editor. No layers, no selections, no PNG import. Cells, colors, symmetry. That's the whole pitch.
- No backend. Sharing is URL-hash-only. Save slots are local-only.
- No multiplayer/collab.

---

## 10. Deployment

- Static build via Vite (`vite build` → `dist/`).
- `vite.config.ts` sets `base: '/pixel-patterns/'` so the bundle URLs match the live GitHub Pages subpath that the original already serves.
- A `.github/workflows/deploy.yml` builds on push to `master` and publishes `dist/` to a `gh-pages` branch via `actions/deploy-pages`. Switch the repo's Pages source to the `gh-pages` branch (root) on the first run; documented in the workflow itself.
- `.gitignore` covers `node_modules/` and `dist/`.
- A new `README.md` documents the stack, the design, how to run dev, how to build, and how to deploy. The original "Vanilla JS" badge is replaced with an honest "Preact + TS + Vite" thumbnail and a paragraph linking to the spec.

---

## 11. Verification

- `npm run build` produces a static `dist/` that opens correctly at the `/pixel-patterns/` subpath (verified with Vite preview or `python -m http.server`).
- `npm run typecheck` passes clean.
- Manual smoke test in Chromium and Firefox: paint, drag, mirror, undo/redo, save slot, share URL round-trip, favicon updates, page bg updates, export PNG at 1024².
- Touch smoke test in mobile viewport of DevTools.
- `Lighthouse` pass once: performance ≥ 95, best practices ≥ 95, no console errors.

---

## 12. Post-v1 revisions

This section logs the deltas that landed after v1 — the v2 / v3 / v4 / v5 polish passes. Kept here so the SPEC stays a useful contract for the current code, not just the original promise.

### v2 polish (UX feedback)

- **Page background & favicon not updating on paint** — v1 had its own data-URL cache in `page-bg.ts` and `favicon.ts` keyed on `mode:w:h:cellPx:tileW*tileH` — *no content fingerprint*. A paint bumped `rev` and re-ran the effect, but the cache hit so the same stale PNG was re-applied. The fix moved the platform cache entirely into `superTileCanvas` (which DOES fingerprint content), and the page-bg/favicon rAF-loop always re-rasterizes against that memoised canvas.
- **`showGridLines` checkbox was a no-op** — the renderer was always drawing grid lines. Now gated by a `showGridLines` field on `GridRenderInput`, threaded through every call site.
- **Dropper reset brush over transparent cells** — `pickColor(0)` previously reset the brush to default magenta. It's now a no-op, so an accidental dropper over empty space leaves the brush untouched.
- **Recents semantics redesigned** — recents dedup by RGB only (so picking the same hue at two different alphas stays one entry, refreshed at the current alpha). The dock renders recents at the *current* alpha so the panel re-tints in lockstep with the alpha slider. The HTML picker's onInput drives a live preview; onChange (release) is what commits to recents, so dragging through the spectrum only adds one entry per drag.
- **Mirror-axis overlay toggle moved** from DimensionsDock up next to the mirror-mode segmented control on the Toolbar.
- **ShareModal URL race fixed** — v1 built the share URL inside `useEffect`, so there was a frame on mount where the input/anchor's `href` was empty and a fast Cmd-C or "Open in new tab" click grabbed an empty URL. Now built synchronously in a `useState` lazy initializer.
- **Export modal gained two modes**: Single tile (one super-tile × cellScale — for OS-level wallpaper tiling, where the OS repeats the pattern itself) and Tile to size (presets FHD/QHD/4K/square, screen-resolution auto-detect, custom WxH — for one-image desktop wallpapers where the tiling is baked into the output).
- **Cell-scale default** in the export modal now mirrors the preview's current cell scale — "what I see is what I get" out of the box.

### v3 polish (post-v2)

- **`saveSlot` empty-name guard** added at the store layer so any UI / programmatic caller can't persist an empty-named slot.
- **Swatch click UX**: `pickColorRgbOnly` was renamed `pickSwatch`; clicking a recent swatch now also re-orders it to the top of the recents list (the conventional Photoshop/GIMP swatch behaviour). RGB is picked at the current alpha; the alpha slider stays global to the brush.
- **Touch: long-press → dropper** is wired. Holding a single-touch pointer still on the canvas for 450 ms temporarily switches to the dropper for the rest of the gesture; the original tool is restored on release. Drifting past 10 px of slack cancels the long-press (so an intended drag doesn't become a dropper by accident).
- **Touch: two-finger pinch** adjusts `previewCellScale`. Tracks inter-pointer distance per `pointermove`, scales by the new/old ratio (so a pinch gesture always scales by the same ratio regardless of where the fingers started). Range `[1, 64]` (raised from the original 32 to align with the cell-scale slider + store clamp at 64).
- **`prefers-color-scheme` honoured on boot**: a brand-new visitor (no share URL, no autosave) with a light-theme OS preference now lands in the light theme instead of dark. Returning visitors keep whatever they last chose.
- **Keyboard cheatsheet modal**: `?` (or `Shift+/`) opens a modal listing every keyboard shortcut, grouped by Tools / Mirror / Color / Stroke / History / View / Touch. Bound to the same dismiss-on-backdrop and `Esc`-closing UX as the other modals. A `?` button in the topbar opens the same modal for discoverability.
- **Line tool brushAnchor artifact concern verified clean** — a smoke test exercises the snapshot-revert-and-repaint pattern through several pointermoves and confirms the visible line at every moment is exactly "anchor → current cursor" (intermediate moves do not leave residue). The original implementation was correct; the test pins it.
- **Sourcemap deployment fix** — `vite.config.ts` switched to `sourcemap: 'hidden'` (the `.map` still builds locally for dev debugging but the JS no longer carries the `sourceMappingURL` comment, so browsers never auto-fetch it on page load); the deploy workflow additionally strips `*.map` from the Pages artifact. Removes ~260 KB sitting unused on the Pages site.
- **History is byte-budgeted at 256 MB**, not count-capped at 64. Lazy-grow, never reservations. See the **History byte-budget** section below.

### v4 polish (post-v3)

- **In-tab navigation loads share URLs** — browsers don't reload on pure hash change. A `window.addEventListener("hashchange")` in `init.ts` re-applies the share payload via `store.loadFromShareUrl()` whenever the new hash carries one. No reload, no flash, no network refetch. Erasing the hash or pasting a non-share hash is a no-op (user's in-progress pattern is preserved).
- **History ceiling raised from 64 snapshots / 1 MB to 256 MB lazily held** — see **History byte-budget** section below.
- **Dropper samples only on click; hover is a no-op** — v3's `handlePointerMove` dropper branch fired `paintAt` on every move regardless of `e.buttons`, so moving the cursor across the canvas with the dropper armed silently overwrote the active color with whatever cell the cursor passed over. The gate is now `e.buttons !== 0` — a real held button — and bare mouse-hover leaves the brush untouched. Touch long-press dropper still works (touch-drag holds button 1).
- **Text selection disabled page-wide** via `user-select: none` on `body`; opt-back-in on `input`, `textarea`, `[contenteditable]`, `.modal` (the share URL field and cheatsheet text the user may want to copy), and `<noscript>`. A paint/draw tool expects drags to paint, not select text.
- **Middle-click (button 1) auto-scroll suppressed** at the window level via `preventDefault` on `mousedown` and `auxclick`. The browser's "round cursor with arrows" mode is only triggered accidentally here; wheel scrolling and keyboard scrolling unaffected.
- **Primary / secondary color model (MSPaint-style)** — two color slots (`primaryColor` / `secondaryColor` + their alpha signals + an `activeColorSlot` signal). LMB paints primary, RMB paints secondary. The ColorDock has overlapping front/back squares (front = primary, back = secondary) plus a `⇄` swap button. RMB on a swatch fills the inactive slot directly; touch long-press on a swatch does the same. `X` swaps slots (Photoshop convention). Series of `setHex` / `setAlpha01` / `pickColor` / `pickSwatch` / `fillPattern` accept an optional `which: ColorSlot` parameter. Recents list unified across both slots, cap doubled from 12 to 24. `color` / `alpha01` signals kept as projections of the active slot so existing readers stay honest.
- **ShareModal URL built synchronously** in a `useState` lazy initializer (was inside `useEffect` → race frame where empty URL could be Cmd-C'd).
- **Export modal cell-scale bound to `store.previewCellScale`** (was a local copy) — dragging the slider re-tints the live page bg + preview in real time, so the user can see how big one cell will be in the exported PNG before committing. Modal default for `Tile to size` is the user's screen-resolution preset (was 1024 square).
- **Dropper auto-reverts after a click** — `store.setTool` captures the previous tool whenever the user switches *to* the dropper; `store.revertDropper()` returns to that previous tool on `pointerup`. Composes cleanly with the long-press dropper path (which restores via its own savedToolRef first and leaves the tool non-dropper, so the explicit revert short-circuits).
- **CSS bug: color squares showed no color** — the `.swatch-fill` rule was scoped to `.swatch > .swatch-fill` only; the `.color-square` parent the new double-square used wasn't covered. Selector widened to also match `.color-square > .swatch-fill`.
- **Page background flicker to black eliminated** — setting `body.style.backgroundImage = url(data:` invalidates the *previous* image the instant the new CSS commits, but the *new* PNG still has to decode before it can paint; for large super-tiles that decode window let the dark `--surface-0` body bg flash through. Fix: preload the new PNG via `new Image()` and only swap the body bg in `img.onload`. The old image is shown right up until the new one is ready, then the swap is paint-atomic. `onerror` falls back to swap-immediately.
- **Color picker hotkey: `C` for the active slot, `Shift+C` for the secondary slot.** `store.requestOpenColorPicker(slot)` action bumps an `openPickerRequest` signal the ColorDock subscribes to; the dock calls `HTMLInputElement.showPicker()` (with a `.click()` fallback) and temporarily switches the active slot when `Shift+C` requested, restoring on `change` or `blur`. Clear-pattern moved off `C` to `Backspace` / `Delete` so a single keystroke no longer wipes a pattern.
- **New-session defaults changed**: Width × Height = 7 × 7, Cell size = 3, Page scale = 1 (was 5 × 5 / 8 / 4). A 7×7 HV-mirrored super-tile becomes a 14×14 at 42×42 device px — a comfortably dense wallpaper. Page scale 1 = one super-tile cell per device pixel on screen, so the page background reads at real pixel density.
- **Active tool / mirror-mode button is visibly pressed.** Previous `accent-weak` background was easy to miss on the dark surface; replaced with solid `--accent` fill + white text + `font-weight: 600`, matching the Photoshop / Aseprite convention for the active tool in a group.
- **v1 (single-color) share URL back-compat dropped.** The codec now accepts exactly one format — the 8-field v2 form `#p=WxH,mode,hexP,alpha,hexS,alphaS,slot,cells`. Old 5-field URLs decode cleanly to null. Nothing's published yet, so the v1 shim was pure complexity for zero reachable users.

### History byte-budget (v3 → v4 boundary)

Replaces the v1 fixed `HISTORY_CAP = 64` with a lazy-grow byte-budget model. Memory is allocated per-paint — empty history still holds 0 bytes; the budget is a ceiling on what can accumulate, not a reservation.

- **Default budget: 256 MB.** Session-local cap; history is never persisted across page reloads (only the current pattern + UI state autosaves), so the budget is a per-session local ceiling.
- **Snapshots held** at this budget for typical patterns:

  | Pattern | Per snapshot | Snapshots held |
  |---|---|---|
  | 7 × 7 (default) | 196 B | ~1.4M |
  | 16 × 16 | 1 KB | ~262K |
  | 32 × 32 | 4 KB | ~65K |
  | 64 × 64 (max grid) | 16 KB | ~16K |

- **`MIN_SNAPSHOTS = 8` floor** — a single huge pattern never wipes history below a usable number of undo steps, even if one snapshot alone exceeds the byte budget. Better to overshoot than to lose all undo.
- **Redo stack** respects the same byte-budget + MIN floor.
- **Diagnostic accessors** `bytesHeld()` / `undoDepth()` / `redoDepth()` exposed on the `History` class for any future in-ui memory meter.
- **Eviction cost is O(n) per push when over budget** — `Array.shift()` at the cap. For 4k-snapshot saturation on a 64×64 pattern that's a ~64 KB copy per eviction stroke — negligible. Only matters at budgets in the GB range; a true O(1) ring buffer isn't worth the complexity at 256 MB.

### Build / deployment deltas (cumulative)

- `vite.config.ts` has `sourcemap: 'hidden'`.
- `.github/workflows/deploy.yml` runs `find dist -name '*.map' -delete` before the Pages artifact upload.
- The README documents Single tile vs Tile to size export modes, the `?` cheatsheet, the touch gestures, the primary/secondary color model, and the current test count.

### Test coverage as of v4

- Pure domain: color / pattern / mirror / history / tools / randomize / presets / share-url round trip.
- happy-dom smoke tests: App+boot mount, paint/undo/redo, save/load/delete slot, preset application, dropper no-op-on-transparent, swatch-tracks-current-alpha, HTML picker drag spam guard, superTileCanvas content invalidation, share-URL boot decode loop, hashchange re-apply, line tool snapshot-revert invariant, saveSlot empty-name guard, primary/secondary color round-trip, share-URL v1 rejection, dropper-hover gate, dropper auto-revert, new-session defaults, `requestOpenColorPicker` API.
- 122 assertions / 17 test files / all green.