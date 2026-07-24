import { randomUUID } from 'crypto';
import { fieldTypes } from '../data/fieldTypes.js';

// Field types supported across all entry templates.
export const FIELD_TYPES = Object.freeze(fieldTypes.types);

// Types that are automatically hidden (masked) by default.
export const AUTO_HIDDEN_TYPES = Object.freeze(fieldTypes.autoHidden);

/**
 * Creates a Field.
 * @param {Object} options
 * @param {string} options.label
 * @param {string} [options.type='text']
 * @param {string} [options.value='']
 * @param {boolean} [options.hidden]
 * @returns {Object} Field
 */
export function createField({ label, type = 'text', value = '', hidden } = {}) {
  if (!label || typeof label !== 'string') {
    throw new Error('Field requires a non-empty label');
  }
  if (!FIELD_TYPES.includes(type)) {
    throw new Error(`Invalid field type: ${type}`);
  }

  const now = new Date().toISOString();
  const isHidden = typeof hidden === 'boolean' ? hidden : AUTO_HIDDEN_TYPES.includes(type);

  return {
    id: randomUUID(),
    label,
    type,
    value: value === undefined || value === null ? '' : String(value),
    hidden: isHidden,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Returns a new Field with updated properties (immutable update).
 * @param {Object} field
 * @param {Object} updates
 */
export function updateField(field, updates = {}) {
  const next = { ...field, ...updates };
  if (updates.type && !FIELD_TYPES.includes(updates.type)) {
    throw new Error(`Invalid field type: ${updates.type}`);
  }
  if (updates.type && updates.hidden === undefined) {
    next.hidden = AUTO_HIDDEN_TYPES.includes(updates.type);
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

export function isFieldValid(field) {
  return (
    !!field &&
    typeof field.id === 'string' &&
    typeof field.label === 'string' &&
    FIELD_TYPES.includes(field.type)
  );
}
