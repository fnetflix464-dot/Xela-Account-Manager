// Rust port of src/models/Category.js.

use super::field::ModelError;
use super::folder::{create_folder, CreateFolderOptions, Folder};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub folders: Vec<Folder>,
}

pub struct CreateCategoryOptions {
    pub name: String,
    pub icon: String,
    pub folders: Vec<Folder>,
}

impl Default for CreateCategoryOptions {
    fn default() -> Self {
        Self { name: String::new(), icon: "category".to_string(), folders: Vec::new() }
    }
}

pub fn create_category(opts: CreateCategoryOptions) -> Result<Category, ModelError> {
    if opts.name.is_empty() {
        return Err(ModelError::EmptyCategoryName);
    }
    Ok(Category { id: Uuid::new_v4().to_string(), name: opts.name, icon: opts.icon, folders: opts.folders })
}

/// Convenience: create a category pre-populated with a default "General" folder.
pub fn create_default_category(name: &str, icon: &str) -> Result<Category, ModelError> {
    let general = create_folder(CreateFolderOptions { name: "General".into(), ..Default::default() })?;
    create_category(CreateCategoryOptions { name: name.into(), icon: icon.into(), folders: vec![general] })
}

pub fn is_category_valid(category: &Category) -> bool {
    !category.id.is_empty() && !category.name.is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_name() {
        assert!(matches!(create_category(CreateCategoryOptions::default()), Err(ModelError::EmptyCategoryName)));
    }

    #[test]
    fn default_category_has_a_general_folder() {
        let cat = create_default_category("Personal", "category").unwrap();
        assert_eq!(cat.folders.len(), 1);
        assert_eq!(cat.folders[0].name, "General");
    }
}
