# Xela Account Manager

An offline, encrypted local vault for accounts, notes, cards, keys, and anything else you need to keep track of. Everything is stored in a single encrypted file on your own machine — nothing is ever sent to a server.

## Features

**Vault**
- AES-256-GCM encryption with PBKDF2 (210,000 iterations) key derivation
- Categories, nested folders, and typed entries (Login, Card, Note, and more)
- Full-text search, tags, and favorites (pinned to the top of any list)
- Recently updated entries at a glance
- Password generator and per-field password history
- Duplicate/reused password detection

**Recovery & backups**
- Every save rotates a local backup automatically
- Corrupted vault file detection at launch, with a guided restore flow
- Backup manager: restore, rename, export, or delete individual backups
- Vault export/import (still password-protected)

**Unlocking**
- Master password is the only real encryption key
- Optional PIN quick-unlock as a convenience layer on top of it — the PIN never derives the key itself; it unlocks a copy of the key wrapped by your OS's own credential store (DPAPI/Keychain/libsecret via Electron's `safeStorage`)

**Customization**
- Light/dark/system theme
- Independent accent, background, and panel color pickers, plus an optional background image
- Undo/redo for vault edits (Ctrl+Z / Ctrl+Shift+Z)

**Housekeeping**
- Recycle bin for deleted categories/folders/entries
- Activity log
- Idle auto-lock and clipboard auto-clear, both configurable

## Installation

```bash
npm install
npm start
```

`npm start` runs the CRA dev server and Electron together.

## Testing

```bash
npm test
```

## Building

```bash
npm run build   # publishes if a draft GitHub release exists
npm run dist    # local package only, no publish
```

Packaging is handled by `electron-builder`; see `package.json`'s `build` field for the current target configuration.

## Project structure

```
Xela-Account-Manager/
├── public/
│   ├── electron.js        # Main process: window, IPC handlers, event wiring (CommonJS)
│   └── preload.cjs         # contextBridge — the only surface the renderer can call into
├── src/
│   ├── App.jsx              # Renderer root
│   ├── components/          # React components (renderer)
│   ├── hooks/                # React hooks (renderer)
│   ├── utils/                 # Renderer-only helpers (theming, clipboard, password tools)
│   ├── models/                # Vault/Entry/Folder/Settings — plain data + validation (ESM)
│   ├── services/               # CryptoService, FileService, VaultService, etc. (ESM)
│   ├── repositories/            # VaultRepository — the only layer that touches disk/crypto (ESM)
│   ├── commands/                 # Undo/redo command objects (ESM)
│   └── data/                      # entryTemplates.js, fieldTypes.js (ESM)
└── package.json
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for how these layers fit together, and [DEVELOPMENT.md](./DEVELOPMENT.md) for local setup details.

## Security

- AES-256-GCM for the vault contents, PBKDF2-HMAC-SHA256 (210,000 iterations) for key derivation
- The master password (and the key derived from it) live only in memory while unlocked, and are zeroed out on lock, master-password change, backup restore, or import
- Vault writes are atomic (temp file → fsync → rename) so a crash mid-write can't corrupt the live file
- No network access, no telemetry, no accounts, no servers

If you find a security issue, please open an issue describing it rather than a public PR with an exploit.

## License

MIT — see [LICENSE](./LICENSE).
