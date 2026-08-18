import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@omp-switch/core": resolve(rootDir, "packages/core/src"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["packages/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
