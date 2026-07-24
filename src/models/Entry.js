const { randomUUID } = require('crypto');
const { createField } = require('./Field');

// Built-in entry templates. "Custom" has no default fields.
const ENTRY_TEMPLATES = Object.freeze([
  'Login',
  'Secure Note',
  'Credit Card',
  'Bank Account',
  'License Key',
  'API Key',
  'SSH Key',
  'WiFi',
  'Custom',
]);

const TEMPLATE_ICONS = Object.freeze({
  Login: 'key',
  'Secure Note': 'note',
  'Credit Card': 'credit-card',
  'Bank Account': 'bank',
  'License Key': 'tag',
  'API Key': 'code',
  'SSH Key': 'terminal',
  WiFi: 'wifi',
  Custom: 'file',
});

/**
 * Returns the default field set for a given template. Pure/no side effects
 * beyond generating fresh field ids/timestamps.
 */
function defaultFieldsForTemplate(template) {
  switch (template) {
    case 'Login':
      return [
        createField({ label: 'Username', type: 'text' }),
        createField({ label: 'Password', type: 'password' }),
        createField({ label: 'Website', type: 'url' }),
      ];
    case 'Secure Note':
      return [createField({ label: 'Note', type: 'note' })];
    case 'Credit Card':
      return [
        createField({ label: 'Cardholder Name', type: 'text' }),
        createField({ label: 'Card Number', type: 'password' }),
        createField({ label: 'Expiry Date', type: 'text' }),
        createField({ label: 'CVV', type: 'pin' }),
        createField({ label: 'PIN', type: 'pin' }),
      ];
    case 'Bank Account':
      return [
        createField({ label: 'Bank Name', type: 'text' }),
        createField({ label: 'Account Number', type: 'password' }),
        createField({ label: 'Routing Number', type: 'text' }),
        createField({ label: 'IBAN', type: 'text' }),
      ];
    case 'License Key':
      return [
        createField({ label: 'Product', type: 'text' }),
        createField({ label: 'License Key', type: 'password' }),
      ];
    case 'API Key':
      return [
        createField({ label: 'Service', type: 'text' }),
        createField({ label: 'API Key', type: 'password' }),
        createField({ label: 'API Secret', type: 'password' }),
      ];
    case 'SSH Key':
      return [
        createField({ label: 'Host', type: 'text' }),
        createField({ label: 'Username', type: 'text' }),
        createField({ label: 'Private Key', type: 'note' }),
        createField({ label: 'Passphrase', type: 'password' }),
      ];
    case 'WiFi':
      return [
        createField({ label: 'Network Name (SSID)', type: 'text' }),
        createField({ label: 'Password', type: 'password' }),
      ];
    case 'Custom':
    default:
      return [];
  }
}

/**
 * Creates an Entry. Entries never carry username/password directly -
 * all sensitive data lives inside `fields`.
 * @param {Object} options
 */
function createEntry({
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

function updateEntry(entry, updates = {}) {
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

function duplicateEntry(entry) {
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

function isEntryValid(entry) {
  return (
    !!entry &&
    typeof entry.id === 'string' &&
    typeof entry.title === 'string' &&
    ENTRY_TEMPLATES.includes(entry.template) &&
    Array.isArray(entry.fields)
  );
}

module.exports = {
  ENTRY_TEMPLATES,
  TEMPLATE_ICONS,
  defaultFieldsForTemplate,
  createEntry,
  updateEntry,
  duplicateEntry,
  isEntryValid,
};
