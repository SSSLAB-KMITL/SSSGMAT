import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
const base = "node_modules/cesium/Build/Cesium";
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: ["Workers", "ThirdParty", "Assets", "Widgets"].map((dir) => ({
        src: `${base}/${dir}`,
        dest: "cesium",
        rename: { stripBase: base.split("/").length },
      })),
    }),
  ],
  define: { CESIUM_BASE_URL: JSON.stringify("/cesium") },
  server: { proxy: { "/api": "http://127.0.0.1:8018" } },
  // An open tab can request its lazy Globe chunk after the next local build.
  // Keep content-hashed assets so that tab does not lose the 3D renderer.
  build: { outDir: "dist", emptyOutDir: false },
});
