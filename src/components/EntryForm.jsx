import React, { useState } from 'react';
import '../styles/AccountForm.css';
import { calculatePasswordStrength } from '../utils/passwordStrength';
import { generatePassword } from '../utils/passwordGenerator';

const FIELD_TYPES = ['text', 'password', 'email', 'url', 'note', 'number', 'date', 'pin'];
const AUTO_HIDDEN_TYPES = ['password', 'pin'];

function EntryForm({ entry, passwordGeneratorSettings, onSubmit, onCancel }) {
  const [title, setTitle] = useState(entry.title);
  const [tags, setTags] = useState(entry.tags.join(', '));
  const [fields, setFields] = useState(entry.fields.map((f) => ({ ...f })));

  const updateField = (id, updates) => {
    setFields((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        const next = { ...f, ...updates };
        if (updates.type) {
          next.hidden = AUTO_HIDDEN_TYPES.includes(updates.type);
        }
        return next;
      }),
    );
  };

  const removeField = (id) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
  };

  const addField = () => {
    setFields((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}-${prev.length}`,
        label: 'New Field',
        type: 'text',
        value: '',
        hidden: false,
      },
    ]);
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
            <div className="form-group field-row" key={field.id}>
              <div className="field-row-header">
                <input
                  className="field-label-input"
                  type="text"
                  value={field.label}
                  onChange={(e) => updateField(field.id, { label: e.target.value })}
                />
                <select value={field.type} onChange={(e) => updateField(field.id, { type: e.target.value })}>
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <label className="hidden-checkbox">
                  <input
                    type="checkbox"
                    checked={field.hidden}
                    onChange={(e) => updateField(field.id, { hidden: e.target.checked })}
                  />
                  Hidden
                </label>
                <button type="button" className="btn-remove-field" onClick={() => removeField(field.id)} title="Remove field">
                  ✕
                </button>
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
            </div>
          );
        })}

        <button type="button" className="btn btn-outline btn-add-field" onClick={addField}>
          ➕ Add Field
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
    </div>
  );
}

export default EntryForm;
