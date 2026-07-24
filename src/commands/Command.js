/**
 * A Command is a single undoable unit of work: `execute` performs it (and
 * returns whatever the caller needs back), `undo` reverses it, `redo`
 * re-applies it. Validated at construction so a malformed command fails
 * fast instead of silently no-op-ing inside CommandManager later.
 * @param {Object} options
 * @param {string} options.label human-readable name, e.g. "Add category"
 * @param {function(): *} options.execute
 * @param {function(): void} options.undo
 * @param {function(): void} options.redo
 */
export function createCommand({ label, execute, undo, redo }) {
  if (typeof execute !== 'function' || typeof undo !== 'function' || typeof redo !== 'function') {
    throw new Error('Command requires execute, undo, and redo functions');
  }
  return { label, execute, undo, redo };
}
