import React, { useState, useEffect, useCallback } from 'react';
import '../styles/Settings.css';
import { resizeImageToDataUrl } from '../utils/imageResize';

// Turns "vault-2026-07-24T15-10-27-131Z.xam.bak" into a readable local
// date/time; falls back to the raw label (e.g. a custom rename) when the
// filename isn't the auto-generated timestamp format.
function backupLabel(path) {
  const filename = path.split(/[\\/]/).pop();
  const match = filename.match(/^vault-(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.xam\.bak$/);
  if (match) {
    const date = new Date(`${match[1]}:${match[2]}:${match[3]}.${match[4]}Z`);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    }
  }
  return filename.replace(/^vault-/, '').replace(/\.xam\.bak$/, '');
}

function ColorPickerField({ label, value, fallback, onChange, hint }) {
  return (
    <div className="setting-item">
      <label>{label}</label>
      {hint && <p className="hint">{hint}</p>}
      <div className="accent-color-picker">
        <input type="color" value={value || fallback} onChange={(e) => onChange(e.target.value)} />
        {value && (
          <button type="button" className="btn-link" onClick={() => onChange(null)}>
            Reset to default
          </button>
        )}
      </div>
    </div>
  );
}

function Settings({ settings: settingsProp, onSettingsChanged }) {
  // Seeded once from the live (possibly still-unsaved, already-previewed)
  // App-level settings rather than re-fetched from disk on every mount -
  // this component used to always pull the persisted value fresh, which
  // meant navigating away and back after previewing an unsaved change
  // (e.g. a background image) silently reverted the form to the old
  // value while the rest of the app kept showing the preview, making
  // controls like "remove background image" disappear even though the
  // image was still visibly applied.
  const [settings, setSettings] = useState(settingsProp || null);
  const [backups, setBackups] = useState([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [renamingPath, setRenamingPath] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [quickUnlockAvailable, setQuickUnlockAvailable] = useState(false);
  const [quickUnlockEnabled, setQuickUnlockEnabled] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');

  const load = useCallback(async () => {
    // Fallback only - in normal operation App.jsx has already loaded
    // settings by the time this component can be reached, and re-fetching
    // here would clobber any unsaved live-previewed change with the
    // stale persisted value.
    if (!settingsProp) {
      const settingsResult = await window.electron.getSettings();
      if (settingsResult.success) setSettings(settingsResult.data);
    }
    const [backupsResult, quickUnlockAvailableResult, quickUnlockEnabledResult] = await Promise.all([
      window.electron.listBackups(),
      window.electron.isQuickUnlockAvailable(),
      window.electron.isQuickUnlockEnabled(),
    ]);
    if (backupsResult.success) setBackups(backupsResult.data);
    if (quickUnlockAvailableResult.success) setQuickUnlockAvailable(quickUnlockAvailableResult.data.available);
    if (quickUnlockEnabledResult.success) setQuickUnlockEnabled(quickUnlockEnabledResult.data.enabled);
    // Deliberately checks settingsProp only as it was at mount time (same
    // as the useState initializer above) - this only ever runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleChange = (field, value) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  // Theme gets a live preview - flipping the dropdown applies it
  // immediately (via the same callback "Save" uses), rather than leaving
  // the user staring at an unchanged screen wondering if their click
  // registered. It's still not persisted to disk until Save is pressed,
  // same as every other setting.
  const handleThemeChange = (value) => {
    setSettings((prev) => {
      const next = { ...prev, theme: value };
      onSettingsChanged(next);
      return next;
    });
  };

  // Shared by every color-picker setting (accent/background/panel) - all
  // three live-preview the same way theme does.
  const handleColorFieldChange = (field, value) => {
    setSettings((prev) => {
      const next = { ...prev, [field]: value };
      onSettingsChanged(next);
      return next;
    });
  };

  const handleBackgroundImageChange = async (file) => {
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setSettings((prev) => {
        const next = { ...prev, backgroundImage: dataUrl };
        onSettingsChanged(next);
        return next;
      });
    } catch (err) {
      setError(err.message || 'Could not use that image');
    }
  };

  const handleRemoveBackgroundImage = () => {
    setSettings((prev) => {
      const next = { ...prev, backgroundImage: null };
      onSettingsChanged(next);
      return next;
    });
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

  const handleEnableQuickUnlock = async (e) => {
    e.preventDefault();
    setError('');
    if (newPin !== confirmNewPin) {
      setError('PINs do not match');
      return;
    }
    const result = await window.electron.enableQuickUnlock(newPin);
    if (result.success) {
      setNewPin('');
      setConfirmNewPin('');
      setQuickUnlockEnabled(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else {
      setError(result.error);
    }
  };

  const handleDisableQuickUnlock = async () => {
    const result = await window.electron.disableQuickUnlock();
    if (result.success) setQuickUnlockEnabled(false);
    else setError(result.error);
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

  const handleDeleteBackup = async (backupPath) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete this backup permanently? This cannot be undone.')) return;
    const result = await window.electron.deleteBackup(backupPath);
    if (result.success) {
      setBackups((prev) => prev.filter((p) => p !== backupPath));
    } else {
      setError(result.error);
    }
  };

  const handleStartRename = (backupPath) => {
    setRenamingPath(backupPath);
    setRenameValue('');
    setError('');
  };

  const handleConfirmRename = async () => {
    if (!renameValue.trim()) return;
    const result = await window.electron.renameBackup(renamingPath, renameValue.trim());
    if (result.success) {
      setBackups((prev) => prev.map((p) => (p === renamingPath ? result.data : p)));
      setRenamingPath(null);
      setRenameValue('');
    } else {
      setError(result.error);
    }
  };

  const handleExportBackup = async (backupPath) => {
    const result = await window.electron.exportBackup(backupPath);
    if (!result.success) setError(result.error);
  };

  if (!settings) {
    return <div className="loading-state">Loading settings...</div>;
  }

  return (
    <div className="settings-container">
      <h2>Settings</h2>

      {error && <div className="error-message">{error}</div>}

      <div className="settings-section">
        <h3>Display</h3>
        <div className="setting-item">
          <label>Theme</label>
          <select value={settings.theme} onChange={(e) => handleThemeChange(e.target.value)}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </div>
        <ColorPickerField
          label="Accent color"
          value={settings.accentColor}
          fallback="#667eea"
          onChange={(v) => handleColorFieldChange('accentColor', v)}
        />
        <ColorPickerField
          label="Background color"
          value={settings.backgroundColor}
          fallback="#f9fafb"
          onChange={(v) => handleColorFieldChange('backgroundColor', v)}
        />
        <ColorPickerField
          label="Panel color"
          value={settings.panelColor}
          fallback="#ffffff"
          onChange={(v) => handleColorFieldChange('panelColor', v)}
          hint="Cards, sidebar, and header. Automatically turns a little translucent when a background image/color is set, so it doesn't hide it."
        />
        <div className="setting-item">
          <label>Background image</label>
          <p className="hint">
            Optional - shown behind the vault view. Off by default. Resized/compressed automatically before
            saving.
          </p>
          <div className="background-image-picker">
            <input type="file" accept="image/*" onChange={(e) => handleBackgroundImageChange(e.target.files[0])} />
            {settings.backgroundImage && (
              <button type="button" className="btn-link" onClick={handleRemoveBackgroundImage}>
                Remove background image
              </button>
            )}
          </div>
          {settings.backgroundImage && (
            <img src={settings.backgroundImage} alt="Background preview" className="background-image-preview" />
          )}
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
        <div className="setting-item">
          <label>Clear clipboard after copying a password (seconds, 0 = never)</label>
          <input
            type="number"
            min="0"
            value={settings.clipboardClearSeconds}
            onChange={(e) => handleChange('clipboardClearSeconds', Number(e.target.value))}
          />
        </div>
        <div className="setting-item">
          <label>Password history entries to keep per field (0 = disabled)</label>
          <input
            type="number"
            min="0"
            value={settings.passwordHistoryLimit}
            onChange={(e) => handleChange('passwordHistoryLimit', Number(e.target.value))}
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
          <ul className="backup-rows">
            {backups.slice(0, 20).map((path) => (
              <li key={path} className="backup-row">
                {renamingPath === path ? (
                  <>
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      placeholder="New name"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleConfirmRename();
                        if (e.key === 'Escape') setRenamingPath(null);
                      }}
                    />
                    <div className="backup-row-actions">
                      <button className="btn-card-action" disabled={!renameValue.trim()} onClick={handleConfirmRename}>
                        Save
                      </button>
                      <button className="btn-card-action" onClick={() => setRenamingPath(null)}>
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="backup-row-label" title={path}>
                      {backupLabel(path)}
                    </span>
                    <div className="backup-row-actions">
                      <button className="btn-card-action" onClick={() => handleRestoreBackup(path)}>
                        Restore
                      </button>
                      <button className="btn-card-action" onClick={() => handleStartRename(path)}>
                        Rename
                      </button>
                      <button className="btn-card-action" onClick={() => handleExportBackup(path)}>
                        Export
                      </button>
                      <button className="btn-card-action danger" onClick={() => handleDeleteBackup(path)}>
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {backups.length > 20 && <p className="hint">Showing the 20 most recent of {backups.length} backups.</p>}
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
        <h3>Quick Unlock PIN</h3>
        {!quickUnlockAvailable ? (
          <p className="hint">Quick unlock is not available on this system.</p>
        ) : quickUnlockEnabled ? (
          <>
            <p className="hint">
              A PIN can unlock your vault instead of the master password. Your master password is still
              the real key - the PIN just unlocks a copy of it that your operating system's own
              credential store protects.
            </p>
            <button type="button" className="btn btn-danger" onClick={handleDisableQuickUnlock}>
              Disable Quick Unlock
            </button>
          </>
        ) : (
          <form onSubmit={handleEnableQuickUnlock}>
            <p className="hint">
              Set a PIN to unlock your vault without typing the full master password. The master
              password remains your vault's real encryption key - changing it later automatically
              turns quick unlock back off.
            </p>
            <div className="setting-item">
              <label>New PIN (4-12 digits)</label>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={12}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                required
              />
            </div>
            <div className="setting-item">
              <label>Confirm PIN</label>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={12}
                value={confirmNewPin}
                onChange={(e) => setConfirmNewPin(e.target.value.replace(/\D/g, ''))}
                required
              />
            </div>
            <button type="submit" className="btn btn-secondary">
              Enable Quick Unlock
            </button>
          </form>
        )}
      </div>

      <div className="settings-section">
        <h3>Data Management</h3>
        <button className="btn btn-secondary" onClick={handleExport}>
          Export Vault (.xam)
        </button>
        <p className="hint">Saves an encrypted copy of your vault - still requires your master password to open.</p>

        <div className="setting-item" style={{ marginTop: '1rem' }}>
          <label>Master password of the vault file to import</label>
          <input type="password" value={importPassword} onChange={(e) => setImportPassword(e.target.value)} />
        </div>
        <button className="btn btn-secondary" onClick={handleImport}>
          Import Vault (.xam)
        </button>
      </div>

      <div className="settings-section">
        <h3>About</h3>
        <p className="hint">Xela Account Manager</p>
        <p className="hint">© Alex B.</p>
      </div>

      {saved && <div className="success-message">Saved successfully</div>}

      <div className="settings-actions">
        <button className="btn btn-primary" onClick={handleSave}>
          Save Settings
        </button>
      </div>
    </div>
  );
}

export default Settings;
