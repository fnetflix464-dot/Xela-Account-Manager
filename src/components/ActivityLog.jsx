import React, { useState, useEffect, useCallback } from 'react';
import '../styles/SecurityDashboard.css';

function formatAction(entry) {
  const label = entry.action.replace(/\./g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  const name = entry.details && (entry.details.title || entry.details.name);
  return name ? `${label} — ${name}` : label;
}

function ActivityLog() {
  const [tree, setTree] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [recycleBinCount, setRecycleBinCount] = useState(0);
  const [activity, setActivity] = useState([]);
  const [reusedPasswords, setReusedPasswords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [treeResult, favoritesResult, recycleResult, activityResult, reusedResult] = await Promise.all([
      window.electron.getVaultTree(),
      window.electron.listFavorites(),
      window.electron.getRecycleBin(),
      window.electron.listRecentActivity(25),
      window.electron.findReusedPasswords(),
    ]);

    if (treeResult.success) setTree(treeResult.data);
    if (favoritesResult.success) setFavorites(favoritesResult.data);
    if (recycleResult.success) setRecycleBinCount(recycleResult.data.length);
    if (activityResult.success) setActivity(activityResult.data);
    if (reusedResult.success) setReusedPasswords(reusedResult.data);
    if (!treeResult.success) setError(treeResult.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const countEntries = (folder) => folder.entries.length + folder.folders.reduce((s, f) => s + countEntries(f), 0);
  const totalEntries = tree.reduce(
    (sum, category) => sum + category.folders.reduce((s, f) => s + countEntries(f), 0),
    0,
  );

  if (loading) {
    return <div className="loading-state">Loading activity...</div>;
  }

  return (
    <div className="security-dashboard">
      <div className="dashboard-header">
        <h2>Activity</h2>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{totalEntries}</div>
          <div className="stat-label">Total Entries</div>
        </div>
        <div className="stat-card success">
          <div className="stat-value">{favorites.length}</div>
          <div className="stat-label">Favorites</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{tree.length}</div>
          <div className="stat-label">Categories</div>
        </div>
        <div className="stat-card warning">
          <div className="stat-value">{recycleBinCount}</div>
          <div className="stat-label">In Recycle Bin</div>
        </div>
        <div className={`stat-card ${reusedPasswords.length > 0 ? 'warning' : ''}`}>
          <div className="stat-value">{reusedPasswords.length}</div>
          <div className="stat-label">Reused Passwords</div>
        </div>
      </div>

      {reusedPasswords.length > 0 && (
        <div className="dashboard-section">
          <h3>Reused Passwords</h3>
          <p className="hint">
            These entries share the same password with at least one other entry - reusing a password
            means a single leak compromises all of them.
          </p>
          <div className="audit-log">
            {reusedPasswords.map((group, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <div className="audit-entry" key={i}>
                <div>
                  {group.map((entry) => `${entry.title} (${entry.categoryName}/${entry.folderPath})`).join(', ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dashboard-section">
        <h3>Recent Activity</h3>
        {activity.length === 0 ? (
          <p>No activity yet.</p>
        ) : (
          <div className="audit-log">
            {activity.map((entry) => (
              <div className="audit-entry" key={entry.id}>
                <div>
                  {formatAction(entry)}
                  <div className="audit-timestamp">{new Date(entry.timestamp).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ActivityLog;
