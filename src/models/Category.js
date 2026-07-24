const { randomUUID } = require('crypto');
const { createFolder } = require('./Folder');

/**
 * Creates a Category. Categories are the top-level containers in the
 * vault's tree (e.g. "Personal", "Work") and hold Folders.
 * @param {Object} options
 */
function createCategory({ name, icon = 'category', folders = [] } = {}) {
  if (!name || typeof name !== 'string') {
    throw new Error('Category requires a non-empty name');
  }
  return {
    id: randomUUID(),
    name,
    icon,
    folders: Array.isArray(folders) ? folders : [],
  };
}

function updateCategory(category, updates = {}) {
  return { ...category, ...updates };
}

function isCategoryValid(category) {
  return (
    !!category &&
    typeof category.id === 'string' &&
    typeof category.name === 'string' &&
    Array.isArray(category.folders)
  );
}

/** Convenience: create a category pre-populated with a default "General" folder. */
function createDefaultCategory(name, icon) {
  return createCategory({ name, icon, folders: [createFolder({ name: 'General' })] });
}

module.exports = {
  createCategory,
  updateCategory,
  isCategoryValid,
  createDefaultCategory,
};
