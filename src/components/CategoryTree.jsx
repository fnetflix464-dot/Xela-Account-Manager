import React, { useState } from 'react';
import '../styles/CategoryFilter.css';
import ContextMenu from './ContextMenu';

function countEntries(folder) {
  return folder.entries.length + folder.folders.reduce((sum, f) => sum + countEntries(f), 0);
}

// Prevents dropping a folder onto itself or one of its own descendants -
// the backend's moveFolder doesn't guard against this, and doing so would
// silently lose the folder (it gets removed from its old location before
// being re-inserted at a target that, if it were a descendant, no longer
// exists by that point).
function containsFolderId(folder, targetId) {
  if (folder.id === targetId) return true;
  return folder.folders.some((f) => containsFolderId(f, targetId));
}

// Locates folderId within categoryId's tree and returns its sibling list,
// its index within that list, and its parent folder id (null if it's a
// root folder directly under the category) - everything "Move Up"/"Move
// Down" need to compute a beforeFolderId for moveFolder().
function findFolderContext(categories, categoryId, folderId) {
  const category = categories.find((c) => c.id === categoryId);
  if (!category) return null;

  const search = (siblings, parentFolderId) => {
    const index = siblings.findIndex((f) => f.id === folderId);
    if (index !== -1) return { siblings, index, parentFolderId };
    for (const sibling of siblings) {
      const found = search(sibling.folders, sibling.id);
      if (found) return found;
    }
    return null;
  };

  return search(category.folders, null);
}

function FolderNode({
  folder,
  categoryId,
  selectedFolderId,
  onSelectFolder,
  onContextMenu,
  dragState,
  dragOverId,
  setDragOverId,
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = folder.folders.length > 0;
  const isDragging = dragState.draggedFolder && dragState.draggedFolder.folder.id === folder.id;
  const isValidDropTarget =
    dragState.draggedFolder && !containsFolderId(dragState.draggedFolder.folder, folder.id);

  return (
    <div className="tree-node">
      <button
        className={`category-item ${selectedFolderId === folder.id ? 'active' : ''} ${
          isDragging ? 'dragging' : ''
        } ${dragOverId === folder.id ? 'drag-over' : ''}`}
        draggable
        onClick={() => onSelectFolder(categoryId, folder.id)}
        onDoubleClick={() => hasChildren && setExpanded((v) => !v)}
        onContextMenu={(e) => onContextMenu(e, folder, categoryId)}
        onDragStart={(e) => {
          e.stopPropagation();
          dragState.start(folder, categoryId);
        }}
        onDragEnd={() => dragState.end()}
        onDragOver={(e) => {
          if (!isValidDropTarget) return;
          e.preventDefault();
          e.stopPropagation();
          setDragOverId(folder.id);
        }}
        onDragLeave={() => setDragOverId((prev) => (prev === folder.id ? null : prev))}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOverId(null);
          if (isValidDropTarget) dragState.drop(categoryId, folder.id);
        }}
      >
        <span
          className={`tree-toggle ${hasChildren ? '' : 'invisible'}`}
          role="button"
          tabIndex={-1}
          onClick={(e) => {
            if (!hasChildren) return;
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          {hasChildren ? (expanded ? '▾' : '▸') : '▸'}
        </span>
        <span className="name">{folder.name}</span>
        <span className="count">{countEntries(folder)}</span>
      </button>

      {hasChildren && expanded && (
        <div className="tree-children">
          {folder.folders.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              categoryId={categoryId}
              selectedFolderId={selectedFolderId}
              onSelectFolder={onSelectFolder}
              onContextMenu={onContextMenu}
              dragState={dragState}
              dragOverId={dragOverId}
              setDragOverId={setDragOverId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryNode({
  category,
  selectedCategoryId,
  selectedFolderId,
  onSelectFolder,
  onContextMenu,
  dragState,
  dragOverId,
  setDragOverId,
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = category.folders.length > 0;

  return (
    <div className="tree-node">
      <button
        className={`category-item ${selectedCategoryId === category.id && !selectedFolderId ? 'active' : ''} ${
          dragOverId === category.id ? 'drag-over' : ''
        }`}
        onClick={() => onSelectFolder(category.id, null)}
        onDoubleClick={() => hasChildren && setExpanded((v) => !v)}
        onContextMenu={(e) => onContextMenu(e, null, category.id)}
        onDragOver={(e) => {
          if (!dragState.draggedFolder) return;
          e.preventDefault();
          setDragOverId(category.id);
        }}
        onDragLeave={() => setDragOverId((prev) => (prev === category.id ? null : prev))}
        onDrop={(e) => {
          e.preventDefault();
          setDragOverId(null);
          if (dragState.draggedFolder) dragState.drop(category.id, null);
        }}
      >
        <span
          className={`tree-toggle ${hasChildren ? '' : 'invisible'}`}
          role="button"
          tabIndex={-1}
          onClick={(e) => {
            if (!hasChildren) return;
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          {hasChildren ? (expanded ? '▾' : '▸') : '▸'}
        </span>
        <span className="name">{category.name}</span>
        <span className="count">{category.folders.reduce((sum, f) => sum + countEntries(f), 0)}</span>
      </button>

      {hasChildren && expanded && (
        <div className="tree-children">
          {category.folders.map((folder) => (
            <FolderNode
              key={folder.id}
              folder={folder}
              categoryId={category.id}
              selectedFolderId={selectedFolderId}
              onSelectFolder={onSelectFolder}
              onContextMenu={onContextMenu}
              dragState={dragState}
              dragOverId={dragOverId}
              setDragOverId={setDragOverId}
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
  onRenameCategory,
  onRenameFolder,
  onDeleteCategory,
  onDeleteFolder,
  onMoveFolder,
}) {
  const [menu, setMenu] = useState(null);
  const [draggedFolder, setDraggedFolder] = useState(null); // { folder, categoryId } | null
  const [dragOverId, setDragOverId] = useState(null);

  const dragState = {
    draggedFolder,
    start: (folder, categoryId) => setDraggedFolder({ folder, categoryId }),
    end: () => setDraggedFolder(null),
    drop: (targetCategoryId, targetParentFolderId) => {
      if (draggedFolder) {
        onMoveFolder(draggedFolder.folder.id, targetCategoryId, targetParentFolderId);
      }
      setDraggedFolder(null);
    },
  };

  // folder === null means this context menu was opened on a category row
  // (categoryId is the category itself); otherwise it's a folder row
  // (categoryId is that folder's owning category).
  const openContextMenu = (event, folder, categoryId) => {
    event.preventDefault();
    const items = folder
      ? (() => {
          const context = findFolderContext(categories, categoryId, folder.id);
          const moveItems = [];
          if (context && context.index > 0) {
            moveItems.push({
              label: 'Move Up',
              onClick: () =>
                onMoveFolder(folder.id, categoryId, context.parentFolderId, context.siblings[context.index - 1].id),
            });
          }
          if (context && context.index < context.siblings.length - 1) {
            moveItems.push({
              label: 'Move Down',
              onClick: () =>
                onMoveFolder(
                  folder.id,
                  categoryId,
                  context.parentFolderId,
                  context.siblings[context.index + 2] ? context.siblings[context.index + 2].id : null,
                ),
            });
          }
          return [
            { label: 'New Subfolder', onClick: () => onAddFolder(categoryId, folder.id) },
            { label: 'Rename Folder', onClick: () => onRenameFolder(categoryId, folder.id, folder.name) },
            ...moveItems,
            {
              label: 'Delete Folder',
              danger: true,
              onClick: () => onDeleteFolder(categoryId, folder.id),
            },
          ];
        })()
      : [
          { label: 'New Folder', onClick: () => onAddFolder(categoryId, null) },
          {
            label: 'Rename Category',
            onClick: () => onRenameCategory(categoryId, categories.find((c) => c.id === categoryId).name),
          },
          { label: 'Delete Category', danger: true, onClick: () => onDeleteCategory(categoryId) },
        ];
    setMenu({ x: event.clientX, y: event.clientY, items });
  };

  return (
    <div className="category-filter">
      <div className="category-filter-header">
        <h3>Categories</h3>
        <button className="btn-icon-plus" onClick={onAddCategory} title="New Category">
          +
        </button>
      </div>
      <div className="categories-list">
        {categories.map((category) => (
          <CategoryNode
            key={category.id}
            category={category}
            selectedCategoryId={selectedCategoryId}
            selectedFolderId={selectedFolderId}
            onSelectFolder={onSelectFolder}
            onContextMenu={openContextMenu}
            dragState={dragState}
            dragOverId={dragOverId}
            setDragOverId={setDragOverId}
          />
        ))}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

export default CategoryTree;
