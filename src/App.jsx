import React, { useState, useEffect, useCallback } from 'react';
import './styles/App.css';
import Login from './components/Login';
import CategoryTree from './components/CategoryTree';
import EntryList from './components/EntryList';
import EntryForm from './components/EntryForm';
import RecycleBin from './components/RecycleBin';
import ActivityLog from './components/SecurityDashboard';
import Settings from './components/Settings';
import { findCategory, findFolder, collectEntries, collectCategoryEntries } from './utils/vaultTree';

const ENTRY_TEMPLATES = [
  'Login',
  'Secure Note',
  'Credit Card',
  'Bank Account',
  'License Key',
  'API Key',
  'SSH Key',
  'WiFi',
  'Custom',
];

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
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const clearError = () => setError('');

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

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    loadTree();
    loadSettings();

    const unsubscribe = window.electron.onVaultAutoLocked(() => {
      setIsAuthenticated(false);
      setCategories([]);
      setEditingEntry(null);
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
  };

  // ---- categories / folders ----

  const handleAddCategory = async () => {
    // eslint-disable-next-line no-alert
    const name = window.prompt('New category name:');
    if (!name || !name.trim()) return;
    setLoading(true);
    const result = await window.electron.addCategory(name.trim(), 'category');
    setLoading(false);
    if (result.success) loadTree();
    else setError(result.error);
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

  const handleAddFolder = async (categoryId, parentFolderId) => {
    // eslint-disable-next-line no-alert
    const name = window.prompt('New folder name:');
    if (!name || !name.trim()) return;
    setLoading(true);
    const result = await window.electron.addFolder(categoryId, parentFolderId, name.trim());
    setLoading(false);
    if (result.success) loadTree();
    else setError(result.error);
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

  // ---- entries ----

  const handleCreateEntry = async (template, title) => {
    if (!selectedCategoryId) return;
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

  const currentFolder = findFolder(categories, selectedCategoryId, selectedFolderId);
  const currentCategory = findCategory(categories, selectedCategoryId);
  const visibleEntries = searchResults
    ? searchResults
    : currentFolder
      ? collectEntries(currentFolder)
      : currentCategory
        ? collectCategoryEntries(currentCategory)
        : [];

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
            />
          </aside>

          <main className="main-panel">
            <div className="panel-header">
              <h2>{currentFolder ? currentFolder.name : currentCategory ? currentCategory.name : 'Select a category'}</h2>
              <button
                className="btn btn-primary"
                disabled={!selectedCategoryId || loading}
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
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                onEdit={setEditingEntry}
                onDelete={handleDeleteEntry}
                onDuplicate={handleDuplicateEntry}
                onToggleFavorite={handleToggleFavorite}
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
    </div>
  );
}

export default App;
