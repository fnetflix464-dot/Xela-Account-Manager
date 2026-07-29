// Rust port of src/services/SearchService.js. Read-only, in-memory search
// over an unlocked Vault - never touches disk or encryption directly.

use crate::model::{Category, Entry, Folder, Vault};
use serde::Serialize;

fn normalize(s: &str) -> String {
    s.to_lowercase()
}

fn matches_query(haystack: &str, query: &str) -> bool {
    normalize(haystack).contains(&normalize(query))
}

/// Searches a single entry's own data: title, tags, field labels, and
/// non-hidden field values (hidden/secret values are intentionally
/// excluded from search matching).
pub fn entry_matches(entry: &Entry, query: &str) -> bool {
    if matches_query(&entry.title, query) {
        return true;
    }
    if entry.tags.iter().any(|tag| matches_query(tag, query)) {
        return true;
    }
    entry.fields.iter().any(|field| {
        matches_query(&field.label, query) || (!field.hidden && matches_query(&field.value, query))
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SearchResult {
    Category {
        item: Category,
        #[serde(rename = "categoryId")]
        category_id: String,
        #[serde(rename = "categoryName")]
        category_name: String,
        #[serde(rename = "folderPath")]
        folder_path: Vec<FolderPathSegment>,
    },
    Folder {
        item: Folder,
        #[serde(rename = "categoryId")]
        category_id: String,
        #[serde(rename = "categoryName")]
        category_name: String,
        #[serde(rename = "folderPath")]
        folder_path: Vec<FolderPathSegment>,
    },
    Entry {
        item: Entry,
        #[serde(rename = "categoryId")]
        category_id: String,
        #[serde(rename = "categoryName")]
        category_name: String,
        #[serde(rename = "folderPath")]
        folder_path: Vec<FolderPathSegment>,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderPathSegment {
    pub id: String,
    pub name: String,
}

/// Runs a global, case-insensitive search across every category, folder,
/// and entry in the vault.
pub fn search(vault: &Vault, query: &str) -> Vec<SearchResult> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let mut results = Vec::new();

    fn walk_folder(
        folder: &Folder,
        category: &Category,
        folder_path: &[FolderPathSegment],
        query: &str,
        results: &mut Vec<SearchResult>,
    ) {
        if matches_query(&folder.name, query) {
            results.push(SearchResult::Folder {
                item: folder.clone(),
                category_id: category.id.clone(),
                category_name: category.name.clone(),
                folder_path: folder_path.to_vec(),
            });
        }
        for entry in &folder.entries {
            if entry_matches(entry, query) {
                results.push(SearchResult::Entry {
                    item: entry.clone(),
                    category_id: category.id.clone(),
                    category_name: category.name.clone(),
                    folder_path: folder_path.to_vec(),
                });
            }
        }
        for child in &folder.folders {
            let mut next_path = folder_path.to_vec();
            next_path.push(FolderPathSegment { id: folder.id.clone(), name: folder.name.clone() });
            walk_folder(child, category, &next_path, query, results);
        }
    }

    for category in &vault.categories {
        if matches_query(&category.name, trimmed) {
            results.push(SearchResult::Category {
                item: category.clone(),
                category_id: category.id.clone(),
                category_name: category.name.clone(),
                folder_path: Vec::new(),
            });
        }
        for folder in &category.folders {
            walk_folder(folder, category, &[], trimmed, &mut results);
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::category::create_category;
    use crate::model::entry::{create_entry, CreateEntryOptions};
    use crate::model::folder::create_folder;
    use crate::model::vault::create_vault;
    use crate::model::{CreateCategoryOptions, CreateFolderOptions};

    fn vault_with_one_entry(title: &str) -> Vault {
        let mut folder = create_folder(CreateFolderOptions { name: "Logins".into(), ..Default::default() }).unwrap();
        let entry = create_entry(CreateEntryOptions { title: title.into(), template: "Login".into(), ..Default::default() }).unwrap();
        folder.entries.push(entry);
        let mut category = create_category(CreateCategoryOptions { name: "Personal".into(), ..Default::default() }).unwrap();
        category.folders.push(folder);
        let mut vault = create_vault();
        vault.categories.push(category);
        vault
    }

    #[test]
    fn empty_query_returns_no_results() {
        let vault = vault_with_one_entry("Gmail");
        assert!(search(&vault, "").is_empty());
        assert!(search(&vault, "   ").is_empty());
    }

    #[test]
    fn matches_entry_title_case_insensitively() {
        let vault = vault_with_one_entry("Gmail Account");
        let results = search(&vault, "gmail");
        assert_eq!(results.len(), 1);
        assert!(matches!(&results[0], SearchResult::Entry { .. }));
    }

    #[test]
    fn excludes_hidden_field_values_from_matching() {
        let vault = vault_with_one_entry("My Login");
        // The Login template's Password field is auto-hidden; its
        // generated value is empty so search on a real secret value here.
        let mut vault = vault;
        vault.categories[0].folders[0].entries[0].fields[1].hidden = true;
        vault.categories[0].folders[0].entries[0].fields[1].value = "supersecret".into();
        assert!(search(&vault, "supersecret").is_empty());
    }

    #[test]
    fn matches_non_hidden_field_values() {
        let mut vault = vault_with_one_entry("My Login");
        vault.categories[0].folders[0].entries[0].fields[0].hidden = false;
        vault.categories[0].folders[0].entries[0].fields[0].value = "alice@example.com".into();
        assert_eq!(search(&vault, "alice@example.com").len(), 1);
    }

    #[test]
    fn matches_category_and_folder_names() {
        let vault = vault_with_one_entry("X");
        assert_eq!(search(&vault, "Personal").len(), 1);
        assert_eq!(search(&vault, "Logins").len(), 1);
    }
}
