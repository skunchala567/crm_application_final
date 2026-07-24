import { useState, useEffect } from 'react';
import { RefreshCw, Eye, EyeOff, Lock, X } from 'lucide-react';
import { api } from '../api';
import SpreadsheetPicker from './SpreadsheetPicker';
import ImportGuide from './ImportGuide';
import './GoogleSheetsConfig.css';

export default function GoogleSheetsConfig({ integrationId, onConfigSaved }) {
  const [selectedSheet, setSelectedSheet] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [activeTab, setActiveTab] = useState('config');
  const [preview, setPreview] = useState(null);
  const [showPreview, setShowPreview] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    fetchSelectedSheet();
  }, [integrationId]);

  const fetchSelectedSheet = async () => {
    try {
      const response = await api.get(`/hub/integrations/${integrationId}`);
      const integration = response.data;
      if (integration.config?.spreadsheetName) {
        setSelectedSheet({
          name: integration.config.spreadsheetName,
          id: integration.config.spreadsheetId
        });
        fetchPreview(integration.config.spreadsheetId);
      }
    } catch (err) {
      console.error('Failed to fetch selected sheet:', err);
    }
  };

  const fetchPreview = async (sheetId) => {
    try {
      setPreviewLoading(true);
      setError(null);
      const response = await api.get(
        `/hub/integrations/${integrationId}/spreadsheets/${sheetId}/preview`
      );
      setPreview(response.data);
    } catch (err) {
      setError('Failed to load preview: ' + err.message);
      console.error('Preview fetch error:', err);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSheetSelected = (sheet) => {
    setSelectedSheet(sheet);
    setShowPicker(false);
    fetchPreview(sheet.id);
    if (onConfigSaved) onConfigSaved();
  };

  const handleChangeSheetClick = () => {
    setShowPasswordDialog(true);
    setPassword('');
    setPasswordError('');
  };

  const handlePasswordSubmit = () => {
    const SHEET_PASSWORD = 'admin123';
    if (password === SHEET_PASSWORD) {
      setShowPasswordDialog(false);
      setPassword('');
      setPasswordError('');
      setShowPicker(true);
    } else {
      setPasswordError('Incorrect password. Try again.');
      setPassword('');
    }
  };

  const handlePasswordCancel = () => {
    setShowPasswordDialog(false);
    setPassword('');
    setPasswordError('');
  };

  return (
    <div className="google-sheets-config">
      <div className="tabs-header">
        <button
          className={`tab-btn ${activeTab === 'config' ? 'active' : ''}`}
          onClick={() => setActiveTab('config')}
        >
          Configuration
        </button>
        <button
          className={`tab-btn ${activeTab === 'guide' ? 'active' : ''}`}
          onClick={() => setActiveTab('guide')}
        >
          Import Guide
        </button>
      </div>

      {activeTab === 'config' && (
        <div>
          <div className="config-section">
            <div className="section-header">
              <h4>📊 Google Sheets</h4>
            </div>

            {selectedSheet ? (
              <div className="sheet-info">
                <div className="sheet-name">
                  <strong>Currently Selected</strong>
                  {selectedSheet.name}
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={handleChangeSheetClick}
                >
                  <Lock size={16} />
                  Change Sheet
                </button>
              </div>
            ) : (
              <div className="no-sheet">
                <p style={{ color: '#64748b', marginBottom: '1rem' }}>
                  No Google Sheet selected yet. Choose one to get started.
                </p>
                <button
                  className="btn btn-primary"
                  onClick={() => setShowPicker(true)}
                >
                  Select Spreadsheet
                </button>
              </div>
            )}

            {showPicker && (
              <SpreadsheetPicker
                integrationId={integrationId}
                onClose={() => setShowPicker(false)}
                onSelect={handleSheetSelected}
              />
            )}
          </div>

          {selectedSheet && (
            <div className="preview-section">
              <div className="preview-header">
                <button
                  className="preview-toggle"
                  onClick={() => setShowPreview(!showPreview)}
                >
                  {showPreview ? (
                    <Eye size={18} />
                  ) : (
                    <EyeOff size={18} />
                  )}
                  <span>{showPreview ? 'Hide' : 'Show'} Preview</span>
                </button>
                {showPreview && (
                  <button
                    className="btn btn-sm"
                    onClick={() => fetchPreview(selectedSheet.id)}
                    disabled={previewLoading}
                    title="Refresh preview data"
                  >
                    <RefreshCw size={14} style={{ animation: previewLoading ? 'spin 1s linear infinite' : 'none' }} />
                  </button>
                )}
              </div>

              {showPreview && (
                <div className="preview-content">
                  {previewLoading && (
                    <p style={{ textAlign: 'center', color: '#667eea', fontWeight: '500' }}>
                      ⏳ Loading preview...
                    </p>
                  )}
                  {error && <div className="preview-error">⚠️ {error}</div>}
                  {preview && !previewLoading && (
                    <div className="preview-table">
                      <table>
                        <thead>
                          <tr>
                            {preview.headers?.map((header, i) => (
                              <th key={i}>{header || `Column ${i + 1}`}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.rows?.length > 0 ? (
                            preview.rows.map((row, i) => (
                              <tr key={i}>
                                {row.map((cell, j) => (
                                  <td key={j}>{cell || '—'}</td>
                                ))}
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={preview.headers?.length || 1} className="empty-preview">
                                📭 No data in sheet yet
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'guide' && (
        <ImportGuide />
      )}

      {showPasswordDialog && (
        <div className="password-dialog-overlay">
          <div className="password-dialog">
            <div className="password-dialog-header">
              <h3>🔐 Password Required</h3>
              <button
                className="password-close-btn"
                onClick={handlePasswordCancel}
              >
                <X size={20} />
              </button>
            </div>

            <div className="password-dialog-body">
              <p>Please enter the password to change the sheet selection:</p>
              <input
                type="password"
                placeholder="Enter password..."
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError('');
                }}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') handlePasswordSubmit();
                }}
                autoFocus
                className="password-input"
              />
              {passwordError && (
                <div className="password-error-message">{passwordError}</div>
              )}
            </div>

            <div className="password-dialog-footer">
              <button
                className="btn btn-outline"
                onClick={handlePasswordCancel}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handlePasswordSubmit}
                disabled={!password}
              >
                Verify
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
