import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath, URL } from "node:url";
import { aiProxy } from "./tools/ai-proxy";

// Two build targets from one source tree:
//   `npm run build`         -> normal chunked static site (dist/)
//   `npm run build:single`  -> one self-contained .html you can email or
//                              double-click, the way BUD_1.html worked.
// The single-file target is a DELIVERY format, not an architectural constraint.
export default defineConfig(({ mode }) => ({
  // aiProxy is dev/preview middleware only; it is not part of either build.
  plugins: [react(), aiProxy(), ...(mode === "singlefile" ? [viteSingleFile()] : [])],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: mode === "singlefile" ? "dist-single" : "dist",
    emptyOutDir: true,
    target: "es2020",
    assetsInlineLimit: mode === "singlefile" ? 100_000_000 : 4096,
    chunkSizeWarningLimit: 2400,
  },
}));
