import { defineConfig } from "@playwright/test";

const PORT = 1430;

// `pnpm shots`: renders key screens against the mock backend, light + dark, into
// e2e/__screenshots__/ for review against docs/DESIGN.md §4.13.
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `pnpm dev:web --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
