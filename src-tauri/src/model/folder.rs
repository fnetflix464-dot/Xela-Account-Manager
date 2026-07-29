// Rust port of src/models/Folder.js.

use super::entry::Entry;
use super::field::ModelError;
use crate::time_util::now_iso8601;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub folders: Vec<Folder>,
    pub entries: Vec<Entry>,
    #[serde(rename = "createdAt", default)]
    pub created_at: String,
    #[serde(rename = "updatedAt", default)]
    pub updated_at: String,
}

pub struct CreateFolderOptions {
    pub name: String,
    pub icon: String,
}

impl Default for CreateFolderOptions {
    fn default() -> Self {
        Self { name: String::new(), icon: "folder".to_string() }
    }
}

pub fn create_folder(opts: CreateFolderOptions) -> Result<Folder, ModelError> {
    if opts.name.is_empty() {
        return Err(ModelError::EmptyFolderName);
    }
    let now = now_iso8601();
    Ok(Folder {
        id: Uuid::new_v4().to_string(),
        name: opts.name,
        icon: opts.icon,
        folders: Vec::new(),
        entries: Vec::new(),
        created_at: now.clone(),
        updated_at: now,
    })
}

pub fn is_folder_valid(folder: &Folder) -> bool {
    !folder.id.is_empty() && !folder.name.is_empty()
}

/// Recursively walks a folder tree, invoking `visitor(node, path)` for the
/// folder itself and every descendant. Read-only traversal.
pub fn walk_folders<'a>(folder: &'a Folder, path: &[String], visitor: &mut dyn FnMut(&'a Folder, &[String])) {
    visitor(folder, path);
    let mut child_path = path.to_vec();
    child_path.push(folder.id.clone());
    for child in &folder.folders {
        walk_folders(child, &child_path, visitor);
    }
}

/// Finds a folder by id anywhere within a folder tree (inclusive of root).
pub fn find_folder_by_id<'a>(root: &'a Folder, folder_id: &str) -> Option<&'a Folder> {
    if root.id == folder_id {
        return Some(root);
    }
    root.folders.iter().find_map(|child| find_folder_by_id(child, folder_id))
}

pub fn find_folder_by_id_mut<'a>(root: &'a mut Folder, folder_id: &str) -> Option<&'a mut Folder> {
    if root.id == folder_id {
        return Some(root);
    }
    root.folders.iter_mut().find_map(|child| find_folder_by_id_mut(child, folder_id))
}

/// Finds the parent folder of a given folder id within a tree. None if
/// folder_id is the root or not found.
pub fn find_parent_folder<'a>(root: &'a Folder, folder_id: &str) -> Option<&'a Folder> {
    for child in &root.folders {
        if child.id == folder_id {
            return Some(root);
        }
        if let Some(found) = find_parent_folder(child, folder_id) {
            return Some(found);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> Folder {
        create_folder(CreateFolderOptions { name: name.into(), ..Default::default() }).unwrap()
    }

    #[test]
    fn rejects_empty_name() {
        assert!(matches!(create_folder(CreateFolderOptions::default()), Err(ModelError::EmptyFolderName)));
    }

    #[test]
    fn find_folder_by_id_locates_nested_folder() {
        let mut root = folder("root");
        let mut child = folder("child");
        let grandchild = folder("grandchild");
        child.folders.push(grandchild.clone());
        root.folders.push(child);

        assert!(find_folder_by_id(&root, &root.id).is_some());
        assert_eq!(find_folder_by_id(&root, &grandchild.id).unwrap().name, "grandchild");
        assert!(find_folder_by_id(&root, "nonexistent").is_none());
    }

    #[test]
    fn find_parent_folder_returns_none_for_root() {
        let mut root = folder("root");
        let child = folder("child");
        root.folders.push(child.clone());

        assert!(find_parent_folder(&root, &root.id).is_none());
        assert_eq!(find_parent_folder(&root, &child.id).unwrap().id, root.id);
    }

    #[test]
    fn walk_folders_visits_every_descendant() {
        let mut root = folder("root");
        root.folders.push(folder("a"));
        root.folders.push(folder("b"));
        let mut names = Vec::new();
        walk_folders(&root, &[], &mut |f, _path| names.push(f.name.clone()));
        assert_eq!(names, vec!["root", "a", "b"]);
    }
}
