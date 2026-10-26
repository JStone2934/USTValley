import { defineConfig, devices } from "@playwright/test";
// Local readiness probes must bypass workstation HTTP proxies.
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1", "localhost"]
  .filter(Boolean)
  .join(",");
process.env.no_proxy = process.env.NO_PROXY;
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:4317", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -- --port 4317",
    url: "http://127.0.0.1:4317",
    reuseExistingServer: false,
    timeout: 30_000,
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
