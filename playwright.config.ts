import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", fullyParallel: false, workers: 1,
  use: { baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3000", viewport: { width: 390, height: 844 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] } },
  projects: [{ name: "mobile-chromium", use: { browserName: "chromium" } }],
});
