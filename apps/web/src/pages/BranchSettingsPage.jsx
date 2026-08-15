import { useEffect, useState } from 'react';
import { Save, AlertCircle } from 'lucide-react';
import { api } from '../api.js';
import '../styles/BranchSettings.css';

export default function BranchSettingsPage({ onMessage }) {
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    jodo_payment_enabled: false,
    jodo_api_key: '',
    jodo_secret_key: '',
    jodo_collector_code: '',
    jodo_base_url: 'https://ext.jodo.in',
    jodo_auth_header: '',
  });

  const notify = (type, text) => onMessage?.({ type, text });

  useEffect(() => {
    loadBranches();
  }, []);

  async function loadBranches() {
    try {
      setLoading(true);
      const result = await api('/branches');
      setBranches(result.data || []);
      if (result.data?.length > 0) {
        selectBranch(result.data[0]);
      }
    } catch (error) {
      notify('error', `Failed to load branches: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  /*
   * The three secrets come back empty with a `_set` flag beside them -- the
   * server no longer hands out live payment credentials, it only says whether
   * one is stored. An empty box with a "saved" placeholder is what shows that,
   * and leaving it empty on save keeps whatever is already there.
   */
  const [stored, setStored] = useState({});
  const secretPlaceholder = (isSet, ifEmpty) => (isSet ? '•••••••••••••• (saved)' : ifEmpty);

  async function selectBranch(branch) {
    setSelectedBranch(branch);
    try {
      const result = await api(`/branches/${branch.id}/jodo-config`);
      setStored({
        apiKey: Boolean(result.data?.jodo_api_key_set),
        secretKey: Boolean(result.data?.jodo_secret_key_set),
        authHeader: Boolean(result.data?.jodo_auth_header_set),
      });
      setFormData({
        jodo_payment_enabled: true,
        jodo_api_key: '',
        jodo_secret_key: '',
        jodo_collector_code: result.data?.jodo_collector_code || '',
        jodo_base_url: result.data?.jodo_base_url || 'https://ext.jodo.in',
        jodo_auth_header: '',
      });
    } catch (error) {
      setStored({});
      setFormData({
        jodo_payment_enabled: false,
        jodo_api_key: '',
        jodo_secret_key: '',
        jodo_collector_code: '',
        jodo_base_url: 'https://ext.jodo.in',
        jodo_auth_header: '',
      });
    }
  }

  async function handleSave() {
    if (!selectedBranch) return;
    setSaving(true);
    try {
      await api.post(`/branches/${selectedBranch.id}/jodo-config`, formData);
      notify('success', 'Jodo payment configuration saved successfully');
    } catch (error) {
      notify('error', `Failed to save: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="branch-settings"><p>Loading branches...</p></div>;

  return (
    <main className="branch-settings">
      <section className="branch-selector">
        <select
          value={selectedBranch?.id || ''}
          onChange={(e) => {
            const branch = branches.find(b => b.id === Number(e.target.value));
            if (branch) selectBranch(branch);
          }}
        >
          <option value="">Select a branch</option>
          {branches.map(branch => (
            <option key={branch.id} value={branch.id}>
              {branch.branch_name || branch.name}
            </option>
          ))}
        </select>
      </section>

      {selectedBranch && (
        <section className="jodo-config-form">
          {/* No enable checkbox: a branch can take payment as soon as it has
              credentials. Whether a given enquiry form charges is set on the
              form itself. */}
          {(
            <>
              <div className="info-box">
                <AlertCircle size={16} />
                <p>Get these credentials from your Jodo dashboard at <strong>https://dashboard.jodo.in</strong></p>
              </div>

              <div className="form-group">
                <label>API Key *</label>
                <input
                  type="password"
                  placeholder={secretPlaceholder(stored.apiKey, "Enter your Jodo API key")}
                  value={formData.jodo_api_key}
                  onChange={(e) => setFormData({ ...formData, jodo_api_key: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Secret Key *</label>
                <input
                  type="password"
                  placeholder={secretPlaceholder(stored.secretKey, "Enter your Jodo secret key")}
                  value={formData.jodo_secret_key}
                  onChange={(e) => setFormData({ ...formData, jodo_secret_key: e.target.value })}
                />
              </div>

              {/* Jodo issues its own Authorization value. Given one, it is
                  sent exactly as provided; left blank, the CRM falls back to
                  building Basic from the key and secret as it always did. */}
              <div className="form-group">
                <label>API Base URL *</label>
                <input
                  type="text"
                  placeholder="https://ext.jodo.in"
                  value={formData.jodo_base_url}
                  onChange={(e) => setFormData({ ...formData, jodo_base_url: e.target.value })}
                />
                <small>Live is https://ext.jodo.in. Point a branch at the UAT host to test against it.</small>
              </div>

              <div className="form-group">
                <label>Authorization Header</label>
                <input
                  type="password"
                  placeholder={secretPlaceholder(stored.authHeader, "Basic ....==")}
                  value={formData.jodo_auth_header}
                  onChange={(e) => setFormData({ ...formData, jodo_auth_header: e.target.value })}
                />
                <small>Paste the value Jodo issued. Leave blank to derive it from the API key and secret.</small>
              </div>

              <div className="form-group">
                <label>Collector Code</label>
                <input
                  type="text"
                  placeholder="Optional collector code (if required by Jodo)"
                  value={formData.jodo_collector_code}
                  onChange={(e) => setFormData({ ...formData, jodo_collector_code: e.target.value })}
                />
              </div>

              <button
                className="primary"
                disabled={saving || !formData.jodo_base_url || (!(formData.jodo_auth_header || stored.authHeader) && !((formData.jodo_api_key || stored.apiKey) && (formData.jodo_secret_key || stored.secretKey)))}
                onClick={handleSave}
              >
                <Save size={16} />
                {saving ? 'Saving...' : 'Save Configuration'}
              </button>
            </>
          )}

        </section>
      )}
    </main>
  );
}
