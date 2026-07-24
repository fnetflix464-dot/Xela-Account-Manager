import { EventEmitter } from 'node:events';

/**
 * Process-wide event bus for genuinely decoupled, order-insensitive
 * notifications - NOT for anything that must land inside the same
 * persisted vault blob (activity log / recycle bin entries are written
 * synchronously by VaultService itself, before persist(), precisely to
 * avoid the ordering hazards pub/sub would introduce there).
 *
 * Emitted on the single 'vault-event' channel with a
 * `{ action, details, timestamp }` payload (the same shape already used
 * by the activity log), after a mutation has been durably persisted (or,
 * for `lock`, after session state has been cleared). Consumers today:
 *  - public/electron.js forwards every event to the renderer.
 *  - CommandManager (Phase 4) clears its undo/redo stacks on the vault
 *    lifecycle transitions (created/imported/locked).
 */
export const eventBus = new EventEmitter();

export const VAULT_EVENT_CHANNEL = 'vault-event';

/**
 * Emits a vault-event with a consistent envelope shape.
 * @param {string} action e.g. 'entry.created', 'vault.locked'
 * @param {Object} [details]
 */
export function emitVaultEvent(action, details = {}) {
  eventBus.emit(VAULT_EVENT_CHANNEL, {
    action,
    details,
    timestamp: new Date().toISOString(),
  });
}
