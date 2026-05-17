import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const tauriHost = process.env.TAURI_DEV_HOST;
const isTauriDev = Boolean(process.env.TAURI_ENV_PLATFORM || tauriHost);

export default defineConfig({
  clearScreen: false,
  plugins: [react(), tailwindcss()],
  server: {
    host: tauriHost || false,
    port: 5173,
    strictPort: true,
    // Tauri WebView can fail on React refresh runtime in dev; keep HMR for browser dev.
    hmr: isTauriDev
      ? false
      : tauriHost
      ? {
          protocol: "ws",
          host: tauriHost,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    chunkSizeWarningLimit: 1100,
  },
});
