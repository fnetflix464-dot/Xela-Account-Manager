import React, { useState } from 'react';
import '../styles/AccountList.css';

function AccountList({ accounts, onEdit, onDelete, onEnable2FA }) {
  const [revealedPasswords, setRevealedPasswords] = useState({});
  const [searchTerm, setSearchTerm] = useState('');

  const toggleReveal = (id) => {
    setRevealedPasswords((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    alert('Copied to clipboard!');
  };

  const filteredAccounts = accounts.filter(acc =>
    acc.platform.toLowerCase().includes(searchTerm.toLowerCase()) ||
    acc.username.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getCategoryEmoji = (category) => {
    const emojis = {
      personal: '👤',
      work: '💼',
      gaming: '🎮',
      shopping: '🛒',
      banking: '🏦',
      social: '📱',
      other: '📌',
    };
    return emojis[category] || '📌';
  };

  const getPasswordStrengthColor = (strength) => {
    switch (strength) {
      case 'Very Strong':
      case 'Strong':
        return '#10b981';
      case 'Good':
        return '#f59e0b';
      default:
        return '#ef4444';
    }
  };

  return (
    <div className="account-list-container">
      <div className="list-header">
        <input
          type="text"
          placeholder="🔍 Search accounts..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
        <span className="account-count">{filteredAccounts.length} accounts</span>
      </div>

      {filteredAccounts.length === 0 ? (
        <div className="empty-state">
          <p>📭 No accounts found</p>
          <p className="hint">Add your first account to get started</p>
        </div>
      ) : (
        <div className="accounts-grid">
          {filteredAccounts.map((account) => (
            <div key={account.id} className="account-card">
              <div className="card-header">
                <div className="card-title">
                  <span className="category-icon">{getCategoryEmoji(account.category)}</span>
                  <h4>{account.platform}</h4>
                </div>
                <span className="category-badge">{account.category}</span>
              </div>

              <div className="card-content">
                <div className="account-field">
                  <label>Username:</label>
                  <span>{account.username}</span>
                </div>

                {account.email && (
                  <div className="account-field">
                    <label>Email:</label>
                    <span>{account.email}</span>
                  </div>
                )}

                <div className="account-field">
                  <label>Password:</label>
                  <div className="password-display">
                    <input
                      type={revealedPasswords[account.id] ? 'text' : 'password'}
                      value="••••••••"
                      readOnly
                    />
                    <button
                      className="btn-reveal"
                      onClick={() => toggleReveal(account.id)}
                      title={revealedPasswords[account.id] ? 'Hide' : 'Show'}
                    >
                      {revealedPasswords[account.id] ? '👁️' : '👁️‍🗨️'}
                    </button>
                    <button
                      className="btn-copy"
                      onClick={() => copyToClipboard(account.username)}
                      title="Copy username"
                    >
                      📋
                    </button>
                  </div>
                </div>

                {account.passwordStrength && (
                  <div className="strength-badge" style={{
                    backgroundColor: getPasswordStrengthColor(account.passwordStrength),
                  }}>
                    {account.passwordStrength}
                  </div>
                )}

                {account.twoFactorEnabled && (
                  <div className="2fa-badge">🔐 2FA Enabled</div>
                )}
              </div>

              <div className="card-actions">
                {!account.twoFactorEnabled && (
                  <button
                    className="btn btn-sm btn-success"
                    onClick={() => onEnable2FA(account)}
                  >
                    🔐 Enable 2FA
                  </button>
                )}
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => onEdit(account)}
                >
                  ✏️ Edit
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => onDelete(account.id)}
                >
                  🗑️ Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default AccountList;