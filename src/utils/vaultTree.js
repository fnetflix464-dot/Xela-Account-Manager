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

/** Recursively collects every entry within a folder (including subfolders). */
export function collectEntries(folder) {
  return [...folder.entries, ...folder.folders.flatMap(collectEntries)];
}

/** Recursively collects every entry within a category (all folders). */
export function collectCategoryEntries(category) {
  return category.folders.flatMap(collectEntries);
}
