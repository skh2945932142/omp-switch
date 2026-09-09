import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  main: {
    // `@omp-switch/core` is a workspace source package (main: src/index.ts); it must be bundled
    // into the output, not left as a runtime import that would only resolve in a dev checkout.
    plugins: [externalizeDepsPlugin({ exclude: ["@omp-switch/core"] })],
    build: {
      lib: { entry: resolve(rootDir, "electron/main.ts"), formats: ["es"], fileName: "index" },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve(rootDir, "electron/preload.ts"), formats: ["cjs"], fileName: () => "index.cjs" },
    },
  },
  renderer: {
    plugins: [react()],
    build: { rollupOptions: { input: resolve(rootDir, "src/renderer/index.html") } },
  },
});
