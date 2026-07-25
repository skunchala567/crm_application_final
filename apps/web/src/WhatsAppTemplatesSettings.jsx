import { useState, useEffect } from 'react';
import { AlertCircle, Loader } from 'lucide-react';
import { api } from './api';
import SettingsWhatsAppTemplates from './pages/SettingsWhatsAppTemplates';
import SettingsWhatsAppTemplatesCreate from './pages/SettingsWhatsAppTemplatesCreate';
import SettingsWhatsAppTemplatesView from './pages/SettingsWhatsAppTemplatesView';

export default function WhatsAppTemplatesSettings({ onMessage }) {
  const [integrationId, setIntegrationId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState('list'); // 'list' | 'create' | 'view'
  const [viewingTemplateId, setViewingTemplateId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetchSmartpingIntegration();
  }, []);

  const fetchSmartpingIntegration = async () => {
    try {
      const response = await api.get('/whatsapp/integrations?provider=SMARTPING');
      const integrations = Array.isArray(response.data) ? response.data : response.data?.data || [];
      const smartpingIntegration = integrations[0];

      if (!smartpingIntegration) {
        setError('WhatsApp integration not configured. Please create a Smartping integration first.');
        setLoading(false);
        return;
      }

      setIntegrationId(smartpingIntegration.id);
      setError(null);
    } catch (err) {
      setError(`Failed to load WhatsApp integration: ${err.message}`);
      console.error('Error fetching smartping integration:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleNavigate = (page, templateId = null) => {
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

  if (!integrationId) {
    return <main style={{ padding: '30px' }}>No integration available</main>;
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
        <SettingsWhatsAppTemplates
          key={refreshKey}
          integrationId={integrationId}
          onNavigate={handleNavigate}
          onMessage={onMessage}
        />
      );
  }
}
