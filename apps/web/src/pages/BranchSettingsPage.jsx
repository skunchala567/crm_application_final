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

  async function selectBranch(branch) {
    setSelectedBranch(branch);
    try {
      const result = await api(`/branches/${branch.id}/jodo-config`);
      setFormData({
        jodo_payment_enabled: true,
        jodo_api_key: result.data?.jodo_api_key || '',
        jodo_secret_key: result.data?.jodo_secret_key || '',
        jodo_collector_code: result.data?.jodo_collector_code || '',
      });
    } catch (error) {
      setFormData({
        jodo_payment_enabled: false,
        jodo_api_key: '',
        jodo_secret_key: '',
        jodo_collector_code: '',
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
                  placeholder="Enter your Jodo API key"
                  value={formData.jodo_api_key}
                  onChange={(e) => setFormData({ ...formData, jodo_api_key: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Secret Key *</label>
                <input
                  type="password"
                  placeholder="Enter your Jodo secret key"
                  value={formData.jodo_secret_key}
                  onChange={(e) => setFormData({ ...formData, jodo_secret_key: e.target.value })}
                />
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
                disabled={saving || !formData.jodo_api_key || !formData.jodo_secret_key}
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
