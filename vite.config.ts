import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import pkg from "./package.json" with { type: "json" };

// `vite --mode web` (pnpm dev:web) runs the frontend in a browser against the mock backend.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  // Scan every source file for dependencies up front, so lazily loaded routes don't make
  // the dev server re-optimize and reload the page mid-session.
  optimizeDeps: { entries: ["index.html", "src/**/*.tsx", "src/workers/*.ts"] },
  // ES-module workers let each syntax grammar be its own chunk, loaded on demand.
  worker: { format: "es" },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  // package.json is the one source of the app version (tauri.conf.json reads it too).
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version) },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/target/**"] },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
