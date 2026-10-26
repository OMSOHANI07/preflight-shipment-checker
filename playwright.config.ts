import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const OUT = process.env.E2E_REPORT ?? "reports/playwright-local.json";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: process.env.E2E_BASE_URL ? 3 : 4,
  reporter: [["list"], ["json", { outputFile: OUT }]],
  use: { baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`, trace: "retain-on-failure", acceptDownloads: true },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: `npm run start -- -p ${PORT}`, port: PORT, reuseExistingServer: true, timeout: 120_000 },
});
