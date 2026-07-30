# Architecture

## Process split

Electron's two-process model applies as usual: the **main process** (`public/electron.js`) owns the window, all disk/crypto access, and every IPC handler; the **renderer** (`src/`, React) never touches Node/Electron APIs directly. `public/preload.cjs` is the only bridge between them, exposed as `window.electron` via `contextBridge`. Every IPC channel is wrapped by the same `handle(channel, fn)` helper in `electron.js`, which try/catches and always resolves `{ success, data }` or `{ success: false, error }` — the renderer never has to special-case IPC failures.

## Module system

`src/models/`, `src/services/`, `src/repositories/`, `src/commands/`, and `src/data/` are genuine ES Modules (each has its own nested `package.json` with `{"type":"module"}`, scoped to just that directory). `public/electron.js` and `public/preload.cjs` stay CommonJS — two hard constraints forced this split:

- A root-level `"type":"module"` breaks CRA's webpack build (it starts requiring explicit file extensions on every renderer import).
- Electron 31's `require('electron')` doesn't resolve to the real API object when the main script itself is loaded as an ES Module — it silently falls back to a stub. `electron.js` reaches the ESM services via dynamic `await import(...)` inside its `async` `app.on('ready', ...)` handler instead, the standard CJS-consumes-ESM interop path.

## Layers

```
VaultRepository  →  the only place that touches disk or crypto directly
       ↑
  VaultService    →  domain logic over an in-memory vault tree; decides *when*
       ↑              to persist, the repository decides *how*
   electron.js     →  IPC handlers, one per channel, thin wrappers around
       ↑              VaultService calls (some wrapped in withUndo())
    preload.cjs      →  contextBridge surface, window.electron
       ↑
    React renderer
```

`VaultService` holds all runtime state for a session — the derived AES key and the decrypted vault object live only in memory, never written to disk in plaintext, and are zeroed (not just dereferenced) on lock. It composes several single-purpose services rather than doing everything itself: `ActivityLogService`, `RecycleBinService`, `SettingsService`, `SearchService`, `QuickUnlockService`, `BackupService` (via the repository). Activity-log and recycle-bin entries are written into the same in-memory vault object *before* `persist()` runs — deliberately not event-driven, since they need to land in the same atomic write as the mutation that caused them, not a separate one.

`EventBus` (`src/services/EventBus.js`, a thin `EventEmitter` wrapper) is reserved for the opposite case: decoupled, order-insensitive notifications emitted *after* a successful persist (`entry.deleted`, `vault.locked`, `command.stackChanged`, ...). `electron.js` forwards every event to the renderer over one generalized `vault-event` channel; `CommandManager` listens for lifecycle events to clear its undo stack.

## Vault file format

`vault.xam` is a plain JSON envelope on the outside — `{ fileVersion, salt, iv, authTag, ciphertext, savedAt }` — with only `ciphertext` (the actual vault tree) encrypted. This split is what makes two things possible without ever touching the password:
- **Structural corruption detection**: `FileService.isVaultFileStructurallyValid()` just checks the envelope parses and has the expected fields. A vault file can fail *this* check (definite corruption) or fail decryption (wrong password *or* tampering — AES-GCM can't distinguish the two) — the recovery UI (Login screen) branches on which one happened.
- **Atomic, durable writes**: `FileService.writeVaultFile()` writes to a temp file, `fsync`s it, then renames over the live file. Renaming is atomic at the filesystem level on both NTFS and POSIX, so a crash mid-write leaves either the complete old file or the complete new one — never a truncated one.

Every save also rotates a timestamped backup (`BackupService`, pruned to the configured `backupCount`).

## PIN quick-unlock security model

The master password is always the vault's real encryption key. PIN quick-unlock (`src/services/QuickUnlockService.js`) does not change that — it wraps the *already-derived session key* using Electron's `safeStorage` (OS-level DPAPI/Keychain/libsecret), decryptable only by the same OS user account. The PIN itself is checked against a stored PBKDF2 verifier purely as a local UX gate; it adds no cryptographic protection beyond the OS-account boundary, which is the actual security boundary here — a short numeric PIN doesn't have the entropy to be a real key on its own, so the design leans entirely on the OS to protect the wrapped key at rest instead of pretending the PIN does.

Any operation that changes the vault's real key (master-password change, backup restore, import) proactively disables quick-unlock, since the previously wrapped key would otherwise go silently stale. `VaultRepository.loadWithKey()` also re-checks the vault file's salt against the recovered key as a backstop, in case a future key-changing code path forgets to call the invalidation.

## Undo/redo

`src/commands/` implements snapshot-based undo/redo: `CommandManager.execute()` snapshots the whole in-memory vault object before/after a mutation. `VaultService` already treats `vault` as immutable (`{ ...vault, ... }` everywhere), so retaining bounded snapshot references is cheap — unchanged subtrees are the same object references. `undo()`/`redo()` restore a snapshot directly rather than re-running the original mutation, which would mint new UUIDs and diverge from what was actually undone.

Deliberately **not** undoable: settings changes (better suited to one deliberate "Save" than Ctrl+Z), master-password/import/restore-backup (they change the vault's encryption identity, not just its content), and permanent delete / empty recycle bin (the UI explicitly promises these "cannot be undone" — silently making them undoable would break that promise).

## Tauri backend (parallel runtime, not yet the default)

`src-tauri/` is a Rust port of everything above the renderer - `electron.js`'s IPC handlers, `VaultRepository`/`VaultService`/`CommandManager`, and the domain services it composes - built to run *alongside* the Electron app, not replace it (see ROADMAP.md for cutover status). It mirrors the JS layering module-for-module (`vault_repository.rs`, `vault_service.rs`, `command_manager.rs`, `quick_unlock.rs`, `recycle_bin.rs`, `search.rs`, `settings_service.rs`, `activity_log.rs`, `backup.rs`), and `src-tauri/tests/fixtures/sample-vault.xam` (generated by the Node app) round-trips through the Rust repository to confirm the two implementations stay byte-compatible on the vault file format.

Two things replace Electron/Node platform APIs that don't exist in Tauri's Rust main process:
- **PIN quick-unlock**: `safeStorage` (DPAPI/Keychain/libsecret) becomes the `keyring` crate's equivalent OS credential store backends (`quick_unlock.rs`'s `OsKeyring`), wrapping the same already-derived session key under the same security model described above.
- **Idle auto-lock**: `powerMonitor`'s idle-time polling becomes `idle_lock.rs`'s `IdleLockController`, a background poll thread (via the `user-idle` crate) started/stopped off the same vault-lifecycle events electron.js used, calling back into `AppState` through a cloned `AppHandle` (captured before `AppState` itself exists, since the controller is built inside `build_app_state()`).

`src/tauriBridge.js` is the renderer-side counterpart to `preload.cjs`: it installs `window.electron` with the exact same method names/argument order, re-wrapping Tauri's `invoke()` (which resolves directly to a value or rejects with a string) back into the `{success,data}`/`{success,error}` envelope every existing component already expects - so nothing under `src/components`, `src/hooks`, etc. needs to know which runtime it's talking to. It only installs itself when `window.__TAURI_INTERNALS__` is present and `window.electron` isn't already set, so an Electron build is unaffected. `vault-event` is emitted the same way on both backends (`app.emit("vault-event", payload)` vs. `mainWindow.webContents.send(...)`), including the undo/redo stack's `command.stackChanged` event, which electron.js drove from `CommandManager`'s own `EventBus` listener but `commands.rs` emits directly from `notify_stack_changed()` since there's no equivalent decoupled event bus on the Rust side.

## Theming

Four independent, composable settings — `theme`, `accentColor`, `backgroundColor`, `panelColor` — plus an opt-in `backgroundImage`, all applied via `src/utils/theme.js` as inline CSS custom-property overrides on `document.documentElement` (so they win over both the light and dark stylesheet palettes without touching either). `applySurfaceStyling()` deliberately owns both the custom panel color *and* "make panels translucent over a custom background" in one function, since both would otherwise target the same `--color-bg-surface`/`--color-bg-surface-alt` variables and silently clobber each other if split apart.

Settings live inside the encrypted vault like everything else, so none of this is available before unlock — the Login screen falls back to the OS light/dark preference until then.
