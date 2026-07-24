import React, { useState } from 'react';
import '../styles/CategoryFilter.css';

const FOLDER_EMOJI = '📁';
const CATEGORY_EMOJI = '🗂️';

function countEntries(folder) {
  return folder.entries.length + folder.folders.reduce((sum, f) => sum + countEntries(f), 0);
}

function FolderNode({ folder, categoryId, depth, selectedFolderId, onSelectFolder, onAddSubfolder, onDeleteFolder }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = folder.folders.length > 0;

  return (
    <div className="tree-node">
      <button
        className={`category-item ${selectedFolderId === folder.id ? 'active' : ''}`}
        style={{ paddingLeft: `${1 + depth * 1.25}rem` }}
        onClick={() => onSelectFolder(categoryId, folder.id)}
      >
        {hasChildren && (
          <span
            className="tree-toggle"
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
          >
            {expanded ? '▾' : '▸'}
          </span>
        )}
        <span className="emoji">{FOLDER_EMOJI}</span>
        <span className="name">{folder.name}</span>
        <span className="count">{countEntries(folder)}</span>
      </button>

      <div className="tree-node-actions" style={{ paddingLeft: `${1 + depth * 1.25}rem` }}>
        <button
          className="tree-action-btn"
          title="New subfolder"
          onClick={(e) => {
            e.stopPropagation();
            onAddSubfolder(categoryId, folder.id);
          }}
        >
          ➕ Folder
        </button>
        <button
          className="tree-action-btn danger"
          title="Delete folder"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteFolder(categoryId, folder.id);
          }}
        >
          🗑️
        </button>
      </div>

      {hasChildren && expanded && (
        <div className="tree-children">
          {folder.folders.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              categoryId={categoryId}
              depth={depth + 1}
              selectedFolderId={selectedFolderId}
              onSelectFolder={onSelectFolder}
              onAddSubfolder={onAddSubfolder}
              onDeleteFolder={onDeleteFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryTree({
  categories,
  selectedCategoryId,
  selectedFolderId,
  onSelectFolder,
  onAddCategory,
  onAddFolder,
  onDeleteCategory,
  onDeleteFolder,
}) {
  return (
    <div className="category-filter">
      <h3>🗂️ Categories</h3>
      <div className="categories-list">
        {categories.map((category) => (
          <div key={category.id} className="tree-node">
            <button
              className={`category-item ${
                selectedCategoryId === category.id && !selectedFolderId ? 'active' : ''
              }`}
              onClick={() => onSelectFolder(category.id, null)}
            >
              <span className="emoji">{CATEGORY_EMOJI}</span>
              <span className="name">{category.name}</span>
              <span className="count">
                {category.folders.reduce((sum, f) => sum + countEntries(f), 0)}
              </span>
            </button>
            <div className="tree-node-actions">
              <button
                className="tree-action-btn"
                title="New folder"
                onClick={() => onAddFolder(category.id, null)}
              >
                ➕ Folder
              </button>
              <button
                className="tree-action-btn danger"
                title="Delete category"
                onClick={() => onDeleteCategory(category.id)}
              >
                🗑️
              </button>
            </div>

            {category.folders.map((folder) => (
              <FolderNode
                key={folder.id}
                folder={folder}
                categoryId={category.id}
                depth={1}
                selectedFolderId={selectedFolderId}
                onSelectFolder={onSelectFolder}
                onAddSubfolder={onAddFolder}
                onDeleteFolder={onDeleteFolder}
              />
            ))}
          </div>
        ))}
      </div>

      <button className="btn btn-outline btn-add-category" onClick={onAddCategory}>
        ➕ New Category
      </button>
    </div>
  );
}

export default CategoryTree;
