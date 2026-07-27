# pixel-patterns
Easily create large images from simple patterns.  
Use it [here](https://nathanjrollins.github.io/pixel-patterns/)!



<br><br><br><br><br><br><br><br><br><br><br><br>


## Build

```sh
npm install
npm run build
npm run dev
npm test
```
^ then hit the application running at [http://localhost:5173/pixel-patterns]()

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


## License

GPL-3.0. See `LICENSE`.