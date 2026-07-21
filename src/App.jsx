import React, { useState, useEffect } from 'react';
import './styles/App.css';
import Login from './components/Login';
import AccountList from './components/AccountList';
import AccountForm from './components/AccountForm';
import SecurityDashboard from './components/SecurityDashboard';
import Settings from './components/Settings';
import TwoFactorSetup from './components/TwoFactorSetup';
import CategoryFilter from './components/CategoryFilter';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [activeTab, setActiveTab] = useState('accounts'); // accounts, security, settings
  const [setupTwoFA, setSetupTwoFA] = useState(null);
  const [loading, setLoading] = useState(false);

  // Load accounts when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      loadAccounts();
    }
  }, [isAuthenticated]);

  const loadAccounts = async () => {
    try {
      setLoading(true);
      const result = await window.electron.getAccounts();
      if (result.success) {
        setAccounts(result.data);
      }
    } catch (err) {
      console.error('Error loading accounts:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
  };

  const handleAddAccount = async (accountData) => {
    try {
      setLoading(true);
      const result = await window.electron.addAccount(accountData);
      if (result.success) {
        setAccounts([...accounts, result.data]);
        setShowForm(false);
        alert('Account added successfully!');
      } else {
        alert('Error adding account: ' + result.error);
      }
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateAccount = async (accountData) => {
    try {
      setLoading(true);
      const result = await window.electron.updateAccount(editingAccount.id, accountData);
      if (result.success) {
        setAccounts(accounts.map(acc => acc.id === editingAccount.id ? result.data : acc));
        setShowForm(false);
        setEditingAccount(null);
        alert('Account updated successfully!');
      } else {
        alert('Error updating account: ' + result.error);
      }
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async (id) => {
    if (window.confirm('Are you sure you want to delete this account?')) {
      try {
        setLoading(true);
        const result = await window.electron.deleteAccount(id);
        if (result.success) {
          setAccounts(accounts.filter(acc => acc.id !== id));
          alert('Account deleted successfully!');
        } else {
          alert('Error deleting account: ' + result.error);
        }
      } catch (err) {
        alert('Error: ' + err.message);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleEditAccount = (account) => {
    setEditingAccount(account);
    setShowForm(true);
  };

  const handleEnable2FA = (account) => {
    setSetupTwoFA(account);
  };

  const handle2FAComplete = (result) => {
    loadAccounts(); // Reload accounts to reflect 2FA status
    setSetupTwoFA(null);
    alert('2FA enabled successfully!');
  };

  const filteredAccounts =
    selectedCategory === 'all'
      ? accounts
      : accounts.filter(acc => acc.category === selectedCategory);

  if (!isAuthenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-title">
          <h1>🔐 Xela Account Manager</h1>
          <p>Secure account management with 2FA tracking</p>
        </div>
        <div className="header-info">
          <span className="account-count">📋 {accounts.length} accounts</span>
          <button
            className="btn-logout"
            onClick={() => setIsAuthenticated(false)}
            title="Logout"
          >
            🚪 Logout
          </button>
        </div>
      </header>

      <div className="app-content">
        {/* Navigation Tabs */}
        <nav className="app-nav">
          <button
            className={`nav-tab ${activeTab === 'accounts' ? 'active' : ''}`}
            onClick={() => setActiveTab('accounts')}
          >
            📋 Accounts
          </button>
          <button
            className={`nav-tab ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => setActiveTab('security')}
          >
            🛡️ Security
          </button>
          <button
            className={`nav-tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            ⚙️ Settings
          </button>
        </nav>

        {/* Main Content Area */}
        <main className="main-content">
          {/* 2FA Setup Modal */}
          {setupTwoFA && (
            <div className="modal-overlay">
              <div className="modal-content">
                <button
                  className="modal-close"
                  onClick={() => setSetupTwoFA(null)}
                >
                  ✕
                </button>
                <TwoFactorSetup
                  account={setupTwoFA}
                  onEnable={handle2FAComplete}
                  onCancel={() => setSetupTwoFA(null)}
                />
              </div>
            </div>
          )}

          {/* Accounts Tab */}
          {activeTab === 'accounts' && (
            <div className="tab-content">
              <div className="tab-header">
                <h2>Your Accounts</h2>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setEditingAccount(null);
                    setShowForm(true);
                  }}
                  disabled={loading}
                >
                  ➕ Add New Account
                </button>
              </div>

              {/* Account Form */}
              {showForm && (
                <div className="form-section">
                  <AccountForm
                    account={editingAccount}
                    onSubmit={editingAccount ? handleUpdateAccount : handleAddAccount}
                    onCancel={() => {
                      setShowForm(false);
                      setEditingAccount(null);
                    }}
                  />
                </div>
              )}

              {/* Category Filter */}
              <CategoryFilter
                selectedCategory={selectedCategory}
                onSelectCategory={setSelectedCategory}
              />

              {/* Account List */}
              {loading && !accounts.length ? (
                <div className="loading-state">
                  <p>Loading accounts...</p>
                </div>
              ) : (
                <AccountList
                  accounts={filteredAccounts}
                  onEdit={handleEditAccount}
                  onDelete={handleDeleteAccount}
                  onEnable2FA={handleEnable2FA}
                />
              )}
            </div>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div className="tab-content">
              <SecurityDashboard />
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <div className="tab-content">
              <Settings />
            </div>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="app-footer">
        <p>🔒 All data is encrypted with AES-256 • Master password protected</p>
      </footer>
    </div>
  );
}

export default App;
