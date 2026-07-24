export function findCategory(categories, categoryId) {
  return categories.find((c) => c.id === categoryId) || null;
}

export function findFolderInTree(rootFolder, folderId) {
  if (rootFolder.id === folderId) return rootFolder;
  for (const child of rootFolder.folders) {
    const found = findFolderInTree(child, folderId);
    if (found) return found;
  }
  return null;
}

export function findFolder(categories, categoryId, folderId) {
  const category = findCategory(categories, categoryId);
  if (!category || !folderId) return null;
  for (const rootFolder of category.folders) {
    const found = findFolderInTree(rootFolder, folderId);
    if (found) return found;
  }
  return null;
}

function findParentInTree(folder, targetId) {
  for (const child of folder.folders) {
    if (child.id === targetId) return folder;
    const found = findParentInTree(child, targetId);
    if (found) return found;
  }
  return null;
}

/**
 * Returns the id of folderId's parent folder, or `null` if folderId is a
 * root folder (its "parent" is the category itself), or `undefined` if
 * folderId can't be found at all.
 */
export function findParentFolderId(categories, categoryId, folderId) {
  const category = findCategory(categories, categoryId);
  if (!category) return undefined;
  for (const rootFolder of category.folders) {
    if (rootFolder.id === folderId) return null;
    const parent = findParentInTree(rootFolder, folderId);
    if (parent) return parent.id;
  }
  return undefined;
}
