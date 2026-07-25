// @ts-check
const { defineConfig } = require('@playwright/test');

// Electron E2E tests (see e2e/) drive the packaged renderer directly via
// Playwright's Electron support - there's no dev server to point a
// regular browser at, so most of the usual web-app config (webServer,
// projects per browser, baseURL) doesn't apply here.
module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false, // each test launches its own Electron process; keep it simple
  reporter: [['list']],
  use: {
    screenshot: 'only-on-failure',
  },
});
