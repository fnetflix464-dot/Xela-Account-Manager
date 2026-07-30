# Development

## Prerequisites
- Node.js 18+ and npm
- Rust toolchain (`rustup`) and the platform's Tauri prerequisites:
  - **Linux**: `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libxss-dev` (idle-detection needs the X11 screensaver extension headers), `patchelf`
  - **Windows/macOS**: see https://tauri.app/start/prerequisites/
- Optional, only for `npm run test:e2e`: `tauri-driver` (`cargo install tauri-driver --locked`) and, on Linux, the `webkit2gtk-driver` system package

## Setup
```bash
npm install
```

## Running in development
```bash
npm start
```

Runs `tauri dev`, which starts the CRA dev server (`http://localhost:3000`) itself via `beforeDevCommand` and launches the native window once it's ready - one command, no manual concurrent-process wrangling.

## Testing
```bash
npm test            # single run
npm run test:watch  # watch mode
```

No JS test files exist right now - `npm test` exits clean on zero tests (`--passWithNoTests`). The renderer never had unit tests of its own; the domain-logic tests it used to inherit indirectly moved to `cargo test` along with the code they covered. If you add renderer-only logic worth unit testing, `react-scripts test` (Jest) is still wired up and ready for it.

```bash
cd src-tauri && cargo test
```

The Rust backend's own suite - crypto, vault repository/service, command manager, quick-unlock, idle-lock, activity log, recycle bin, search, settings, backups.

```bash
npm run test:e2e
```

Drives the real compiled binary via `tauri-driver` (W3C WebDriver) + `webdriverio` (`e2e-tauri/run.mjs`) - currently covers one scenario end to end (vault creation → category → folder → entry → field, then a layout regression check). Requires `tauri-driver` on `PATH` (`cargo install tauri-driver --locked`) and, on Linux, the `webkit2gtk-driver` system package.

## Building
```bash
npm run build   # react-scripts build + Tauri bundling (.deb/.rpm/AppImage on Linux, .msi/.exe on Windows, .dmg/.app on macOS)
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full picture (process split, layering, vault file format, PIN quick-unlock security model, idle auto-lock, undo/redo, theming). Summary:

- **Renderer** (`src/`, React) — never touches the filesystem or Rust directly
- **Backend** (`src-tauri/`, Rust) — window management, commands (the IPC surface), disk/crypto access
- **Bridge** (`src/tauriBridge.js`) — the only thing exposed to the renderer, as `window.api`

## File structure

```
src-tauri/
├── src/
│   ├── commands.rs            # Tauri command layer - the IPC surface the renderer calls into
│   ├── vault_repository.rs, vault_service.rs, command_manager.rs, quick_unlock.rs,
│   │   idle_lock.rs, recycle_bin.rs, search.rs, settings_service.rs, activity_log.rs, backup.rs
│   └── model/                 # Category/Folder/Entry/Field/Settings/Vault structs
└── tauri.conf.json

src/
├── App.jsx                # Renderer root
├── tauriBridge.js          # window.api - the sole bridge into src-tauri/
├── index.js                # React entry point
├── index.css                 # Global styles + shared button/panel primitives
├── components/               # React components
├── hooks/                    # React hooks
├── utils/                    # Renderer-only helpers (theming, clipboard, password tools)
└── data/                     # entryTemplates.js, fieldTypes.js - shared UI metadata
```

## Manual smoke test checklist

There's automated coverage for the Rust backend and one E2E scenario (`npm run test:e2e`, see ROADMAP.md for what it does and doesn't cover), but no renderer unit tests — after a UI change, walk through the rest by hand:

1. First launch → set master password → vault unlocks
2. Lock → unlock with master password
3. If quick-unlock is set up: lock → unlock with PIN, then "use master password instead"
4. Create category → folder → subfolder → entry; edit; favorite; duplicate; delete → Recycle Bin → restore
5. Search, tag filter, Recent tab
6. Settings: change theme/accent/background/panel color, save, reload the tab and confirm it stuck
7. Export vault, then import it back
8. Settings → Backups: restore, rename, export, delete a backup

## Troubleshooting

### Port 3000 already in use
```bash
lsof -i :3000
kill -9 <PID>
```

### `npm start`/`npm run build` fails with a `pkg-config`/missing system library error
Install the platform's Tauri prerequisites (see "Prerequisites" above) — the error names the missing `.pc` package (e.g. `gdk-3.0`, `xscrnsaver`); on Debian/Ubuntu that maps to an apt `-dev` package of the same base name.

### Packaged app behaves differently than `npm start`
`npm run build`'s bundle runs against the production React build (`build/`), not the dev server - if something only reproduces there, rule out dev-only behavior (e.g. React StrictMode's double-invoke) before assuming it's a packaging bug.

## Retired: the Electron/Node implementation

Xela shipped on Electron through v2.0.0; Tauri has fully replaced it (see ARCHITECTURE.md's "Retired" section and ROADMAP.md for why and the size numbers). `public/electron.js`, `public/preload.cjs`, the old `src/models/`/`src/services/`/`src/repositories/`/`src/commands/`, and the Electron-only `e2e/`/`playwright.config.js` are gone from the repo - if you're looking for how any of that used to work, check git history (tags/commits before the 3.0.0 cutover) rather than expecting to find it on disk.
