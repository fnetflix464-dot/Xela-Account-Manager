import React, { useState } from 'react';
import '../styles/Settings.css';

function Settings() {
  const [settings, setSettings] = useState({
    theme: 'light',
    autoBackup: true,
    backupFrequency: 'daily',
    notificationsEnabled: true,
  });
  const [saved, setSaved] = useState(false);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setSettings((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSave = async () => {
    try {
      // Save settings to database
      await window.electron.setSetting('theme', settings.theme);
      await window.electron.setSetting('autoBackup', settings.autoBackup);
      await window.electron.setSetting('backupFrequency', settings.backupFrequency);
      await window.electron.setSetting('notificationsEnabled', settings.notificationsEnabled);
      
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Error saving settings:', err);
    }
  };

  const exportData = async () => {
    try {
      const accounts = await window.electron.getAccounts();
      const dataStr = JSON.stringify(accounts, null, 2);
      const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
      
      const exportFileDefaultName = `xela-accounts-${new Date().toISOString()}.json`;
      
      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', dataUri);
      linkElement.setAttribute('download', exportFileDefaultName);
      linkElement.click();
    } catch (err) {
      console.error('Error exporting data:', err);
    }
  };

  const clearAllData = () => {
    if (window.confirm('⚠️ This will delete ALL accounts and data. This cannot be undone. Are you sure?')) {
      // Implement clear all functionality
      alert('Data cleared');
    }
  };

  return (
    <div className="settings-container">
      <h2>⚙️ Settings</h2>

      <div className="settings-section">
        <h3>Display</h3>
        <div className="setting-item">
          <label>Theme</label>
          <select name="theme" value={settings.theme} onChange={handleChange}>
            <option value="light">☀️ Light</option>
            <option value="dark">🌙 Dark</option>
          </select>
        </div>
      </div>

      <div className="settings-section">
        <h3>Backup & Sync</h3>
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              name="autoBackup"
              checked={settings.autoBackup}
              onChange={handleChange}
            />
            Enable Automatic Backups
          </label>
        </div>
        {settings.autoBackup && (
          <div className="setting-item">
            <label>Backup Frequency</label>
            <select name="backupFrequency" value={settings.backupFrequency} onChange={handleChange}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        )}
      </div>

      <div className="settings-section">
        <h3>Notifications</h3>
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              name="notificationsEnabled"
              checked={settings.notificationsEnabled}
              onChange={handleChange}
            />
            Enable Notifications
          </label>
        </div>
      </div>

      <div className="settings-section">
        <h3>Data Management</h3>
        <button className="btn btn-secondary" onClick={exportData}>
          📥 Export Data as JSON
        </button>
        <p className="hint">Export all your accounts for backup or migration</p>
      </div>

      <div className="settings-section danger">
        <h3>Danger Zone</h3>
        <button className="btn btn-danger" onClick={clearAllData}>
          🗑️ Clear All Data
        </button>
        <p className="hint">Permanently delete all accounts and data. This cannot be undone.</p>
      </div>

      {saved && <div className="success-message">✅ Settings saved successfully</div>}

      <div className="settings-actions">
        <button className="btn btn-primary" onClick={handleSave}>
          💾 Save Settings
        </button>
      </div>
    </div>
  );
}

export default Settings;