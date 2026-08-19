import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

// Bundles the headless CLI into a single Node file. `build.ssr` is used rather than `build.lib`
// because the entry only has side effects (it runs a command); a client library build tree-shakes
// the whole program away. Node builtins stay external and everything else (currently just `yaml`)
// is inlined, so the shipped artifact has no runtime dependencies.
export default defineConfig({
  resolve: {
    alias: { "@omp-switch/core": resolve(rootDir, "packages/core/src") },
  },
  ssr: {
    noExternal: true,
  },
  build: {
    target: "node24",
    outDir: "packages/cli/dist",
    emptyOutDir: true,
    minify: false,
    ssr: resolve(rootDir, "packages/cli/src/main.ts"),
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
      output: { entryFileNames: "main.js", format: "es" },
    },
  },
});
