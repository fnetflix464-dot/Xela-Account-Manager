import { randomUUID } from 'crypto';

/**
 * Builds a recycle-bin record for a deleted category/folder/entry. The
 * three item types genuinely carry different parent-reference fields
 * (a category has none, a folder needs its categoryId to restore into,
 * an entry needs both categoryId and folderId) - that shape difference is
 * intentional and now expressed in exactly one place instead of being
 * copy-pasted at each call site.
 * @param {Object} options
 * @param {'category'|'folder'|'entry'} options.type
 * @param {Object} options.item the deleted category/folder/entry itself
 * @param {string} [options.categoryId] required for 'folder' and 'entry'
 * @param {string} [options.folderId] required for 'entry'
 */
export function buildRecord({ type, item, categoryId, folderId }) {
  const base = {
    id: randomUUID(),
    type,
    item,
    deletedAt: new Date().toISOString(),
  };
  if (type === 'category') return base;
  if (type === 'folder') return { ...base, categoryId };
  if (type === 'entry') return { ...base, categoryId, folderId };
  throw new Error(`Invalid recycle bin record type: ${type}`);
}

/**
 * Prepends a record to the vault's recycle bin, returning a new vault.
 */
export function addRecord(vault, record) {
  return { ...vault, recycleBin: [record, ...vault.recycleBin] };
}

/**
 * Finds a recycle bin record by id, or null.
 */
export function findRecord(vault, recycleId) {
  return vault.recycleBin.find((r) => r.id === recycleId) || null;
}

/**
 * Removes a record from the recycle bin (used both by restore and by
 * permanent deletion - the only difference is whether the caller
 * re-inserts the item into the live tree first).
 */
export function removeRecord(vault, recycleId) {
  return { ...vault, recycleBin: vault.recycleBin.filter((r) => r.id !== recycleId) };
}

export function list(vault) {
  return vault.recycleBin;
}

export function clear(vault) {
  return { ...vault, recycleBin: [] };
}
