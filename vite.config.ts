import { builtinModules } from "node:module";
import { defineConfig } from "vite";

// VS Code extension host load: CommonJS bundle for the extension entry.
// `vscode` and all Node.js builtins stay external and are required() at runtime.
const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry: "src/extension.ts",
      formats: ["cjs"],
      fileName: () => "extension.js",
    },
    rollupOptions: {
      external: ["vscode", ...nodeBuiltins],
      output: {
        // VS Code requires a single CommonJS entry, no code splitting
        inlineDynamicImports: true,
        entryFileNames: "extension.js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});
