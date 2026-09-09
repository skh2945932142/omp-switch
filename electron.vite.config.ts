import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  main: {
    // `@omp-switch/core` and `@omp-switch/shared` are workspace source packages (main:
    // src/index.ts); they must be bundled into the output, not left as runtime imports that would
    // only resolve in a dev checkout.
    plugins: [externalizeDepsPlugin({ exclude: ["@omp-switch/core", "@omp-switch/shared"] })],
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
