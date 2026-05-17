import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const tauriHost = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  plugins: [react(), tailwindcss()],
  server: {
    host: tauriHost || false,
    port: 5173,
    strictPort: true,
    // React Fast Refresh crashes Tauri WebView; HMR is off for localhost.
    // Remote-host dev (TAURI_DEV_HOST) keeps its WebSocket tunnel.
    hmr: tauriHost
      ? { protocol: "ws", host: tauriHost, port: 1421 }
      : false,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    chunkSizeWarningLimit: 1100,
  },
});
