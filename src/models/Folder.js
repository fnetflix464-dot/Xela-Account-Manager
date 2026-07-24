const { randomUUID } = require('crypto');

/**
 * Creates a Folder. Folders can nest other folders without limit and hold
 * Entry objects directly.
 * @param {Object} options
 */
function createFolder({ name, icon = 'folder', folders = [], entries = [] } = {}) {
  if (!name || typeof name !== 'string') {
    throw new Error('Folder requires a non-empty name');
  }
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name,
    icon,
    folders: Array.isArray(folders) ? folders : [],
    entries: Array.isArray(entries) ? entries : [],
    createdAt: now,
    updatedAt: now,
  };
}

function updateFolder(folder, updates = {}) {
  return {
    ...folder,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
}

function isFolderValid(folder) {
  return (
    !!folder &&
    typeof folder.id === 'string' &&
    typeof folder.name === 'string' &&
    Array.isArray(folder.folders) &&
    Array.isArray(folder.entries)
  );
}

/**
 * Recursively walks a folder tree, invoking visitor(node, path) for the
 * folder itself and every descendant folder. Read-only traversal.
 */
function walkFolders(folder, visitor, path = []) {
  visitor(folder, path);
  for (const child of folder.folders) {
    walkFolders(child, visitor, [...path, folder.id]);
  }
}

/**
 * Finds a folder by id anywhere within a folder tree (inclusive of root).
 * Returns null if not found.
 */
function findFolderById(rootFolder, folderId) {
  if (rootFolder.id === folderId) return rootFolder;
  for (const child of rootFolder.folders) {
    const found = findFolderById(child, folderId);
    if (found) return found;
  }
  return null;
}

/**
 * Finds the parent folder of a given folder id within a tree.
 * Returns null if folderId is the root or not found.
 */
function findParentFolder(rootFolder, folderId) {
  for (const child of rootFolder.folders) {
    if (child.id === folderId) return rootFolder;
    const found = findParentFolder(child, folderId);
    if (found) return found;
  }
  return null;
}

module.exports = {
  createFolder,
  updateFolder,
  isFolderValid,
  walkFolders,
  findFolderById,
  findParentFolder,
};
