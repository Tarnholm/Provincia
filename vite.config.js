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
});
