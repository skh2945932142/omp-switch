import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Browser-preview dev server for the renderer only (mock API). Mirrors the alias from
// electron.vite.config.ts so `@omp-switch/core` resolves the same way.
const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: resolve(rootDir, "src/renderer"),
  plugins: [react()],
  resolve: { alias: { "@omp-switch/core": resolve(rootDir, "packages/core/src") } },
});
