import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Copy, Download,
  LayoutList, Link2, Loader2, Plus, RefreshCw, Save, Search, ShieldCheck, Users, X, XCircle,
} from 'lucide-react';
import { api } from '../api';
import { SearchSelect } from '../FilterWorkspace.jsx';
import './MetaLeadAdsFilters.css';
import { recordDownload } from '../downloadAudit.js';

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

export const CRM_FIELDS = [
  { value: '', label: '— Ignore —' },
  { value: 'studentName', label: 'Student name' },
  { value: 'firstName', label: 'First name' },
  { value: 'lastName', label: 'Last name' },
  { value: 'phone', label: 'Phone' },
  { value: 'alternatePhone', label: 'Alternate phone' },
  { value: 'email', label: 'Email' },
  { value: 'parentName', label: 'Parent name' },
  { value: 'city', label: 'City' },
  /* The rest of what a Meta Custom Audience matches on. Mapping a form's
     state/pincode question here raises the audience match rate; leaving it
     unmapped only means the answer stays in the lead's remarks. */
  { value: 'state', label: 'State' },
  { value: 'postalCode', label: 'PIN / postal code' },
  { value: 'country', label: 'Country' },
  { value: 'applyingClass', label: 'Applying class' },
  { value: 'academicYear', label: 'Academic year' },
];

export function StatusPill({ ok, children }) {
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
export function Field({ label, hint, required, error, children }) {
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

/* ---------------------------------------------------------------------
   Shared bits for the tabbed lists below: one CSV writer, one paginator.
   Both follow what Leads and WhatsApp Templates already do, so the controls
   look and behave the same wherever they appear.
   --------------------------------------------------------------------- */

const PAGE_SIZES = [10, 20, 50];

/** Every value quoted, so a comma or a newline in a form name cannot shift columns. */
const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;

export function downloadCsv(filename, columns, rows, dataset) {
  const csv = [
    columns.map((c) => csvCell(c.label)).join(','),
    ...rows.map((row) => columns.map((c) => csvCell(c.get(row))).join(',')),
  ].join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
  // Recorded so Bulk Actions can say who took what, and when.
  recordDownload(dataset || filename.replace(/\.csv$/, ''), rows.length, filename, { columns: columns.map((c) => c.label), content: csv });
}

/*
 * One filter row, shared by the three list tabs.
 *
 * A free-text box plus as many dropdowns as the list needs. Everything
 * filters in the browser -- these lists are already loaded whole, so a
 * round trip per keystroke would buy nothing.
 */
export function FilterBar({ search, onSearch, placeholder, selects = [], showing, total, onClear }) {
  const filtered = showing !== total;
  return (
    <div className="meta-filter-bar">
      <label className="meta-filter-search">
        <Search size={15} />
        <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder} />
      </label>
      {selects.map((select) => (
        <select key={select.label} value={select.value} onChange={(e) => select.onChange(e.target.value)} aria-label={select.label}>
          <option value="">{select.label}</option>
          {select.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ))}
      {/* Only when something is actually hidden: a count that always reads
          "6 of 6" is noise, and a clear button with nothing to clear is worse. */}
      {filtered && (
        <span className="meta-filter-count">
          {showing} of {total}
          <button type="button" onClick={onClear} title="Clear filters"><X size={13} /></button>
        </span>
      )}
    </div>
  );
}

export function ExportButton({ onClick, disabled }) {
  return (
    <button
      className="secondary inline-flex items-center gap-2"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Nothing to export' : 'Download this list as CSV'}
    >
      <Download size={14} /> Export
    </button>
  );
}

/** Slices a list and hands back what the bar below needs to describe it. */
export function usePaged(rows, initialSize = 10) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(initialSize);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  // Clamped rather than reset: deleting the last row of page 3 should land on
  // page 2, not throw the reader back to the top of the list.
  const current = Math.min(page, pages);
  const start = (current - 1) * size;
  return {
    slice: rows.slice(start, start + size),
    bar: { total, page: current, pages, size, from: total ? start + 1 : 0, to: Math.min(start + size, total),
      onPage: setPage, onSize: (next) => { setSize(next); setPage(1); } },
  };
}

/*
 * One Facebook account's Pages.
 *
 * A component rather than JSX inside the map: each account paginates its own
 * table, and a hook cannot be called from inside a loop.
 */
function AccountPagesTable({ group, children }) {
  const paged = usePaged(group.pages);
  return (
    <>
      <div className="table-wrap overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th>Page</th><th>Receiving leads</th><th>Destination</th><th>Forms</th></tr>
          </thead>
          <tbody>{paged.slice.map(children)}</tbody>
        </table>
      </div>
      <PaginationBar {...paged.bar} />
    </>
  );
}

export function PaginationBar({ total, page, pages, size, from, to, onPage, onSize }) {
  // One page of results needs no controls to move between pages.
  if (total <= PAGE_SIZES[0]) return null;
  return (
    <div className="pagination-controls">
      <div className="page-size-selector">
        <label>Records per page:</label>
        <select value={size} onChange={(e) => onSize(Number(e.target.value))}>
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div className="pagination-info">Showing {from} to {to} of {total} records</div>
      <div className="pagination-buttons">
        <button className="pagination-btn" title="First page" disabled={page === 1} onClick={() => onPage(1)}>&lsaquo;&lsaquo;</button>
        <button className="pagination-btn" title="Previous page" disabled={page === 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></button>
        <div className="page-indicator">Page {page} of {pages}</div>
        <button className="pagination-btn" title="Next page" disabled={page === pages} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></button>
        <button className="pagination-btn" title="Last page" disabled={page === pages} onClick={() => onPage(pages)}>&rsaquo;&rsaquo;</button>
      </div>
    </div>
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
  const [lookups, setLookups] = useState({ users: [], branches: [], businessUnits: [], pipelines: [], stages: [], substages: [] });

  const [pages, setPages] = useState([]);
  const [forms, setForms] = useState([]);
  const [ledger, setLedger] = useState({ counts: {}, imports: [] });

  // Adding a second Facebook account: its token is used once for discovery.
  /* One section at a time. The screen carried six of them stacked, so
     checking a form's mapping meant scrolling past the credentials and the
     whole page list to get there. */
  const [tab, setTab] = useState('connect');
  const [pageFilter, setPageFilter] = useState({ q: '', account: '', subscribed: '', branch: '' });
  const [formFilter, setFormFilter] = useState({ q: '', page: '', status: '', mapped: '', unit: '' });
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
  /* Branches are not owned by a business unit -- the two are independent
     dimensions of where a lead lands -- so a Meta Page or form has to name
     both, and both are shown wherever a destination is displayed. */
  const unitName = useCallback(
    (id) => lookups.businessUnits.find((u) => String(u.id) === String(id))?.name || null,
    [lookups.businessUnits],
  );

  const branchName = useCallback(
    (id) => lookups.branches.find((b) => String(b.id) === String(id))?.name || null,
    [lookups.branches],
  );

  /*
   * Stages this form may route to, labelled by their pipeline.
   *
   * Narrowed to the business unit the form is bound to -- offering a stage
   * from another unit would send the lead somewhere the unit's own screens
   * never show it. The pipeline name is on every label because that is the
   * thing being chosen; the stage is only how it is chosen.
   */
  const stageOptionsFor = useCallback((form) => {
    const unitId = form.business_unit_id
      || pages.find((p) => String(p.page_id) === String(form.page_id))?.business_unit_id
      || routing.defaultBusinessUnitId;
    const pipelines = (lookups.pipelines || []).filter((p) => !unitId || String(p.businessUnitId) === String(unitId));
    const byId = new Map(pipelines.map((p) => [String(p.id), p.name]));
    return (lookups.stages || [])
      .filter((stage) => byId.has(String(stage.pipelineId)))
      .map((stage) => ({ id: stage.id, label: `${byId.get(String(stage.pipelineId))} · ${stage.name}` }));
  }, [lookups.pipelines, lookups.stages, pages, routing.defaultBusinessUnitId]);

  /* Mirrors resolveRouting on the server: a form's own value wins, then the
     Page's, then the global default. Shown so an admin can see where a lead
     actually lands without holding all three levels in their head. */
  const effectiveDestination = useCallback((form) => {
    const page = pages.find((p) => String(p.page_id) === String(form.page_id));
    const unitId = form.business_unit_id ?? page?.business_unit_id ?? routing.defaultBusinessUnitId;
    const branchId = form.branch_id ?? page?.branch_id ?? routing.defaultBranchId;
    const source = form.business_unit_id || form.branch_id ? 'form'
      : (page?.business_unit_id || page?.branch_id) ? 'page' : 'default';
    return { unitId, branchId, unit: unitName(unitId), branch: branchName(branchId), source };
  }, [pages, routing.defaultBusinessUnitId, routing.defaultBranchId, unitName, branchName]);

  /* What each list shows after its filters. The lists are already loaded in
     full, so this is a filter over what is in hand rather than a refetch. */
  const visiblePages = useMemo(() => {
    const q = pageFilter.q.trim().toLowerCase();
    return pages.filter((page) => (
      (!q || `${page.page_name || ''} ${page.page_id}`.toLowerCase().includes(q))
      && (!pageFilter.account || String(page.meta_account_id || '') === pageFilter.account)
      && (!pageFilter.subscribed || (pageFilter.subscribed === 'yes') === Boolean(page.is_subscribed))
      && (!pageFilter.branch || String(page.branch_id || '') === pageFilter.branch)
    ));
  }, [pages, pageFilter]);

  const visibleForms = useMemo(() => {
    const q = formFilter.q.trim().toLowerCase();
    return forms.filter((form) => {
      const mapped = Object.keys(form.field_mapping || {}).length > 0;
      return (!q || `${form.form_name || ''} ${form.form_id}`.toLowerCase().includes(q))
        && (!formFilter.page || String(form.page_id) === formFilter.page)
        && (!formFilter.status || String(form.form_status || '').toUpperCase() === formFilter.status)
        && (!formFilter.mapped || (formFilter.mapped === 'yes') === mapped)
        && (!formFilter.unit || String(effectiveDestination(form).unitId ?? '') === formFilter.unit);
    });
  }, [forms, formFilter, effectiveDestination]);

  const accountGroups = useMemo(() => {
    const groups = new Map();
    for (const page of visiblePages) {
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
  }, [visiblePages]);

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



  const loadAll = useCallback(async () => {
    setError('');
    try {
      const [configRes, lookupRes, pagesRes, formsRes, importsRes] = await Promise.all([
        api.get('/meta/config'),
        api.get('/meta/lookups').catch(() => ({ data: { users: [], branches: [], businessUnits: [], pipelines: [], stages: [], substages: [] } })),
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

  /* Each list paginates on its own, so a long form list does not drag the
     pages tab with it. */
  const pagedForms = usePaged(visibleForms);
  const pagedImports = usePaged(ledger.imports || []);

  const exportPages = () => downloadCsv('meta-facebook-pages.csv', [
    { label: 'Account', get: (r) => r.meta_account_name || r.meta_account_id || '' },
    { label: 'Page', get: (r) => r.page_name || '' },
    { label: 'Page ID', get: (r) => r.page_id },
    { label: 'Receiving leads', get: (r) => (r.is_subscribed ? 'Yes' : 'No') },
    { label: 'Business unit', get: (r) => unitName(r.business_unit_id) || 'Default' },
    { label: 'Branch', get: (r) => branchName(r.branch_id) || 'Default' },
    { label: 'Forms', get: (r) => forms.filter((f) => String(f.page_id) === String(r.page_id)).length },
    { label: 'Last error', get: (r) => r.subscribe_error || '' },
  ], pages, 'Facebook pages');

  const exportForms = () => downloadCsv('meta-lead-forms.csv', [
    { label: 'Form', get: (r) => r.form_name || '' },
    { label: 'Form ID', get: (r) => r.form_id },
    { label: 'Page', get: (r) => pages.find((p) => String(p.page_id) === String(r.page_id))?.page_name || '' },
    { label: 'Page ID', get: (r) => r.page_id },
    { label: 'Status', get: (r) => r.form_status || '' },
    { label: 'Business unit', get: (r) => unitName(r.business_unit_id) || 'Default' },
    { label: 'Branch', get: (r) => branchName(r.branch_id) || 'Default' },
    // Where a lead actually lands once the page and global defaults apply.
    { label: 'Effective unit', get: (r) => effectiveDestination(r).unit || '' },
    { label: 'Effective branch', get: (r) => effectiveDestination(r).branch || '' },
    { label: 'Mapped questions', get: (r) => Object.keys(r.field_mapping || {}).length },
  ], forms);

  const exportImports = () => downloadCsv('meta-recent-imports.csv', [
    { label: 'Leadgen ID', get: (r) => r.leadgen_id },
    { label: 'Campaign', get: (r) => r.campaign_name || '' },
    { label: 'Ad set', get: (r) => r.adgroup_name || '' },
    { label: 'Ad', get: (r) => r.ad_name || '' },
    { label: 'Status', get: (r) => r.status || '' },
    { label: 'Lead', get: (r) => r.lead_number || '' },
    { label: 'Error', get: (r) => r.error_message || '' },
    { label: 'Received', get: (r) => (r.created_at_utc ? new Date(r.created_at_utc).toLocaleString() : '') },
  ], ledger.imports || [], 'Meta recent imports');

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

      <div className="config-tabs academic-config-tabs" role="tablist" aria-label="Meta Lead Ads">
        {[
          ['connect', 'Connect to Meta', Link2],
          ['pages', `Facebook pages (${pages.length})`, LayoutList],
          ['imports', 'Recent imports', RefreshCw],
        ].map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* 1. Connection */}
      {tab === 'connect' && (
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
      )}

      {/* 2. Routing */}

      {/* 3. Pages, grouped by the Facebook account they were connected through */}
      {tab === 'pages' && (
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
            <ExportButton onClick={exportPages} disabled={!pages.length} />
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

        <FilterBar
          search={pageFilter.q}
          onSearch={(q) => setPageFilter({ ...pageFilter, q })}
          placeholder="Search page name or ID…"
          showing={visiblePages.length}
          total={pages.length}
          onClear={() => setPageFilter({ q: '', account: '', subscribed: '', branch: '' })}
          selects={[
            { label: 'All accounts', value: pageFilter.account, onChange: (v) => setPageFilter({ ...pageFilter, account: v }),
              options: [...new Map(pages.map((p) => [String(p.meta_account_id || ''), p.meta_account_name || p.meta_account_id || 'Unknown'])).entries()]
                .map(([value, label]) => ({ value, label })) },
            { label: 'Receiving leads: any', value: pageFilter.subscribed, onChange: (v) => setPageFilter({ ...pageFilter, subscribed: v }),
              options: [{ value: 'yes', label: 'Receiving leads' }, { value: 'no', label: 'Not receiving' }] },
            { label: 'All branches', value: pageFilter.branch, onChange: (v) => setPageFilter({ ...pageFilter, branch: v }),
              options: [...new Map(pages.map((p) => [String(p.branch_id || ''), branchName(p.branch_id) || 'Default'])).entries()]
                .map(([value, label]) => ({ value, label })) },
          ]}
        />
        {pages.length === 0 ? (
          <p className="text-sm text-secondary-600">
            No pages yet. Save credentials and re-sync, or add a Facebook account above.
          </p>
        ) : (
          <div className="space-y-5">
            {!visiblePages.length && (
              <p className="text-sm text-secondary-600">No pages match these filters.</p>
            )}
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

                <AccountPagesTable group={group}>
                  {(page) => (
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
                            {/* Both halves of where this Page's leads go. A
                                form can still override either one. */}
                            <div>{unitName(page.business_unit_id)
                              || <span className="text-secondary-400">Default unit</span>}</div>
                            <div className="text-xs text-secondary-500">
                              {branchName(page.branch_id) || 'Default branch'}
                            </div>
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
                  )}
                </AccountPagesTable>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {/* 4. Forms */}

      {/* 5. Waiting for review */}

      {/* 6. Recent imports */}
      {tab === 'imports' && (
      <section className="panel card">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
          <h3 className="card-title">6. Recent imports</h3>
          <ExportButton onClick={exportImports} disabled={!(ledger.imports || []).length} />
        </div>
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
                <tr><th>Leadgen ID</th><th>Status</th><th>Lead</th><th>Campaign</th><th>Detail</th><th>When</th></tr>
              </thead>
              <tbody>
                {pagedImports.slice.map((row) => (
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
                    {/* Which advertisement produced this lead, by name rather
                        than by Meta's numeric id. */}
                    <td className="text-xs">
                      {row.campaign_name || '—'}
                      {row.ad_name && <div className="text-secondary-500">{row.ad_name}</div>}
                    </td>
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
        <PaginationBar {...pagedImports.bar} />
      </section>
      )}
    </div>
  );
}
