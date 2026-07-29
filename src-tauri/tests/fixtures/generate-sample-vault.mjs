// Regenerates sample-vault.xam using the *real* (unmodified) Node
// CryptoService + FileService from src/services/. This fixture exists to
// prove the Rust port in src-tauri/src/vault_repository.rs can read and
// import a vault file the actual Electron app would have written - not
// just round-trip its own output. Re-run this whenever the vault envelope
// format or fixture contents need to change, and update the expected
// password/values asserted in vault_repository.rs's fixture test to match.
//
// Usage: node src-tauri/tests/fixtures/generate-sample-vault.mjs

import path from 'path';
import { fileURLToPath } from 'url';
import * as CryptoService from '../../../src/services/CryptoService.js';
import * as FileService from '../../../src/services/FileService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const vault = {
  categories: [
    {
      id: 'cat-1',
      name: 'Logins',
      icon: 'lock',
      folders: [],
      entries: [
        {
          id: 'entry-1',
          title: 'Example Bank',
          fields: [
            { id: 'f1', label: 'Username', value: 'alice@example.com', hidden: false },
            { id: 'f2', label: 'Password', value: 'hunter2-but-not-really', hidden: true },
          ],
          favorite: true,
        },
      ],
    },
  ],
  recycleBin: [],
  settings: { backupCount: 10, theme: 'dark' },
  activityLog: [],
};

const password = 'fixture-master-password-42';
const salt = CryptoService.generateSalt();
const sessionKey = CryptoService.deriveKey(password, salt);
const envelope = CryptoService.encryptObject(vault, sessionKey);

const outPath = path.join(__dirname, 'sample-vault.xam');
FileService.writeVaultFile(outPath, {
  salt: salt.toString('base64'),
  ...envelope,
});

console.log(`Wrote ${outPath} (password: ${password})`);
