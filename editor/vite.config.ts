import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const gameCliDist = fileURLToPath(new URL("../GameCli_framework/dist", import.meta.url));
const bundledGameCliTarget = fileURLToPath(new URL("./dist/gamecli-preview", import.meta.url));

function gameCliContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js":
    case ".mjs": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".ico": return "image/x-icon";
    case ".woff": return "font/woff";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
}

function assertGameCliBuild(): void {
  if (!fs.existsSync(path.join(gameCliDist, "index.html"))) {
    throw new Error(`GameCLI web build is missing: ${gameCliDist}. Run npm run build:gamecli-preview.`);
  }
}

function gameCliPreviewPlugin() {
  return {
    name: "agentvn-gamecli-preview",
    configureServer(server: { middlewares: { use: (route: string, handler: (request: { url?: string }, response: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: Buffer) => void }, next: () => void) => void) => void } }) {
      assertGameCliBuild();
      server.middlewares.use("/gamecli-preview", (request, response, next) => {
        let requestPath: string;
        try {
          requestPath = decodeURIComponent((request.url ?? "/").split("?")[0]);
        } catch {
          response.statusCode = 400;
          response.end();
          return;
        }
        if (requestPath.includes("..")) {
          response.statusCode = 400;
          response.end();
          return;
        }
        const relativePath = requestPath.replace(/^\/+/, "");
        let filePath = relativePath ? path.join(gameCliDist, relativePath) : path.join(gameCliDist, "index.html");
        if (!filePath.startsWith(gameCliDist)) {
          response.statusCode = 400;
          response.end();
          return;
        }
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          filePath = path.join(gameCliDist, "index.html");
        }
        try {
          const body = fs.readFileSync(filePath);
          response.statusCode = 200;
          response.setHeader("Content-Type", gameCliContentType(filePath));
          response.setHeader("Cache-Control", "no-cache");
          response.end(body);
        } catch {
          next();
        }
      });
    },
    closeBundle() {
      assertGameCliBuild();
      fs.rmSync(bundledGameCliTarget, { recursive: true, force: true });
      fs.cpSync(gameCliDist, bundledGameCliTarget, { recursive: true });
    },
  };
}

function manualChunks(id: string) {
  const normalized = id.replace(/\\/g, "/");
  if (normalized.includes("/node_modules/")) {
    if (normalized.includes("/@xyflow/")) return "vendor-flow";
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
  plugins: [gameCliPreviewPlugin(), react()],
  resolve: {
    alias: {
      jszip: fileURLToPath(new URL("./node_modules/jszip/dist/jszip.min.js", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 6767,
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
