import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { pwaServiceWorkerPlugin } from "./scripts/vite-pwa-plugin.js";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), pwaServiceWorkerPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Playwright specs live in e2e/ and run via `pnpm test:e2e`, not vitest.
    exclude: ["e2e/**", "node_modules", "dist"],
  },
});
