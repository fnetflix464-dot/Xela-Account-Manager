import React, { useState, useEffect, useCallback } from 'react';
import '../styles/Settings.css';

function Settings({ onSettingsChanged }) {
  const [settings, setSettings] = useState(null);
  const [backups, setBackups] = useState([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');

  const load = useCallback(async () => {
    const [settingsResult, backupsResult] = await Promise.all([
      window.electron.getSettings(),
      window.electron.listBackups(),
    ]);
    if (settingsResult.success) setSettings(settingsResult.data);
    if (backupsResult.success) setBackups(backupsResult.data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleChange = (field, value) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const handleGeneratorChange = (field, value) => {
    setSettings((prev) => ({ ...prev, passwordGenerator: { ...prev.passwordGenerator, [field]: value } }));
  };

  const handleSave = async () => {
    const result = await window.electron.updateSettings(settings);
    if (result.success) {
      setSettings(result.data);
      onSettingsChanged(result.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else {
      setError(result.error);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmNewPassword) {
      setError('New passwords do not match');
      return;
    }
    const result = await window.electron.changeMasterPassword(currentPassword, newPassword);
    if (result.success) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else {
      setError(result.error);
    }
  };

  const handleExport = async () => {
    const result = await window.electron.exportVault();
    if (!result.success) setError(result.error);
  };

  const handleImport = async () => {
    if (!importPassword) {
      setError('Enter the master password of the vault file you want to import');
      return;
    }
    // eslint-disable-next-line no-alert
    if (!window.confirm('Importing will replace your current vault (a backup of it will be kept first). Continue?')) {
      return;
    }
    const result = await window.electron.importVault(importPassword);
    if (result.success) {
      setImportPassword('');
      // eslint-disable-next-line no-alert
      alert("Vault imported. Please unlock again with the imported vault's master password.");
      window.location.reload();
    } else {
      setError(result.error);
    }
  };

  const handleRestoreBackup = async (backupPath) => {
    // eslint-disable-next-line no-alert
    if (
      !window.confirm(
        'Restore this backup? Your current vault will itself be backed up first, and you will need to unlock again.',
      )
    ) {
      return;
    }
    const result = await window.electron.restoreBackup(backupPath);
    if (result.success) {
      window.location.reload();
    } else {
      setError(result.error);
    }
  };

  if (!settings) {
    return <div className="loading-state">Loading settings...</div>;
  }

  return (
    <div className="settings-container">
      <h2>⚙️ Settings</h2>

      {error && <div className="error-message">{error}</div>}

      <div className="settings-section">
        <h3>Display</h3>
        <div className="setting-item">
          <label>Theme</label>
          <select value={settings.theme} onChange={(e) => handleChange('theme', e.target.value)}>
            <option value="light">☀️ Light</option>
            <option value="dark">🌙 Dark</option>
            <option value="system">🖥️ System</option>
          </select>
        </div>
      </div>

      <div className="settings-section">
        <h3>Security</h3>
        <div className="setting-item">
          <label>Auto-lock after inactivity (minutes, 0 = never)</label>
          <input
            type="number"
            min="0"
            value={settings.autoLockMinutes}
            onChange={(e) => handleChange('autoLockMinutes', Number(e.target.value))}
          />
        </div>
      </div>

      <div className="settings-section">
        <h3>Password Generator</h3>
        <div className="setting-item">
          <label>Length</label>
          <input
            type="number"
            min="6"
            max="128"
            value={settings.passwordGenerator.length}
            onChange={(e) => handleGeneratorChange('length', Number(e.target.value))}
          />
        </div>
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={settings.passwordGenerator.uppercase}
              onChange={(e) => handleGeneratorChange('uppercase', e.target.checked)}
            />
            Uppercase letters
          </label>
        </div>
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={settings.passwordGenerator.lowercase}
              onChange={(e) => handleGeneratorChange('lowercase', e.target.checked)}
            />
            Lowercase letters
          </label>
        </div>
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={settings.passwordGenerator.numbers}
              onChange={(e) => handleGeneratorChange('numbers', e.target.checked)}
            />
            Numbers
          </label>
        </div>
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={settings.passwordGenerator.symbols}
              onChange={(e) => handleGeneratorChange('symbols', e.target.checked)}
            />
            Symbols
          </label>
        </div>
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={settings.passwordGenerator.excludeAmbiguous}
              onChange={(e) => handleGeneratorChange('excludeAmbiguous', e.target.checked)}
            />
            Exclude ambiguous characters (l, I, 1, O, 0)
          </label>
        </div>
      </div>

      <div className="settings-section">
        <h3>Backups</h3>
        <div className="setting-item">
          <label>Backups to keep</label>
          <input
            type="number"
            min="1"
            max="100"
            value={settings.backupCount}
            onChange={(e) => handleChange('backupCount', Number(e.target.value))}
          />
        </div>
        {backups.length === 0 ? (
          <p className="hint">No backups yet — one is made automatically every time the vault saves.</p>
        ) : (
          <ul>
            {backups.slice(0, 5).map((path) => (
              <li key={path}>
                {path.split(/[\\/]/).pop()}{' '}
                <button className="btn btn-sm btn-outline" onClick={() => handleRestoreBackup(path)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {saved && <div className="success-message">✅ Saved successfully</div>}

      <div className="settings-actions">
        <button className="btn btn-primary" onClick={handleSave}>
          💾 Save Settings
        </button>
      </div>

      <div className="settings-section">
        <h3>Change Master Password</h3>
        <form onSubmit={handleChangePassword}>
          <div className="setting-item">
            <label>Current Password</label>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
          </div>
          <div className="setting-item">
            <label>New Password</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
          </div>
          <div className="setting-item">
            <label>Confirm New Password</label>
            <input
              type="password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-secondary">
            Change Password
          </button>
        </form>
      </div>

      <div className="settings-section">
        <h3>Data Management</h3>
        <button className="btn btn-secondary" onClick={handleExport}>
          📥 Export Vault (.xam)
        </button>
        <p className="hint">Saves an encrypted copy of your vault - still requires your master password to open.</p>

        <div className="setting-item" style={{ marginTop: '1rem' }}>
          <label>Master password of the vault file to import</label>
          <input type="password" value={importPassword} onChange={(e) => setImportPassword(e.target.value)} />
        </div>
        <button className="btn btn-secondary" onClick={handleImport}>
          📤 Import Vault (.xam)
        </button>
      </div>
    </div>
  );
}

export default Settings;
