import React, { useState, useEffect } from 'react';
import '../styles/SecurityDashboard.css';

function SecurityDashboard() {
  const [stats, setStats] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadSecurityData();
    // Refresh every 30 seconds
    const interval = setInterval(loadSecurityData, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadSecurityData = async () => {
    try {
      setLoading(true);
      const [statsResult, auditResult] = await Promise.all([
        window.electron.getSecurityStats(),
        window.electron.getAuditLog(20),
      ]);

      if (statsResult.success) {
        setStats(statsResult.data);
      }
      if (auditResult.success) {
        setAuditLog(auditResult.data);
      }
    } catch (err) {
      setError('Failed to load security data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const getRiskLevel = () => {
    if (!stats) return 'unknown';
    
    let riskScore = 0;
    
    // 2FA coverage: ideal is 100%
    if (stats.twoFAPercentage < 50) riskScore += 3;
    else if (stats.twoFAPercentage < 80) riskScore += 1;

    // Weak passwords: should be 0
    if (stats.weakPasswords > 0) riskScore += 2;

    // Old passwords: should be minimal
    if (stats.passwordsOlderThan90Days > stats.totalAccounts * 0.5) riskScore += 1;

    if (riskScore >= 5) return 'critical';
    if (riskScore >= 3) return 'high';
    if (riskScore >= 1) return 'medium';
    return 'low';
  };

  const getRiskColor = (risk) => {
    const colors = {
      critical: '#dc2626',
      high: '#ea580c',
      medium: '#f59e0b',
      low: '#10b981',
      unknown: '#6b7280',
    };
    return colors[risk] || colors.unknown;
  };

  const formatEventType = (eventType) => {
    const types = {
      ACCOUNT_CREATED: '➕ Account Created',
      ACCOUNT_UPDATED: '✏️ Account Updated',
      ACCOUNT_DELETED: '🗑️ Account Deleted',
      '2FA_ENABLED': '🔐 2FA Enabled',
      '2FA_DISABLED': '🔓 2FA Disabled',
      BACKUP_RESTORE_STARTED: '📦 Backup Started',
      BACKUP_RESTORE_COMPLETED: '✅ Backup Completed',
      BACKUP_RESTORE_FAILED: '❌ Backup Failed',
    };
    return types[eventType] || eventType;
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="security-dashboard">
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading security data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="security-dashboard">
        <div className="error-state">
          <p>⚠️ {error}</p>
          <button onClick={loadSecurityData} className="btn btn-primary">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="security-dashboard">
        <div className="empty-state">
          <p>No security data available</p>
        </div>
      </div>
    );
  }

  const riskLevel = getRiskLevel();
  const riskColor = getRiskColor(riskLevel);

  return (
    <div className="security-dashboard">
      <div className="dashboard-header">
        <h2>🛡️ Security Dashboard</h2>
        <button onClick={loadSecurityData} className="btn-refresh" title="Refresh">
          🔄
        </button>
      </div>

      {/* Overall Risk Assessment */}
      <div className="risk-card">
        <div className="risk-level" style={{ borderLeftColor: riskColor }}>
          <div className="risk-indicator" style={{ backgroundColor: riskColor }}></div>
          <div className="risk-info">
            <h3>Overall Security Risk</h3>
            <p className="risk-status" style={{ color: riskColor }}>
              {riskLevel.toUpperCase()}
            </p>
          </div>
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="metrics-grid">
        {/* 2FA Coverage */}
        <div className="metric-card">
          <div className="metric-icon">🔐</div>
          <div className="metric-content">
            <h3>2FA Coverage</h3>
            <div className="metric-value">{stats.twoFAPercentage}%</div>
            <div className="metric-subtext">
              {stats.accountsWith2FA} of {stats.totalAccounts} accounts
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${stats.twoFAPercentage}%`,
                  backgroundColor: stats.twoFAPercentage >= 80 ? '#10b981' : '#f59e0b',
                }}
              ></div>
            </div>
            {stats.twoFAPercentage < 80 && (
              <p className="metric-warning">
                ⚠️ Target: 100% coverage for all important accounts
              </p>
            )}
          </div>
        </div>

        {/* Weak Passwords */}
        <div className="metric-card">
          <div className="metric-icon">⚠️</div>
          <div className="metric-content">
            <h3>Weak Passwords</h3>
            <div className="metric-value" style={{ color: stats.weakPasswords > 0 ? '#ef4444' : '#10b981' }}>
              {stats.weakPasswords}
            </div>
            <div className="metric-subtext">accounts with weak passwords</div>
            {stats.weakPasswords > 0 && (
              <p className="metric-warning">
                🚨 Upgrade these passwords immediately
              </p>
            )}
            {stats.weakPasswords === 0 && (
              <p className="metric-success">✅ All passwords are strong</p>
            )}
          </div>
        </div>

        {/* Password Age */}
        <div className="metric-card">
          <div className="metric-icon">🕐</div>
          <div className="metric-content">
            <h3>Old Passwords</h3>
            <div className="metric-value">{stats.passwordsOlderThan90Days}</div>
            <div className="metric-subtext">not changed in 90+ days</div>
            {stats.passwordsOlderThan90Days > 0 && (
              <p className="metric-warning">
                💡 Consider updating these passwords
              </p>
            )}
            {stats.passwordsOlderThan90Days === 0 && (
              <p className="metric-success">✅ All passwords are up-to-date</p>
            )}
          </div>
        </div>

        {/* Total Accounts */}
        <div className="metric-card">
          <div className="metric-icon">📋</div>
          <div className="metric-content">
            <h3>Total Accounts</h3>
            <div className="metric-value">{stats.totalAccounts}</div>
            <div className="metric-subtext">accounts managed</div>
            <p className="metric-info">
              Protected with AES-256 encryption
            </p>
          </div>
        </div>
      </div>

      {/* Security Recommendations */}
      <div className="recommendations-section">
        <h3>🎯 Security Recommendations</h3>
        <div className="recommendations-list">
          {stats.weakPasswords > 0 && (
            <div className="recommendation critical">
              <span className="recommendation-icon">🚨</span>
              <span>Upgrade {stats.weakPasswords} weak password(s) to strong passwords</span>
            </div>
          )}
          {stats.twoFAPercentage < 100 && (
            <div className="recommendation high">
              <span className="recommendation-icon">🔐</span>
              <span>Enable 2FA on {stats.totalAccounts - stats.accountsWith2FA} more account(s)</span>
            </div>
          )}
          {stats.passwordsOlderThan90Days > 0 && (
            <div className="recommendation medium">
              <span className="recommendation-icon">💡</span>
              <span>Consider updating {stats.passwordsOlderThan90Days} password(s) that are older than 90 days</span>
            </div>
          )}
          {stats.weakPasswords === 0 && stats.twoFAPercentage === 100 && stats.passwordsOlderThan90Days === 0 && (
            <div className="recommendation success">
              <span className="recommendation-icon">✅</span>
              <span>Excellent security posture! All recommendations met.</span>
            </div>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="activity-section">
        <h3>📊 Recent Activity</h3>
        {auditLog.length === 0 ? (
          <div className="empty-activity">
            <p>No activity recorded yet</p>
          </div>
        ) : (
          <div className="activity-list">
            {auditLog.map((log) => (
              <div key={log.id} className="activity-item">
                <div className="activity-event">
                  {formatEventType(log.eventType)}
                </div>
                <div className="activity-details">
                  {log.details && <p>{log.details}</p>}
                </div>
                <div className="activity-time">
                  {formatTime(log.timestamp)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default SecurityDashboard;
