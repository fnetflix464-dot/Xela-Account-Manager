import { useCallback, useEffect, useState } from 'react';

/**
 * Wires Ctrl/Cmd+Z (undo) and Ctrl/Cmd+Shift+Z (redo) to the main
 * process's CommandManager. The undo/redo stack itself lives in the main
 * process (see src/commands/CommandManager.js), so canUndo/canRedo are
 * kept in sync here via the 'vault-event' push channel's
 * `command.stackChanged` events rather than local state.
 * @param {Object} options
 * @param {boolean} options.enabled only listen/track state while the vault is unlocked
 * @param {function(): void} options.onChanged called after a successful undo/redo so the caller can reload its tree
 */
export function useUndoRedo({ enabled, onChanged }) {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const refreshState = useCallback(async () => {
    const result = await window.api.getUndoState();
    if (result.success) {
      setCanUndo(result.data.canUndo);
      setCanRedo(result.data.canRedo);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setCanUndo(false);
      setCanRedo(false);
      return undefined;
    }

    refreshState();

    const unsubscribe = window.api.onVaultEvent((event) => {
      if (event.action === 'command.stackChanged') {
        setCanUndo(event.details.canUndo);
        setCanRedo(event.details.canRedo);
      }
    });
    return unsubscribe;
  }, [enabled, refreshState]);

  const undo = useCallback(async () => {
    const result = await window.api.undo();
    if (result.success && result.data) {
      onChanged();
    }
  }, [onChanged]);

  const redo = useCallback(async () => {
    const result = await window.api.redo();
    if (result.success && result.data) {
      onChanged();
    }
  }, [onChanged]);

  useEffect(() => {
    if (!enabled) return undefined;

    const handleKeyDown = (e) => {
      const isModPressed = e.ctrlKey || e.metaKey;
      if (!isModPressed || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, undo, redo]);

  return { canUndo, canRedo, undo, redo };
}
