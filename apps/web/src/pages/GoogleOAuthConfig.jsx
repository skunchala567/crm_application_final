import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Eye, EyeOff, Loader } from 'lucide-react';
import { api } from '../api';

export default function GoogleOAuthConfig({ integrationId, onConfigSaved }) {
  const [config, setConfig] = useState({});
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUrl, setRedirectUrl] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    setLoading(true);
    api.get(`/hub/integrations/${integrationId}`).then(response => {
      const next = response.data?.config || {};
      setConfig(next);
      setClientId(next.clientId || '');
      setClientSecret(next.clientSecret || '');
      setRedirectUrl(next.redirectUrl || '');
      setNotice(null);
    }).catch(error => setNotice({ type: 'error', text: error.message }))
      .finally(() => setLoading(false));
  }, [integrationId]);

  async function save() {
    if (!clientId.trim() || !clientSecret.trim() || !/^https?:\/\/\S+$/i.test(redirectUrl.trim())) {
      setNotice({ type: 'error', text: 'Client ID, Client Secret, and a valid Redirect URI are required.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await api.put(`/hub/integrations/${integrationId}`, {
        config: {
          ...config,
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          redirectUrl: redirectUrl.trim()
        }
      });
      setNotice({ type: 'success', text: 'Google OAuth credentials saved for this integration.' });
      onConfigSaved?.();
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="oauth-config-loading"><Loader className="spinning"/> Loading Google OAuth configuration…</div>;

  return <section className="google-oauth-config">
    <div className="oauth-config-heading">
      <h4>Google OAuth credentials</h4>
      <p>Credentials are stored separately for this Google Sheets account.</p>
    </div>
    <div className="oauth-config-grid">
      <label><span>Google Client ID *</span><input value={clientId} onChange={event => setClientId(event.target.value)} disabled={saving} placeholder="OAuth client ID"/></label>
      <label><span>Google Client Secret *</span><div className="oauth-secret-input"><input type={showSecret ? 'text' : 'password'} value={clientSecret} onChange={event => setClientSecret(event.target.value)} disabled={saving} placeholder="OAuth client secret"/><button type="button" onClick={() => setShowSecret(value => !value)}>{showSecret ? <EyeOff/> : <Eye/>}</button></div></label>
      <label className="oauth-redirect"><span>Authorized Redirect URI *</span><input type="url" value={redirectUrl} onChange={event => setRedirectUrl(event.target.value)} disabled={saving} placeholder="https://your-api-domain.com/api/hub/oauth/callback"/><small>Add this exact URI to the OAuth client in Google Cloud Console.</small></label>
    </div>
    {notice && <div className={`oauth-config-notice ${notice.type}`}>{notice.type === 'success' ? <CheckCircle/> : <AlertCircle/>}{notice.text}</div>}
    <div className="oauth-config-actions"><button className="btn btn-primary" onClick={save} disabled={saving}>{saving && <Loader className="spinning"/>}{saving ? 'Saving…' : 'Save Google credentials'}</button></div>
    <style>{`
      .google-oauth-config{margin-top:18px;padding:18px;border:1px solid var(--border);border-radius:10px;background:#fff}
      .oauth-config-heading h4,.oauth-config-heading p{margin:0}.oauth-config-heading h4{font-size:14px}.oauth-config-heading p{margin-top:3px;color:var(--text-secondary);font-size:10px}
      .oauth-config-grid{margin-top:15px;display:grid;grid-template-columns:1fr 1fr;gap:13px}.oauth-config-grid label{display:grid;gap:6px}.oauth-config-grid label>span{font-size:10px;font-weight:700}.oauth-config-grid input{width:100%;height:40px;padding:0 11px;border:1px solid var(--border);border-radius:8px}.oauth-redirect{grid-column:1/-1}.oauth-config-grid small{color:var(--text-secondary);font-size:9px}
      .oauth-secret-input{position:relative}.oauth-secret-input input{padding-right:42px}.oauth-secret-input button{position:absolute;top:3px;right:3px;width:34px;height:34px;display:grid;place-items:center;border:0;background:transparent;color:var(--primary)}.oauth-secret-input svg{width:16px}
      .oauth-config-notice{margin-top:12px;padding:10px;display:flex;align-items:center;gap:7px;border-radius:7px;font-size:10px}.oauth-config-notice svg{width:16px}.oauth-config-notice.success{background:#e7f5ee;color:#0b7a4f}.oauth-config-notice.error{background:#fdeeed;color:#b23d3d}
      .oauth-config-actions{margin-top:14px;display:flex;justify-content:flex-end}.oauth-config-actions button{display:flex;align-items:center;gap:7px}.oauth-config-actions svg{width:15px}.oauth-config-loading{padding:18px;display:flex;align-items:center;gap:8px;color:var(--text-secondary)}
      @media(max-width:650px){.oauth-config-grid{grid-template-columns:1fr}.oauth-redirect{grid-column:auto}}
    `}</style>
  </section>;
}
