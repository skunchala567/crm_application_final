import { useState } from 'react';
import { Upload, Download, Loader, CheckCircle, AlertCircle, TrendingUp } from 'lucide-react';
import { api } from '../api';
import './SyncDataPanel.css';

export default function SyncDataPanel({ integrationId, provider }) {
  const [syncInProgress, setSyncInProgress] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [error, setError] = useState(null);
  const [syncType, setSyncType] = useState(null);

  const handleImport = async () => {
    try {
      setSyncInProgress(true);
      setSyncType('import');
      setError(null);
      setSyncResult(null);

      const response = await api.post(`/hub/integrations/${integrationId}/import`);
      setSyncResult(response.data.result || response.data);
    } catch (err) {
      setError(err.message || 'Import failed');
    } finally {
      setSyncInProgress(false);
    }
  };

  const handleExport = async () => {
    try {
      setSyncInProgress(true);
      setSyncType('export');
      setError(null);
      setSyncResult(null);

      const response = await api.post(`/hub/integrations/${integrationId}/export`);
      setSyncResult(response.data.result || response.data);
    } catch (err) {
      setError(err.message || 'Export failed');
    } finally {
      setSyncInProgress(false);
    }
  };

  return (
    <div className="sync-data-panel">
      <div className="sync-header">
        <div>
          <h3 className="sync-title">🔄 Sync Data</h3>
          <p className="sync-subtitle">
            Import data from {provider} or export CRM data
          </p>
        </div>
      </div>

      <div className="sync-actions">
        <button
          className="sync-btn import-btn"
          onClick={handleImport}
          disabled={syncInProgress}
        >
          <Upload size={18} />
          Import from {provider}
        </button>
        <button
          className="sync-btn export-btn"
          onClick={handleExport}
          disabled={syncInProgress}
        >
          <Download size={18} />
          Export to {provider}
        </button>
      </div>

      {syncInProgress && (
        <div className="sync-progress">
          <Loader size={32} style={{ animation: 'spin 1s linear infinite', color: '#12915f' }} />
          <div>
            <p className="progress-title">
              {syncType === 'import' ? 'Importing data...' : 'Exporting data...'}
            </p>
            <p className="progress-subtitle">Please wait while we sync your data</p>
          </div>
        </div>
      )}

      {error && !syncInProgress && (
        <div className="sync-error">
          <AlertCircle size={20} />
          <p>{error}</p>
          <button
            className="retry-link"
            onClick={() => syncType === 'import' ? handleImport() : handleExport()}
          >
            Try Again
          </button>
        </div>
      )}

      {syncResult && !syncInProgress && (
        <div className="sync-success">
          <div className="success-header">
            <CheckCircle size={24} />
            <p>Sync Completed Successfully!</p>
          </div>

          <div className="sync-stats">
            {syncResult.imported !== undefined && (
              <div className="stat-item">
                <TrendingUp size={16} />
                <div>
                  <p className="stat-label">Imported</p>
                  <p className="stat-value">{syncResult.imported}</p>
                </div>
              </div>
            )}

            {syncResult.skipped !== undefined && (
              <div className="stat-item">
                <AlertCircle size={16} />
                <div>
                  <p className="stat-label">Skipped</p>
                  <p className="stat-value">{syncResult.skipped}</p>
                </div>
              </div>
            )}

            {syncResult.failed !== undefined && (
              <div className="stat-item">
                <AlertCircle size={16} />
                <div>
                  <p className="stat-label">Failed</p>
                  <p className="stat-value">{syncResult.failed}</p>
                </div>
              </div>
            )}

            {syncResult.exported !== undefined && (
              <div className="stat-item">
                <TrendingUp size={16} />
                <div>
                  <p className="stat-label">Exported</p>
                  <p className="stat-value">{syncResult.exported}</p>
                </div>
              </div>
            )}
          </div>

          {syncResult.message && (
            <p className="sync-message">{syncResult.message}</p>
          )}

          <button
            className="sync-close-btn"
            onClick={() => setSyncResult(null)}
          >
            Close
          </button>
        </div>
      )}

      <div className="sync-info">
        <p>
          💡 <strong>Tip:</strong> Set up your field mappings before syncing. Import will check for duplicates based on phone number or email.
        </p>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
