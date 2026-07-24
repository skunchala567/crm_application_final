import { useState, useEffect } from 'react';
import { Trash2, Loader, Wand2, Info } from 'lucide-react';
import { api } from '../api';
import './FieldMappingPanel.css';

export default function FieldMappingPanel({ integrationId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sheetHeaders, setSheetHeaders] = useState([]);
  const [crmFields, setCrmFields] = useState([]);
  const [mappings, setMappings] = useState({});
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [autoMapSuggestions, setAutoMapSuggestions] = useState({});

  useEffect(() => {
    fetchMappingData();
  }, [integrationId]);

  const fetchMappingData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [headersRes, mappingRes] = await Promise.all([
        api.get(`/hub/integrations/${integrationId}/field-mapping/headers`),
        api.get(`/hub/integrations/${integrationId}/field-mapping`)
      ]);

      const headers = headersRes.data.sheetHeaders || [];
      const fields = headersRes.data.crmFields || [];

      setSheetHeaders(headers);
      setCrmFields(fields);
      setMappings(mappingRes.data.mappings || {});
      setHasChanges(false);

      // Generate auto-map suggestions
      generateAutoMapSuggestions(headers, fields);
    } catch (err) {
      setError(err.message || 'Failed to load mapping data');
      console.error('Error fetching mapping data:', err);
    } finally {
      setLoading(false);
    }
  };

  const generateAutoMapSuggestions = (headers, fields) => {
    const suggestions = {};

    headers.forEach((header) => {
      const headerLower = header.name.toLowerCase().trim();
      const match = fields.find((field) => {
        const fieldLower = field.label.toLowerCase();
        return fieldLower === headerLower || fieldLower.includes(headerLower) || headerLower.includes(fieldLower);
      });

      if (match) {
        suggestions[`sheet_${header.index}`] = match.name;
      }
    });

    setAutoMapSuggestions(suggestions);
  };

  const handleAutoMap = () => {
    setMappings(autoMapSuggestions);
    setHasChanges(true);
  };

  const handleMapColumn = (sheetColumnIndex, crmFieldName) => {
    const columnKey = `sheet_${sheetColumnIndex}`;
    const newMappings = { ...mappings };

    if (crmFieldName) {
      newMappings[columnKey] = crmFieldName;
    } else {
      delete newMappings[columnKey];
    }

    setMappings(newMappings);
    setHasChanges(true);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await api.post(`/hub/integrations/${integrationId}/field-mapping`, {
        mappings
      });

      setHasChanges(false);
      alert('Field mappings saved successfully!');
    } catch (err) {
      alert('Failed to save mappings: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-state">
        <Loader size={40} style={{ animation: 'spin 1s linear infinite', color: '#667eea' }} />
        <p>Loading field mapping...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-state">
        <p>❌ {error}</p>
        <button className="retry-btn" onClick={fetchMappingData}>
          Try Again
        </button>
      </div>
    );
  }

  if (sheetHeaders.length === 0) {
    return (
      <div className="empty-state">
        <p>📭 No columns found in spreadsheet</p>
        <p>Make sure your spreadsheet has headers in the first row</p>
      </div>
    );
  }

  return (
    <div className="field-mapping-panel">
      <div className="mapping-header">
        <div>
          <h3 className="mapping-title">📊 Map Sheet Columns to CRM Fields</h3>
          <p className="mapping-subtitle">
            Define how spreadsheet data maps to your CRM fields
          </p>
        </div>
        <button
          className="auto-map-btn"
          onClick={handleAutoMap}
          title="Automatically map matching columns"
        >
          <Wand2 size={18} />
          Auto Map
        </button>
      </div>

      {Object.keys(autoMapSuggestions).length > 0 && (
        <div className="suggestions-info">
          <Info size={16} />
          <span>{Object.keys(autoMapSuggestions).length} auto-mapping suggestions available. Click "Auto Map" to apply them.</span>
        </div>
      )}

      <div className="mapping-container">
        {sheetHeaders.map((header) => {
          const columnKey = `sheet_${header.index}`;
          const selectedCrmField = mappings[columnKey];
          const suggestion = autoMapSuggestions[columnKey];
          const hasSuggestion = suggestion && selectedCrmField !== suggestion;

          return (
            <div key={header.index} className={`mapping-row ${hasSuggestion ? 'has-suggestion' : ''}`}>
              <div className="sheet-column-section">
                <label className="field-label">Sheet Column</label>
                <div className="column-badge">{header.name}</div>
              </div>

              <div className="mapping-arrow">
                <svg width="20" height="2" viewBox="0 0 20 2" fill="none">
                  <line x1="0" y1="1" x2="20" y2="1" stroke="currentColor" strokeWidth="2" />
                  <polygon points="18,0 20,1 18,2" fill="currentColor" />
                </svg>
              </div>

              <div className="crm-field-section">
                <label className="field-label">CRM Field</label>
                <div className="select-wrapper">
                  <select
                    className="field-select"
                    value={selectedCrmField || ''}
                    onChange={(e) => handleMapColumn(header.index, e.target.value)}
                  >
                    <option value="">-- Don't Import --</option>
                    {crmFields.map((field) => (
                      <option key={field.name} value={field.name}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                  {hasSuggestion && (
                    <div className="suggestion-hint">
                      💡 Suggested: {crmFields.find(f => f.name === suggestion)?.label}
                    </div>
                  )}
                </div>
              </div>

              {selectedCrmField && (
                <button
                  className="clear-mapping-btn"
                  onClick={() => handleMapColumn(header.index, null)}
                  title="Clear this mapping"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="mapping-footer">
        <button
          className="save-mapping-btn"
          onClick={handleSave}
          disabled={!hasChanges || saving}
        >
          {saving ? '💾 Saving...' : '💾 Save Mappings'}
        </button>
        <div className="mapping-stats">
          <span className="mapped-count">
            {Object.keys(mappings).length} field{Object.keys(mappings).length !== 1 ? 's' : ''} mapped
          </span>
          {hasChanges && <span className="unsaved-badge">Unsaved changes</span>}
        </div>
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

