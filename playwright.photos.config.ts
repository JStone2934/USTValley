import { defineConfig, devices } from "@playwright/test";
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1", "localhost"]
  .filter(Boolean)
  .join(",");
process.env.no_proxy = process.env.NO_PROXY;
export default defineConfig({
  testDir: "./tests/photo-browser",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  use: { baseURL: "http://127.0.0.1:4322", trace: "retain-on-failure" },
  webServer: {
    command: "tsx tests/photo-browser/server.ts",
    url: "http://127.0.0.1:4322/health/ready",
    reuseExistingServer: false,
    timeout: 30000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 960 },
      },
    },
  ],
});
