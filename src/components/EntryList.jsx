import React, { useState } from 'react';
import '../styles/AccountList.css';
import { entryTemplates } from '../data/entryTemplates.js';
import { copyWithAutoClear } from '../utils/clipboard';
import { splitByMatch } from '../utils/highlightMatch';

const TEMPLATE_EMOJI = Object.fromEntries(entryTemplates.map((t) => [t.name, t.emoji]));
const FOLDER_EMOJI = '📁';

function countEntriesRecursive(folder) {
  return folder.entries.length + folder.folders.reduce((sum, f) => sum + countEntriesRecursive(f), 0);
}

function HighlightedText({ text, query }) {
  return splitByMatch(text, query).map((segment, i) =>
    // eslint-disable-next-line react/no-array-index-key
    segment.matched ? <mark key={i}>{segment.text}</mark> : <React.Fragment key={i}>{segment.text}</React.Fragment>,
  );
}

function EntryList({
  entries,
  subfolders,
  onOpenFolder,
  searchTerm,
  onSearchTermChange,
  onEdit,
  onDelete,
  onDuplicate,
  onToggleFavorite,
  clipboardClearSeconds,
  hideSearch,
}) {
  const [revealedFields, setRevealedFields] = useState({});

  const toggleReveal = (entryId, fieldId) => {
    const key = `${entryId}:${fieldId}`;
    setRevealedFields((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const copyToClipboard = (text) => {
    copyWithAutoClear(text, clipboardClearSeconds);
  };

  return (
    <div className="account-list-container">
      <div className="list-header">
        {!hideSearch && (
          <input
            type="text"
            placeholder="🔍 Search this vault..."
            value={searchTerm}
            onChange={(e) => onSearchTermChange(e.target.value)}
            className="search-input"
          />
        )}
        <span className="account-count">{entries.length} items</span>
      </div>

      {subfolders.length > 0 && (
        <div className="folders-grid">
          {subfolders.map((folder) => (
            <button key={folder.id} className="folder-tile" onClick={() => onOpenFolder(folder.id)}>
              <span className="folder-tile-emoji">{FOLDER_EMOJI}</span>
              <span className="folder-tile-name">{folder.name}</span>
              <span className="folder-tile-count">{countEntriesRecursive(folder)}</span>
            </button>
          ))}
        </div>
      )}

      {entries.length === 0 && subfolders.length === 0 ? (
        <div className="empty-state">
          <p>📭 No entries here</p>
          <p className="hint">Add your first entry to get started</p>
        </div>
      ) : entries.length === 0 ? null : (
        <div className="accounts-grid">
          {entries.map((entry) => (
            <div key={entry.id} className="account-card">
              <div className="card-header">
                <div className="card-title">
                  <span className="category-icon">{TEMPLATE_EMOJI[entry.template] || '📄'}</span>
                  <h4>
                    <HighlightedText text={entry.title} query={searchTerm} />
                  </h4>
                </div>
                <span className="category-badge">{entry.template}</span>
              </div>

              <div className="card-content">
                {entry.fields.map((field) => {
                  const key = `${entry.id}:${field.id}`;
                  const revealed = revealedFields[key];
                  return (
                    <div className="account-field" key={field.id}>
                      <label>{field.label}:</label>
                      {field.hidden ? (
                        <div className="password-display">
                          <input type={revealed ? 'text' : 'password'} value={field.value} readOnly />
                          <button
                            className="btn-reveal"
                            onClick={() => toggleReveal(entry.id, field.id)}
                            title={revealed ? 'Hide' : 'Show'}
                          >
                            {revealed ? '👁️' : '👁️‍🗨️'}
                          </button>
                          <button
                            className="btn-copy"
                            onClick={() => copyToClipboard(field.value)}
                            title={`Copy ${field.label}`}
                          >
                            📋
                          </button>
                        </div>
                      ) : (
                        <span>{field.value || '—'}</span>
                      )}
                    </div>
                  );
                })}

                {entry.tags.length > 0 && (
                  <div className="account-field">
                    <label>Tags:</label>
                    <span>{entry.tags.join(', ')}</span>
                  </div>
                )}
              </div>

              <div className="card-actions">
                <button
                  className={`btn btn-sm ${entry.favorite ? 'btn-success' : 'btn-outline'}`}
                  onClick={() => onToggleFavorite(entry.id)}
                  title={entry.favorite ? 'Unfavorite' : 'Favorite'}
                >
                  {entry.favorite ? '⭐ Favorited' : '☆ Favorite'}
                </button>
                <button className="btn btn-sm btn-outline" onClick={() => onDuplicate(entry.id)}>
                  📑 Duplicate
                </button>
                <button className="btn btn-sm btn-primary" onClick={() => onEdit(entry)}>
                  ✏️ Edit
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => onDelete(entry.id)}>
                  🗑️ Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default EntryList;
