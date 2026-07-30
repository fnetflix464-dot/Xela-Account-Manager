# Architecture

## Process split

`src-tauri/` (Rust) owns the window, all disk/crypto access, and every command - the IPC surface the renderer calls into; the **renderer** (`src/`, React) never touches the filesystem or Rust directly. `src/tauriBridge.js` is the only bridge between them, installing `window.api`. Every command's result is wrapped the same way: `{ success, data }` or `{ success: false, error }` - the renderer never has to special-case a failure.

## Layers

```
vault_repository.rs  →  the only place that touches disk or crypto directly
       ↑
  vault_service.rs    →  domain logic over an in-memory vault tree; decides *when*
       ↑                  to persist, the repository decides *how*
   commands.rs          →  Tauri command handlers, one per command, thin wrappers
       ↑                   around VaultService calls (some wrapped in with_undo())
  tauriBridge.js          →  window.api surface
       ↑
    React renderer
```

`VaultService` (`vault_service.rs`) holds all runtime state for a session — the derived AES key and the decrypted vault object live only in memory, never written to disk in plaintext, and are zeroed (not just dropped) on lock. It composes several single-purpose modules rather than doing everything itself: `activity_log.rs`, `recycle_bin.rs`, `settings_service.rs`, `search.rs`, `quick_unlock.rs`, `backup.rs` (via the repository). Activity-log and recycle-bin entries are written into the same in-memory vault object *before* `persist()` runs — deliberately not event-driven, since they need to land in the same atomic write as the mutation that caused them, not a separate one.

Domain events (`entry.deleted`, `vault.locked`, `command.stackChanged`, ...) recorded by `VaultService` are drained and forwarded to the renderer after every mutating command, by `commands.rs`'s `forward_events()` - called explicitly at each command site rather than through a decoupled listener, since Rust's ownership model makes an event-bus-style callback registry more friction than it's worth for what's ultimately a fixed, known set of call sites. `CommandManager` (`command_manager.rs`) clears its own undo stack in response to the same drained events (vault lifecycle transitions invalidate any pending undo/redo).

## Vault file format

`vault.xam` is a plain JSON envelope on the outside — `{ fileVersion, salt, iv, authTag, ciphertext, savedAt }` — with only `ciphertext` (the actual vault tree) encrypted. This split is what makes two things possible without ever touching the password:
- **Structural corruption detection**: `vault_file.rs`'s structural-validity check just confirms the envelope parses and has the expected fields. A vault file can fail *this* check (definite corruption) or fail decryption (wrong password *or* tampering — AES-GCM can't distinguish the two) — the recovery UI (Login screen) branches on which one happened.
- **Atomic, durable writes**: `vault_file.rs`'s write path writes to a temp file, `fsync`s it, then renames over the live file. Renaming is atomic at the filesystem level on both NTFS and POSIX, so a crash mid-write leaves either the complete old file or the complete new one — never a truncated one.

Every save also rotates a timestamped backup (`backup.rs`, pruned to the configured `backupCount`).

## PIN quick-unlock security model

The master password is always the vault's real encryption key. PIN quick-unlock (`quick_unlock.rs`) does not change that — it wraps the *already-derived session key* using the `keyring` crate's OS-level credential store backends (DPAPI/Keychain/libsecret via `OsKeyring`), decryptable only by the same OS user account. The PIN itself is checked against a stored PBKDF2 verifier purely as a local UX gate; it adds no cryptographic protection beyond the OS-account boundary, which is the actual security boundary here — a short numeric PIN doesn't have the entropy to be a real key on its own, so the design leans entirely on the OS to protect the wrapped key at rest instead of pretending the PIN does.

Any operation that changes the vault's real key (master-password change, backup restore, import) proactively disables quick-unlock, since the previously wrapped key would otherwise go silently stale. `vault_repository.rs`'s `load_with_key()` also re-checks the vault file's salt against the recovered key as a backstop, in case a future key-changing code path forgets to call the invalidation.

## Idle auto-lock

`idle_lock.rs`'s `IdleLockController` polls real OS idle time (via the `user-idle` crate) on a background thread, started/stopped off the same vault-lifecycle events described above rather than reset on every command - there's nothing to reset while nothing is idle-able to begin with. Its timeout callback re-enters through a cloned `AppHandle` rather than capturing `AppState` directly, since the controller is constructed inside `build_app_state()`, before `AppState` itself exists to capture.

## Undo/redo

`command_manager.rs` implements snapshot-based undo/redo: `commands.rs`'s `with_undo()` clones the whole in-memory `Vault` before/after a mutation and pushes both onto a bounded stack (`MAX_HISTORY = 50`). `undo()`/`redo()` restore a snapshot directly rather than re-running the original mutation, which would mint new UUIDs and diverge from what was actually undone.

Deliberately **not** undoable: settings changes (better suited to one deliberate "Save" than Ctrl+Z), master-password/import/restore-backup (they change the vault's encryption identity, not just its content), and permanent delete / empty recycle bin (the UI explicitly promises these "cannot be undone" — silently making them undoable would break that promise).

## Retired: the original Electron/Node implementation

Xela shipped on Electron through v2.0.0; `src-tauri/` (Rust) has since fully replaced it, for a fraction of the shipped size - see ROADMAP.md for the concrete before/after numbers. Everything above describes the Rust implementation, which is the only one still in active use.

`public/electron.js`, `public/preload.cjs`, and the JS backend it drove (`src/models/`, `src/services/`, `src/repositories/`, `src/commands/`) have been deleted from the repo entirely - `src-tauri/tests/fixtures/sample-vault.xam` (generated by that old Node app before it was removed) is kept only to round-trip through `vault_repository.rs` in a test confirming the two implementations stayed byte-compatible on the vault file format during the port. If you need to see how the old implementation worked, check git history from before the 3.0.0 cutover; do not resurrect the pattern of dynamic `import()` from a CommonJS main process, ESM-scoped nested `package.json` files, etc. described in older revisions of this document - none of it applies anymore.

## Theming

Four independent, composable settings — `theme`, `accentColor`, `backgroundColor`, `panelColor` — plus an opt-in `backgroundImage`, all applied via `src/utils/theme.js` as inline CSS custom-property overrides on `document.documentElement` (so they win over both the light and dark stylesheet palettes without touching either). `applySurfaceStyling()` deliberately owns both the custom panel color *and* "make panels translucent over a custom background" in one function, since both would otherwise target the same `--color-bg-surface`/`--color-bg-surface-alt` variables and silently clobber each other if split apart.

Settings live inside the encrypted vault like everything else, so none of this is available before unlock — the Login screen falls back to the OS light/dark preference until then.
