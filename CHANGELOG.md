# Changelog

All notable changes to this project are documented in this file. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

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
