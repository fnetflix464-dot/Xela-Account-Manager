import React, { useState, useEffect, useCallback } from 'react';
import '../styles/SecurityDashboard.css';

const TYPE_LABEL = {
  category: 'Category',
  folder: 'Folder',
  entry: 'Entry',
};

function itemName(record) {
  return record.item.title || record.item.name || 'Untitled';
}

function RecycleBin({ onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const result = await window.electron.getRecycleBin();
    if (result.success) setItems(result.data);
    else setError(result.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const restore = async (recycleId) => {
    const result = await window.electron.restoreFromRecycleBin(recycleId);
    if (result.success) {
      load();
      onChanged();
    } else {
      setError(result.error);
    }
  };

  const permanentlyDelete = async (recycleId) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Permanently delete this item? This cannot be undone.')) return;
    const result = await window.electron.permanentlyDelete(recycleId);
    if (result.success) load();
    else setError(result.error);
  };

  const emptyBin = async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Permanently delete everything in the Recycle Bin? This cannot be undone.')) return;
    const result = await window.electron.emptyRecycleBin();
    if (result.success) load();
    else setError(result.error);
  };

  if (loading) {
    return <div className="loading-state">Loading recycle bin...</div>;
  }

  return (
    <div className="security-dashboard">
      <div className="panel-header">
        <h2>Recycle Bin</h2>
        {items.length > 0 && (
          <button className="btn btn-danger" onClick={emptyBin}>
            Empty Recycle Bin
          </button>
        )}
      </div>

      {error && <div className="error-message">{error}</div>}

      {items.length === 0 ? (
        <div className="empty-state">
          <p>Recycle Bin is empty</p>
        </div>
      ) : (
        <div className="audit-log">
          {items.map((record) => (
            <div className="audit-entry" key={record.id}>
              <div>
                <strong>{TYPE_LABEL[record.type]}:</strong> {itemName(record)}
                <div className="audit-timestamp">Deleted {new Date(record.deletedAt).toLocaleString()}</div>
              </div>
              <div className="card-actions">
                <button className="btn btn-sm btn-success" onClick={() => restore(record.id)}>
                  Restore
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => permanentlyDelete(record.id)}>
                  Delete Forever
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default RecycleBin;
