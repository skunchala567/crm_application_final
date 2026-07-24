import { useState, useEffect } from 'react';
import { AlertCircle, Loader } from 'lucide-react';
import { api } from './api';
import WhatsAppTemplatesPage from './pages/WhatsAppTemplates/WhatsAppTemplatesPage.jsx';

export default function WhatsAppTemplatesSettings({ onMessage }) {
  const [integrationId, setIntegrationId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchSmartpingIntegration();
  }, []);

  const fetchSmartpingIntegration = async () => {
    try {
      const response = await api.get('/hub/integrations?provider=smartping');
      const integrations = Array.isArray(response.data) ? response.data : response.data?.data || [];
      const smartpingIntegration = integrations[0];

      if (!smartpingIntegration) {
        setError('WhatsApp integration not configured. Please set up Smartping in Integrations first.');
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

  return (
    <main style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      {integrationId && <WhatsAppTemplatesPage integrationId={integrationId} />}
    </main>
  );
}
