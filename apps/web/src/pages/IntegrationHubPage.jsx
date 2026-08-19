import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Settings, Activity, AlertCircle, CheckCircle, Link as LinkIcon, ChevronLeft, FileSpreadsheet, MessageCircle, Phone, PhoneCall, Facebook, MessageSquare, Mail} from 'lucide-react';
import { api } from '../api';
import FieldMappingPanel from './FieldMappingPanel';
import SmartpingConfig from './SmartpingConfig';
import SmartpingSmsConfig from './SmartpingSmsConfig';
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
  // null = the tiles; otherwise the type whose integrations are open.
  const [openTypeId, setOpenTypeId] = useState(null);
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
    smtp: '/settings/email-configuration',
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
      /*
       * Meta Lead Ads is not a sync-engine provider: pages, forms and leads
       * are handled by /api/meta, so the generic hub sync only ever answered
       * "Provider meta_lead_ads not registered". Send the administrator to the
       * screen that can actually subscribe a page instead of failing at them.
       */
      if (String(integration.provider_name).toLowerCase() === 'meta_lead_ads') {
        navigate('/settings/meta-lead-ads');
        return;
      }
      // Email accounts are configured on their own screen, which also maps
      // each account to the branches allowed to send from it.
      if (String(integration.provider_name).toLowerCase() === 'smtp') {
        navigate('/settings/email-configuration');
        return;
      }
      const response = await api.post(`/hub/integrations/${integration.id}/sync/manual`);
      const created = Number(response.data?.result?.imported || 0);
      alert(created > 0
        ? `✅ Sync complete: ${created} lead${created === 1 ? '' : 's'} added (Job #${response.data.jobId})`
        : '✅ Sync complete: no new leads were added');
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
    const matchesType = !openTypeId || typeOf(i) === openTypeId;
    return matchesSearch && matchesFilter && matchesType;
  });

  const openType = INTEGRATION_TYPES.find(type => type.id === openTypeId) || null;
  const countFor = (typeId) => integrations.filter(i => typeOf(i) === typeId).length;

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
        {openType ? (
          <div className="integration-crumb">
            <button className="btn btn-secondary" onClick={() => { setOpenTypeId(null); setSearch(''); setFilter(''); }}>
              <ChevronLeft size={16} /> All integration types
            </button>
            <div>
              <strong>{openType.name}</strong>
              <span>{openType.providers.join(', ')}</span>
            </div>
          </div>
        ) : (
          <p className="text-[12.5px] text-secondary-500">
            Choose a service to see what is connected and add another
          </p>
        )}
        {openType && openType.available && (
          <button className="btn btn-primary" onClick={() => setShowWizard(true)}>
            <Plus size={18} />
            Add {openType.name}
          </button>
        )}
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
          presetType={openType}
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

      {/* Types first: what the CRM can connect to, and how much of each is
          already set up. Opening one shows only its integrations. */}
      {!openType ? (
        <div className="integration-type-grid">
          {INTEGRATION_TYPES.map(type => {
            const count = countFor(type.id);
            return (
              <button
                key={type.id}
                type="button"
                className={`integration-type-tile ${type.available ? '' : 'disabled'}`}
                onClick={() => type.available && setOpenTypeId(type.id)}
                disabled={!type.available}
              >
                <span className="integration-type-mark" style={{ '--mark': type.accent }}>
                  <type.Icon size={19} />
                </span>
                <span className="integration-type-body">
                  <strong>{type.name}</strong>
                  <small>{type.providers.join(', ')}</small>
                </span>
                {/* The number alone: "connected" was the widest thing in the
                    tile and said the same as the count beside it. The word
                    stays as the accessible name and the tooltip. */}
                {type.available
                  ? <span className={count ? 'count on' : 'count'} title={`${count} connected`} aria-label={`${count} connected`}>{count}</span>
                  : <span className="count soon">Coming soon</span>}
              </button>
            );
          })}
        </div>
      ) : filteredIntegrations.length === 0 ? (
        <div className="empty-state">
          <Activity size={48} />
          <h2>No {openType.name} integrations yet</h2>
          <p>{search || filter ? 'Nothing matches the current search.' : 'Add one to start using this service.'}</p>
          {!search && !filter && (
            <button className="btn btn-primary" onClick={() => setShowWizard(true)}>
              <Plus size={18} /> Add {openType.name}
            </button>
          )}
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
 * The services the CRM can connect to.
 *
 * Shared by the browse screen and the wizard: the screen lists a tile per
 * type, and the wizard fills its type from whichever tile was opened.
 */
const INTEGRATION_TYPES = [
  { id: 'google_sheets', name: 'Google Sheets', providers: ['Google Sheets API v4'], available: true, Icon: FileSpreadsheet, accent: '#0F9D58' },
  { id: 'smartping', name: 'WhatsApp (Smartping)', providers: ['AiSensy Smartping'], available: true, Icon: MessageCircle, accent: '#25D366' },
  { id: 'callerdesk', name: 'Cloud Calling', providers: ['CallerDesk'], available: true, Icon: Phone, accent: '#3B82F6' },
  { id: 'smartflo', name: 'Tata Cloud Telephony', providers: ['Tata Smartflo'], available: true, Icon: PhoneCall, accent: '#6366F1' },
  { id: 'meta_lead_ads', name: 'Meta Lead Ads', providers: ['Facebook / Instagram Lead Ads'], available: true, Icon: Facebook, accent: '#1877F2' },
  { id: 'sms', name: 'SMS', providers: ['SmartPing SMS'], available: true, Icon: MessageSquare, accent: '#8B5CF6' },
  { id: 'email', name: 'Email', providers: ['SMTP'], available: true, Icon: Mail, accent: '#EA580C' },
];

/** Display provider name -> the name the backend stores. */
const providerNameMap = {
  'Google Sheets API v4': 'google_sheets',
  'AiSensy Smartping': 'smartping',
  'SmartPing SMS': 'smartping_sms',
  SMTP: 'smtp',
  CallerDesk: 'callerdesk',
  'Tata Smartflo': 'smartflo',
  'Facebook / Instagram Lead Ads': 'meta_lead_ads',
};

/**
 * Which type an existing integration belongs to.
 *
 * provider_name, not integration_type: the stored type is unreliable -- the
 * Facebook integration carries "google_sheets" and CallerDesk carries "sms" --
 * whereas provider_name is correct on every row and is what the rest of this
 * screen already switches on. Type is kept only as a fallback for a row that
 * somehow has no provider.
 */
const typeOf = (integration) => {
  const provider = String(integration.provider_name || '').toLowerCase();
  if (provider === 'smartping_sms') return 'sms';
  if (provider === 'smtp') return 'email';
  return provider || String(integration.integration_type || '').toLowerCase();
};

/**
 * Connection Wizard - Multi-step integration setup
 */
function ConnectionWizard({ presetType = null, onClose, onSuccess }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  /*
   * Opened from a type tile, the service is already decided, so the wizard
   * carries it in and skips asking again. Its provider is filled too when the
   * type offers only one, which is every connected service today.
   */
  const [formData, setFormData] = useState({
    integrationName: '',
    integrationType: presetType?.id || '',
    providerName: presetType?.providers?.length === 1 ? presetType.providers[0] : '',
    config: {}
  });
  const steps = presetType ? [1, 3, 4] : [1, 2, 3, 4];
  const stepNumber = steps.indexOf(step) + 1;
  const [loading, setLoading] = useState(false);

  const selectedType = INTEGRATION_TYPES.find(t => t.id === formData.integrationType);

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
    // With a preset type, step 2 has nothing left to ask.
    const next = steps[steps.indexOf(step) + 1];
    setStep(next ?? step);
  };

  const handleCreate = async () => {
    if (!formData.integrationName || !formData.integrationType || !formData.providerName) {
      alert('Please complete all steps');
      return;
    }

    setLoading(true);
    try {
      if (formData.integrationType === 'callerdesk' || formData.integrationType === 'smartflo' || formData.integrationType === 'email') {
        onClose();
        navigate(formData.integrationType==='email'?'/settings/email-configuration':formData.integrationType==='smartflo'?'/settings/smartflo':'/settings/callerdesk');
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
          <h2>{presetType ? `Add ${presetType.name}` : 'Connect New Integration'}</h2>
          <p>Step {stepNumber} of {steps.length}</p>
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
                {INTEGRATION_TYPES.map(type => (
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

              {integration.provider_name === 'smartping_sms' && (
                <SmartpingSmsConfig
                  integrationId={integration.id}
                  organizationId={integration.organization_id}
                  onConfigSaved={onRefresh}
                />
              )}

              {integration.provider_name === 'callerdesk' && (
                <div className="google-sheets-handoff">
                  <div><strong>CallerDesk calling integration</strong><p>API credentials, branch DIDs, CRM user mappings, webhooks and dialling queues are managed from the dedicated Calling screen.</p></div>
                  <button className="btn btn-primary" onClick={() => { onClose(); navigate('/settings/callerdesk'); }}>Open Calling</button>
                </div>
              )}

              {!isAuthorized && integration.provider_name !== 'callerdesk' && integration.provider_name !== 'smartping_sms' && (
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
