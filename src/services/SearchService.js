/**
 * SearchService performs read-only, in-memory search over an unlocked
 * Vault object. It never touches disk or encryption directly - it's
 * handed the already-decrypted vault by VaultService.
 */

function normalize(str) {
  return (str || '').toString().toLowerCase();
}

function matchesQuery(haystack, query) {
  return normalize(haystack).includes(normalize(query));
}

/**
 * Searches a single entry's own data: title, tags, field labels, and
 * non-hidden field values (hidden/secret values like passwords and PINs
 * are intentionally excluded from search matching).
 */
function entryMatches(entry, query) {
  if (matchesQuery(entry.title, query)) return true;
  if (entry.tags.some((tag) => matchesQuery(tag, query))) return true;
  return entry.fields.some((field) => {
    if (matchesQuery(field.label, query)) return true;
    if (!field.hidden && matchesQuery(field.value, query)) return true;
    return false;
  });
}

/**
 * Runs a global, case-insensitive search across every category, folder,
 * and entry in the vault. Returns a flat list of results annotated with
 * their location in the tree.
 * @param {Object} vault
 * @param {string} query
 * @returns {Array<{ type: 'category'|'folder'|'entry', item: Object, categoryId: string, categoryName: string, folderPath: Array<{id:string,name:string}> }>}
 */
function search(vault, query) {
  const trimmed = (query || '').trim();
  if (!trimmed) return [];

  const results = [];

  function walkFolder(folder, category, folderPath) {
    if (matchesQuery(folder.name, trimmed)) {
      results.push({
        type: 'folder',
        item: folder,
        categoryId: category.id,
        categoryName: category.name,
        folderPath,
      });
    }

    for (const entry of folder.entries) {
      if (entryMatches(entry, trimmed)) {
        results.push({
          type: 'entry',
          item: entry,
          categoryId: category.id,
          categoryName: category.name,
          folderPath,
        });
      }
    }

    for (const child of folder.folders) {
      walkFolder(child, category, [...folderPath, { id: folder.id, name: folder.name }]);
    }
  }

  for (const category of vault.categories) {
    if (matchesQuery(category.name, trimmed)) {
      results.push({
        type: 'category',
        item: category,
        categoryId: category.id,
        categoryName: category.name,
        folderPath: [],
      });
    }
    for (const folder of category.folders) {
      walkFolder(folder, category, []);
    }
  }

  return results;
}

module.exports = {
  search,
  entryMatches,
};
