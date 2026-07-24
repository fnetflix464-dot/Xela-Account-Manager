import React, { useState, useEffect, useCallback } from 'react';
import './styles/App.css';
import Login from './components/Login';
import CategoryTree from './components/CategoryTree';
import EntryList from './components/EntryList';
import EntryForm from './components/EntryForm';
import RecycleBin from './components/RecycleBin';
import ActivityLog from './components/ActivityLog';
import Settings from './components/Settings';
import { findCategory, findFolder, findParentFolderId } from './utils/vaultTree';
import { useUndoRedo } from './hooks/useUndoRedo';
import { applyTheme } from './utils/theme';
import entryTemplates from './data/entryTemplates.json';

const ENTRY_TEMPLATES = entryTemplates.map((t) => t.name);

function NewEntryModal({ onCreate, onCancel }) {
  const [template, setTemplate] = useState('Login');
  const [title, setTitle] = useState('');

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <button className="modal-close" onClick={onCancel}>
          ✕
        </button>
        <h3>New Entry</h3>
        <div className="form-group">
          <label>Template</label>
          <select value={template} onChange={(e) => setTemplate(e.target.value)}>
            {ENTRY_TEMPLATES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Title *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. GitHub, Chase Checking"
            autoFocus
          />
        </div>
        <div className="form-actions">
          <button className="btn btn-outline" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!title.trim()}
            onClick={() => onCreate(template, title.trim())}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

// Electron's renderer does not implement window.prompt() (it throws
// "prompt() is and will not be supported"), unlike alert()/confirm()
// which do work - so free-text input needs a real modal instead.
function PromptModal({ title, placeholder, onSubmit, onCancel }) {
  const [value, setValue] = useState('');

  const submit = () => {
    if (!value.trim()) return;
    onSubmit(value.trim());
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <button className="modal-close" onClick={onCancel}>
          ✕
        </button>
        <h3>{title}</h3>
        <div className="form-group">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
        </div>
        <div className="form-actions">
          <button className="btn btn-outline" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!value.trim()} onClick={submit}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [categories, setCategories] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [activeTab, setActiveTab] = useState('vault');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [editingEntry, setEditingEntry] = useState(null);
  const [showNewEntryModal, setShowNewEntryModal] = useState(false);
  const [promptModal, setPromptModal] = useState(null); // { title, placeholder, onSubmit } | null
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const clearError = () => setError('');

  // Applies the theme setting to the whole app, including the Login
  // screen: settings live inside the encrypted vault, so pre-auth (or on
  // a fresh install before any setting exists) this falls back to the OS
  // preference. Only tracks live OS-preference changes while resolved
  // that way ('system', or no settings loaded yet) - an explicit
  // light/dark choice shouldn't shift out from under the user.
  useEffect(() => {
    const preference = settings ? settings.theme : 'system';
    applyTheme(preference);

    if (preference === 'system') {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyTheme(preference);
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }
    return undefined;
  }, [settings]);

  // The main window starts sized for the small Login card; grow it to
  // the full app size once authenticated, and shrink back on lock.
  useEffect(() => {
    window.electron.setWindowMode(isAuthenticated ? 'app' : 'login');
  }, [isAuthenticated]);

  const loadTree = useCallback(async () => {
    const result = await window.electron.getVaultTree();
    if (result.success) {
      setCategories(result.data);
      if (!selectedCategoryId && result.data.length > 0) {
        setSelectedCategoryId(result.data[0].id);
      }
    } else {
      setError(result.error);
    }
  }, [selectedCategoryId]);

  const loadSettings = useCallback(async () => {
    const result = await window.electron.getSettings();
    if (result.success) setSettings(result.data);
  }, []);

  const { canUndo, canRedo, undo, redo } = useUndoRedo({ enabled: isAuthenticated, onChanged: loadTree });

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    loadTree();
    loadSettings();

    const unsubscribe = window.electron.onVaultEvent((event) => {
      if (event.action === 'vault.locked') {
        setIsAuthenticated(false);
        setCategories([]);
        setEditingEntry(null);
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated) return undefined;
    if (!searchTerm.trim()) {
      setSearchResults(null);
      return undefined;
    }
    window.electron.searchVault(searchTerm).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setSearchResults(result.data.filter((r) => r.type === 'entry').map((r) => r.item));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [searchTerm, isAuthenticated]);

  const handleLoginSuccess = () => setIsAuthenticated(true);

  const handleLock = async () => {
    await window.electron.lockVault();
    setIsAuthenticated(false);
    setCategories([]);
    setEditingEntry(null);
  };

  const handleSelectFolder = (categoryId, folderId) => {
    setSelectedCategoryId(categoryId);
    setSelectedFolderId(folderId);
    setSearchTerm('');
    // Without this, navigating to a different folder/category while an
    // entry's edit form is open leaves that form on screen (it isn't
    // keyed to the selected folder), so the newly-selected folder's
    // contents never actually get shown until the stale form is
    // manually closed - easy to mistake for "the entry isn't there."
    setEditingEntry(null);
  };

  const handleGoBack = () => {
    if (!selectedFolderId) return; // already at category level, nothing above it
    const parentId = findParentFolderId(categories, selectedCategoryId, selectedFolderId);
    setSelectedFolderId(parentId || null);
    setSearchTerm('');
    setEditingEntry(null);
  };

  // ---- categories / folders ----

  const handleAddCategory = () => {
    setPromptModal({
      title: 'New category name',
      placeholder: 'e.g. Personal, Work',
      onSubmit: async (name) => {
        setPromptModal(null);
        setLoading(true);
        const result = await window.electron.addCategory(name, 'category');
        setLoading(false);
        if (result.success) loadTree();
        else setError(result.error);
      },
    });
  };

  const handleDeleteCategory = async (categoryId) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete this category and everything in it? It will move to the Recycle Bin.')) return;
    setLoading(true);
    const result = await window.electron.deleteCategory(categoryId);
    setLoading(false);
    if (result.success) {
      if (selectedCategoryId === categoryId) {
        setSelectedCategoryId(null);
        setSelectedFolderId(null);
      }
      loadTree();
    } else setError(result.error);
  };

  const handleAddFolder = (categoryId, parentFolderId) => {
    setPromptModal({
      title: 'New folder name',
      placeholder: 'e.g. Documents',
      onSubmit: async (name) => {
        setPromptModal(null);
        setLoading(true);
        const result = await window.electron.addFolder(categoryId, parentFolderId, name);
        setLoading(false);
        if (result.success) loadTree();
        else setError(result.error);
      },
    });
  };

  const handleDeleteFolder = async (categoryId, folderId) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete this folder and everything in it? It will move to the Recycle Bin.')) return;
    setLoading(true);
    const result = await window.electron.deleteFolder(categoryId, folderId);
    setLoading(false);
    if (result.success) {
      if (selectedFolderId === folderId) setSelectedFolderId(null);
      loadTree();
    } else setError(result.error);
  };

  const handleMoveFolder = async (folderId, targetCategoryId, targetParentFolderId) => {
    const result = await window.electron.moveFolder(folderId, targetCategoryId, targetParentFolderId);
    if (result.success) loadTree();
    else setError(result.error);
  };

  // ---- entries ----

  const handleCreateEntry = async (template, title) => {
    if (!selectedFolderId) {
      // Entries live inside folders, never directly in a category - the
      // backend would silently no-op the insert (wrong folderId never
      // matches anything in the tree) and this form would then open an
      // edit view for an entry that doesn't actually exist anywhere,
      // which only surfaces as a confusing "Entry not found" error later
      // when trying to save it. Guarding here instead of relying solely
      // on the button's disabled state, in case that ever gets out of sync.
      setError('Select or create a folder first - entries live inside folders, not directly in categories.');
      setShowNewEntryModal(false);
      return;
    }
    setLoading(true);
    const result = await window.electron.addEntry(selectedCategoryId, selectedFolderId, { title, template });
    setLoading(false);
    setShowNewEntryModal(false);
    if (result.success) {
      await loadTree();
      setEditingEntry(result.data);
    } else {
      setError(result.error);
    }
  };

  const handleSaveEntry = async (updates) => {
    setLoading(true);
    const result = await window.electron.updateEntry(editingEntry.id, updates);
    setLoading(false);
    if (result.success) {
      setEditingEntry(null);
      loadTree();
    } else {
      setError(result.error);
    }
  };

  const handleDeleteEntry = async (entryId) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete this entry? It will move to the Recycle Bin.')) return;
    const result = await window.electron.deleteEntry(entryId);
    if (result.success) loadTree();
    else setError(result.error);
  };

  const handleDuplicateEntry = async (entryId) => {
    const result = await window.electron.duplicateEntry(entryId);
    if (result.success) loadTree();
    else setError(result.error);
  };

  const handleToggleFavorite = async (entryId) => {
    const result = await window.electron.toggleFavorite(entryId);
    if (result.success) loadTree();
    else setError(result.error);
  };

  // ---- derived state ----

  // Browsing a folder/category shows only its DIRECT children - entries
  // that live one level down (in a subfolder) show up by navigating into
  // that subfolder, not flattened into the parent's list. Categories
  // never hold entries directly (only via folders), so selecting just a
  // category shows its root folders with zero entries until you open one.
  const currentFolder = findFolder(categories, selectedCategoryId, selectedFolderId);
  const currentCategory = findCategory(categories, selectedCategoryId);
  const visibleSubfolders = searchResults
    ? []
    : currentFolder
      ? currentFolder.folders
      : currentCategory
        ? currentCategory.folders
        : [];
  const visibleEntries = searchResults ? searchResults : currentFolder ? currentFolder.entries : [];

  if (!isAuthenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>🔐 Xela Account Manager</h1>
        <nav className="nav-tabs">
          <button className={`nav-tab ${activeTab === 'vault' ? 'active' : ''}`} onClick={() => setActiveTab('vault')}>
            📋 Vault
          </button>
          <button className="nav-tab" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            ↩️ Undo
          </button>
          <button className="nav-tab" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
            ↪️ Redo
          </button>
          <button
            className={`nav-tab ${activeTab === 'recycle' ? 'active' : ''}`}
            onClick={() => setActiveTab('recycle')}
          >
            🗑️ Recycle Bin
          </button>
          <button
            className={`nav-tab ${activeTab === 'activity' ? 'active' : ''}`}
            onClick={() => setActiveTab('activity')}
          >
            🛡️ Activity
          </button>
          <button
            className={`nav-tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            ⚙️ Settings
          </button>
          <button className="nav-tab" onClick={handleLock}>
            🔒 Lock Vault
          </button>
        </nav>
      </header>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={clearError}>✕</button>
        </div>
      )}

      {activeTab === 'vault' && (
        <div className="main-content">
          <aside className="sidebar">
            <CategoryTree
              categories={categories}
              selectedCategoryId={selectedCategoryId}
              selectedFolderId={selectedFolderId}
              onSelectFolder={handleSelectFolder}
              onAddCategory={handleAddCategory}
              onAddFolder={handleAddFolder}
              onDeleteCategory={handleDeleteCategory}
              onDeleteFolder={handleDeleteFolder}
              onMoveFolder={handleMoveFolder}
            />
          </aside>

          <main className="main-panel">
            <div className="panel-header">
              <div className="panel-header-title">
                {selectedFolderId && (
                  <button className="btn-back" onClick={handleGoBack} title="Back">
                    ⬅
                  </button>
                )}
                <h2>{currentFolder ? currentFolder.name : currentCategory ? currentCategory.name : 'Select a category'}</h2>
              </div>
              <button
                className="btn btn-primary"
                disabled={!selectedFolderId || loading}
                title={!selectedFolderId ? 'Select or create a folder first - entries live inside folders' : undefined}
                onClick={() => setShowNewEntryModal(true)}
              >
                ➕ New Entry
              </button>
            </div>

            {editingEntry ? (
              <EntryForm
                entry={editingEntry}
                passwordGeneratorSettings={settings ? settings.passwordGenerator : {}}
                onSubmit={handleSaveEntry}
                onCancel={() => setEditingEntry(null)}
              />
            ) : (
              <EntryList
                entries={visibleEntries}
                subfolders={visibleSubfolders}
                onOpenFolder={(folderId) => handleSelectFolder(selectedCategoryId, folderId)}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                onEdit={setEditingEntry}
                onDelete={handleDeleteEntry}
                onDuplicate={handleDuplicateEntry}
                onToggleFavorite={handleToggleFavorite}
                clipboardClearSeconds={settings ? settings.clipboardClearSeconds : 20}
              />
            )}
          </main>
        </div>
      )}

      {activeTab === 'recycle' && (
        <main className="main-panel">
          <RecycleBin onChanged={loadTree} />
        </main>
      )}

      {activeTab === 'activity' && (
        <main className="main-panel">
          <ActivityLog />
        </main>
      )}

      {activeTab === 'settings' && (
        <main className="main-panel">
          <Settings onSettingsChanged={setSettings} />
        </main>
      )}

      {showNewEntryModal && (
        <NewEntryModal onCreate={handleCreateEntry} onCancel={() => setShowNewEntryModal(false)} />
      )}

      {promptModal && (
        <PromptModal
          title={promptModal.title}
          placeholder={promptModal.placeholder}
          onSubmit={promptModal.onSubmit}
          onCancel={() => setPromptModal(null)}
        />
      )}
    </div>
  );
}

export default App;
