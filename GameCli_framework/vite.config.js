import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

function manualChunks(id) {
  const normalized = id.replace(/\\/g, "/");
  if (normalized.includes("/node_modules/")) {
    if (normalized.includes("/jszip/")) return "vendor-zip";
    if (normalized.includes("/@tauri-apps/")) return "vendor-tauri";
    if (normalized.includes("/react/") || normalized.includes("/react-dom/") || normalized.includes("/scheduler/")) return "vendor-react";
    if (normalized.includes("/lucide-react/")) return "vendor-icons";
    if (normalized.includes("/zustand/") || normalized.includes("/zod/") || normalized.includes("/nanoid/")) return "vendor-state";
    return "vendor";
  }
  return undefined;
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      jszip: fileURLToPath(new URL("./node_modules/jszip/dist/jszip.min.js", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 6868,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
});
