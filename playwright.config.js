// @ts-check
// STALE - Electron has been retired in favor of Tauri (see ROADMAP.md /
// ARCHITECTURE.md). This file, e2e/, and the @playwright/test dependency
// it needs are no longer wired into any npm script and should be deleted
// once Tauri gets its own E2E setup (tauri-driver/WebDriver - Playwright's
// Electron support has no Tauri equivalent). Left in place only because
// this session couldn't delete files; see ROADMAP.md for the removal list.
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
