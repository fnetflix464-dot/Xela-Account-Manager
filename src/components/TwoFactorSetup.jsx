import React, { useState } from 'react';
import '../styles/TwoFactorSetup.css';

function TwoFactorSetup({ account, onEnable, onCancel }) {
  const [step, setStep] = useState(1); // 1: method selection, 2: setup, 3: verify
  const [method, setMethod] = useState(''); // 'totp', 'sms', 'email'
  const [backupCodes, setBackupCodes] = useState([]);
  const [verificationCode, setVerificationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [copied, setCopied] = useState(false);

  const generateBackupCodes = () => {
    const codes = [];
    for (let i = 0; i < 10; i++) {
      const code = Math.random().toString(36).substring(2, 10).toUpperCase();
      codes.push(code);
    }
    return codes;
  };

  const handleMethodSelect = (selectedMethod) => {
    setMethod(selectedMethod);
    setBackupCodes(generateBackupCodes());
    setStep(2);
  };

  const handleCopyBackupCodes = () => {
    const text = backupCodes.join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadBackupCodes = () => {
    const text = `Backup Codes for ${account.platform} (${account.username})\n\n${backupCodes.join('\n')}`;
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', `2fa-backup-codes-${Date.now()}.txt`);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleVerifyAndEnable = async () => {
    if (!verificationCode.trim()) {
      setError('Please enter the verification code');
      return;
    }

    try {
      setLoading(true);
      setError('');

      // Simulate verification (in real app, would verify TOTP token)
      if (method === 'totp' && verificationCode.length !== 6) {
        setError('Verification code must be 6 digits');
        return;
      }

      const result = await window.electron.enable2FA(
        account.id,
        method,
        backupCodes
      );

      if (result.success) {
        onEnable(result.data);
      } else {
        setError(result.error || 'Failed to enable 2FA');
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
      setError('');
    }
  };

  return (
    <div className="twofa-setup-container">
      <div className="twofa-header">
        <h2>🔐 Set Up 2FA</h2>
        <p className="account-info">
          {account.platform} • {account.username}
        </p>
      </div>

      {/* Step 1: Method Selection */}
      {step === 1 && (
        <div className="twofa-step">
          <h3>Choose 2FA Method</h3>
          <p className="step-description">
            Select how you want to secure this account
          </p>

          <div className="method-grid">
            {/* TOTP */}
            <div
              className={`method-card ${method === 'totp' ? 'selected' : ''}`}
              onClick={() => handleMethodSelect('totp')}
            >
              <div className="method-icon">📱</div>
              <h4>Authenticator App</h4>
              <p className="method-desc">
                Use an authenticator app like Google Authenticator or Authy
              </p>
              <ul className="method-features">
                <li>✓ Most secure</li>
                <li>✓ Works offline</li>
                <li>✓ Time-based codes</li>
              </ul>
            </div>

            {/* SMS */}
            <div
              className={`method-card ${method === 'sms' ? 'selected' : ''}`}
              onClick={() => handleMethodSelect('sms')}
            >
              <div className="method-icon">💬</div>
              <h4>Text Message (SMS)</h4>
              <p className="method-desc">
                Receive verification codes via text message
              </p>
              <ul className="method-features">
                <li>✓ Easy to use</li>
                <li>✓ No app needed</li>
                <li>✓ Quick setup</li>
              </ul>
            </div>

            {/* Email */}
            <div
              className={`method-card ${method === 'email' ? 'selected' : ''}`}
              onClick={() => handleMethodSelect('email')}
            >
              <div className="method-icon">📧</div>
              <h4>Email</h4>
              <p className="method-desc">
                Receive verification codes via email
              </p>
              <ul className="method-features">
                <li>✓ Always available</li>
                <li>✓ No phone needed</li>
                <li>✓ Simple setup</li>
              </ul>
            </div>
          </div>

          <div className="step-actions">
            <button onClick={onCancel} className="btn btn-outline">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Setup Instructions */}
      {step === 2 && (
        <div className="twofa-step">
          <h3>
            {method === 'totp'
              ? 'Scan QR Code'
              : method === 'sms'
              ? 'Enter Phone Number'
              : 'Confirm Email'}
          </h3>

          {method === 'totp' && (
            <div className="setup-content">
              <p className="step-description">
                Scan this QR code with your authenticator app
              </p>
              <div className="qr-code-placeholder">
                <div className="qr-placeholder-text">
                  📱<br />
                  QR Code<br />
                  (Integration with qrcode library)
                </div>
              </div>
              <p className="alt-method">
                Can't scan? Enter this code instead:<br />
                <code>JBSWY3DPEBLW64TMMQ======</code>
              </p>
            </div>
          )}

          {method === 'sms' && (
            <div className="setup-content">
              <div className="form-group">
                <label>Phone Number</label>
                <input
                  type="tel"
                  placeholder="+1 (555) 123-4567"
                  defaultValue={account.email || ''}
                />
              </div>
              <p className="info-text">
                📌 We'll send a verification code to this number
              </p>
            </div>
          )}

          {method === 'email' && (
            <div className="setup-content">
              <div className="form-group">
                <label>Email Address</label>
                <input
                  type="email"
                  placeholder="your.email@example.com"
                  defaultValue={account.email || ''}
                />
              </div>
              <p className="info-text">
                📌 We'll send verification codes to this email
              </p>
            </div>
          )}

          {/* Backup Codes Section */}
          <div className="backup-codes-section">
            <h4>💾 Save Your Backup Codes</h4>
            <p className="backup-description">
              Save these codes in a safe place. Use them if you lose access to your {method === 'totp' ? 'authenticator app' : 'device'}.
            </p>

            <div className="backup-codes-box">
              {!showBackupCodes ? (
                <button
                  className="btn-reveal-codes"
                  onClick={() => setShowBackupCodes(true)}
                >
                  👁️ Reveal Backup Codes
                </button>
              ) : (
                <div className="backup-codes-list">
                  {backupCodes.map((code, idx) => (
                    <div key={idx} className="backup-code">
                      {code}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {showBackupCodes && (
              <div className="backup-actions">
                <button
                  className="btn btn-secondary"
                  onClick={handleCopyBackupCodes}
                >
                  {copied ? '✅ Copied' : '📋 Copy All'}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handleDownloadBackupCodes}
                >
                  📥 Download
                </button>
              </div>
            )}

            <div className="warning-box">
              ⚠️ <strong>Important:</strong> Each code can only be used once. Keep them safe!
            </div>
          </div>

          <div className="step-actions">
            <button
              onClick={handleBack}
              className="btn btn-outline"
              disabled={loading}
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              className="btn btn-primary"
              disabled={!showBackupCodes || loading}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Verification */}
      {step === 3 && (
        <div className="twofa-step">
          <h3>Verify 2FA Setup</h3>
          <p className="step-description">
            Enter a verification code to confirm your setup
          </p>

          <div className="form-group">
            <label>
              {method === 'totp'
                ? 'Enter code from your authenticator app'
                : method === 'sms'
                ? 'Enter code from your text message'
                : 'Enter code from your email'}
            </label>
            <input
              type="text"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder={method === 'totp' ? '000000' : 'Enter code'}
              maxLength="6"
              autoFocus
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="info-box">
            💡 <strong>Tip:</strong> Your code will expire in 30 seconds. Generate a new one if needed.
          </div>

          <div className="step-actions">
            <button
              onClick={handleBack}
              className="btn btn-outline"
              disabled={loading}
            >
              Back
            </button>
            <button
              onClick={handleVerifyAndEnable}
              className="btn btn-success"
              disabled={loading || verificationCode.length < 6}
            >
              {loading ? 'Enabling...' : 'Enable 2FA'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default TwoFactorSetup;
