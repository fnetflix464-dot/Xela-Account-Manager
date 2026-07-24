import { randomUUID } from 'crypto';

// Capped so the vault file doesn't grow unbounded over the life of a vault.
export const MAX_ACTIVITY_LOG_ENTRIES = 500;

/**
 * Appends an activity log entry to a vault, returning a new vault object
 * (the log itself lives inside the encrypted vault blob, alongside
 * everything else - there is no separate on-disk file for it).
 * @param {Object} vault
 * @param {string} action e.g. 'entry.created'
 * @param {Object} [details]
 */
export function record(vault, action, details = {}) {
  const entry = {
    id: randomUUID(),
    action,
    details,
    timestamp: new Date().toISOString(),
  };
  const activityLog = [entry, ...vault.activityLog].slice(0, MAX_ACTIVITY_LOG_ENTRIES);
  return { ...vault, activityLog };
}

/**
 * Returns the most recent `limit` activity log entries, newest first.
 */
export function list(vault, limit = 20) {
  return vault.activityLog.slice(0, limit);
}
