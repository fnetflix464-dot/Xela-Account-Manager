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

## Tauri v2 (in progress, parallel to Electron)

A full Rust backend lives in `src-tauri/`, built alongside the existing Electron app rather than replacing it yet - `npm start`/`npm run build` still target Electron; `npm run tauri:dev`/`npm run tauri:build` target Tauri. See ARCHITECTURE.md.

- [x] Rust port of the full data/domain layer and command surface (crypto, vault repository/service, command manager, quick-unlock, idle-lock, activity log, recycle bin, search, settings, backups) - 120 Rust unit tests, verified byte-compatible with vault files written by the Electron/Node build
- [x] Frontend bridge (`src/tauriBridge.js`) reshapes `invoke()` into the same `{success,data}` envelope `window.electron` always returned, so no `src/` component or hook needs to change
- [x] Packaging verified end-to-end: `npm run tauri:build` produces working `.deb`/`.rpm`/AppImage bundles; the built binary launches and renders under a headless X server without errors
- [ ] Cutover decision: which runtime ships by default, whether Electron is dropped, Windows/macOS icon and installer parity
- [ ] E2E coverage: `e2e/` is Electron-only (Playwright's `_electron`), no Tauri equivalent yet (would need `tauri-driver`/WebDriver)

## Not yet done

- [ ] Quick Access / pinned folders in the sidebar (deferred — under-specified; Favorites and Recent already cover most of the need)
- [ ] Vault health check (settings-page report: encryption OK, no duplicate UUIDs, tree integrity, no orphan entries, backups available)
- [ ] Folder/subfolder drag-to-reorder position (Move Up/Move Down exists; direct drag reordering does not)
- [ ] Auto-updater / release channel beyond manual GitHub releases

Nothing here is scheduled — this list exists so work doesn't get proposed twice, not as a commitment.
