import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// dev: `npm run dev` (port 5173) proxies /api and /ws to the FastAPI server (port 8740).
// changeOrigin is deliberately not set: the server's Host/Origin allow-list accepts localhost:5173 as sent by the browser.
const SERVER = "http://127.0.0.1:8740";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: SERVER, ws: true },
      "/ws": { target: SERVER, ws: true },
    },
  },
  test: {
    environment: "node", // the tested code is pure TypeScript: no DOM, no jsdom
    include: ["src/**/*.test.ts"],
  },
});
