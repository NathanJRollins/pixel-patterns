# pixel-patterns

Draw small grid patterns, watch them tile the page.

> https://nathanjrollins.github.io/pixel-patterns/

## Build

```sh
npm install
npm run build      # → dist/
npm run dev        # http://localhost:5173/pixel-patterns/
npm test           # 126 assertions
```

Static output: `dist/index.html` + one JS + one CSS. Download is ~25 KB gzip.

## Stack

TypeScript, Vite (`base: '/pixel-patterns/'`), Preact + `@preact/signals`. Hand-rolled CSS, no framework.

## Layout

```
src/domain/   pure pattern math
src/render/   offscreen canvas + createPattern tiler
src/state/    signals store + persistence (localStorage) + share-URL codec
src/ui/       Preact components
src/styles/   tokens.css, app.css, components.css
tests/        vitest (pure-domain + happy-dom smoke)
SPEC.md       design notes
```

## Deploy

GitHub Actions workflow in `.github/workflows/deploy.yml` builds on `push` to `master`, uploads `dist/` to GitHub Pages. Set the repo's Pages source to the `gh-pages` branch (root) on first run.

## License

GPL-3.0. See `LICENSE`.