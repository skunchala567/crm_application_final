import { useState, useEffect } from 'react';
import { AlertCircle, Loader, MessageCircle, X } from 'lucide-react';
import { api } from './api';
import SettingsWhatsAppTemplates from './pages/SettingsWhatsAppTemplates';
import SettingsWhatsAppTemplatesCreate from './pages/SettingsWhatsAppTemplatesCreate';
import SettingsWhatsAppTemplatesView from './pages/SettingsWhatsAppTemplatesView';
import { WhatsAppMessageHistory, WhatsAppSendPanel } from './components/WhatsAppSendPanel';

export default function WhatsAppTemplatesSettings({ onMessage }) {
  const [integrationId, setIntegrationId] = useState('');
  const [integrations, setIntegrations] = useState([]);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState('list'); // 'list' | 'create' | 'view'
  const [viewingTemplateId, setViewingTemplateId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showSendMessage, setShowSendMessage] = useState(false);
  const [showMessageHistory, setShowMessageHistory] = useState(false);

  useEffect(() => {
    fetchSmartpingIntegration();
  }, []);

  const fetchSmartpingIntegration = async () => {
    try {
      const response = await api.get('/whatsapp/integrations?provider=SMARTPING');
      const integrations = Array.isArray(response.data) ? response.data : response.data?.data || [];
      if (!integrations.length) {
        setError('WhatsApp integration not configured. Please create a Smartping integration first.');
        setLoading(false);
        return;
      }

      setIntegrations(integrations);
      setIntegrationId('');
      setError(null);
    } catch (err) {
      setError(`Failed to load WhatsApp integration: ${err.message}`);
      console.error('Error fetching smartping integration:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleNavigate = (page, templateId = null, targetIntegrationId = null) => {
    if (page === 'create' && !targetIntegrationId) {
      setShowAccountPicker(true);
      return;
    }
    if (targetIntegrationId) setIntegrationId(String(targetIntegrationId));
    setCurrentPage(page);
    if (templateId) {
      setViewingTemplateId(templateId);
    }
  };

  const handleSuccess = () => {
    if (onMessage) {
      onMessage({ type: 'success', text: 'Template saved successfully!' });
    }
    // Force re-mount of templates list to reload from database
    setRefreshKey(prev => prev + 1);
    handleNavigate('list');
  };

  const handleBack = () => {
    setCurrentPage('list');
    setViewingTemplateId(null);
  };

  if (loading) {
    return (
      <main style={{ padding: '30px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '200px' }}>
          <Loader size={24} style={{ animation: 'spin 1s linear infinite' }} />
          <span style={{ marginLeft: '12px', color: 'var(--text-secondary)' }}>Loading WhatsApp Templates...</span>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main style={{ padding: '30px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          padding: '16px',
          background: '#fee2e2',
          border: '1px solid #fca5a5',
          borderRadius: '6px',
        }}>
          <AlertCircle size={20} style={{ color: '#dc2626', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <h3 style={{ margin: '0 0 4px 0', color: '#dc2626', fontSize: '14px', fontWeight: 600 }}>
              Configuration Required
            </h3>
            <p style={{ margin: 0, color: '#991b1b', fontSize: '13px' }}>
              {error}
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Render appropriate page based on current page state
  switch (currentPage) {
    case 'create':
      return (
        <SettingsWhatsAppTemplatesCreate
          integrationId={integrationId}
          onBack={handleBack}
          onSuccess={handleSuccess}
        />
      );
    case 'view':
      return (
        <SettingsWhatsAppTemplatesView
          integrationId={integrationId}
          templateId={viewingTemplateId}
          onBack={handleBack}
        />
      );
    case 'list':
    default:
      return (
        <>
          <SettingsWhatsAppTemplates
            key={refreshKey}
            integrationId={integrationId}
            integrations={integrations}
            onIntegrationChange={setIntegrationId}
            onNavigate={handleNavigate}
            onMessage={onMessage}
            onSendMessage={() => setShowSendMessage(true)}
            onMessageHistory={() => setShowMessageHistory(true)}
          />
          {showAccountPicker && <div className="whatsapp-account-overlay" onClick={()=>setShowAccountPicker(false)}>
            <section className="whatsapp-account-picker" onClick={event=>event.stopPropagation()}>
              <header><div><MessageCircle size={20}/><span><h2>Select WhatsApp integration</h2><p>Choose the WhatsApp account where this template will be created.</p></span></div><button onClick={()=>setShowAccountPicker(false)}><X size={18}/></button></header>
              <div>{integrations.map(item=><button key={item.id} disabled={!item.has_credentials} onClick={()=>{setShowAccountPicker(false);handleNavigate('create',null,item.id);}}><MessageCircle size={18}/><span><strong>{item.integration_name}</strong><small>{item.has_credentials?'Connected and ready':'Configuration required'}</small></span><b>{item.has_credentials?'Select':'Unavailable'}</b></button>)}</div>
            </section>
          </div>}
          <WhatsAppSendPanel
            open={showSendMessage}
            initialMode="single"
            onClose={() => setShowSendMessage(false)}
            onSent={() => onMessage?.({ type: 'success', text: 'WhatsApp message request completed' })}
          />
          <WhatsAppMessageHistory open={showMessageHistory} onClose={() => setShowMessageHistory(false)} />
        </>
      );
  }

  return null;
}
