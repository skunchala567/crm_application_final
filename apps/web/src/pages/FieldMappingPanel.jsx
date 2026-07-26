import { useEffect, useState } from 'react';
import { Info, Loader, TableProperties, Trash2, Wand2 } from 'lucide-react';
import { api } from '../api';
import './FieldMappingPanel.css';

export default function FieldMappingPanel({ integrationId, sheetId = null, sourceId = null, onSaved = null }) {
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
  }, [integrationId, sheetId, sourceId]);

  const normalize = (value) => String(value || '').toLowerCase().replace(/\*/g, '').replace(/[^a-z0-9]/g, '');

  const generateAutoMapSuggestions = (headers, fields) => {
    const suggestions = {};
    fields.forEach((field) => {
      const names = [normalize(field.label), normalize(field.name)];
      const match = headers.find((header) => names.includes(normalize(header.name)));
      if (match) suggestions[field.name] = `sheet_${match.index}`;
    });
    setAutoMapSuggestions(suggestions);
  };

  const fetchMappingData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [headersRes, mappingRes] = await Promise.all([
        api.get(`/hub/integrations/${integrationId}/field-mapping/headers${sheetId ? `?sheetId=${encodeURIComponent(sheetId)}` : ''}`),
        api.get(`/hub/integrations/${integrationId}/field-mapping${sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : ''}`)
      ]);
      const headers = headersRes.data.sheetHeaders || [];
      const fields = headersRes.data.crmFields || [];
      setSheetHeaders(headers);
      setCrmFields(fields);
      setMappings(mappingRes.data.mappings || {});
      setHasChanges(false);
      generateAutoMapSuggestions(headers, fields);
    } catch (err) {
      setError(err.message || 'Failed to load mapping data');
    } finally {
      setLoading(false);
    }
  };

  const handleAutoMap = () => {
    const nextMappings = {};
    Object.entries(autoMapSuggestions).forEach(([crmFieldName, sheetColumnKey]) => {
      nextMappings[sheetColumnKey] = crmFieldName;
    });
    setMappings(nextMappings);
    setHasChanges(true);
  };

  const handleMapField = (crmFieldName, sheetColumnKey) => {
    const nextMappings = { ...mappings };
    Object.keys(nextMappings).forEach((key) => {
      if (nextMappings[key] === crmFieldName || key === sheetColumnKey) delete nextMappings[key];
    });
    if (sheetColumnKey) nextMappings[sheetColumnKey] = crmFieldName;
    setMappings(nextMappings);
    setHasChanges(true);
  };

  const handleSave = async () => {
    const mappedFields = Object.values(mappings);
    const missingFields = crmFields.filter((field) => field.required && !mappedFields.includes(field.name));
    if (missingFields.length) {
      alert(`Map all required CRM fields before activating this source: ${missingFields.map((field) => field.label).join(', ')}.`);
      return;
    }
    try {
      setSaving(true);
      await api.post(`/hub/integrations/${integrationId}/field-mapping`, { mappings, sourceId });
      setHasChanges(false);
      alert(sourceId ? 'Field mappings saved. Continuous import is now active.' : 'Field mappings saved successfully!');
      onSaved?.(mappings);
    } catch (err) {
      alert(`Failed to save mappings: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading-state"><Loader size={32} className="mapping-spinner" /><p>Loading field mapping...</p></div>;
  if (error) return <div className="error-state"><p>{error}</p><button className="retry-btn" onClick={fetchMappingData}>Try Again</button></div>;
  if (!sheetHeaders.length) {
    return <div className="empty-state"><TableProperties size={30} /><p>No columns found in spreadsheet</p><p>Make sure the first row contains column headings.</p></div>;
  }

  return (
    <div className="field-mapping-panel">
      <div className="mapping-header">
        <div>
          <h3 className="mapping-title"><TableProperties size={20} /> Map CRM Fields to Sheet Columns</h3>
          <p className="mapping-subtitle">Select the matching Google Sheet column for each CRM field.</p>
        </div>
        <button className="auto-map-btn" onClick={handleAutoMap} title="Automatically map matching columns">
          <Wand2 size={17} /> Auto Map
        </button>
      </div>

      {!!Object.keys(autoMapSuggestions).length && (
        <div className="suggestions-info">
          <Info size={16} />
          <span>{Object.keys(autoMapSuggestions).length} matching columns found. Select Auto Map to apply them.</span>
        </div>
      )}

      <div className="mapping-container">
        {crmFields.map((field) => {
          const selectedSheetColumn = Object.keys(mappings).find((key) => mappings[key] === field.name) || '';
          const suggestion = autoMapSuggestions[field.name];
          const hasSuggestion = suggestion && selectedSheetColumn !== suggestion;
          return (
            <div key={field.name} className={`mapping-row ${hasSuggestion ? 'has-suggestion' : ''}`}>
              <div className="crm-field-section">
                <label className="field-label">CRM Field</label>
                <div className="column-badge">{field.label}{field.required && <span aria-label="required"> *</span>}</div>
              </div>
              <div className="mapping-arrow" aria-hidden="true">→</div>
              <div className="sheet-column-section">
                <label className="field-label">Google Sheet Column</label>
                <div className="select-wrapper">
                  <select className="field-select" value={selectedSheetColumn} onChange={(event) => handleMapField(field.name, event.target.value)}>
                    <option value="">-- Select Google Sheet Column --</option>
                    {sheetHeaders.map((header) => <option key={header.index} value={`sheet_${header.index}`}>{header.name}</option>)}
                  </select>
                  {hasSuggestion && <div className="suggestion-hint">Suggested: {sheetHeaders.find((header) => `sheet_${header.index}` === suggestion)?.name}</div>}
                </div>
              </div>
              {selectedSheetColumn && <button className="clear-mapping-btn" onClick={() => handleMapField(field.name, '')} title="Clear this mapping"><Trash2 size={15} /></button>}
            </div>
          );
        })}
      </div>

      <div className="mapping-footer">
        <button className="save-mapping-btn" onClick={handleSave} disabled={!hasChanges || saving}>{saving ? 'Saving...' : 'Save Mappings'}</button>
        <div className="mapping-stats">
          <span className="mapped-count">{Object.keys(mappings).length} field{Object.keys(mappings).length === 1 ? '' : 's'} mapped</span>
          {hasChanges && <span className="unsaved-badge">Unsaved changes</span>}
        </div>
      </div>
    </div>
  );
}
