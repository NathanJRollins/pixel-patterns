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
    // 'hidden' builds the .map file (useful for local debugging) but omits
    // the `//# sourceMappingURL=...` comment from the JS, so end-user
    // browsers never auto-fetch the .map on first hit. Saves ~260 KB on
    // the deployed Pages site for users who keep DevTools closed; users who
    // want it can still fetch it manually if we upload it (we won't).
    sourcemap: "hidden",
  },
});