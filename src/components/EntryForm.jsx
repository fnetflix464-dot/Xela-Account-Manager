import React, { useState } from 'react';
import '../styles/AccountForm.css';
import { calculatePasswordStrength } from '../utils/passwordStrength';
import { generatePassword } from '../utils/passwordGenerator';
import { fieldTypes } from '../data/fieldTypes.js';

const FIELD_TYPES = fieldTypes.types;
const AUTO_HIDDEN_TYPES = fieldTypes.autoHidden;

/** Read-only viewer for a secret field's prior values - no restore action. */
function PasswordHistoryList({ history }) {
  const [expanded, setExpanded] = useState(false);
  const [revealedIndexes, setRevealedIndexes] = useState({});

  if (!history || history.length === 0) return null;

  const toggleReveal = (index) => {
    setRevealedIndexes((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  return (
    <div className="password-history">
      <button type="button" className="btn-history-toggle" onClick={() => setExpanded((v) => !v)}>
        {expanded ? '▾' : '▸'} Previous values ({history.length})
      </button>
      {expanded && (
        <ul className="password-history-list">
          {history.map((entry, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={index}>
              <span className="password-history-value">
                {revealedIndexes[index] ? entry.value || '(empty)' : '•'.repeat(Math.max(entry.value.length, 6))}
              </span>
              <button
                type="button"
                className="btn-reveal"
                onClick={() => toggleReveal(index)}
                title={revealedIndexes[index] ? 'Hide' : 'Show'}
              >
                {revealedIndexes[index] ? 'Hide' : 'Show'}
              </button>
              <span className="password-history-date">
                {entry.changedAt ? new Date(entry.changedAt).toLocaleString() : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// A field's name and type are decided once, here, and never editable
// afterward - they're the field's identity, not its data. Only the value
// (and whether it's hidden) can change after creation.
function AddFieldModal({ onAdd, onCancel }) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState('text');

  const submit = () => {
    if (!label.trim()) return;
    onAdd(label.trim(), type);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <button type="button" className="modal-close" onClick={onCancel}>
          ✕
        </button>
        <h3>Add Field</h3>
        <div className="form-group">
          <label>Field Name *</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. PIN, Security Question"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
        </div>
        <div className="form-group">
          <label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-outline" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!label.trim()} onClick={submit}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function EntryForm({ entry, passwordGeneratorSettings, onSubmit, onCancel }) {
  const [title, setTitle] = useState(entry.title);
  const [tags, setTags] = useState(entry.tags.join(', '));
  const [fields, setFields] = useState(entry.fields.map((f) => ({ ...f })));
  const [showAddFieldModal, setShowAddFieldModal] = useState(false);

  const updateField = (id, updates) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  };

  const removeField = (id) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
  };

  const addField = (label, type) => {
    setFields((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}-${prev.length}`,
        label,
        type,
        value: '',
        hidden: AUTO_HIDDEN_TYPES.includes(type),
      },
    ]);
    setShowAddFieldModal(false);
  };

  const fillGeneratedPassword = (id) => {
    try {
      const value = generatePassword(passwordGeneratorSettings);
      updateField(id, { value });
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(err.message);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) {
      // eslint-disable-next-line no-alert
      alert('Title is required');
      return;
    }
    onSubmit({
      title: title.trim(),
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      fields,
    });
  };

  return (
    <div className="account-form-container">
      <h3>Edit {entry.template} Entry</h3>
      <form onSubmit={handleSubmit} className="account-form">
        <div className="form-group">
          <label>Title *</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>

        <div className="form-group">
          <label>Tags (comma separated)</label>
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. work, important" />
        </div>

        {fields.map((field) => {
          const strength = field.type === 'password' ? calculatePasswordStrength(field.value) : '';
          return (
            <div className="field-row-wrapper" key={field.id}>
              <button
                type="button"
                className="btn-remove-field"
                onClick={() => removeField(field.id)}
                title="Remove field"
              >
                <span className="x-icon" aria-hidden="true" />
              </button>

              <div className="form-group field-row">
                <div className="field-row-header">
                  <div className="field-label-display">
                    <span className="field-label-text">{field.label}</span>
                    <span className="field-type-badge">{field.type}</span>
                  </div>
                  <label className="hidden-checkbox">
                    <input
                      type="checkbox"
                      checked={field.hidden}
                      onChange={(e) => updateField(field.id, { hidden: e.target.checked })}
                    />
                    Hidden
                  </label>
                </div>

                {field.type === 'note' ? (
                  <textarea
                    value={field.value}
                    onChange={(e) => updateField(field.id, { value: e.target.value })}
                    rows="3"
                  />
                ) : (
                  <div className="password-input-group">
                    <input
                      type={field.hidden ? 'password' : field.type === 'date' ? 'date' : 'text'}
                      value={field.value}
                      onChange={(e) => updateField(field.id, { value: e.target.value })}
                    />
                    {(field.type === 'password' || field.type === 'pin') && (
                      <button type="button" className="btn-generate" onClick={() => fillGeneratedPassword(field.id)}>
                        Generate
                      </button>
                    )}
                  </div>
                )}

                {strength && (
                  <div className="strength-indicator">
                    <span>{strength}</span>
                  </div>
                )}

                {(field.type === 'password' || field.type === 'pin') && (
                  <PasswordHistoryList history={field.history} />
                )}
              </div>
            </div>
          );
        })}

        <button type="button" className="btn btn-outline btn-add-field" onClick={() => setShowAddFieldModal(true)}>
          Add Field
        </button>

        <div className="form-actions">
          <button type="button" onClick={onCancel} className="btn btn-outline">
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Save Entry
          </button>
        </div>
      </form>

      {showAddFieldModal && <AddFieldModal onAdd={addField} onCancel={() => setShowAddFieldModal(false)} />}
    </div>
  );
}

export default EntryForm;
