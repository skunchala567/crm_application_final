import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const defaults = {
  baseUrl: '', username: '', password: '', senderId: '', dltContentId: '',
  dltPrincipalEntityId: '', dltTelemarketerId: '', defaultUnicode: false,
  callbackSecret: '', publicApiBaseUrl: ''
};

export default function SmartpingSmsConfig({ integrationId, organizationId, onConfigSaved }) {
  const [form, setForm] = useState(defaults);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));

  useEffect(() => {
    api.get(`/hub/integrations/${integrationId}`)
      .then(response => setForm({ ...defaults, ...(response.data?.config || {}) }))
      .catch(err => setError(err.message))
      .finally(() => setBusy(false));
  }, [integrationId]);

  const callbackUrl = useMemo(() => {
    if (!form.publicApiBaseUrl) return '';
    const secret = form.callbackSecret ? `?secret=${encodeURIComponent(form.callbackSecret)}` : '';
    return `${form.publicApiBaseUrl.replace(/\/+$/, '')}/api/hub/smartping-sms/dlr/${organizationId || 1}/${integrationId}${secret}`;
  }, [form.publicApiBaseUrl, form.callbackSecret, integrationId, organizationId]);

  const validate = () => {
    if (!/^https?:\/\/[^\s/]+/i.test(form.baseUrl)) return 'Enter the SmartPing API base URL, including https://';
    if (!form.username.trim() || !form.password.trim()) return 'Username and API password are required';
    if (!/^[A-Za-z0-9]{6}$/.test(form.senderId)) return 'Sender ID must contain exactly 6 letters or numbers';
    if (!/^\d{4,19}$/.test(form.dltContentId)) return 'DLT Content ID must contain 4 to 19 digits';
    if (form.dltPrincipalEntityId && !/^\d{12,19}$/.test(form.dltPrincipalEntityId)) return 'DLT Principal Entity ID must contain 12 to 19 digits';
    if (form.dltTelemarketerId && !/^\d{12,19}$/.test(form.dltTelemarketerId)) return 'DLT Telemarketer ID must contain 12 to 19 digits';
    if (form.publicApiBaseUrl && !/^https:\/\/[^\s/]+/i.test(form.publicApiBaseUrl)) return 'Public CRM API URL must use HTTPS';
    return '';
  };

  const save = async (test = false) => {
    const validationError = validate();
    if (validationError) return setError(validationError);
    setBusy(true); setError(''); setNotice('');
    try {
      await api.put(`/hub/integrations/${integrationId}`, { config: form });
      if (test) await api.post(`/hub/integrations/${integrationId}/test-connection`);
      setNotice(test ? 'Configuration is valid. No billable SMS was sent.' : 'SmartPing SMS configuration saved.');
      onConfigSaved?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  if (busy && !form.username) return <p>Loading SMS configuration...</p>;
  const fields = [
    ['baseUrl', 'SmartPing API base URL *', 'https://your-smartping-domain'],
    ['username', 'API username *', 'account.trans'],
    ['password', 'API password *', 'API password', 'password'],
    ['senderId', 'Sender ID / DLT Header *', 'ABCDEF'],
    ['dltContentId', 'Default DLT Content ID *', 'Approved template ID'],
    ['dltPrincipalEntityId', 'DLT Principal Entity ID', '12–19 digit PE ID'],
    ['dltTelemarketerId', 'DLT Telemarketer ID', '12–19 digit TM ID'],
    ['publicApiBaseUrl', 'Public CRM API URL', 'https://crm-api.example.com'],
    ['callbackSecret', 'Delivery callback secret', 'Shared secret', 'password']
  ];
  return (
    <div className="smartping-sms-config">
      <h3>SmartPing SMS configuration</h3>
      <p className="help-text">Credentials, sender header, and DLT defaults are stored on this integration. A send request may override the DLT IDs when using another approved template.</p>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}
      {fields.map(([key, label, placeholder, type]) => (
        <div className="form-group" key={key}>
          <label>{label}</label>
          <input type={type || 'text'} value={form[key]} placeholder={placeholder} disabled={busy}
            onChange={event => set(key, event.target.value)} />
        </div>
      ))}
      <label className="checkbox-label">
        <input type="checkbox" checked={Boolean(form.defaultUnicode)} disabled={busy}
          onChange={event => set('defaultUnicode', event.target.checked)} />
        Send as Unicode by default (regional-language templates)
      </label>
      {callbackUrl && <div className="form-group"><label>Delivery report URL to give SmartPing</label><input readOnly value={callbackUrl} /></div>}
      <div className="wizard-actions">
        <button className="btn btn-outline" disabled={busy} onClick={() => save(true)}>Validate configuration</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => save(false)}>Save configuration</button>
      </div>
    </div>
  );
}
