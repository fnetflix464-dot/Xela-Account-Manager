// Single source of truth for entry templates, consumed by both the main
// process (src/models/Entry.js) and the renderer (App.jsx, EntryList.jsx,
// EntryForm.jsx). A plain .js module with `export const` - not a .json
// file loaded via createRequire/import-assertions - so it works
// identically under Node's native ESM loader (production/Electron) and
// under Jest's Babel-transpiled CommonJS execution (tests), with no
// runtime-specific special-casing needed in either place.
export const entryTemplates = [
  {
    name: 'Login',
    icon: 'key',
    emoji: '🔑',
    fields: [
      { label: 'Username', type: 'text' },
      { label: 'Password', type: 'password' },
      { label: 'Website', type: 'url' },
    ],
  },
  {
    name: 'Secure Note',
    icon: 'note',
    emoji: '📝',
    fields: [{ label: 'Note', type: 'note' }],
  },
  {
    name: 'Credit Card',
    icon: 'credit-card',
    emoji: '💳',
    fields: [
      { label: 'Cardholder Name', type: 'text' },
      { label: 'Card Number', type: 'password' },
      { label: 'Expiry Date', type: 'text' },
      { label: 'CVV', type: 'pin' },
      { label: 'PIN', type: 'pin' },
    ],
  },
  {
    name: 'Bank Account',
    icon: 'bank',
    emoji: '🏦',
    fields: [
      { label: 'Bank Name', type: 'text' },
      { label: 'Account Number', type: 'password' },
      { label: 'Routing Number', type: 'text' },
      { label: 'IBAN', type: 'text' },
    ],
  },
  {
    name: 'License Key',
    icon: 'tag',
    emoji: '🏷️',
    fields: [
      { label: 'Product', type: 'text' },
      { label: 'License Key', type: 'password' },
    ],
  },
  {
    name: 'API Key',
    icon: 'code',
    emoji: '💻',
    fields: [
      { label: 'Service', type: 'text' },
      { label: 'API Key', type: 'password' },
      { label: 'API Secret', type: 'password' },
    ],
  },
  {
    name: 'SSH Key',
    icon: 'terminal',
    emoji: '🖥️',
    fields: [
      { label: 'Host', type: 'text' },
      { label: 'Username', type: 'text' },
      { label: 'Private Key', type: 'note' },
      { label: 'Passphrase', type: 'password' },
    ],
  },
  {
    name: 'WiFi',
    icon: 'wifi',
    emoji: '📶',
    fields: [
      { label: 'Network Name (SSID)', type: 'text' },
      { label: 'Password', type: 'password' },
    ],
  },
  {
    name: 'Custom',
    icon: 'file',
    emoji: '📄',
    fields: [
      { label: 'Text', type: 'text' },
      { label: 'Password', type: 'password' },
    ],
  },
];
