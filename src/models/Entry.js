import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import { createField } from './Field.js';

// See Field.js for why `createRequire` is used to read this JSON rather
// than an ESM import-attributes import. Kept in sync with
// src/App.jsx/EntryList.jsx, which import the same file directly.
const require = createRequire(import.meta.url);
const entryTemplates = require('../data/entryTemplates.json');

// Built-in entry templates. "Custom" has no default fields.
export const ENTRY_TEMPLATES = Object.freeze(entryTemplates.map((t) => t.name));

export const TEMPLATE_ICONS = Object.freeze(
  Object.fromEntries(entryTemplates.map((t) => [t.name, t.icon])),
);

const DEFAULT_FIELDS_BY_TEMPLATE = Object.fromEntries(entryTemplates.map((t) => [t.name, t.fields]));

/**
 * Returns the default field set for a given template. Pure/no side effects
 * beyond generating fresh field ids/timestamps.
 */
export function defaultFieldsForTemplate(template) {
  const fields = DEFAULT_FIELDS_BY_TEMPLATE[template];
  if (!fields) return [];
  return fields.map((f) => createField({ label: f.label, type: f.type }));
}

/**
 * Creates an Entry. Entries never carry username/password directly -
 * all sensitive data lives inside `fields`.
 * @param {Object} options
 */
export function createEntry({
  title,
  template = 'Custom',
  icon,
  color = '#4a90d9',
  favorite = false,
  tags = [],
  fields,
} = {}) {
  if (!title || typeof title !== 'string') {
    throw new Error('Entry requires a non-empty title');
  }
  if (!ENTRY_TEMPLATES.includes(template)) {
    throw new Error(`Invalid entry template: ${template}`);
  }

  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    title,
    template,
    icon: icon || TEMPLATE_ICONS[template] || 'file',
    color,
    favorite: !!favorite,
    tags: Array.isArray(tags) ? [...tags] : [],
    fields: Array.isArray(fields) ? fields : defaultFieldsForTemplate(template),
    createdAt: now,
    updatedAt: now,
  };
}

export function updateEntry(entry, updates = {}) {
  if (updates.template && !ENTRY_TEMPLATES.includes(updates.template)) {
    throw new Error(`Invalid entry template: ${updates.template}`);
  }
  const next = {
    ...entry,
    ...updates,
    tags: updates.tags ? [...updates.tags] : entry.tags,
    fields: updates.fields ? updates.fields : entry.fields,
    updatedAt: new Date().toISOString(),
  };
  return next;
}

export function duplicateEntry(entry) {
  const now = new Date().toISOString();
  return {
    ...entry,
    id: randomUUID(),
    title: `${entry.title} (Copy)`,
    fields: entry.fields.map((f) => ({ ...f, id: randomUUID() })),
    createdAt: now,
    updatedAt: now,
  };
}

export function isEntryValid(entry) {
  return (
    !!entry &&
    typeof entry.id === 'string' &&
    typeof entry.title === 'string' &&
    ENTRY_TEMPLATES.includes(entry.template) &&
    Array.isArray(entry.fields)
  );
}
