import React, { useState, useEffect } from 'react';
import '../styles/Login.css';

function Login({ onLoginSuccess }) {
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('verify');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [passwordStrength, setPasswordStrength] = useState('');

  useEffect(() => {
    checkMasterPasswordExists();
  }, []);

  const checkMasterPasswordExists = async () => {
    try {
      const result = await window.electron.checkMasterPasswordExists();
      setMode(result.exists ? 'verify' : 'setup');
      setLoading(false);
    } catch (err) {
      setError('Error checking authentication status');
      setLoading(false);
    }
  };

  const validatePasswordStrength = async (pwd) => {
    if (pwd) {
      try {
        const result = await window.electron.validatePasswordStrength(pwd);
        setPasswordStrength(result.strength);
      } catch (err) {
        console.error('Error validating password:', err);
      }
    }
  };

  const handlePasswordChange = (e) => {
    const pwd = e.target.value;
    setPassword(pwd);
    if (mode === 'setup') {
      validatePasswordStrength(pwd);
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

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="login-header">
          <h1>🔐 Xela Account Manager</h1>
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
                ⚠️ <strong>Important:</strong> Your master password cannot be recovered. Store it securely.
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
              ? '🔒 This is your one-time setup. Create a strong password to protect your accounts.'
              : '🔑 Enter your master password to access your accounts.'}
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
