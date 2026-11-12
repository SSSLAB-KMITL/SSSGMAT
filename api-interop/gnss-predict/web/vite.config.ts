import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { defineConfig } from "vitest/config";

const SERVER_ORIGIN = "http://127.0.0.1:8000";
const CESIUM_BUILD = "node_modules/cesium/Build/Cesium";

export default defineConfig({
  plugins: [
    react(),
    // Cesium โหลด Workers, ThirdParty, Assets, Widgets ตอนรันจาก CESIUM_BASE_URL จึงต้องคัดลอกไป dist/cesium/ (ไม่ต่อ CDN)
    // plugin คงโครงโฟลเดอร์ของ src ไว้เสมอ stripBase ตัด node_modules/cesium/Build/Cesium ออก เหลือ dist/cesium/Workers ฯลฯ
    viteStaticCopy({
      targets: ["Workers", "ThirdParty", "Assets", "Widgets"].map((dir) => ({
        src: `${CESIUM_BUILD}/${dir}`,
        dest: "cesium",
        rename: { stripBase: CESIUM_BUILD.split("/").length },
      })),
    }),
  ],
  define: { CESIUM_BASE_URL: JSON.stringify("/cesium") },
  build: {
    outDir: "dist",
    // Cesium (ราว 4 MB) อยู่ใน chunk ของตัวเองที่หน้าต่าง 3D และ 2D ใช้ร่วมกัน ตั้งชื่อเองให้อ่านรายการคำขอได้ (ไม่งั้นได้ชื่อของโมดูลที่ใช้ร่วมตัวใดตัวหนึ่ง)
    rolldownOptions: { output: { codeSplitting: { groups: [{ name: "cesium", test: /[\\/]node_modules[\\/](cesium|@cesium)[\\/]/ }] } } },
  },
  server: {
    proxy: {
      "/api": {
        target: SERVER_ORIGIN,
        // server ตอบ 403 FORBIDDEN_ORIGIN กับคำขอที่แก้ข้อมูลซึ่ง Origin ไม่ตรง origin ของตัวเอง
        // dev server อยู่คนละ port จึงเขียน Origin ใหม่เป็นของ server
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => proxyReq.setHeader("origin", SERVER_ORIGIN));
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    // jsdom ไม่มี ResizeObserver (dockview ต้องใช้): tests/unit/setup.ts ใส่ตัวปลอมให้
    setupFiles: ["tests/unit/setup.ts"],
    // เวลาทั้งแอปต้องไม่ขึ้นกับ timezone ของเครื่อง จึงรัน test ใน timezone ที่ไม่ใช่ UTC และมี DST ตลอด
    // (โค้ดที่ไปเรียก getHours/getDate ฯลฯ แบบเวลาท้องถิ่นจะ fail ใน suite; time-format.test.ts มี test ยืนยันว่าตั้งผลจริง)
    env: { TZ: "America/New_York" },
  },
});
