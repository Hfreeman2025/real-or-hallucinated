import { resolve } from "node:path";
import type { PreRenderedAsset } from "rollup";
import { defineConfig } from "vite";
import { modelFiles } from "./scripts/model-server.ts";

const assetFileNames = (asset: PreRenderedAsset) =>
  asset.names.some((name) => name.endsWith(".wasm"))
    ? "runtime/[name][extname]"
    : "assets/[name]-[hash][extname]";

export default defineConfig({
  plugins: [modelFiles()],
  resolve: {
    alias: [
      {
        find: /^onnxruntime-web(?:\/webgpu)?$/,
        replacement: resolve("node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs"),
      },
    ],
  },
  worker: { format: "es", rollupOptions: { output: { assetFileNames } } },
  build: {
    rollupOptions: {
      output: {
        assetFileNames,
      },
    },
  },
  server: {
    watch: {
      // Browser profiles and binaries live here to keep all task writes local.
      // They must not flood the development module graph with file events.
      ignored: ["**/.cache/**", "**/shots/**", "**/docs/**"],
      usePolling: true,
      interval: 300,
    },
  },
});
