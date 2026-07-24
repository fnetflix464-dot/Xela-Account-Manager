import React, { useState, useEffect } from 'react';
import '../styles/Login.css';
import { calculatePasswordStrength } from '../utils/passwordStrength';

function Login({ onLoginSuccess }) {
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('verify'); // 'setup' | 'verify' | 'import' | 'recovery'
  const [previousMode, setPreviousMode] = useState('setup'); // where 'import' returns to on Back
  const [confirmPassword, setConfirmPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [passwordStrength, setPasswordStrength] = useState('');
  const [backups, setBackups] = useState([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [quickUnlockEnabled, setQuickUnlockEnabled] = useState(false);
  const [usePin, setUsePin] = useState(false);
  const [pin, setPin] = useState('');

  useEffect(() => {
    checkVaultStatus();
  }, []);

  useEffect(() => {
    if (mode !== 'recovery') return;
    setBackupsLoading(true);
    window.electron.listBackups().then((result) => {
      setBackups(result.success ? result.data : []);
      setBackupsLoading(false);
    });
  }, [mode]);

  const checkVaultStatus = async () => {
    try {
      // Checked before checkMasterPasswordExists: a structurally broken
      // vault.xam should route straight to recovery instead of ever
      // reaching the normal unlock screen, where it could only ever
      // surface as a confusing "incorrect password" on every attempt.
      const health = await window.electron.checkVaultHealth();
      if (health.success && !health.data.healthy) {
        setMode('recovery');
        setLoading(false);
        return;
      }
      const result = await window.electron.checkMasterPasswordExists();
      const exists = result.success && result.data.exists;
      setMode(exists ? 'verify' : 'setup');

      if (exists) {
        const quickUnlock = await window.electron.isQuickUnlockEnabled();
        const enabled = quickUnlock.success && quickUnlock.data.enabled;
        setQuickUnlockEnabled(enabled);
        setUsePin(enabled);
      }
      setLoading(false);
    } catch (err) {
      setError('Error checking authentication status');
      setLoading(false);
    }
  };

  const handlePasswordChange = (e) => {
    const pwd = e.target.value;
    setPassword(pwd);
    if (mode === 'setup') {
      setPasswordStrength(calculatePasswordStrength(pwd));
    }
  };

  const handleSetupMasterPassword = async (e) => {
    e.preventDefault();
    setError('');

    if (!password || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Master password must be at least 8 characters');
      return;
    }

    try {
      setLoading(true);
      const result = await window.electron.setMasterPassword(password);

      if (result.success) {
        onLoginSuccess();
      } else {
        setError(result.error || 'Failed to set master password');
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPassword = async (e) => {
    e.preventDefault();
    setError('');

    if (!password) {
      setError('Please enter your master password');
      return;
    }

    try {
      setLoading(true);
      const result = await window.electron.verifyMasterPassword(password);

      if (result.success) {
        onLoginSuccess();
      } else {
        setError('Invalid master password');
        setPassword('');
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handlePinSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!pin) {
      setError('Please enter your PIN');
      return;
    }

    try {
      setLoading(true);
      const result = await window.electron.unlockWithPin(pin);
      if (result.success) {
        onLoginSuccess();
      } else {
        setError(result.error || 'Incorrect PIN');
        setPin('');
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleImportVault = async (e) => {
    e.preventDefault();
    setError('');

    if (!importPassword) {
      setError('Enter the master password of the vault file you want to import');
      return;
    }

    if (
      previousMode === 'verify' &&
      // eslint-disable-next-line no-alert
      !window.confirm('Importing will replace your current vault (a backup of it will be kept first). Continue?')
    ) {
      return;
    }

    try {
      setLoading(true);
      // Shows a native "choose file" dialog, then decrypts + adopts it as
      // the live vault - already unlocked in memory on success, so no
      // separate "unlock" step is needed afterwards.
      const result = await window.electron.importVault(importPassword);
      if (result.success && result.data) {
        onLoginSuccess();
      } else if (result.success && !result.data) {
        // User canceled the file picker - stay on this screen.
      } else {
        setError(result.error || 'Failed to import vault');
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreBackup = async (backupPath) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Restore this backup? Your current vault file will be replaced (it is backed up first).')) {
      return;
    }
    setError('');
    setRestoring(true);
    try {
      const result = await window.electron.restoreBackup(backupPath);
      if (result.success) {
        // Re-run the full health/existence check against the file that's
        // now live on disk rather than assuming the restored backup is
        // itself healthy.
        setRestoring(false);
        await checkVaultStatus();
      } else {
        setError(result.error || 'Failed to restore backup');
        setRestoring(false);
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
      setRestoring(false);
    }
  };

  const getStrengthColor = (strength) => {
    switch (strength) {
      case 'Very Strong':
      case 'Strong':
        return '#10b981';
      case 'Good':
        return '#f59e0b';
      case 'Fair':
      case 'Weak':
        return '#ef4444';
      default:
        return '#6b7280';
    }
  };

  if (loading) {
    return (
      <div className="login-container">
        <div className="login-box">
          <div className="spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (mode === 'recovery') {
    return (
      <div className="login-container">
        <div className="login-box">
          <div className="login-header">
            <h1 className="app-wordmark login-wordmark">
              <span className="app-wordmark-main">XELA</span>
              <span className="app-wordmark-sub">Account Manager</span>
            </h1>
            <p>Vault File Needs Attention</p>
          </div>

          <p className="hint">
            Your vault.xam file could not be read as a valid vault (it may have been damaged by an
            interrupted write, disk error, or manual edit). Restoring a backup below will replace it -
            the current file is backed up first, so nothing is discarded.
          </p>

          {error && <div className="error-message">{error}</div>}

          {backupsLoading ? (
            <p>Checking for backups...</p>
          ) : backups.length === 0 ? (
            <p className="hint">No backups are available to restore from.</p>
          ) : (
            <ul className="backup-list">
              {backups.map((backupPath) => (
                <li key={backupPath} className="backup-list-item">
                  <span>{backupPath.split(/[\\/]/).pop()}</span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={restoring}
                    onClick={() => handleRestoreBackup(backupPath)}
                  >
                    {restoring ? 'Restoring...' : 'Restore'}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="login-footer">
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setError('');
                setMode('verify');
              }}
            >
              ← Back to unlock screen
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'verify' && usePin) {
    return (
      <div className="login-container">
        <div className="login-box">
          <div className="login-header">
            <h1 className="app-wordmark login-wordmark">
              <span className="app-wordmark-main">XELA</span>
              <span className="app-wordmark-sub">Account Manager</span>
            </h1>
            <p>Unlock Your Accounts</p>
          </div>

          <form onSubmit={handlePinSubmit}>
            <div className="form-group">
              <label htmlFor="pin">PIN</label>
              <input
                id="pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={12}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="Enter your PIN"
                disabled={loading}
                autoFocus
                required
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <button type="submit" className="btn btn-primary btn-large" disabled={loading}>
              {loading ? 'Processing...' : 'Unlock'}
            </button>
          </form>

          <div className="login-footer">
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setError('');
                setPin('');
                setUsePin(false);
              }}
            >
              Use master password instead
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'import') {
    return (
      <div className="login-container">
        <div className="login-box">
          <div className="login-header">
            <h1 className="app-wordmark login-wordmark">
              <span className="app-wordmark-main">XELA</span>
              <span className="app-wordmark-sub">Account Manager</span>
            </h1>
            <p>Import an Existing Vault</p>
          </div>

          <form onSubmit={handleImportVault}>
            <div className="form-group">
              <label htmlFor="import-password">Master password of the vault file to import</label>
              <input
                id="import-password"
                type="password"
                value={importPassword}
                onChange={(e) => setImportPassword(e.target.value)}
                placeholder="Enter that vault's master password"
                disabled={loading}
                autoFocus
                required
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <button type="submit" className="btn btn-primary btn-large" disabled={loading}>
              {loading ? 'Processing...' : 'Choose File & Import'}
            </button>
          </form>

          <div className="login-footer">
            <p>
              {previousMode === 'verify'
                ? 'This replaces your current vault (it gets backed up first). '
                : ''}
              You'll be asked to pick the .xam file next.
            </p>
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setError('');
                setImportPassword('');
                setMode(previousMode);
              }}
            >
              ← Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="login-header">
          <h1 className="app-wordmark login-wordmark">
            <span className="app-wordmark-main">XELA</span>
            <span className="app-wordmark-sub">Account Manager</span>
          </h1>
          <p>{mode === 'setup' ? 'Set Your Master Password' : 'Unlock Your Accounts'}</p>
        </div>

        <form onSubmit={mode === 'setup' ? handleSetupMasterPassword : handleVerifyPassword}>
          <div className="form-group">
            <label htmlFor="password">
              {mode === 'setup' ? 'Create Master Password' : 'Master Password'}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={handlePasswordChange}
              placeholder="Enter a strong password"
              disabled={loading}
              autoFocus
              required
            />
            {mode === 'setup' && passwordStrength && (
              <div className="password-strength">
                <div
                  className="strength-bar"
                  style={{
                    backgroundColor: getStrengthColor(passwordStrength),
                  }}
                ></div>
                <span style={{ color: getStrengthColor(passwordStrength) }}>
                  {passwordStrength}
                </span>
              </div>
            )}
          </div>

          {mode === 'setup' && (
            <div className="form-group">
              <label htmlFor="confirm-password">Confirm Master Password</label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                disabled={loading}
                required
              />
            </div>
          )}

          {mode === 'setup' && (
            <div className="security-info">
              <p>
                <strong>Important:</strong> Your master password cannot be recovered. Store it securely.
              </p>
            </div>
          )}

          {error && <div className="error-message">{error}</div>}

          <button type="submit" className="btn btn-primary btn-large" disabled={loading}>
            {loading ? 'Processing...' : mode === 'setup' ? 'Create Password' : 'Unlock'}
          </button>
        </form>

        <div className="login-footer">
          <p>
            {mode === 'setup'
              ? 'This is your one-time setup. Create a strong password to protect your accounts.'
              : 'Enter your master password to access your accounts.'}
          </p>
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              setError('');
              setPreviousMode(mode);
              setMode('import');
            }}
          >
            {mode === 'setup' ? 'Import an existing vault instead' : 'Import a different vault'}
          </button>
          {mode === 'verify' && quickUnlockEnabled && (
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setError('');
                setUsePin(true);
              }}
            >
              Use PIN instead
            </button>
          )}
          {mode === 'verify' && (
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setError('');
                setMode('recovery');
              }}
            >
              Trouble unlocking? Restore from a backup
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default Login;
