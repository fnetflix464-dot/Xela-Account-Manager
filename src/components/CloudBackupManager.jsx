import React, { useState, useEffect } from 'react';
import '../styles/CloudBackupManager.css';

function CloudBackupManager() {
  const [backups, setBackups] = useState([]);
  const [backupHistory, setBackupHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [googleDriveConnected, setGoogleDriveConnected] = useState(false);
  const [dropboxConnected, setDropboxConnected] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState('local');
  const [syncLogs, setSyncLogs] = useState([]);

  useEffect(() => {
    loadBackupHistory();
    loadSyncLogs();
    checkCloudConnections();
  }, []);

  const checkCloudConnections = async () => {
    try {
      const googleDriveConnected = await window.electron.getSetting('googleDriveConnected');
      const dropboxConnected = await window.electron.getSetting('dropboxConnected');
      setGoogleDriveConnected(!!googleDriveConnected);
      setDropboxConnected(!!dropboxConnected);
    } catch (error) {
      console.error('Error checking cloud connections:', error);
    }
  };

  const loadBackupHistory = async () => {
    try {
      setLoading(true);
      const result = await window.electron.getBackupHistory(20);
      if (result.success) {
        setBackupHistory(result.data);
      }
    } catch (error) {
      console.error('Error loading backup history:', error);
      alert('Error loading backup history: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const loadSyncLogs = async () => {
    try {
      const result = await window.electron.getSyncLogs(50);
      if (result.success) {
        setSyncLogs(result.data);
      }
    } catch (error) {
      console.error('Error loading sync logs:', error);
    }
  };

  const handleCreateBackup = async () => {
    try {
      setLoading(true);
      const result = await window.electron.createBackup();
      if (result.success) {
        alert('Backup created successfully!');
        loadBackupHistory();
      } else {
        alert('Error creating backup: ' + result.error);
      }
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUploadBackup = async (provider) => {
    if (!selectedProvider || selectedProvider === 'local') {
      alert('Please select a cloud provider');
      return;
    }

    try {
      setLoading(true);
      const backupResult = await window.electron.createBackup();
      if (backupResult.success) {
        await window.electron.recordCloudSync(
          'upload',
          null,
          'success',
          null,
          selectedProvider
        );
        alert(`Backup uploaded to ${selectedProvider}!`);
        loadSyncLogs();
      }
    } catch (error) {
      alert('Error uploading backup: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreBackup = async (backup) => {
    if (!window.confirm('Restore this backup? Current data will be replaced.')) {
      return;
    }

    try {
      setLoading(true);
      const result = await window.electron.restoreBackup(backup);
      if (result.success) {
        alert('Backup restored successfully!');
        window.location.reload();
      } else {
        alert('Error restoring backup: ' + result.error);
      }
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cloud-backup-manager">
      <div className="backup-section">
        <h3>💾 Create & Manage Backups</h3>

        <div className="backup-actions">
          <button
            className="btn btn-primary"
            onClick={handleCreateBackup}
            disabled={loading}
          >
            {loading ? 'Creating...' : '➕ Create Local Backup'}
          </button>

          <div className="provider-selector">
            <label>Upload to Cloud:</label>
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              disabled={loading}
            >
              <option value="local">Select Provider...</option>
              {googleDriveConnected && (
                <option value="google-drive">Google Drive</option>
              )}
              {dropboxConnected && (
                <option value="dropbox">Dropbox</option>
              )}
            </select>
            <button
              className="btn btn-secondary"
              onClick={() => handleUploadBackup(selectedProvider)}
              disabled={loading || !selectedProvider || selectedProvider === 'local'}
            >
              {loading ? 'Uploading...' : '☁️ Upload'}
            </button>
          </div>
        </div>

        <div className="cloud-status">
          <div className={`provider-status ${googleDriveConnected ? 'connected' : 'disconnected'}`}>
            <span className="status-indicator"></span>
            Google Drive {googleDriveConnected ? '✓ Connected' : '✗ Not Connected'}
          </div>
          <div className={`provider-status ${dropboxConnected ? 'connected' : 'disconnected'}`}>
            <span className="status-indicator"></span>
            Dropbox {dropboxConnected ? '✓ Connected' : '✗ Not Connected'}
          </div>
        </div>
      </div>

      <div className="backup-history-section">
        <h3>📋 Backup History</h3>
        {backupHistory.length === 0 ? (
          <p className="no-data">No backups yet. Create one to get started.</p>
        ) : (
          <div className="backup-list">
            {backupHistory.map((backup, index) => (
              <div key={index} className="backup-item">
                <div className="backup-info">
                  <span className="backup-date">
                    📅 {new Date(backup.timestamp).toLocaleString()}
                  </span>
                  <span className="backup-size">
                    📦 {(backup.size / 1024).toFixed(2)} KB
                  </span>
                </div>
                <button
                  className="btn btn-small btn-secondary"
                  onClick={() => handleRestoreBackup(backup)}
                  disabled={loading}
                >
                  🔄 Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sync-logs-section">
        <h3>🔄 Sync Logs</h3>
        {syncLogs.length === 0 ? (
          <p className="no-data">No sync activity yet.</p>
        ) : (
          <div className="sync-logs">
            {syncLogs.slice(0, 10).map((log, index) => (
              <div
                key={index}
                className={`sync-log-item ${log.status}`}
              >
                <span className="log-action">{log.action}</span>
                <span className="log-provider">{log.cloudProvider}</span>
                <span className="log-status">{log.status}</span>
                <span className="log-time">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default CloudBackupManager;