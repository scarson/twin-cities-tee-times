// ABOUTME: Playwright config for on-demand accessibility testing.
// ABOUTME: Runs axe-core against the local Wrangler preview server.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:8787",
  },
  webServer: {
    command: "npm run preview",
    url: "http://localhost:8787",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
