import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { "@omp-switch/core": resolve(rootDir, "packages/core/src") } },
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
    resolve: { alias: { "@omp-switch/core": resolve(rootDir, "packages/core/src") } },
    build: { rollupOptions: { input: resolve(rootDir, "src/renderer/index.html") } },
  },
});
