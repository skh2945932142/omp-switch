import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

// Bundles the TUI into a single Node file, mirroring vite.cli.config.ts: `build.ssr` because the
// entry runs side effects; node builtins external; react + ink inlined via `ssr.noExternal`.
export default defineConfig({
  ssr: {
    noExternal: true,
  },
  build: {
    target: "node24",
    outDir: "packages/tui/dist",
    emptyOutDir: true,
    minify: false,
    ssr: resolve(rootDir, "packages/tui/src/main.tsx"),
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
      output: { entryFileNames: "main.js", format: "es" },
    },
  },
});
