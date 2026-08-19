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
    // Several suites do real filesystem work in temp directories rather than mocking fs. That is a
    // deliberate choice, but it means a slow CI disk can exceed the 5s default and fail a release
    // build for reasons unrelated to the code under test.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["electron/**/*.test.ts", "packages/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
