import React, { useState } from 'react';
import '../styles/AccountList.css';

const TEMPLATE_EMOJI = {
  Login: '🔑',
  'Secure Note': '📝',
  'Credit Card': '💳',
  'Bank Account': '🏦',
  'License Key': '🏷️',
  'API Key': '💻',
  'SSH Key': '🖥️',
  WiFi: '📶',
  Custom: '📄',
};

function EntryList({ entries, searchTerm, onSearchTermChange, onEdit, onDelete, onDuplicate, onToggleFavorite }) {
  const [revealedFields, setRevealedFields] = useState({});

  const toggleReveal = (entryId, fieldId) => {
    const key = `${entryId}:${fieldId}`;
    setRevealedFields((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text || '');
  };

  return (
    <div className="account-list-container">
      <div className="list-header">
        <input
          type="text"
          placeholder="🔍 Search this vault..."
          value={searchTerm}
          onChange={(e) => onSearchTermChange(e.target.value)}
          className="search-input"
        />
        <span className="account-count">{entries.length} items</span>
      </div>

      {entries.length === 0 ? (
        <div className="empty-state">
          <p>📭 No entries here</p>
          <p className="hint">Add your first entry to get started</p>
        </div>
      ) : (
        <div className="accounts-grid">
          {entries.map((entry) => (
            <div key={entry.id} className="account-card">
              <div className="card-header">
                <div className="card-title">
                  <span className="category-icon">{TEMPLATE_EMOJI[entry.template] || '📄'}</span>
                  <h4>{entry.title}</h4>
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
