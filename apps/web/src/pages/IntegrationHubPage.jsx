import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Settings, Activity, AlertCircle, CheckCircle, Link as LinkIcon } from 'lucide-react';
import { api } from '../api';
import FieldMappingPanel from './FieldMappingPanel';
import SmartpingConfig from './SmartpingConfig';
import GoogleOAuthConfig from './GoogleOAuthConfig';
import SyncDataPanel from './SyncDataPanel';
import StatCard from './components/StatCard';
import IntegrationGrid from './components/IntegrationGrid';
import ActionToolbar from './components/ActionToolbar';
import './IntegrationHub.css';

export default function IntegrationHubPage() {
  const [searchParams] = useSearchParams();
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showWizard, setShowWizard] = useState(searchParams.get('add') === '1');
  const [selectedIntegration, setSelectedIntegration] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchIntegrations();
    const interval = setInterval(fetchIntegrations, 5000);
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

  /**
   * Providers that own a full settings screen open it; everything else uses
   * the details modal. These screens are not listed in the sidebar, so this
   * is how they are reached.
   */
  const PROVIDER_SCREENS = {
    callerdesk: '/settings/callerdesk',
    smartflo: '/settings/smartflo',
    meta_lead_ads: '/settings/meta-lead-ads',
    google_sheets: '/settings/google-sheets',
  };

  const openIntegrationSettings = (integration) => {
    const provider = String(integration.provider_name || '').toLowerCase();
    const screen = PROVIDER_SCREENS[provider];
    if (screen) navigate(screen);
    else setSelectedIntegration(integration);
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

  const handleSync = async (integration) => {
    try {
      if (String(integration.provider_name).toLowerCase() === 'callerdesk') {
        await api.post('/callerdesk/test', {});
        alert('CallerDesk connection is working');
        fetchIntegrations();
        return;
      }
      if (String(integration.provider_name).toLowerCase() === 'smartflo') {
        await api.post('/smartflo/test', {}); alert('Smartflo connection is working'); fetchIntegrations(); return;
      }
      const response = await api.post(`/hub/integrations/${integration.id}/sync/manual`);
      alert(`✅ Sync started: Job #${response.data.jobId}`);
      fetchIntegrations();
    } catch (err) {
      alert('❌ Sync failed: ' + err.message);
    }
  };

  const handleAuthorize = async (integration) => {
    try {
      if (integration.provider_name === 'smartping') {
        await api.post(`/hub/integrations/${integration.id}/auth/start`, {});
        alert('✅ Smartping activated!');
        fetchIntegrations();
        return;
      }

      const response = await api.post(`/hub/oauth/initiate`, {
        integrationId: integration.id,
        providerName: integration.provider_name
      });

      if (response.data?.authUrl) {
        window.location.href = response.data.authUrl;
      }
    } catch (err) {
      alert('❌ Authorization failed: ' + err.message);
    }
  };


  // Calculate statistics
  const stats = {
    total: integrations.length,
    connected: integrations.filter(i => i.status === 'active').length,
    disconnected: integrations.filter(i => i.status === 'disconnected' || i.status === 'inactive').length,
    needsAttention: integrations.filter(i => i.status === 'error' || i.status === 'pending_auth').length
  };

  // Filter integrations
  const filteredIntegrations = integrations.filter(i => {
    const matchesSearch = String(i.integration_name || '').toLowerCase().includes(search.toLowerCase()) ||
                          String(i.provider_name || '').toLowerCase().includes(search.toLowerCase());
    const matchesFilter = !filter || i.status === filter;
    return matchesSearch && matchesFilter;
  });

  if (loading) {
    return (
      <main className="integration-main settings-integration-page">
        <div className="loading-state">Loading integrations...</div>
      </main>
    );
  }

  return (
    <main className="integration-main settings-integration-page">
      {/* Title lives in the Settings section header; only the action is here. */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <p className="text-[12.5px] text-secondary-500">
          Manage and monitor all third-party integrations connected with the CRM
        </p>
        <button className="btn btn-primary" onClick={() => setShowWizard(true)}>
          <Plus size={18} />
          Add Integration
        </button>
      </div>

      {error && (
        <div className="alert alert-danger">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Statistics Cards */}
      <div className="stats-grid">
        <StatCard
          icon={LinkIcon}
          label="Total Integrations"
          value={stats.total}
          color="primary"
        />
        <StatCard
          icon={CheckCircle}
          label="Connected"
          value={stats.connected}
          color="success"
        />
        <StatCard
          icon={AlertCircle}
          label="Disconnected"
          value={stats.disconnected}
          color="warning"
        />
        <StatCard
          icon={Activity}
          label="Needs Attention"
          value={stats.needsAttention}
          color="danger"
        />
      </div>

      {/* Search & Filter Toolbar */}
      <ActionToolbar
        searchValue={search}
        onSearchChange={setSearch}
        filterValue={filter}
        onFilterChange={setFilter}
        onRefresh={fetchIntegrations}
        filters={[
          { label: 'Connected', value: 'active' },
          { label: 'Disconnected', value: 'disconnected' },
          { label: 'Error', value: 'error' },
          { label: 'Pending', value: 'pending_auth' }
        ]}
      />

      {/* Modals */}
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
          onAuthorize={handleAuthorize}
        />
      )}

      {/* Integration Table or Empty State */}
      {filteredIntegrations.length === 0 && search === '' && filter === '' ? (
        <div className="empty-state">
          <Activity size={48} />
          <h2>No Integrations Yet</h2>
          <p>Connect your first service to extend your CRM capabilities</p>
          <button className="btn btn-primary" onClick={() => setShowWizard(true)}>
            <Plus size={18} />
            Add Your First Integration
          </button>
        </div>
      ) : (
        <IntegrationGrid
          integrations={filteredIntegrations}
          onSync={handleSync}
          onSettings={(integration) => openIntegrationSettings(integration)}
          loading={loading}
        />
      )}
    </main>
  );
}

/**
 * Connection Wizard - Multi-step integration setup
 */
function ConnectionWizard({ onClose, onSuccess }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    integrationName: '',
    integrationType: '',
    providerName: '',
    config: {}
  });
  const [loading, setLoading] = useState(false);

  // Google Sheets and Smartping (WhatsApp via AiSensy)
  const integrationTypes = [
    { id: 'google_sheets', name: 'Google Sheets', providers: ['Google Sheets API v4'], available: true },
    { id: 'smartping', name: 'WhatsApp (Smartping)', providers: ['AiSensy Smartping'], available: true },
    { id: 'callerdesk', name: 'Cloud Calling', providers: ['CallerDesk'], available: true },
    { id: 'smartflo', name: 'Tata Cloud Telephony', providers: ['Tata Smartflo'], available: true },
    { id: 'meta_lead_ads', name: 'Meta Lead Ads', providers: ['Facebook / Instagram Lead Ads'], available: true },
    { id: 'sms', name: 'SMS (Coming Soon)', providers: ['MSG91', 'TextLocal'], available: false },
    { id: 'email', name: 'Email (Coming Soon)', providers: ['SMTP', 'SendGrid', 'Mailgun'], available: false }
  ];

  // Map display provider names to backend provider names
  const providerNameMap = {
    'Google Sheets API v4': 'google_sheets',
    'AiSensy Smartping': 'smartping'
    ,'CallerDesk': 'callerdesk','Tata Smartflo':'smartflo'
    ,'Facebook / Instagram Lead Ads': 'meta_lead_ads'
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
      if (formData.integrationType === 'callerdesk' || formData.integrationType === 'smartflo') {
        onClose();
        navigate(formData.integrationType==='smartflo'?'/settings/smartflo':'/settings/callerdesk');
        return;
      }
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
              <p className="info-text">{formData.integrationType==='callerdesk'?'Next, enter the API credentials and map branch DIDs and CRM users.':`Next, you'll authorize ${formData.providerName} to access your account.`}</p>
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
function IntegrationDetails({ integration, onClose, onRefresh, onAuthorize }) {
  const [tab, setTab] = useState('settings');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const isAuthorized = integration.status === 'active' || integration.status === 'connected';

  return (
    <div className="details-overlay">
      <div className="details-modal">
        <div className="details-header">
          <h2>{integration.integration_name}</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="details-tabs">
          <button
            className={`tab ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => setTab('settings')}
          >
            Settings
          </button>
          {isAuthorized && integration.provider_name !== 'smartping' && integration.provider_name !== 'google_sheets' && (
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

              {integration.provider_name === 'google_sheets' && (
                <GoogleOAuthConfig integrationId={integration.id} onConfigSaved={onRefresh} />
              )}

              {integration.provider_name === 'callerdesk' && (
                <div className="google-sheets-handoff">
                  <div><strong>CallerDesk calling integration</strong><p>API credentials, branch DIDs, CRM user mappings, webhooks and dialling queues are managed from the dedicated Calling screen.</p></div>
                  <button className="btn btn-primary" onClick={() => { onClose(); navigate('/settings/callerdesk'); }}>Open Calling</button>
                </div>
              )}

              {!isAuthorized && integration.provider_name !== 'callerdesk' && (
                <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: '#fdf4e3', border: '1px solid #fcd34d', borderRadius: '0.5rem' }}>
                  <p style={{ color: '#c47f0a', marginBottom: '1rem' }}>
                    ⚠️ This integration is not authorized. Please authorize it first to enable functionality.
                  </p>
                  <button
                    className="btn btn-primary"
                    onClick={() => onAuthorize(integration)}
                    disabled={loading}
                    style={{ width: '100%' }}
                  >
                    {loading ? 'Authorizing...' : 'Authorize Integration'}
                  </button>
                </div>
              )}

              {isAuthorized && integration.provider_name === 'google_sheets' && (
                <div className="google-sheets-handoff">
                  <div>
                    <strong>Google Sheets is authorized</strong>
                    <p>Sheet selection, field mapping, data sync, and sync history are managed from the dedicated Google Sheets screen.</p>
                  </div>
                  <button className="btn btn-primary" onClick={() => { onClose(); navigate('/settings/google-sheets'); }}>
                    Open Google Sheets
                  </button>
                </div>
              )}

              {isAuthorized && integration.provider_name === 'smartping' && (
                <div style={{ marginTop: '2rem' }}>
                  <SmartpingConfig
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
