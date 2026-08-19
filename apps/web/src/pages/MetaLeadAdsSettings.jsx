import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, AlertTriangle, CheckCircle2, Copy, Download, Loader2, Plus,
  RefreshCw, Save, Search, ShieldCheck, XCircle,
} from 'lucide-react';
import { api } from '../api';
import MetaLeadReview from '../components/MetaLeadReview.jsx';
import { SearchSelect } from '../FilterWorkspace.jsx';

/**
 * Meta Lead Ads settings.
 *
 * Four stages, in the order they must actually be done:
 *   1. Connect      -> app id/secret + system user token
 *   2. Routing      -> who imports, and where leads land by default
 *   3. Pages        -> discover + subscribe to leadgen webhooks
 *   4. Forms        -> route each form to a branch, then backfill
 *
 * Every reference to another record is chosen by name. The ids still go to the
 * API unchanged -- only the way they are picked differs, because asking an
 * admin to recall that "import as user 1" means Srikanth was a reliable way to
 * end up with a number that imports nothing.
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

/** A labelled field with room for the one line of context it needs. */
function Field({ label, hint, required, error, children }) {
  return (
    <div className="form-group">
      <span className="label">
        {label}
        {required && <span className="text-red-600 ml-0.5" title="Required">*</span>}
      </span>
      {children}
      {error
        ? <span className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertTriangle size={12} />{error}</span>
        : hint && <span className="text-xs text-secondary-500 mt-1 block">{hint}</span>}
    </div>
  );
}

/** One line of the setup checklist at the top of the screen. */
function StepChip({ done, label }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border ${
      done
        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
        : 'bg-secondary-50 border-border text-secondary-500'
    }`}>
      {done ? <CheckCircle2 size={13} /> : <span className="w-[13px] h-[13px] rounded-full border-2 border-current inline-block" />}
      {label}
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

  // Names for every id the screen would otherwise have asked for.
  const [lookups, setLookups] = useState({ users: [], branches: [], businessUnits: [] });

  const [pages, setPages] = useState([]);
  const [forms, setForms] = useState([]);
  const [ledger, setLedger] = useState({ counts: {}, imports: [] });

  // Adding a second Facebook account: its token is used once for discovery.
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [accountToken, setAccountToken] = useState('');
  /* Pages the supplied token can see, and the ones ticked to connect. Nothing
     is connected until the second step, so a token that reaches a dozen Pages
     no longer subscribes all twelve to lead delivery. */
  const [discovered, setDiscovered] = useState(null);
  const [chosenPages, setChosenPages] = useState([]);
  const closeAddAccount = () => { setAddAccountOpen(false); setAccountToken(''); setDiscovered(null); setChosenPages([]); };

  // Pages carry the account they were discovered through. Pages connected
  // before that was recorded group under a single "unknown" bucket.
  const accountGroups = useMemo(() => {
    const groups = new Map();
    for (const page of pages) {
      const key = page.meta_account_id || 'unknown';
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          id: page.meta_account_id || null,
          name: page.meta_account_name || 'Previously connected account',
          pages: [],
        });
      }
      groups.get(key).pages.push(page);
    }
    return [...groups.values()];
  }, [pages]);

  const branchOptions = useMemo(() => [
    { value: '', label: '— No default branch —' },
    ...lookups.branches.map((b) => ({ value: String(b.id), label: b.name })),
  ], [lookups.branches]);

  const unitOptions = useMemo(() => [
    { value: '', label: '— No default business unit —' },
    ...lookups.businessUnits.map((u) => ({ value: String(u.id), label: u.name })),
  ], [lookups.businessUnits]);

  const userOptions = useMemo(() => [
    { value: '', label: '— Select a user —' },
    ...lookups.users.map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` })),
  ], [lookups.users]);

  const branchName = useCallback(
    (id) => lookups.branches.find((b) => String(b.id) === String(id))?.name || null,
    [lookups.branches],
  );

  const loadAll = useCallback(async () => {
    setError('');
    try {
      const [configRes, lookupRes, pagesRes, formsRes, importsRes] = await Promise.all([
        api.get('/meta/config'),
        api.get('/meta/lookups').catch(() => ({ data: { users: [], branches: [], businessUnits: [] } })),
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
      setLookups(lookupRes.data || { users: [], branches: [], businessUnits: [] });
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

  /*
   * Stable across renders on purpose. App re-renders every second while the
   * idle timer ticks, and an inline callback here would hand MetaLeadReview a
   * new prop each time -- which is what had it refetching, and flickering,
   * once a second.
   */
  const handleReviewMessage = useCallback((message) => {
    if (!message) return;
    if (message.type === 'error') { setError(message.text); setNotice(''); }
    else { setNotice(message.text); setError(''); }
    // Approving a lead moves it into the ledger, so refresh the counts.
    loadAll();
  }, [loadAll]);

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
      flash('Settings saved');
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
  const subscribedPages = pages.filter((p) => p.is_subscribed).length;
  // The one setting that stops imports dead, so it gets its own banner.
  const missingActor = !routing.actorUserId;

  const saveButton = (
    <button className="primary inline-flex items-center gap-2" onClick={saveConfig} disabled={saving}>
      {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
    </button>
  );

  return (
    <div className="space-y-6">
      {/* Where you are in the setup, and the way back to a fresh read. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <StepChip done={!!meta?.configured} label="1. Connected" />
          <StepChip done={!missingActor} label="2. Lead routing" />
          <StepChip done={subscribedPages > 0} label="3. Pages subscribed" />
          <StepChip done={forms.length > 0} label="4. Forms synced" />
        </div>
        <button className="secondary inline-flex items-center gap-2" onClick={loadAll}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

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
      {missingActor && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>Leads are not being imported.</strong> Choose an <em>Import leads as</em> user
            below — every incoming lead is recorded against a CRM user, and without one each
            lead is rejected and listed as failed under Recent imports. Fix this and use
            <em> retry</em> to bring them in.
          </span>
        </div>
      )}

      {/* 1. Connection */}
      <section className="panel card">
        <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
          <h3 className="card-title">1. Connect to Meta</h3>
          <StatusPill ok={meta?.configured}>
            {meta?.configured ? 'Connected' : 'Not connected'}
          </StatusPill>
        </div>
        <p className="text-xs text-secondary-500 mb-4">
          From your Meta app at developers.facebook.com → Settings → Basic. Secrets are stored
          encrypted and never shown again.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="App ID" hint="The numeric ID of your Meta app.">
            <input
              className="input"
              value={form.appId}
              onChange={(e) => setForm({ ...form, appId: e.target.value })}
              placeholder="1234567890"
            />
          </Field>
          <Field
            label="App Secret"
            hint={meta?.config?.hasAppSecret
              ? 'Already stored. Leave blank to keep it.'
              : 'Used to verify that webhook calls really come from Meta.'}
          >
            <input
              className="input"
              type="password"
              value={form.appSecret}
              onChange={(e) => setForm({ ...form, appSecret: e.target.value })}
              placeholder={meta?.config?.hasAppSecret ? 'Leave blank to keep current' : 'App secret'}
            />
          </Field>
          <div className="md:col-span-2">
            <Field
              label="System User Token"
              hint={meta?.config?.hasSystemUserToken
                ? 'Already stored. Leave blank to keep it.'
                : 'A long-lived token from Business Settings → System Users. Needs pages_show_list, pages_manage_metadata and leads_retrieval.'}
            >
              <input
                className="input"
                type="password"
                value={form.systemUserToken}
                onChange={(e) => setForm({ ...form, systemUserToken: e.target.value })}
                placeholder={meta?.config?.hasSystemUserToken ? 'Leave blank to keep current' : 'Long-lived system user token'}
              />
            </Field>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4 flex-wrap">
          {saveButton}
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

      {/* 2. Routing */}
      <section className="panel card">
        <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
          <h3 className="card-title">2. Where new leads go</h3>
          <StatusPill ok={!missingActor}>{missingActor ? 'Incomplete' : 'Ready'}</StatusPill>
        </div>
        <p className="text-xs text-secondary-500 mb-4">
          Applied to every lead Meta sends. A form with its own branch (step 4) overrides
          the default below.
        </p>

        <div className="grid gap-4 md:grid-cols-3">
          <Field
            label="Import leads as"
            required
            error={missingActor ? 'Required — imports fail without this' : ''}
            hint="The CRM user recorded as having created the lead. A webhook has nobody signed in, so it acts as this user. Shown as the author in the lead's activity timeline."
          >
            <SearchSelect
              label="Import leads as"
              value={String(routing.actorUserId ?? '')}
              options={userOptions}
              onChange={(value) => setRouting({ ...routing, actorUserId: value })}
            />
          </Field>
          <Field label="Default branch" hint="Used when a form has no branch of its own.">
            <SearchSelect
              label="Default branch"
              value={String(routing.defaultBranchId ?? '')}
              options={branchOptions}
              onChange={(value) => setRouting({ ...routing, defaultBranchId: value })}
            />
          </Field>
          <Field label="Default business unit" hint="Which business the leads belong to.">
            <SearchSelect
              label="Default business unit"
              value={String(routing.defaultBusinessUnitId ?? '')}
              options={unitOptions}
              onChange={(value) => setRouting({ ...routing, defaultBusinessUnitId: value })}
            />
          </Field>
        </div>

        <p className="text-xs text-secondary-500 mt-3">
          Only users with CRM access appear in the list. To use a different person, give
          them CRM access under Settings → User Management first.
        </p>

        <div className="flex items-center gap-3 mt-4 flex-wrap">{saveButton}</div>
      </section>

      {/* 3. Pages, grouped by the Facebook account they were connected through */}
      <section className="panel card">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <h3 className="card-title">
            3. Facebook pages ({pages.length})
            {accountGroups.length > 0 && (
              <span className="text-xs font-normal text-secondary-500 ml-2">
                across {accountGroups.length} account{accountGroups.length === 1 ? '' : 's'}
              </span>
            )}
          </h3>
          <div className="flex items-center gap-2">
            <button
              className="secondary inline-flex items-center gap-2"
              disabled={!meta?.configured || busy === 'pages'}
              onClick={() => run('pages', () => api.post('/meta/pages/sync', { subscribe: true }),
                (r) => `${r.data.account?.name || 'Account'}: ${r.data.subscribed}/${r.data.total} pages subscribed${r.data.failed ? `, ${r.data.failed} failed` : ''}`)}
            >
              {busy === 'pages' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Re-sync saved account
            </button>
            <button
              className="primary inline-flex items-center gap-2"
              disabled={!meta?.configured}
              onClick={() => { if (addAccountOpen) closeAddAccount(); else setAddAccountOpen(true); }}
            >
              <Plus size={14} />
              Add Facebook account
            </button>
          </div>
        </div>
        <p className="text-xs text-secondary-500 mb-4">
          Connect as many Pages as you need. Pages from different Facebook accounts can
          coexist — each Page stores its own access token, so lead delivery is independent.
        </p>

        {addAccountOpen && (
          <div className="border border-border rounded-lg p-4 mb-4 bg-surface-3">
            <label className="block text-sm font-semibold mb-1">
              User access token for the Facebook account to add
            </label>
            <p className="text-xs text-secondary-500 mb-2">
              Needs <code>pages_show_list</code>, <code>pages_manage_metadata</code> and{' '}
              <code>leads_retrieval</code>. Used once to list that account&apos;s Pages —
              it is never stored; only each Page&apos;s own token is saved, encrypted.
            </p>
            <div className="flex gap-2 flex-wrap">
              <input
                type="password"
                className="flex-1 min-w-[260px]"
                placeholder="EAAB…"
                value={accountToken}
                onChange={(e) => setAccountToken(e.target.value)}
                autoComplete="off"
              />
              <button
                className="primary inline-flex items-center gap-2"
                disabled={!accountToken.trim() || busy === 'find-pages'}
                onClick={() => run('find-pages',
                  () => api.post('/meta/pages/discover', { userToken: accountToken.trim() }),
                  (r) => {
                    setDiscovered(r.data);
                    // Nothing pre-ticked: connecting a Page subscribes it to
                    // lead delivery, so it should be a choice, not a default.
                    setChosenPages([]);
                    return `${r.data.account?.name || 'Account'}: ${r.data.pages.length} page${r.data.pages.length === 1 ? '' : 's'} found`;
                  })}
              >
                {busy === 'find-pages' ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Find pages
              </button>
              <button className="secondary" onClick={closeAddAccount}>
                Cancel
              </button>
            </div>

            {discovered && (
              <div className="mt-4 border-t border-border pt-3">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                  <strong className="text-sm">
                    {discovered.account?.name || 'Account'} · choose the pages to connect
                  </strong>
                  <button
                    className="secondary text-xs"
                    onClick={() => setChosenPages(
                      chosenPages.length === discovered.pages.length
                        ? []
                        : discovered.pages.map((page) => page.pageId),
                    )}
                  >
                    {chosenPages.length === discovered.pages.length ? 'Clear all' : 'Select all'}
                  </button>
                </div>

                <div className="grid gap-1 max-h-64 overflow-y-auto">
                  {discovered.pages.map((page) => (
                    <label
                      key={page.pageId}
                      className="flex items-center gap-2 p-2 rounded-lg border border-border bg-surface hover:bg-surface-3 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={chosenPages.includes(page.pageId)}
                        onChange={(e) => setChosenPages((current) => (
                          e.target.checked
                            ? [...current, page.pageId]
                            : current.filter((id) => id !== page.pageId)
                        ))}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold truncate">{page.name || page.pageId}</span>
                        <span className="block text-[11px] text-secondary-500">{page.pageId}</span>
                      </span>
                      {page.alreadyConnected && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-primary-700 bg-primary-50 rounded-full px-2 py-0.5">
                          {page.alreadySubscribed ? 'Connected' : 'Added, not subscribed'}
                        </span>
                      )}
                    </label>
                  ))}
                  {!discovered.pages.length && (
                    <p className="text-sm text-secondary-600">This token can see no Pages.</p>
                  )}
                </div>

                <div className="flex gap-2 flex-wrap mt-3">
                  <button
                    className="primary inline-flex items-center gap-2"
                    disabled={!chosenPages.length || busy === 'add-account'}
                    onClick={() => run('add-account',
                      () => api.post('/meta/pages/sync', {
                        subscribe: true,
                        userToken: accountToken.trim(),
                        pageIds: chosenPages,
                      }),
                      (r) => {
                        closeAddAccount();
                        return `${r.data.account?.name || 'Account'}: ${r.data.subscribed}/${r.data.total} page${r.data.total === 1 ? '' : 's'} connected${r.data.failed ? `, ${r.data.failed} failed` : ''}`;
                      })}
                  >
                    {busy === 'add-account' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    Connect {chosenPages.length || ''} selected
                  </button>
                  <button className="secondary" onClick={closeAddAccount}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {pages.length === 0 ? (
          <p className="text-sm text-secondary-600">
            No pages yet. Save credentials and re-sync, or add a Facebook account above.
          </p>
        ) : (
          <div className="space-y-5">
            {accountGroups.map((group) => (
              <div key={group.key} className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 bg-surface-3 border-b border-border">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{group.name}</div>
                    <div className="text-xs text-secondary-500">
                      {group.id ? `Account ${group.id} · ` : ''}
                      {group.pages.length} page{group.pages.length === 1 ? '' : 's'} ·{' '}
                      {group.pages.filter((p) => p.is_subscribed).length} subscribed
                    </div>
                  </div>
                  <button
                    className="secondary text-xs"
                    disabled={busy === `disconnect-${group.key}`}
                    onClick={() => {
                      if (!window.confirm(`Disconnect all ${group.pages.length} page(s) connected through ${group.name}? Imported leads are kept.`)) return;
                      run(`disconnect-${group.key}`,
                        () => api.delete(`/meta/accounts/${encodeURIComponent(group.id || 'unknown')}`),
                        (r) => `${r.data.removed} page(s) disconnected`);
                    }}
                  >
                    {busy === `disconnect-${group.key}` ? 'Removing…' : 'Disconnect account'}
                  </button>
                </div>

                <div className="table-wrap overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr><th>Page</th><th>Receiving leads</th><th>Branch</th><th>Forms</th></tr>
                    </thead>
                    <tbody>
                      {group.pages.map((page) => (
                        <tr key={page.page_id}>
                          <td>
                            <div className="font-semibold">{page.page_name || '(unnamed)'}</div>
                            <div className="text-xs text-secondary-500">{page.page_id}</div>
                            {page.subscribe_error && (
                              <div className="text-xs text-red-600 mt-1">{page.subscribe_error}</div>
                            )}
                          </td>
                          <td><StatusPill ok={!!page.is_subscribed}>{page.is_subscribed ? 'Yes' : 'No'}</StatusPill></td>
                          <td className="text-sm">
                            {branchName(page.branch_id)
                              || <span className="text-secondary-400">Default</span>}
                          </td>
                          <td>
                            <div className="flex items-center gap-2 justify-end flex-wrap">
                            <button
                              className="secondary text-xs"
                              disabled={busy === `forms-${page.page_id}`}
                              onClick={() => run(`forms-${page.page_id}`,
                                () => api.post(`/meta/pages/${page.page_id}/forms/sync`, {}),
                                (r) => `${r.data.length} forms synced`)}
                            >
                              {busy === `forms-${page.page_id}` ? 'Syncing…' : 'Sync forms'}
                            </button>
                            {/* Stops this Page at Meta and forgets it, without
                                touching the leads it has already delivered. */}
                            <button
                              className="secondary text-xs inline-flex items-center gap-1 text-danger"
                              title={`Disconnect ${page.page_name || page.page_id}`}
                              disabled={busy === `drop-${page.page_id}`}
                              onClick={() => {
                                const label = page.page_name || page.page_id;
                                if (!window.confirm(`Disconnect "${label}"?\n\nIt stops receiving leads and is removed from the CRM along with its forms. Leads already imported are kept.`)) return;
                                run(`drop-${page.page_id}`,
                                  () => api.delete(`/meta/pages/${page.page_id}`),
                                  (r) => r.data?.warning || `${r.data?.name || label} disconnected`);
                              }}
                            >
                              {busy === `drop-${page.page_id}`
                                ? <Loader2 size={12} className="animate-spin" />
                                : <XCircle size={12} />}
                              Disconnect
                            </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. Forms */}
      <section className="panel card">
        <h3 className="card-title mb-1">4. Lead forms ({forms.length})</h3>
        <p className="text-xs text-secondary-500 mb-4">
          Send each form&apos;s leads to a specific branch, and check that its questions land
          on the right CRM fields. <strong>Backfill</strong> pulls in leads submitted before
          the form was connected.
        </p>
        {forms.length === 0 ? (
          <p className="text-sm text-secondary-600">No forms yet. Sync forms from a page above.</p>
        ) : (
          <div className="space-y-4">
            {forms.map((f) => (
              <div key={f.form_id} className="border border-border rounded-lg p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-semibold">{f.form_name || f.form_id}</div>
                    <div className="text-xs text-secondary-500">
                      Form {f.form_id} · Page {f.page_id}
                      {f.form_status ? ` · ${f.form_status}` : ''}
                    </div>
                  </div>
                  <div className="flex items-end gap-2 flex-wrap">
                    {/* Native select on purpose: this writes as soon as it
                        changes, and a type-ahead fires onChange while you are
                        still typing -- which would blank the branch mid-search. */}
                    <div className="w-[220px]">
                      <span className="label text-xs">Send leads to branch</span>
                      <select
                        className="input"
                        aria-label={`Branch for ${f.form_name || f.form_id}`}
                        value={String(f.branch_id ?? '')}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (String(value) === String(f.branch_id ?? '')) return;
                          run(`branch-${f.form_id}`,
                            () => api.patch(`/meta/forms/${f.form_id}`, { branchId: value || null }),
                            'Branch updated');
                        }}
                      >
                        <option value="">Use default branch</option>
                        {lookups.branches.map((b) => (
                          <option key={b.id} value={String(b.id)}>{b.name}</option>
                        ))}
                      </select>
                    </div>
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
                  <div className="mt-3 pt-3 border-t border-border">
                    <div className="text-xs font-semibold text-secondary-700 mb-2">
                      Form question → CRM field
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
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

      {/* 5. Ledger */}
      {/* Waiting leads sit above the history: what needs a decision comes
          before what has already been decided. */}
      <section className="panel card">
        <MetaLeadReview onMessage={handleReviewMessage} />
      </section>

      <section className="panel card">
        <h3 className="card-title mb-1">Recent imports</h3>
        <p className="text-xs text-secondary-500 mb-4">
          Every lead Meta has sent. Failed ones are kept and can be retried once the
          cause is fixed.
        </p>
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
