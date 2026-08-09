import { useState, useEffect } from 'react';
import { X, Loader, Check } from 'lucide-react';
import { api } from '../api';

export default function SpreadsheetPicker({ integrationId, onClose, onSelect, persistSelection = true }) {
  const [spreadsheets, setSpreadsheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchSpreadsheets();
  }, [integrationId]);

  const fetchSpreadsheets = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get(`/hub/integrations/${integrationId}/spreadsheets`);
      setSpreadsheets(response.data || []);
    } catch (err) {
      setError(err.message || 'Failed to load spreadsheets');
      console.error('Error fetching spreadsheets:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (sheet) => {
    try {
      setSaving(true);
      if (persistSelection) {
        await api.post(`/hub/integrations/${integrationId}/spreadsheets/${sheet.id}/select`, {
          sheetName: sheet.name
        });
      }

      // Call parent callback
      if (onSelect) {
        onSelect({ id: sheet.id, name: sheet.name });
      }

      onClose();
    } catch (err) {
      setError('Failed to select spreadsheet: ' + err.message);
      setSaving(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>Select Google Sheet</h2>
          <button
            style={styles.closeBtn}
            onClick={onClose}
            disabled={saving}
          >
            <X size={24} />
          </button>
        </div>

        <div style={styles.content}>
          {!loading && !error && spreadsheets.length > 0 && (
            <input
              type="text"
              placeholder="Search sheets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={styles.searchInput}
            />
          )}

          {loading && (
            <div style={styles.loading}>
              <Loader size={40} style={{ animation: 'spin 1s linear infinite' }} />
              <p>Loading your spreadsheets...</p>
            </div>
          )}

          {error && (
            <div style={styles.error}>
              <p>❌ {error}</p>
              <button style={styles.retryBtn} onClick={fetchSpreadsheets}>
                Retry
              </button>
            </div>
          )}

          {!loading && !error && spreadsheets.length === 0 && (
            <div style={styles.empty}>
              <p>No Google Sheets found in your drive</p>
              <p style={styles.hint}>Create a new Google Sheet to get started</p>
            </div>
          )}

          {!loading && !error && spreadsheets.length > 0 && (
            <div style={styles.list}>
              {spreadsheets.filter((sheet) =>
                sheet.name.toLowerCase().includes(searchQuery.toLowerCase())
              ).map((sheet) => (
                <div
                  key={sheet.id}
                  style={{
                    ...styles.item,
                    ...(selectedId === sheet.id ? styles.itemSelected : {})
                  }}
                  onClick={() => !saving && setSelectedId(sheet.id)}
                >
                  <div style={styles.itemContent}>
                    <p style={styles.sheetName}>{sheet.name}</p>
                    <p style={styles.sheetTime}>
                      Modified: {new Date(sheet.modifiedTime).toLocaleDateString()}
                    </p>
                  </div>

                  {selectedId === sheet.id && (
                    <Check size={20} style={styles.checkIcon} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={styles.footer}>
          <button
            style={styles.cancelBtn}
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            style={{
              ...styles.selectBtn,
              opacity: selectedId ? 1 : 0.5,
              cursor: selectedId ? 'pointer' : 'not-allowed'
            }}
            onClick={() => {
              const sheet = spreadsheets.find(s => s.id === selectedId);
              if (sheet) handleSelect(sheet);
            }}
            disabled={!selectedId || saving}
          >
            {saving ? 'Saving...' : 'Select'}
          </button>
        </div>

        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: 'white',
    borderRadius: '12px',
    width: '90%',
    maxWidth: '600px',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1.5rem',
    borderBottom: '1px solid #e4ece8',
  },
  title: {
    margin: 0,
    fontSize: '1.25rem',
    fontWeight: 600,
    color: '#0d1a15',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    color: '#5d7167',
    display: 'flex',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '1.5rem',
    display: 'flex',
    flexDirection: 'column',
  },
  searchInput: {
    marginBottom: '1rem',
    padding: '0.75rem 1rem',
    border: '1px solid #d5dfd9',
    borderRadius: '6px',
    fontSize: '1rem',
    fontFamily: 'inherit',
    outline: 'none',
    transition: 'border-color 0.2s ease',
    boxSizing: 'border-box',
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '300px',
    color: '#5d7167',
  },
  error: {
    background: '#fdeeed',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    padding: '1rem',
    color: '#a33028',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: '1rem',
    padding: '0.5rem 1rem',
    background: '#12915f',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.9rem',
  },
  empty: {
    textAlign: 'center',
    color: '#5d7167',
    padding: '2rem',
  },
  hint: {
    fontSize: '0.9rem',
    color: '#83968c',
    marginTop: '0.5rem',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    overflow: 'auto',
  },
  item: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem',
    border: '1px solid #e4ece8',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  itemSelected: {
    background: '#eef2ff',
    borderColor: '#12915f',
  },
  itemContent: {
    flex: 1,
  },
  sheetName: {
    margin: '0 0 0.25rem 0',
    fontSize: '1rem',
    fontWeight: 500,
    color: '#0d1a15',
  },
  sheetTime: {
    margin: 0,
    fontSize: '0.85rem',
    color: '#83968c',
  },
  checkIcon: {
    color: '#12915f',
    marginLeft: '1rem',
  },
  footer: {
    display: 'flex',
    gap: '1rem',
    padding: '1.5rem',
    borderTop: '1px solid #e4ece8',
    justifyContent: 'flex-end',
  },
  cancelBtn: {
    padding: '0.75rem 1.5rem',
    border: '1px solid #d5dfd9',
    background: 'white',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: 500,
    color: '#5d7167',
    transition: 'all 0.2s ease',
  },
  selectBtn: {
    padding: '0.75rem 1.5rem',
    background: '#12915f',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: 500,
    transition: 'all 0.2s ease',
  },
};
