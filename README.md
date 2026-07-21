# pixel-patterns

A small, fast, opinionated web tool for drawing tiny pixel patterns that **tile seamlessly across the whole page**. Draw a small grid, pick a mirror mode, and watch the seamless super-tile cascade across the entire window in real time. Save locally, share via URL hash, export a PNG — no backend, no account.

> Live: <https://nathanjrollins.github.io/pixel-patterns/>

## The idea

The original `script.js` had a long aspirational TODO list. The redesign pulls the most leveraged ideas together behind one central premise:

> **Default to mirror painting, so anything you draw tiles seamlessly by construction.**

Whatever you paint in the input grid is composed into a four-way mirror-symmetric super-tile. The browser tiles that super-tile across the preview panel, the page background, and the favicon — every stroke lands everywhere instantly. Mirror modes`HV` (four-way), `H` (vertical mirror), `V` (horizontal), and `none` are switchable, so you choose how much the tool helps you go seamless.

## What's in here

- **Tools**: Pencil, Eraser, Bucket (flood fill), Line, Dropper. Keyboard shortcuts `B`, `E`, `G`, `L`, `I`.
- **Mirror**: segmented control on the toolbar (also `M` cycles). Symmetric painting guarantees seamless output.
- **Performance**: the live preview, page background, and export all use `ctx.createPattern(..., 'repeat')` + a single `fillRect`. Cost is constant per redraw, independent of preview size — a ~250,000-`fillRect` per-frame issue in the original is now one GPU blit.
- **Live page background**: the whole window tiles the symmetry-tightened pattern in real time. Toggle it in settings. The redesigned headliner.
- **Live favicon**: the tab favicon updates to your current super-tile. The first thing the user sees.
- **Persistence**: localStorage autosave, debounced 250 ms. Express save slots with 32×32 thumbnails.
- **Share URL**: compresses pattern + mode + color + alpha into the URL `#p=...` hash. No backend, no length issues for typical patterns.
- **Presets**: 12 hand-curated starters (checkerboard, diamond, plus, brick, wave, dots, leaf, zigzag, heart, star, triangle, weave).
- **Randomize**: a biased, seeded generator (`mulberry32` + curated palette + sparse clustered strokes). Default to `HV` so it's seamless out of the box. `R` to trigger.
- **Undo / redo**: stroke-boundary snapshots in a lazy-grow byte-budgeted history (256 MB ceiling, never reserves). `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` (or `Y`). History is session-local; it resets on page reload (autosave stores only the current pattern + UI state, so reloading frees the memory).
- **Theming**: light + dark via `body[data-theme]`. Respects `prefers-color-scheme` on first visit; remembers your last choice afterward.
- **Crisp rendering**: `image-rendering: pixelated`, `imageSmoothingEnabled = false`, device-pixel-ratio-scaled canvas backing stores.
- **Pixel-perfect PNG export** (or optional bilinear smoothing) at any cell scale. Modal has Single tile (for OS-level wallpaper tiling) *and* Tile to size (presets FHD/QHD/4K/square/screen-resolution auto-detect/custom W×H, tiling baked in). Cell-scale slider drives the live preview so you can see what you're exporting.
- **Primary + secondary colors (MSPaint-style)**: LMB paints primary, RMB paints secondary. Overlapping front/back squares in the ColorDock. `X` swaps; `C` opens the native picker for the active slot, `Shift+C` for the secondary slot. RMB click on a swatch fills the inactive slot directly (touch long-press does the same).
- **Touch + accessibility**: pointer events; all tools reachable via keyboard; ARIA labels on tool buttons; `prefers-reduced-motion` honored. Long-press on the canvas → temporary dropper for the rest of the gesture; long-press on a swatch → fill the inactive color slot; two-finger pinch → adjust preview cell scale.
- **Two-tap Clear** (and "Clear all local data" in settings) instead of "are you sure?" modals — keep your rhythm. `Backspace` / `Delete` keyboard clear.
- **Odd/even badges** on dimension sliders: odd values allow tighter mirror symmetry around a center axis.
- **Cheatsheet modal**: `?` opens a single place that lists every keyboard shortcut + touch gesture groupings.
- **New-session defaults**: 7×7 grid, cell size 3, page scale 1, primary `#cc33cc`, secondary `#ffffff`, `HV` mirror. A 14×14 super-tile at 42×42 device px — a comfortably dense wallpaper.

## Stack

- **TypeScript** for the domain layer (pack/unpack RGBA, serialization, mirror composition, history).
- **Vite** for dev + build (configured with `base: '/pixel-patterns/'` to match the live GH Pages subpath).
- **Preact + `@preact/signals`** for UI — a ~3 KB reconciler + signals for fine-grained reactivity without repaints.
- Hand-rolled CSS with design tokens; no CSS framework.

The legacy single-file `script.js` / `style.css` has been removed. The history lives on in `git log master`.

## Project layout

```
src/
  domain/     pure pattern math: types, color, pattern ops, mirror, tools, history, randomize, presets
  render/     offscreen canvas building; preview panel via createPattern; draw grid; favicon; page-bg; PNG export
  state/      signals store; localStorage persistence; share-URL codec; boot
  ui/         Preact components: App, Toolbar, DrawPanel, PreviewPanel, ColorDock, DimensionsDock,
              PresetsBar, SaveSlots, ShareModal, ExportModal, SettingsDrawer, CheatsheetModal,
              keyboard map + toasts
  styles/     tokens.css, app.css, components.css
tests/        vitest: pure-domain unit tests + happy-dom smoke
SPEC.md       the design contract (read this!)
```

## Develop

```sh
npm install
npm run dev          # http://localhost:5173/pixel-patterns/
npm run typecheck
npm run build        # → dist/
npm run preview      # serves dist/ at /pixel-patterns/
npm test             # vitest run (pure domain + happy-dom smoke, 122 assertions)
```

## Deploy

The static site is built by `vite build` to `dist/`. There's a GitHub Actions workflow in
`.github/workflows/deploy.yml` that builds on pushes to `master` and force-pushes `dist/` to
`gh-pages`. To switch the live Pages source from `master` (the legacy site) to the `gh-pages`
branch:

1. Push `master` once the workflow is merged (the first run publishes to `gh-pages`).
2. In GitHub → repository Settings → Pages, set the **source** to the `gh-pages` branch (root).

No environment variables or secrets are required by the workflow — `actions/deploy-pages` with
the default `GITHUB_TOKEN` is enough.

## Inspiration / attribution

Inspired in part by various small pattern-tile web tools, including Kati Heck's `suchis.app`.
The mirror-painting approach that makes seamless output the default is the project's own bet.

## License

GPL-3.0, unchanged from the original. See `LICENSE`.

## Acknowledgment

This is a complete rewrite on branch `ai-overhaul-attempt-01`. The original (single
`script.js`) lives on `master`; the rewrite's design is documented in `SPEC.md`.