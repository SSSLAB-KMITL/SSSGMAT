import { defineConfig, devices } from "@playwright/test";

// E2E ของ GNSS Studio (Task 14): Chromium อย่างเดียว ใช้ server จริงที่เปิดบน data fixture (tests/e2e/start-server.sh)
// ไม่ใช้ GMAT และไม่ต่อเน็ต; workers: 1 เพราะทุก spec ใช้ server และ data ชุดเดียวกัน
const ORIGIN = "http://127.0.0.1:8766";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "*.spec.ts",
  // data fixture อยู่ใน test-results/e2e-data: ตั้ง outputDir แยก Playwright จึงล้างเฉพาะโฟลเดอร์ของมัน ไม่ล้าง data ที่ server กำลังใช้
  outputDir: "test-results/pw",
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: ORIGIN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        // channel "chromium" = Chromium เต็มตัวในโหมด headless ใหม่ (binary เดียวกับ --headed) ไม่ใช้ headless shell แยก
        channel: "chromium",
        // SwiftShader ให้ WebGL ทำงานใน headless ที่ไม่มี GPU
        // วัดประสิทธิภาพ (GNSS_E2E_PERF_URL ตั้งอยู่) ไม่ใช้ SwiftShader: เกณฑ์ข้อ 2 วัดบน GPU ของเครื่องพัฒนา ไม่ใช่การเรนเดอร์ด้วย CPU
        launchOptions: { args: process.env.GNSS_E2E_PERF_URL ? [] : ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] },
      },
    },
  ],
  webServer: {
    command: "bash tests/e2e/start-server.sh",
    url: `${ORIGIN}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
