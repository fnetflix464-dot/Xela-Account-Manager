# Changelog

All notable changes to this project are documented in this file. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [3.0.0] — Tauri v2 migration

Electron replaced with a Tauri v2 (Rust) backend, for a fraction of the shipped size: the unpacked app goes from 402 MB to 13 MB, and the packaged `.deb`/`.rpm` is 4 MB versus a 133 MB Electron AppImage (see ROADMAP.md for the full comparison). The vault file format, crypto, and every user-facing behavior are unchanged - this is a runtime swap, not a data migration; existing `vault.xam` files open as-is.

### Backend
- Full Rust port of the domain/data layer and command surface: crypto, vault repository/service, command manager (undo/redo), PIN quick-unlock (via the OS keyring instead of Electron's `safeStorage`), idle auto-lock (via OS idle-time polling instead of `powerMonitor`), activity log, recycle bin, search, settings, backups
- 120 Rust unit tests, including a round-trip check against a vault file written by the retired Electron/Node implementation to confirm byte-compatibility
- `src/tauriBridge.js` installs `window.api`, replacing `window.electron`; every command result keeps the same `{success,data}`/`{success,error}` envelope so renderer code didn't need to change shape, just the one property name it reads off `window`

### Testing
- `e2e-tauri/run.mjs` replaces the Electron-only Playwright E2E suite: drives the real compiled binary via `tauri-driver` (W3C WebDriver) + `webdriverio`, covering the same field-editor-overlap regression the old suite checked (`npm run test:e2e`)

### Removed
- Electron, `electron-builder`, `electron-is-dev` and the electron-builder `package.json` config block
- The JS implementation of the backend (`src/models/`, `src/services/`, `src/repositories/`, `src/commands/`) - superseded by `src-tauri/`, which now has its own equivalent test coverage
- The Electron-only Playwright E2E suite (`e2e/`, `playwright.config.js`) - superseded by `e2e-tauri/`

## [2.0.0] — Offline vault rewrite

The original prototype (SQLite storage, bcrypt master password, Google Drive/Dropbox cloud backup, 2FA tracking) was replaced end to end with a fully offline, encrypted single-file vault. Nothing from the original backend survived the rewrite; the sections below cover the rewrite and everything built on top of it since.

### Architecture
- Layered design: `VaultRepository` (disk/crypto I/O) → `VaultService` (domain logic, in-memory tree) → IPC → renderer
- ES Modules for `src/models`, `src/services`, `src/repositories`, `src/commands`, `src/data`; `public/electron.js`/`preload.cjs` stay CommonJS (a hard Electron main-process constraint)
- `EventBus` for decoupled post-persist notifications (renderer push, undo-stack invalidation)
- Snapshot-based command/undo-redo (Ctrl+Z / Ctrl+Shift+Z), session-only, excludes permanent-delete operations
- Automated test suite (Jest) covering crypto, repository, service, command, and event-bus layers

### Vault & data model
- AES-256-GCM encryption, PBKDF2 (210,000 iterations) key derivation
- Category → nested folder → entry tree, replacing the old flat account list
- UUID-based entities; entry templates and field types externalized to `src/data/`
- Password history per field, tags, favorites (pinned to top of lists), full-text search
- Duplicate/reused-password detection

### Reliability
- Atomic, durable vault writes (temp file → `fsync` → rename) — a crash mid-write can never corrupt the live file
- Automatic backup rotation on every save
- Corrupted-vault detection at launch (structural validity check, no password needed) with a guided restore-from-backup screen
- Backup manager: restore, rename, export, or delete individual backups from Settings
- Session key material is explicitly zeroed (not just dereferenced) on lock, master-password change, backup restore, and import

### Unlocking
- PIN quick-unlock: opt-in convenience layer over the master password. The PIN never derives the real key — it unlocks a copy of the session key wrapped via the OS credential store (`safeStorage`: DPAPI/Keychain/libsecret). Automatically invalidated by any operation that changes the vault's actual encryption key.

### UI
- Full redesign around the category/folder tree (drag-and-drop moves, Move Up/Down reordering, right-click context menu for add/rename/delete, Discord-style connector lines)
- Minimalist visual pass: emojis removed in favor of plain glyphs, slim header with a "more" overflow menu, small/understated action buttons throughout
- Theming: light/dark/system, plus independent accent/background/panel color pickers and an optional background image (panels turn slightly translucent automatically when a custom background is set)
- Recycle Bin, Activity Log, Settings as first-class views
- Recent-entries tab, idle auto-lock, clipboard auto-clear (both configurable)

## [1.0.0] — Initial prototype

- SQLite-backed storage with AES-256 field encryption and bcrypt master password
- Google Drive / Dropbox cloud backup integration
- 2FA tracking dashboard (TOTP/SMS/Email, backup codes)
- Flat account list UI with category filter
