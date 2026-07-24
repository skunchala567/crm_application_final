import { useState, useEffect } from 'react';
import { Key, AlertCircle, CheckCircle, Loader } from 'lucide-react';
import { api } from '../api';

export default function SmartpingConfig({ integrationId, onConfigSaved }) {
  const [projectId, setProjectId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    loadConfig();
  }, [integrationId]);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/hub/integrations/${integrationId}`);
      const config = response.data?.config || {};
      setProjectId(config.projectId || '');
      setApiKey(config.projectApiPassword || '');
      setError(null);
    } catch (err) {
      setError('Failed to load configuration: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!projectId.trim()) {
      setError('Project ID is required');
      return;
    }

    if (!apiKey.trim()) {
      setError('API Key is required');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await api.put(`/hub/integrations/${integrationId}`, {
        config: {
          projectId: projectId.trim(),
          projectApiPassword: apiKey.trim()
        }
      });

      setSuccess('✅ Smartping credentials saved successfully!');
      if (onConfigSaved) {
        onConfigSaved();
      }

      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError('Failed to save configuration: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!projectId.trim() || !apiKey.trim()) {
      setError('Please enter Project ID and API Password first');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // Save credentials first, then test
      await api.put(`/hub/integrations/${integrationId}`, {
        config: {
          projectId: projectId.trim(),
          projectApiPassword: apiKey.trim()
        }
      });

      // Now test with saved credentials
      await api.post(`/hub/integrations/${integrationId}/test-connection`);
      setSuccess('✅ Connection test successful! Smartping is properly configured.');
      // Reload config to show saved state
      setTimeout(() => {
        setSuccess(null);
        loadConfig();
      }, 5000);
    } catch (err) {
      setError('Connection test failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <p style={styles.loadingText}>Loading configuration...</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>
          <Key size={20} style={{ marginRight: '8px' }} />
          Smartping Credentials
        </h3>
        <p style={styles.subtitle}>Configure your AiSensy Smartping API credentials</p>
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Project ID *</label>
        <input
          type="text"
          style={styles.input}
          placeholder="Enter your Smartping Project ID"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          disabled={saving}
        />
        <p style={styles.hint}>Found in your AiSensy Smartping dashboard settings</p>
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>API Password *</label>
        <div style={styles.inputWrapper}>
          <input
            type={showKey ? 'text' : 'password'}
            style={styles.input}
            placeholder="Enter your Smartping API Password (X-AiSensy-Project-API-Pwd)"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={saving}
          />
          <button
            style={styles.toggleBtn}
            onClick={() => setShowKey(!showKey)}
            disabled={saving}
          >
            {showKey ? '👁️ Hide' : '👁️ Show'}
          </button>
        </div>
        <p style={styles.hint}>Your Smartping project API password. Keep this secret.</p>
      </div>

      {error && (
        <div style={styles.errorBox}>
          <AlertCircle size={18} style={{ marginRight: '8px' }} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div style={styles.successBox}>
          <CheckCircle size={18} style={{ marginRight: '8px' }} />
          <span>{success}</span>
        </div>
      )}

      <div style={styles.actions}>
        <button
          style={{ ...styles.btn, ...styles.btnSecondary }}
          onClick={handleTestConnection}
          disabled={saving || !projectId.trim() || !apiKey.trim()}
        >
          {saving ? (
            <>
              <Loader size={16} style={{ animation: 'spin 1s linear infinite', marginRight: '8px' }} />
              Testing...
            </>
          ) : (
            '🧪 Test Connection'
          )}
        </button>
        <button
          style={{ ...styles.btn, ...styles.btnPrimary }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <>
              <Loader size={16} style={{ animation: 'spin 1s linear infinite', marginRight: '8px' }} />
              Saving...
            </>
          ) : (
            '💾 Save Credentials'
          )}
        </button>
      </div>

      <div style={styles.infoBox}>
        <h4 style={styles.infoTitle}>Where to find your credentials:</h4>
        <ol style={styles.infoList}>
          <li>Go to <strong>AiSensy Smartping Dashboard</strong></li>
          <li>Navigate to <strong>Settings → API Keys</strong></li>
          <li>Copy your <strong>Project ID</strong></li>
          <li>Generate or copy your <strong>API Key</strong></li>
          <li>Paste both values above and click <strong>Save Credentials</strong></li>
        </ol>
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
    display: 'flex',
    alignItems: 'center',
  },
  subtitle: {
    margin: 0,
    fontSize: '0.9rem',
    color: '#666',
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
  inputWrapper: {
    position: 'relative',
    display: 'flex',
  },
  toggleBtn: {
    position: 'absolute',
    right: '0.75rem',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.85rem',
    color: '#667eea',
    padding: '0.5rem',
  },
  hint: {
    fontSize: '0.8rem',
    color: '#666',
    marginTop: '0.25rem',
    margin: 0,
  },
  errorBox: {
    display: 'flex',
    alignItems: 'center',
    padding: '1rem',
    background: '#fee2e2',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    color: '#991b1b',
    marginBottom: '1rem',
  },
  successBox: {
    display: 'flex',
    alignItems: 'center',
    padding: '1rem',
    background: '#dcfce7',
    border: '1px solid #bbf7d0',
    borderRadius: '6px',
    color: '#166534',
    marginBottom: '1rem',
  },
  actions: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1.5rem',
  },
  btn: {
    flex: 1,
    padding: '0.875rem 1rem',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.95rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    background: '#667eea',
    color: 'white',
  },
  btnSecondary: {
    background: 'white',
    border: '1px solid #d1d5db',
    color: '#1a1a1a',
  },
  infoBox: {
    padding: '1rem',
    background: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
  },
  infoTitle: {
    margin: '0 0 0.75rem 0',
    fontSize: '0.9rem',
    fontWeight: 600,
  },
  infoList: {
    margin: 0,
    paddingLeft: '1.5rem',
    fontSize: '0.9rem',
    lineHeight: '1.6',
  },
  loadingText: {
    textAlign: 'center',
    color: '#666',
    padding: '2rem',
  },
};
