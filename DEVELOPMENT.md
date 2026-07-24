# Development

## Prerequisites
- Node.js 18+
- npm

## Setup
```bash
npm install
```

## Running in development
```bash
npm start
```

Runs the CRA dev server (`http://localhost:3000`) and Electron together via `concurrently`; Electron waits for the dev server to be ready before launching, and opens with DevTools attached.

## Testing
```bash
npm test            # single run
npm run test:watch  # watch mode
```

Jest via `react-scripts test`. Covers `CryptoService`, `FileService`, `VaultRepository`, `VaultService`, `QuickUnlockService`, `CommandManager`, and `EventBus`.

## Building
```bash
npm run build   # react-scripts build + electron-builder (publishes if a draft release exists)
npm run dist    # same, but --publish never
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full picture (process split, module system, layering, vault file format, PIN quick-unlock security model, undo/redo, theming). Summary:

- **Renderer** (`src/`, React) — never touches Node/Electron APIs directly
- **Main process** (`public/electron.js`, CommonJS) — window management, IPC handlers, disk/crypto access
- **Bridge** (`public/preload.cjs`) — the only thing exposed to the renderer, as `window.electron`

## File structure

```
src/
├── App.jsx                # Renderer root
├── index.js                # React entry point
├── index.css                 # Global styles + shared button/panel primitives
├── components/               # React components
├── hooks/                    # React hooks
├── utils/                    # Renderer-only helpers (theming, clipboard, password tools)
├── models/                   # Plain data + validation (ESM)
├── services/                 # CryptoService, FileService, VaultService, ... (ESM)
├── repositories/             # VaultRepository - the only layer touching disk/crypto (ESM)
├── commands/                 # Undo/redo command objects (ESM)
└── data/                     # entryTemplates.js, fieldTypes.js (ESM)

public/
├── electron.js             # Main process (CommonJS)
├── preload.cjs              # contextBridge (CommonJS)
└── index.html                # HTML template
```

## Manual smoke test checklist

There's automated coverage for the service/repository layers, but no end-to-end UI test suite yet — after a UI change, walk through:

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

### Electron not starting / dependency issues
```bash
rm -rf node_modules package-lock.json
npm install
```

### Packaged app crashes but dev mode works
Usually an ESM/CJS resolution mismatch that only surfaces under Electron's bundled Node, not your local Node version or Jest's Babel-transpiled test execution — check that every directory under `src/` that's imported from `public/electron.js` has the right nested `package.json` (`{"type":"module"}`), and launch the actual packaged `.exe`/binary to reproduce, not just `npm start`.
