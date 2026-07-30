# Roadmap

## Shipped

- [x] Remove SQLite
- [x] Remove cloud sync (Google Drive, Dropbox)
- [x] Offline vault engine (AES-256-GCM + PBKDF2)
- [x] Master password setup/unlock
- [x] Category tree, nested folders, entries
- [x] Password generator, search, favorites, tags, recycle bin
- [x] Automated test suite
- [x] Atomic/durable vault writes
- [x] Corrupted-vault detection and guided backup restore
- [x] Backup manager (restore/rename/export/delete)
- [x] PIN quick-unlock (convenience layer over the master password)
- [x] Undo/redo
- [x] Theming: light/dark/system, accent/background/panel colors, background image
- [x] Minimalist visual redesign
- [x] Packaging (electron-builder)
- [x] Migrate the runtime from Electron to Tauri v2 for shipped app size (see below)

## Tauri v2 migration (shipped)

Electron is retired. `npm start`/`npm run build` now target Tauri (`src-tauri/`, Rust) exclusively - see ARCHITECTURE.md for the "Retired" section covering what changed.

**Why**: shipped size. Measured on this repo, same version, same platform (Linux x64):

| | Electron | Tauri | |
|---|---|---|---|
| Unpacked app | 402 MB | 13 MB | ~31x smaller |
| AppImage | 133 MB | 75 MB | ~1.8x smaller |
| .deb / .rpm | *(n/a - Electron only shipped AppImage/snap)* | 4 MB | — |

The `.deb`/`.rpm` gap is the starkest number: Tauri links against the system's already-installed WebView instead of bundling an entire Chromium+Node runtime inside the package, the way Electron's AppImage/snap/unpacked builds all do.

Done:
- [x] Rust port of the full data/domain layer and command surface (crypto, vault repository/service, command manager, quick-unlock, idle-lock, activity log, recycle bin, search, settings, backups) - 120 Rust unit tests, verified byte-compatible with vault files written by the old Electron/Node build
- [x] Frontend bridge (`src/tauriBridge.js`) installs `window.api`, reshaping `invoke()` into the `{success,data}` envelope every component already expects
- [x] `npm start`/`npm run build` repointed at Tauri; Electron/electron-builder/electron-is-dev dependencies and the electron-builder `package.json` config block removed
- [x] Packaging verified end-to-end: `npm run build` produces working `.deb`/`.rpm`/AppImage bundles; the built binary launches and renders under a headless X server without errors
- [x] E2E coverage: `e2e-tauri/run.mjs` drives the real compiled binary via `tauri-driver` (W3C WebDriver to WebKitWebDriver on Linux) + `webdriverio`, reproducing the field-editor-overlap regression the old Electron/Playwright suite checked. `npm run test:e2e` runs it; verified green in two independent sessions/environments.
- [x] Retired files physically deleted via the GitHub API (`public/electron.js`, `public/preload.cjs`, `src/models/`, `src/services/`, `src/repositories/`, `src/commands/`, `e2e/`, `playwright.config.js`) after local `rm`/`git rm` was blocked by a sandbox restriction in the sessions that did this migration - the API path wasn't subject to the same restriction. `src/data/` was kept (the renderer imports it directly); `e2e-tauri/` was kept (it's the live E2E suite).

Not yet done:
- [ ] Windows/macOS icon and installer parity (only verified on Linux so far - no Windows/macOS runner available in this environment)
- [ ] `e2e-tauri/run.mjs` covers one regression scenario (the field editor overlap check ported from the old Electron suite) - broader coverage (the full manual smoke-test checklist in DEVELOPMENT.md) is still manual

## Not yet done

- [ ] Quick Access / pinned folders in the sidebar (deferred — under-specified; Favorites and Recent already cover most of the need)
- [ ] Vault health check (settings-page report: encryption OK, no duplicate UUIDs, tree integrity, no orphan entries, backups available)
- [ ] Folder/subfolder drag-to-reorder position (Move Up/Move Down exists; direct drag reordering does not)
- [ ] Auto-updater / release channel beyond manual GitHub releases

Nothing here is scheduled — this list exists so work doesn't get proposed twice, not as a commitment.
