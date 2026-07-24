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

## Not yet done

- [ ] Quick Access / pinned folders in the sidebar (deferred — under-specified; Favorites and Recent already cover most of the need)
- [ ] Vault health check (settings-page report: encryption OK, no duplicate UUIDs, tree integrity, no orphan entries, backups available)
- [ ] Folder/subfolder drag-to-reorder position (Move Up/Move Down exists; direct drag reordering does not)
- [ ] Auto-updater / release channel beyond manual GitHub releases

Nothing here is scheduled — this list exists so work doesn't get proposed twice, not as a commitment.
