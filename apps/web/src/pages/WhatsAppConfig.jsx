import { useState, useEffect } from 'react';
import { Save, AlertCircle, CheckCircle } from 'lucide-react';
import { api } from '../api';

export default function WhatsAppConfig({ integrationId, onConfigSaved }) {
  const [config, setConfig] = useState({
    phoneNumberId: '',
    accessToken: '',
    businessAccountId: ''
  });
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchConfig();
  }, [integrationId]);

  const fetchConfig = async () => {
    try {
      const response = await api.get(`/hub/integrations/${integrationId}`);
      const integration = response.data;

      if (integration.config) {
        setConfig({
          phoneNumberId: integration.config.phoneNumberId || '',
          accessToken: integration.config.accessToken || '',
          businessAccountId: integration.config.businessAccountId || ''
        });
      }
    } catch (err) {
      console.error('Error fetching config:', err);
    }
  };

  const handleSave = async () => {
    if (!config.phoneNumberId || !config.accessToken) {
      setError('Phone Number ID and Access Token are required');
      return;
    }

    setLoading(true);
    setError(null);
    setSaved(false);

    try {
      await api.put(`/hub/integrations/${integrationId}`, {
        config
      });

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);

      if (onConfigSaved) {
        onConfigSaved();
      }
    } catch (err) {
      setError('Failed to save configuration: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.post(`/hub/integrations/${integrationId}/test-connection`);

      if (response.data?.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setError('Connection test failed: ' + (response.data?.message || 'Unknown error'));
      }
    } catch (err) {
      setError('Connection test failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>WhatsApp Business Configuration</h3>
        <p style={styles.subtitle}>
          Enter your WhatsApp Business Account credentials to enable messaging
        </p>
      </div>

      <div style={styles.infoBox}>
        <AlertCircle size={18} style={{ marginRight: '8px', color: '#3b82f6' }} />
        <div>
          <p style={styles.infoTitle}>Get Your Credentials:</p>
          <ol style={styles.infoList}>
            <li>Create a WhatsApp Business Account at <strong>business.facebook.com</strong></li>
            <li>Go to WhatsApp Manager → API Setup</li>
            <li>Copy your <strong>Phone Number ID</strong> and <strong>Access Token</strong></li>
            <li>Paste them below</li>
          </ol>
        </div>
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Phone Number ID *</label>
        <input
          type="text"
          style={styles.input}
          placeholder="e.g., 123456789012345"
          value={config.phoneNumberId}
          onChange={(e) => setConfig({ ...config, phoneNumberId: e.target.value })}
        />
        <p style={styles.hint}>Your WhatsApp phone number identifier from Meta</p>
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Access Token *</label>
        <input
          type="password"
          style={styles.input}
          placeholder="Your access token from Meta App"
          value={config.accessToken}
          onChange={(e) => setConfig({ ...config, accessToken: e.target.value })}
        />
        <p style={styles.hint}>Keep this secret! Never share your access token</p>
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Business Account ID (Optional)</label>
        <input
          type="text"
          style={styles.input}
          placeholder="e.g., 123456789012345"
          value={config.businessAccountId}
          onChange={(e) => setConfig({ ...config, businessAccountId: e.target.value })}
        />
        <p style={styles.hint}>Your WhatsApp Business Account ID</p>
      </div>

      {error && (
        <div style={styles.errorBox}>
          <AlertCircle size={16} style={{ marginRight: '8px' }} />
          {error}
        </div>
      )}

      {saved && (
        <div style={styles.successBox}>
          <CheckCircle size={16} style={{ marginRight: '8px' }} />
          Configuration saved successfully! You can now send messages.
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem' }}>
        <button
          style={{
            ...styles.saveBtn,
            opacity: loading ? 0.7 : 1,
            cursor: loading ? 'not-allowed' : 'pointer',
            flex: 1
          }}
          onClick={handleSave}
          disabled={loading}
        >
          {loading ? 'Saving...' : (
            <>
              <Save size={16} style={{ marginRight: '8px' }} />
              Save Configuration
            </>
          )}
        </button>

        <button
          style={{
            ...styles.testBtn,
            opacity: loading ? 0.7 : 1,
            cursor: loading ? 'not-allowed' : 'pointer',
            flex: 1
          }}
          onClick={handleTestConnection}
          disabled={loading}
        >
          {loading ? 'Testing...' : '🔗 Test Connection'}
        </button>
      </div>

      <style>{`
        ol li {
          margin-bottom: 8px;
        }
      `}</style>
    </div>
  );
}

const styles = {
  container: {
    padding: '1.5rem',
    background: '#fafafa',
    borderRadius: '8px',
  },
  header: {
    marginBottom: '1.5rem',
  },
  title: {
    margin: '0 0 0.5rem 0',
    fontSize: '1.1rem',
    fontWeight: 600,
    color: '#1a1a1a',
  },
  subtitle: {
    margin: 0,
    fontSize: '0.9rem',
    color: '#666',
  },
  infoBox: {
    padding: '1rem',
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: '6px',
    marginBottom: '1.5rem',
    display: 'flex',
    gap: '1rem',
  },
  infoTitle: {
    margin: '0 0 0.5rem 0',
    fontWeight: 600,
    color: '#1e40af',
    fontSize: '0.95rem',
  },
  infoList: {
    margin: '0',
    paddingLeft: '1.5rem',
    color: '#1e40af',
    fontSize: '0.9rem',
  },
  formGroup: {
    marginBottom: '1.5rem',
  },
  label: {
    display: 'block',
    fontSize: '0.85rem',
    fontWeight: 600,
    color: '#1a1a1a',
    marginBottom: '0.5rem',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  input: {
    width: '100%',
    padding: '0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.95rem',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  hint: {
    fontSize: '0.8rem',
    color: '#999',
    marginTop: '0.25rem',
    margin: '0.25rem 0 0 0',
  },
  errorBox: {
    padding: '1rem',
    background: '#fee2e2',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    color: '#991b1b',
    marginBottom: '1rem',
    display: 'flex',
    alignItems: 'center',
  },
  successBox: {
    padding: '1rem',
    background: '#dcfce7',
    border: '1px solid #bbf7d0',
    borderRadius: '6px',
    color: '#166534',
    marginBottom: '1rem',
    display: 'flex',
    alignItems: 'center',
  },
  saveBtn: {
    padding: '0.875rem 1rem',
    background: '#667eea',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '1rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  testBtn: {
    padding: '0.875rem 1rem',
    background: '#10b981',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '1rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
