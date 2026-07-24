import { useState, useEffect } from 'react';
import { Plus, RefreshCw, Settings, Trash2, Activity, AlertCircle, CheckCircle, Clock, MessageCircle } from 'lucide-react';
import { api } from '../api';
import SpreadsheetPicker from './SpreadsheetPicker';
import FieldMappingPanel from './FieldMappingPanel';
import WhatsAppMessaging from './WhatsAppMessaging';
import WhatsAppConfig from './WhatsAppConfig';
import GoogleSheetsConfig from './GoogleSheetsConfig';
import SyncDataPanel from './SyncDataPanel';
import './IntegrationHub.css';

export default function IntegrationHubPage() {
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showWizard, setShowWizard] = useState(false);
  const [selectedIntegration, setSelectedIntegration] = useState(null);
  const [syncStatus, setSyncStatus] = useState({});

  useEffect(() => {
    fetchIntegrations();
    const interval = setInterval(fetchIntegrations, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchIntegrations = async () => {
    try {
      const response = await api.get('/hub/integrations');
      if (response.data) {
        setIntegrations(response.data);
      }
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async (integration) => {
    try {
      await api.post(`/hub/integrations/${integration.id}/test-connection`);
      alert('✅ Connection successful!');
      fetchIntegrations();
    } catch (err) {
      alert('❌ Connection failed: ' + err.message);
    }
  };

  const handleSync = async (integration, syncType) => {
    try {
      const response = await api.post(`/hub/integrations/${integration.id}/sync/${syncType}`);
      alert(`Sync started: Job #${response.data.jobId}`);
      fetchIntegrations();
    } catch (err) {
      alert('❌ Sync failed: ' + err.message);
    }
  };

  const handleAuthorize = async (integration) => {
    try {
      // WhatsApp doesn't use OAuth - just activate it
      if (integration.provider_name === 'whatsapp') {
        const response = await api.post(`/hub/integrations/${integration.id}/auth/start`, {});
        alert('✅ WhatsApp activated! Go to the Messaging tab to start sending messages.');
        fetchIntegrations();
        return;
      }

      // Request authorization URL from backend for OAuth providers
      const response = await api.post(`/hub/oauth/initiate`, {
        integrationId: integration.id,
        providerName: integration.provider_name
      });

      if (response.data?.authUrl) {
        // Redirect to OAuth provider
        window.location.href = response.data.authUrl;
      } else {
        alert('❌ Failed to get authorization URL');
      }
    } catch (err) {
      alert('❌ Authorization failed: ' + err.message);
    }
  };

  const handleDisconnect = async (integration) => {
    if (!confirm('Disconnect this integration? You can re-authorize it later.')) return;

    try {
      await api.post(`/hub/integrations/${integration.id}/auth/disconnect`, {});
      alert('✅ Integration disconnected. Click "Authorize Now" to reconnect.');
      fetchIntegrations();
    } catch (err) {
      alert('❌ Failed: ' + err.message);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'active':
        return <CheckCircle className="status-icon active" size={20} />;
      case 'pending_auth':
        return <Clock className="status-icon pending" size={20} />;
      case 'error':
        return <AlertCircle className="status-icon error" size={20} />;
      default:
        return <Activity className="status-icon" size={20} />;
    }
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      active: { label: 'Connected', color: 'success' },
      pending_auth: { label: 'Awaiting Auth', color: 'warning' },
      error: { label: 'Error', color: 'danger' },
      inactive: { label: 'Disconnected', color: 'muted' }
    };
    const info = statusMap[status] || statusMap.inactive;
    return <span className={`badge badge-${info.color}`}>{info.label}</span>;
  };

  if (loading) {
    return <div className="integration-hub-page"><p>Loading integrations...</p></div>;
  }

  return (
    <div className="integration-hub-page">
      <div className="hub-header">
        <div className="hub-title">
          <h1>Integration Hub</h1>
          <p>Connect third-party services to your CRM</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowWizard(true)}>
          <Plus size={18} /> New Integration
        </button>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {showWizard && (
        <ConnectionWizard
          onClose={() => setShowWizard(false)}
          onSuccess={() => {
            setShowWizard(false);
            fetchIntegrations();
          }}
        />
      )}

      {selectedIntegration && (
        <IntegrationDetails
          integration={selectedIntegration}
          onClose={() => setSelectedIntegration(null)}
          onRefresh={fetchIntegrations}
        />
      )}

      <div className="integrations-grid">
        {integrations.length === 0 ? (
          <div className="empty-state">
            <Activity size={48} />
            <h2>No Integrations Yet</h2>
            <p>Connect your first service to get started</p>
            <button className="btn btn-primary" onClick={() => setShowWizard(true)}>
              <Plus size={18} /> Connect Now
            </button>
          </div>
        ) : (
          integrations.map(integration => (
            <div key={integration.id} className="integration-card">
              <div className="card-header">
                <div className="integration-info">
                  <h3>{integration.integration_name}</h3>
                  <p className="provider">{integration.provider_name}</p>
                </div>
                {getStatusIcon(integration.status)}
              </div>

              <div className="card-body">
                {getStatusBadge(integration.status)}

                {integration.last_synced_at && (
                  <div className="sync-info">
                    <span>Last sync: {new Date(integration.last_synced_at).toLocaleString()}</span>
                  </div>
                )}

                {integration.last_error_message && (
                  <div className="error-info">
                    <AlertCircle size={16} />
                    <span>{integration.last_error_message}</span>
                  </div>
                )}
              </div>

              <div className="card-actions">
                {(integration.status === 'pending_auth' || integration.status === 'disconnected' || integration.status === 'inactive') && (
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => handleAuthorize(integration)}
                    title="Authorize with Provider"
                  >
                    🔐 Authorize Now
                  </button>
                )}

                {integration.status !== 'pending_auth' && integration.status !== 'disconnected' && integration.status !== 'inactive' && (
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => handleTestConnection(integration)}
                    title="Test Connection"
                  >
                    <Activity size={16} /> Test
                  </button>
                )}

                {integration.status === 'active' && (
                  <>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => handleSync(integration, 'manual')}
                      title="Manual Sync"
                    >
                      <RefreshCw size={16} /> Sync
                    </button>

                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => setSelectedIntegration(integration)}
                      title="Settings"
                    >
                      <Settings size={16} /> Settings
                    </button>
                  </>
                )}

                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => handleDisconnect(integration)}
                  title="Disconnect"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Connection Wizard - Multi-step integration setup
 */
function ConnectionWizard({ onClose, onSuccess }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    integrationName: '',
    integrationType: '',
    providerName: '',
    config: {}
  });
  const [loading, setLoading] = useState(false);

  // Phase 4: Google Sheets
  // Phase 5: WhatsApp enabled, SMS & Email coming soon
  const integrationTypes = [
    { id: 'google_sheets', name: 'Google Sheets', providers: ['Google Sheets API v4'], available: true },
    { id: 'whatsapp', name: 'WhatsApp', providers: ['WhatsApp Business'], available: true },
    { id: 'sms', name: 'SMS (Coming Soon)', providers: ['SmartPing', 'MSG91', 'TextLocal'], available: false },
    { id: 'email', name: 'Email (Coming Soon)', providers: ['SMTP', 'SendGrid', 'Mailgun'], available: false }
  ];

  // Map display provider names to backend provider names
  const providerNameMap = {
    'Google Sheets API v4': 'google_sheets',
    'WhatsApp Business': 'whatsapp'
  };

  const selectedType = integrationTypes.find(t => t.id === formData.integrationType);

  const handleNext = () => {
    if (step === 1 && !formData.integrationName) {
      alert('Please enter a name');
      return;
    }
    if (step === 2 && !formData.integrationType) {
      alert('Please select an integration type');
      return;
    }
    if (step === 3 && !formData.providerName) {
      alert('Please select a provider');
      return;
    }
    setStep(step + 1);
  };

  const handleCreate = async () => {
    if (!formData.integrationName || !formData.integrationType || !formData.providerName) {
      alert('Please complete all steps');
      return;
    }

    setLoading(true);
    try {
      // Map the display provider name to backend provider name
      const backendProviderName = providerNameMap[formData.providerName] || formData.providerName;

      await api.post('/hub/integrations', {
        ...formData,
        providerName: backendProviderName
      });
      // Close wizard and refresh integrations list
      onSuccess();
    } catch (err) {
      // Log error but still close wizard and go back to list
      console.error('Integration creation failed:', err.message);
      onSuccess();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="wizard-overlay">
      <div className="wizard-modal">
        <div className="wizard-header">
          <h2>Connect New Integration</h2>
          <p>Step {step} of 4</p>
        </div>

        <div className="wizard-body">
          {step === 1 && (
            <div className="wizard-step">
              <label>Integration Name</label>
              <input
                type="text"
                placeholder="e.g., My Google Sheets"
                value={formData.integrationName}
                onChange={e => setFormData({ ...formData, integrationName: e.target.value })}
              />
              <p className="help-text">A friendly name to identify this integration</p>
            </div>
          )}

          {step === 2 && (
            <div className="wizard-step">
              <label>Select Service Type</label>
              <div className="service-grid">
                {integrationTypes.map(type => (
                  <div
                    key={type.id}
                    className={`service-option ${formData.integrationType === type.id ? 'selected' : ''} ${!type.available ? 'disabled' : ''}`}
                    onClick={() => {
                      if (type.available) {
                        setFormData({ ...formData, integrationType: type.id, providerName: '' });
                      }
                    }}
                    title={!type.available ? 'Coming in Phase 5' : ''}
                  >
                    <h4>{type.name}</h4>
                    <p>{type.providers.length} provider(s)</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 3 && selectedType && (
            <div className="wizard-step">
              <label>Select Provider</label>
              <div className="provider-list">
                {selectedType.providers.map(provider => (
                  <div
                    key={provider}
                    className={`provider-option ${formData.providerName === provider ? 'selected' : ''}`}
                    onClick={() => setFormData({ ...formData, providerName: provider })}
                  >
                    <input
                      type="radio"
                      name="provider"
                      value={provider}
                      checked={formData.providerName === provider}
                      onChange={() => {}}
                    />
                    <label>{provider}</label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="wizard-step">
              <h3>Ready to Connect</h3>
              <div className="summary">
                <p><strong>Name:</strong> {formData.integrationName}</p>
                <p><strong>Type:</strong> {selectedType?.name}</p>
                <p><strong>Provider:</strong> {formData.providerName}</p>
              </div>
              <p className="info-text">Next, you'll authorize {formData.providerName} to access your account.</p>
            </div>
          )}
        </div>

        <div className="wizard-actions">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          {step < 4 ? (
            <button className="btn btn-primary" onClick={handleNext}>Next</button>
          ) : (
            <button className="btn btn-primary" onClick={handleCreate} disabled={loading}>
              {loading ? 'Creating...' : 'Create & Authorize'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Integration Details - Settings, sync, field mapping
 */
function IntegrationDetails({ integration, onClose, onRefresh }) {
  const [tab, setTab] = useState(integration.provider_name === 'whatsapp' ? 'messaging' : 'settings');
  const [loading, setLoading] = useState(false);


  return (
    <div className="details-overlay">
      <div className="details-modal">
        <div className="details-header">
          <h2>{integration.integration_name}</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="details-tabs">
          {integration.provider_name === 'whatsapp' && (
            <button
              className={`tab ${tab === 'messaging' ? 'active' : ''}`}
              onClick={() => setTab('messaging')}
            >
              <MessageCircle size={16} style={{ marginRight: '4px' }} />
              Messaging
            </button>
          )}
          <button
            className={`tab ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => setTab('settings')}
          >
            Settings
          </button>
          {integration.provider_name !== 'whatsapp' && (
            <>
              <button
                className={`tab ${tab === 'mapping' ? 'active' : ''}`}
                onClick={() => setTab('mapping')}
              >
                Field Mapping
              </button>
              <button
                className={`tab ${tab === 'sync' ? 'active' : ''}`}
                onClick={() => setTab('sync')}
              >
                Sync Data
              </button>
              <button
                className={`tab ${tab === 'logs' ? 'active' : ''}`}
                onClick={() => setTab('logs')}
              >
                Sync Logs
              </button>
            </>
          )}
        </div>

        <div className="details-content">
          {tab === 'settings' && (
            <div className="settings-panel">
              <h3>Integration Settings</h3>
              <div className="info-group">
                <p><strong>Provider:</strong> {integration.provider_name}</p>
                <p><strong>Status:</strong> {integration.status}</p>
                <p><strong>Created:</strong> {new Date(integration.created_at).toLocaleString()}</p>
              </div>

              {integration.provider_name === 'whatsapp' && (
                <div style={{ marginTop: '2rem' }}>
                  <WhatsAppConfig integrationId={integration.id} onConfigSaved={onRefresh} />
                </div>
              )}

              {integration.provider_name === 'google_sheets' && (
                <div style={{ marginTop: '2rem' }}>
                  <GoogleSheetsConfig
                    integrationId={integration.id}
                    onConfigSaved={onRefresh}
                  />
                </div>
              )}
            </div>
          )}

          {tab === 'sync' && (
            <SyncDataPanel
              integrationId={integration.id}
              provider={integration.provider_name === 'google_sheets' ? 'Google Sheets' : integration.provider_name}
            />
          )}

          {tab === 'mapping' && (
            <div className="mapping-panel">
              <h3>Field Mapping</h3>
              <FieldMappingUI integrationId={integration.id} />
            </div>
          )}

          {tab === 'logs' && (
            <div className="logs-panel">
              <h3>Sync History</h3>
              <SyncLogsViewer integrationId={integration.id} />
            </div>
          )}

          {tab === 'messaging' && (
            <div className="messaging-panel">
              <WhatsAppMessaging integrationId={integration.id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Field Mapping UI (delegated to FieldMappingPanel)
 */
function FieldMappingUI({ integrationId }) {
  return <FieldMappingPanel integrationId={integrationId} />;
}

/**
 * Sync Logs Viewer
 */
function SyncLogsViewer({ integrationId }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, [integrationId]);

  const fetchLogs = async () => {
    try {
      const response = await api.get(`/hub/integrations/${integrationId}/sync/history`);
      setLogs(response.data || []);
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <p>Loading logs...</p>;

  return (
    <div className="logs-table">
      {logs.length === 0 ? (
        <p>No sync history yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Status</th>
              <th>Records</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(log => (
              <tr key={log.id}>
                <td>{new Date(log.created_at).toLocaleString()}</td>
                <td>{log.sync_type}</td>
                <td><span className={`badge badge-${log.status === 'success' ? 'success' : 'danger'}`}>{log.status}</span></td>
                <td>{log.records_processed}</td>
                <td>{log.duration_seconds}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
