import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Copy, Download, Facebook, Loader2,
  RefreshCw, Save, ShieldCheck, XCircle,
} from 'lucide-react';
import { api } from '../api';

/**
 * Meta Lead Ads settings.
 *
 * Three stages, in the order they must actually be done:
 *   1. Credentials  -> app id/secret + system user token
 *   2. Pages        -> discover + subscribe to leadgen webhooks
 *   3. Forms        -> route each form to a branch, then backfill
 */

const CRM_FIELDS = [
  { value: '', label: '— Ignore —' },
  { value: 'studentName', label: 'Student name' },
  { value: 'firstName', label: 'First name' },
  { value: 'lastName', label: 'Last name' },
  { value: 'phone', label: 'Phone' },
  { value: 'alternatePhone', label: 'Alternate phone' },
  { value: 'email', label: 'Email' },
  { value: 'parentName', label: 'Parent name' },
  { value: 'city', label: 'City' },
  { value: 'applyingClass', label: 'Applying class' },
  { value: 'academicYear', label: 'Academic year' },
];

function StatusPill({ ok, children }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
      ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
    }`}>
      <Icon size={13} />
      {children}
    </span>
  );
}

export default function MetaLeadAdsSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [meta, setMeta] = useState(null);
  const [form, setForm] = useState({ appId: '', appSecret: '', systemUserToken: '' });
  const [routing, setRouting] = useState({ defaultBranchId: '', defaultBusinessUnitId: '', actorUserId: '' });

  const [pages, setPages] = useState([]);
  const [forms, setForms] = useState([]);
  const [ledger, setLedger] = useState({ counts: {}, imports: [] });

  const loadAll = useCallback(async () => {
    setError('');
    try {
      const [configRes, pagesRes, formsRes, importsRes] = await Promise.all([
        api.get('/meta/config'),
        api.get('/meta/pages').catch(() => ({ data: [] })),
        api.get('/meta/forms').catch(() => ({ data: [] })),
        api.get('/meta/imports?limit=25').catch(() => ({ data: { counts: {}, imports: [] } })),
      ]);
      const cfg = configRes.data || {};
      setMeta(cfg);
      setForm((prev) => ({ ...prev, appId: cfg.config?.appId || '' }));
      setRouting({
        defaultBranchId: cfg.config?.defaultBranchId ?? '',
        defaultBusinessUnitId: cfg.config?.defaultBusinessUnitId ?? '',
        actorUserId: cfg.config?.actorUserId ?? '',
      });
      setPages(pagesRes.data || []);
      setForms(formsRes.data || []);
      setLedger(importsRes.data || { counts: {}, imports: [] });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const flash = (message) => {
    setNotice(message);
    setTimeout(() => setNotice(''), 4000);
  };

  async function saveConfig() {
    setSaving(true);
    setError('');
    try {
      const payload = { appId: form.appId, ...routing };
      // Only send secrets the user actually retyped, so a blank field never
      // wipes a stored credential.
      if (form.appSecret) payload.appSecret = form.appSecret;
      if (form.systemUserToken) payload.systemUserToken = form.systemUserToken;
      await api.put('/meta/config', payload);
      setForm((prev) => ({ ...prev, appSecret: '', systemUserToken: '' }));
      flash('Credentials saved');
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function run(key, fn, successMessage) {
    setBusy(key);
    setError('');
    try {
      const result = await fn();
      flash(typeof successMessage === 'function' ? successMessage(result) : successMessage);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function updateMapping(formId, metaField, crmField) {
    const target = forms.find((f) => f.form_id === formId);
    const mapping = { ...(target?.field_mapping || {}), [metaField]: crmField };
    await api.patch(`/meta/forms/${formId}`, { fieldMapping: mapping });
    await loadAll();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-secondary-500">
        <Loader2 className="animate-spin mr-2" size={18} /> Loading Meta settings…
      </div>
    );
  }

  const counts = ledger.counts || {};

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-600 text-white">
            <Facebook size={20} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">Meta Lead Ads</h2>
            <p className="text-sm text-secondary-600">
              Pull leads from Facebook and Instagram lead forms into the CRM.
            </p>
          </div>
        </div>
        <button className="secondary inline-flex items-center gap-2" onClick={loadAll}>
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
          <CheckCircle2 size={16} /> {notice}
        </div>
      )}

      {/* 1. Credentials */}
      <section className="panel card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="card-title">1. App credentials</h3>
          <StatusPill ok={meta?.configured}>
            {meta?.configured ? 'Configured' : 'Not configured'}
          </StatusPill>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="form-group">
            <span className="label">App ID</span>
            <input
              className="input"
              value={form.appId}
              onChange={(e) => setForm({ ...form, appId: e.target.value })}
              placeholder="1234567890"
            />
          </label>
          <label className="form-group">
            <span className="label">
              App Secret {meta?.config?.hasAppSecret && <em className="text-xs text-secondary-500">(stored)</em>}
            </span>
            <input
              className="input"
              type="password"
              value={form.appSecret}
              onChange={(e) => setForm({ ...form, appSecret: e.target.value })}
              placeholder={meta?.config?.hasAppSecret ? 'Leave blank to keep current' : 'App secret'}
            />
          </label>
          <label className="form-group md:col-span-2">
            <span className="label">
              System User Token {meta?.config?.hasSystemUserToken && <em className="text-xs text-secondary-500">(stored)</em>}
            </span>
            <input
              className="input"
              type="password"
              value={form.systemUserToken}
              onChange={(e) => setForm({ ...form, systemUserToken: e.target.value })}
              placeholder={meta?.config?.hasSystemUserToken ? 'Leave blank to keep current' : 'Long-lived system user token'}
            />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-3 mt-2">
          <label className="form-group">
            <span className="label">Default Branch ID</span>
            <input
              className="input" type="number" value={routing.defaultBranchId}
              onChange={(e) => setRouting({ ...routing, defaultBranchId: e.target.value })}
            />
          </label>
          <label className="form-group">
            <span className="label">Default Business Unit ID</span>
            <input
              className="input" type="number" value={routing.defaultBusinessUnitId}
              onChange={(e) => setRouting({ ...routing, defaultBusinessUnitId: e.target.value })}
            />
          </label>
          <label className="form-group">
            <span className="label">Import as User ID</span>
            <input
              className="input" type="number" value={routing.actorUserId}
              onChange={(e) => setRouting({ ...routing, actorUserId: e.target.value })}
            />
          </label>
        </div>

        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <button className="primary inline-flex items-center gap-2" onClick={saveConfig} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
          <button
            className="secondary inline-flex items-center gap-2"
            disabled={!meta?.configured || busy === 'test'}
            onClick={() => run('test', () => api.post('/meta/config/test', {}),
              (r) => r.data?.valid ? `Token valid — scopes: ${(r.data.scopes || []).join(', ') || 'none'}` : 'Token is NOT valid')}
          >
            {busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Test token
          </button>
        </div>

        <div className="mt-4 p-3 bg-secondary-50 border border-border rounded-lg">
          <div className="text-xs font-semibold text-secondary-700 mb-1">Webhook callback URL</div>
          <div className="flex items-center gap-2">
            <code className="text-xs break-all flex-1">{meta?.webhookUrl}</code>
            <button
              className="secondary"
              title="Copy"
              onClick={() => navigator.clipboard?.writeText(meta?.webhookUrl || '')}
            >
              <Copy size={13} />
            </button>
          </div>
          {meta?.config?.verifyToken && (
            <>
              <div className="text-xs font-semibold text-secondary-700 mt-3 mb-1">Verify token</div>
              <div className="flex items-center gap-2">
                <code className="text-xs break-all flex-1">{meta.config.verifyToken}</code>
                <button
                  className="secondary"
                  title="Copy"
                  onClick={() => navigator.clipboard?.writeText(meta.config.verifyToken)}
                >
                  <Copy size={13} />
                </button>
              </div>
            </>
          )}
          <p className="text-xs text-secondary-600 mt-2">
            Paste both into your Meta App → Webhooks → Page → <code>leadgen</code>.
            Meta requires a public HTTPS URL; it cannot reach localhost.
          </p>
        </div>
      </section>

      {/* 2. Pages */}
      <section className="panel card">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="card-title">2. Pages ({pages.length})</h3>
          <button
            className="primary inline-flex items-center gap-2"
            disabled={!meta?.configured || busy === 'pages'}
            onClick={() => run('pages', () => api.post('/meta/pages/sync', { subscribe: true }),
              (r) => `${r.data.subscribed}/${r.data.total} pages subscribed${r.data.failed ? `, ${r.data.failed} failed` : ''}`)}
          >
            {busy === 'pages' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Sync &amp; subscribe pages
          </button>
        </div>

        {pages.length === 0 ? (
          <p className="text-sm text-secondary-600">
            No pages yet. Save credentials, then sync.
          </p>
        ) : (
          <div className="table-wrap overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>Page</th><th>Subscribed</th><th>Branch</th><th>Forms</th></tr>
              </thead>
              <tbody>
                {pages.map((page) => (
                  <tr key={page.page_id}>
                    <td>
                      <div className="font-semibold">{page.page_name || '(unnamed)'}</div>
                      <div className="text-xs text-secondary-500">{page.page_id}</div>
                      {page.subscribe_error && (
                        <div className="text-xs text-red-600 mt-1">{page.subscribe_error}</div>
                      )}
                    </td>
                    <td><StatusPill ok={!!page.is_subscribed}>{page.is_subscribed ? 'Yes' : 'No'}</StatusPill></td>
                    <td className="text-sm">{page.branch_id || <span className="text-secondary-400">default</span>}</td>
                    <td>
                      <button
                        className="secondary text-xs"
                        disabled={busy === `forms-${page.page_id}`}
                        onClick={() => run(`forms-${page.page_id}`,
                          () => api.post(`/meta/pages/${page.page_id}/forms/sync`, {}),
                          (r) => `${r.data.length} forms synced`)}
                      >
                        {busy === `forms-${page.page_id}` ? 'Syncing…' : 'Sync forms'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 3. Forms */}
      <section className="panel card">
        <h3 className="card-title mb-4">3. Lead forms ({forms.length})</h3>
        {forms.length === 0 ? (
          <p className="text-sm text-secondary-600">No forms yet. Sync forms from a page above.</p>
        ) : (
          <div className="space-y-4">
            {forms.map((f) => (
              <div key={f.form_id} className="border border-border rounded-lg p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-semibold">{f.form_name || f.form_id}</div>
                    <div className="text-xs text-secondary-500">
                      Form {f.form_id} · Page {f.page_id}
                      {f.form_status ? ` · ${f.form_status}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      className="input w-32"
                      type="number"
                      placeholder="Branch ID"
                      defaultValue={f.branch_id || ''}
                      onBlur={(e) => {
                        const value = e.target.value;
                        if (String(value) !== String(f.branch_id || '')) {
                          run(`branch-${f.form_id}`,
                            () => api.patch(`/meta/forms/${f.form_id}`, { branchId: value || null }),
                            'Branch updated');
                        }
                      }}
                    />
                    <button
                      className="secondary inline-flex items-center gap-1.5 text-xs"
                      disabled={busy === `bf-${f.form_id}`}
                      onClick={() => run(`bf-${f.form_id}`,
                        () => api.post(`/meta/forms/${f.form_id}/backfill`, {}),
                        (r) => `Fetched ${r.data.fetched}: ${r.data.imported} imported, ${r.data.duplicate} duplicate, ${r.data.failed} failed`)}
                    >
                      {busy === `bf-${f.form_id}`
                        ? <Loader2 size={13} className="animate-spin" />
                        : <Download size={13} />}
                      Backfill
                    </button>
                  </div>
                </div>

                {Object.keys(f.field_mapping || {}).length > 0 && (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {Object.entries(f.field_mapping).map(([metaField, crmField]) => (
                      <label key={metaField} className="flex items-center gap-2 text-xs">
                        <span className="flex-1 truncate text-secondary-700" title={metaField}>{metaField}</span>
                        <select
                          className="input py-1 text-xs w-40"
                          value={crmField || ''}
                          onChange={(e) => updateMapping(f.form_id, metaField, e.target.value)}
                        >
                          {CRM_FIELDS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                )}
                <p className="text-xs text-secondary-500 mt-2">
                  Unmapped questions are auto-detected by name and stored on the lead.
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. Ledger */}
      <section className="panel card">
        <h3 className="card-title mb-4">Recent imports</h3>
        <div className="flex gap-3 flex-wrap mb-4">
          {[
            ['imported', 'Imported', 'bg-emerald-100 text-emerald-700'],
            ['duplicates', 'Duplicates', 'bg-amber-100 text-amber-700'],
            ['failed', 'Failed', 'bg-red-100 text-red-700'],
            ['skipped', 'Skipped', 'bg-secondary-100 text-secondary-700'],
          ].map(([key, label, cls]) => (
            <div key={key} className={`px-3 py-2 rounded-lg ${cls}`}>
              <div className="text-lg font-bold">{Number(counts[key] || 0)}</div>
              <div className="text-xs font-semibold">{label}</div>
            </div>
          ))}
        </div>

        {(ledger.imports || []).length === 0 ? (
          <p className="text-sm text-secondary-600">No leads received yet.</p>
        ) : (
          <div className="table-wrap overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>Leadgen ID</th><th>Status</th><th>Lead</th><th>Detail</th><th>When</th></tr>
              </thead>
              <tbody>
                {ledger.imports.map((row) => (
                  <tr key={row.leadgen_id}>
                    <td className="text-xs font-mono">{row.leadgen_id}</td>
                    <td>
                      <span className={`badge-status ${
                        row.status === 'imported' ? 'success'
                          : row.status === 'failed' ? 'error'
                          : row.status === 'duplicate' ? 'warning' : 'info'
                      }`}>{row.status}</span>
                    </td>
                    <td className="text-xs">{row.lead_number || '—'}</td>
                    <td className="text-xs text-red-600 max-w-xs truncate" title={row.error_message || ''}>
                      {row.error_message || ''}
                      {row.status === 'failed' && (
                        <button
                          className="text-btn ml-2"
                          onClick={() => run(`retry-${row.leadgen_id}`,
                            () => api.post(`/meta/imports/${row.leadgen_id}/retry`, {}),
                            'Retry finished')}
                        >retry</button>
                      )}
                    </td>
                    <td className="text-xs text-secondary-500">
                      {row.created_at_utc ? new Date(row.created_at_utc).toLocaleString() : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
