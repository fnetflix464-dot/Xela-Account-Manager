import { eventBus, VAULT_EVENT_CHANNEL, emitVaultEvent } from '../services/EventBus.js';

const MAX_HISTORY = 50;

// Vault lifecycle transitions after which a previously-recorded snapshot
// would no longer make sense to restore (a new/different vault is now
// live, or the session ended) - the stack is cleared, not persisted.
const CLEARING_ACTIONS = new Set(['vault.created', 'vault.imported', 'vault.locked']);

/**
 * Session-only (never persisted to disk) undo/redo stack of Commands.
 * Bounded to MAX_HISTORY entries. Persisting this would mean writing
 * plaintext vault snapshots to disk for a UX nicety - unnecessary attack
 * surface for a password vault, so it lives in memory only and is
 * cleared whenever the underlying vault identity changes (created,
 * imported, or locked).
 */
export function createCommandManager() {
  let undoStack = [];
  let redoStack = [];

  function notifyChanged() {
    emitVaultEvent('command.stackChanged', { canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
  }

  function execute(command) {
    const result = command.execute();
    undoStack = [...undoStack, command].slice(-MAX_HISTORY);
    redoStack = [];
    notifyChanged();
    return result;
  }

  function undo() {
    if (undoStack.length === 0) return false;
    const command = undoStack[undoStack.length - 1];
    undoStack = undoStack.slice(0, -1);
    command.undo();
    redoStack = [...redoStack, command];
    notifyChanged();
    return true;
  }

  function redo() {
    if (redoStack.length === 0) return false;
    const command = redoStack[redoStack.length - 1];
    redoStack = redoStack.slice(0, -1);
    command.redo();
    undoStack = [...undoStack, command];
    notifyChanged();
    return true;
  }

  function canUndo() {
    return undoStack.length > 0;
  }

  function canRedo() {
    return redoStack.length > 0;
  }

  function clear() {
    if (undoStack.length === 0 && redoStack.length === 0) return;
    undoStack = [];
    redoStack = [];
    notifyChanged();
  }

  eventBus.on(VAULT_EVENT_CHANNEL, (event) => {
    if (CLEARING_ACTIONS.has(event.action)) {
      clear();
    }
  });

  return { execute, undo, redo, canUndo, canRedo, clear };
}
