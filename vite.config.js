import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Provincia's source uses plain .js files that contain JSX, so the React plugin
// must be told to process them. Output goes to build/ (not Vite's default dist/)
// because electron-builder is configured to package build/. Base is "./" so the
// generated asset URLs work when Electron loads index.html via loadFile().
export default defineConfig({
  plugins: [
    react({
      include: /\.(js|jsx|ts|tsx)$/,
    }),
  ],
  base: "./",
  root: ".",
  publicDir: "public",
  build: {
    outDir: "build",
    emptyOutDir: true,
    assetsDir: "static",
    sourcemap: false,
    // src/diagnostics.js is a CommonJS module (main.js require()s it at runtime;
    // it's listed in package.json build.files). The renderer (App.js) also imports
    // it. Rollup's CJS interop only runs on node_modules by default, so opt this
    // src file in so `import diagnostics from "./diagnostics"` resolves the
    // module.exports object in the production bundle. (vitest/esbuild already
    // handled it; this is the Rollup-side equivalent.)
    commonjsOptions: {
      include: [/diagnostics\.js$/, /nonLiveCommanderResolver\.js$/, /node_modules/],
    },
  },
  // Tell esbuild to treat all .js files as JSX — our source uses plain .js
  // extensions with JSX inside (CRA convention). Keeps imports working without
  // mass-renaming to .jsx.
  esbuild: {
    loader: "jsx",
    include: /\.(js|jsx|ts|tsx)$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: { ".js": "jsx" },
    },
  },
  server: {
    port: 3000,
    strictPort: false,
  },
  test: {
    // Never run tests out of agent git worktrees — they hold stale copies of
    // src/*.test.js that double-count (and may lag behind) the real tree.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**"],
  },
});
