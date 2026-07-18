import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// `base` matches the live GitHub Pages subpath so the built bundle URLs
// resolve correctly when served from
// https://nathanjrollins.github.io/pixel-patterns/.
// Override locally with `vite --base=/` if you serve from origin root.
export default defineConfig({
  base: "/pixel-patterns/",
  plugins: [preact()],
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: "es2020",
    outDir: "dist",
    sourcemap: true,
  },
});