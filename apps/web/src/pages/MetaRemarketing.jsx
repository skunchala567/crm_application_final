import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Loader2, Pause, Play, Plus, RefreshCw, Trash2, Users, X, Eye, Download,
} from 'lucide-react';
import { api } from '../api';
import { recordDownload } from '../downloadAudit.js';
import './MetaLeadAdsFilters.css';

/*
 * Meta Remarketing: CRM leads as Meta Custom Audiences.
 *
 * An audience is a saved set of lead filters plus the Meta ad account it
 * belongs in. The CRM keeps the definition and the membership; Meta holds
 * only hashed identifiers, and every call to it happens on the server.
 */

const SYNC_INTERVALS = [
  ['daily', 'Daily'],
  ['every_6_hours', 'Every 6 hours'],
  ['every_12_hours', 'Every 12 hours'],
  ['weekly', 'Weekly'],
];

const fmt = (value) => (value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;

function downloadCsv(filename, columns, rows, dataset) {
  const csv = [columns.map((c) => csvCell(c.label)).join(','),
    ...rows.map((row) => columns.map((c) => csvCell(c.get(row))).join(','))].join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
  // Recorded so Bulk Actions can say who took what, and when.
  recordDownload(dataset || filename.replace(/\.csv$/, ''), rows.length, filename, { columns: columns.map((c) => c.label), content: csv });
}

function StatusPill({ status }) {
  const tone = { active: 'is-ok', draft: 'is-draft', paused: 'is-paused', error: 'is-error' }[status] || 'is-draft';
  return <span className={`rm-pill ${tone}`}>{status}</span>;
}

/* ---------------------------------------------------------------------
   Create / edit an audience.
   --------------------------------------------------------------------- */

function AudienceEditor({ meta, adAccounts, audience, onClose, onSaved, onMessage }) {
  const [form, setForm] = useState(() => ({
    name: audience?.name || '',
    description: audience?.description || '',
    adAccountId: audience?.adAccountId || adAccounts[0]?.adAccountId || '',
    syncType: audience?.syncType || 'manual',
    syncInterval: audience?.syncInterval || 'daily',
    filters: audience?.filters || {},
    excludeFilters: audience?.excludeFilters || {},
  }));
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [leads, setLeads] = useState(null);

  const setFilter = (key, value) => setForm((current) => ({
    ...current,
    filters: { ...current.filters, [key]: value === '' || (Array.isArray(value) && !value.length) ? undefined : value },
  }));

  /* The count is the point of the screen, so it refreshes as conditions
     change rather than waiting for a "preview" press. */
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api('/meta/audiences/preview', {
        method: 'POST',
        body: JSON.stringify({ filters: form.filters, excludeFilters: form.excludeFilters }),
      }).then((r) => { if (!cancelled) setPreview(r.data); }).catch(() => {});
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [form.filters, form.excludeFilters]);

  async function save() {
    if (!form.name.trim()) return onMessage({ type: 'error', text: 'Give the audience a name' });
    if (!form.adAccountId) return onMessage({ type: 'error', text: 'Choose a Meta ad account' });
    setBusy('save');
    try {
      if (audience?.id) await api(`/meta/audiences/${audience.id}`, { method: 'PUT', body: JSON.stringify(form) });
      else await api('/meta/audiences', { method: 'POST', body: JSON.stringify(form) });
      onMessage({ type: 'success', text: audience?.id ? 'Audience updated' : 'Audience created' });
      onSaved();
    } catch (error) {
      onMessage({ type: 'error', text: error.message });
    } finally { setBusy(''); }
  }

  const options = (list, labelKey = 'displayName') => (list || []).map((item) => ({
    value: String(item.id), label: item[labelKey] || item.name || item.displayName,
  }));

  const conditions = [
    ['Branch', 'branchId', options(meta.branches, 'name')],
    ['Lead stage', 'stageId', options(meta.stages)],
    ['Lead source', 'sourceId', options(meta.sources)],
    ['Class / grade', 'classId', options(meta.classes)],
    ['Curriculum', 'curriculumId', options(meta.curricula)],
    ['Campaign', 'campaignId', options(meta.campaigns)],
    ['Assigned user', 'ownerEmployeeId', options(meta.employees, 'name')],
  ];

  return (
    <div className="modal-overlay">
      <section className="modal-content rm-editor">
        <header className="modal-header">
          <div><h2>{audience?.id ? 'Edit audience' : 'Create audience'}</h2></div>
          <button type="button" onClick={onClose}><X size={20} /></button>
        </header>

        <div className="rm-editor-body">
          <div className="rm-grid">
            <label>Audience name *
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Admissions 2026 – Interested leads" />
            </label>
            <label>Meta ad account *
              <select value={form.adAccountId} onChange={(e) => setForm({ ...form, adAccountId: e.target.value })}>
                <option value="">Select ad account</option>
                {adAccounts.map((account) => (
                  <option key={account.adAccountId} value={account.adAccountId}>
                    {account.name || account.adAccountId}{account.currency ? ` · ${account.currency}` : ''}
                  </option>
                ))}
              </select>
              {!adAccounts.length && <small>No ad accounts yet — use “Discover ad accounts” on the Remarketing tab.</small>}
            </label>
            <label className="rm-wide">Description
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What this audience is for" />
            </label>
          </div>

          <h4>Lead filters</h4>
          <div className="rm-grid">
            {conditions.map(([label, key, opts]) => (
              <label key={key}>{label}
                <select
                  value={(form.filters[key] || [])[0] || ''}
                  onChange={(e) => setFilter(key, e.target.value ? [e.target.value] : [])}
                >
                  <option value="">Any</option>
                  {opts.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            ))}
            <label>Academic year
              <select value={(form.filters.academicYear || [])[0] || ''} onChange={(e) => setFilter('academicYear', e.target.value ? [e.target.value] : [])}>
                <option value="">Any</option>
                {(meta.academicYears || []).map((year) => (
                  <option key={year.academicYear || year} value={year.academicYear || year}>{year.displayName || year.academicYear || year}</option>
                ))}
              </select>
            </label>
            <label>Admission status
              <select value={form.filters.admissionStatus || ''} onChange={(e) => setFilter('admissionStatus', e.target.value)}>
                <option value="">Any</option>
                <option value="admitted">Admitted</option>
                <option value="not_admitted">Not admitted</option>
              </select>
            </label>
            <label>City
              <input value={(form.filters.city || [])[0] || ''} onChange={(e) => setFilter('city', e.target.value ? [e.target.value] : [])} placeholder="Any" />
            </label>
            <label>Created from
              <input type="date" value={form.filters.createdFrom || ''} onChange={(e) => setFilter('createdFrom', e.target.value)} />
            </label>
            <label>Created to
              <input type="date" value={form.filters.createdTo || ''} onChange={(e) => setFilter('createdTo', e.target.value)} />
            </label>
            <label>Meta leads only
              <select value={form.filters.metaOnly ? 'yes' : ''} onChange={(e) => setFilter('metaOnly', e.target.value === 'yes' ? true : '')}>
                <option value="">All CRM leads</option>
                <option value="yes">Only leads from Meta ads</option>
              </select>
            </label>
          </div>

          <h4>Exclude</h4>
          <div className="rm-grid rm-grid-fixed">
            <label>Exclude stage
              <select
                value={(form.excludeFilters.stageId || [])[0] || ''}
                onChange={(e) => setForm({ ...form, excludeFilters: e.target.value ? { ...form.excludeFilters, stageId: [e.target.value] } : {} })}
              >
                <option value="">Nothing excluded</option>
                {options(meta.stages).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>

          <h4>Sync</h4>
          <div className="rm-grid rm-grid-fixed">
            <label>Sync type
              <select value={form.syncType} onChange={(e) => setForm({ ...form, syncType: e.target.value })}>
                <option value="manual">Manual</option>
                <option value="automatic">Automatic</option>
              </select>
            </label>
            {form.syncType === 'automatic' && (
              <label>Frequency
                <select value={form.syncInterval} onChange={(e) => setForm({ ...form, syncInterval: e.target.value })}>
                  {SYNC_INTERVALS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            )}
          </div>

          {/* What will actually be sent, before anything is. */}
          <div className="rm-preview">
            <div>
              <strong>{form.name || 'Untitled audience'}</strong>
              <span>{preview ? `${preview.matched} matching leads · ${preview.eligible} eligible for Meta` : 'Counting…'}</span>
              {preview && preview.matched !== preview.eligible && (
                <small>{preview.matched - preview.eligible} have no email or phone, so Meta cannot match them.</small>
              )}
            </div>
            <button type="button" className="secondary" onClick={() => setLeads(preview?.sample || [])}>
              <Eye size={14} /> Preview leads
            </button>
          </div>

          {leads && (
            <div className="rm-preview-list">
              {leads.length === 0 ? <p>No leads match these conditions.</p> : leads.map((lead) => (
                <div key={lead.id}><span>{lead.name || `Lead ${lead.id}`}</span><small>{lead.matchKeys.join(', ') || 'no match keys'}</small></div>
              ))}
              {preview?.matched > leads.length && <p>Showing the first {leads.length} of {preview.matched}.</p>}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" disabled={busy === 'save'} onClick={save}>
            {busy === 'save' ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            {audience?.id ? 'Save changes' : 'Create audience'}
          </button>
        </div>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------
   The audience list.
   --------------------------------------------------------------------- */

export function MetaRemarketingAudiences({ meta, onMessage }) {
  const [audiences, setAudiences] = useState([]);
  const [adAccounts, setAdAccounts] = useState([]);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState('');
  const [viewing, setViewing] = useState(null);

  const load = useCallback(() => {
    api('/meta/audiences').then((r) => setAudiences(r.data || [])).catch((e) => onMessage({ type: 'error', text: e.message }));
    api('/meta/ad-accounts').then((r) => setAdAccounts(r.data || [])).catch(() => {});
  }, [onMessage]);

  useEffect(() => { load(); }, [load]);

  const run = async (key, work, done) => {
    setBusy(key);
    try { const result = await work(); onMessage({ type: 'success', text: done(result) }); load(); }
    catch (error) { onMessage({ type: 'error', text: error.message }); }
    finally { setBusy(''); }
  };

  async function viewLeads(audience) {
    try {
      const result = await api(`/meta/audiences/${audience.id}/leads`);
      setViewing({ audience, leads: result.data || [] });
    } catch (error) { onMessage({ type: 'error', text: error.message }); }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <h3 className="card-title">Remarketing audiences ({audiences.length})</h3>
        <div className="flex items-center gap-2">
          <button className="secondary panel-action" disabled={busy === 'accounts'}
            onClick={() => run('accounts', () => api('/meta/ad-accounts/sync', { method: 'POST', body: '{}' }),
              (r) => `${r.data.discovered} ad account(s) discovered`)}>
            {busy === 'accounts' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Discover ad accounts
          </button>
          <button className="secondary panel-action" disabled={!audiences.length}
            onClick={() => downloadCsv('meta-remarketing-audiences.csv', [
              { label: 'Audience', get: (a) => a.name },
              { label: 'Meta audience ID', get: (a) => a.metaAudienceId || '' },
              { label: 'Ad account', get: (a) => a.adAccountName || a.adAccountId },
              { label: 'CRM leads', get: (a) => a.crmLeadCount },
              { label: 'Synced', get: (a) => a.syncedLeadCount },
              { label: 'Sync type', get: (a) => a.syncType },
              { label: 'Status', get: (a) => a.status },
              { label: 'Last sync', get: (a) => fmt(a.lastSyncAt) },
              { label: 'Created by', get: (a) => a.createdBy || '' },
              { label: 'Created', get: (a) => fmt(a.createdAt) },
            ], audiences, 'Remarketing audiences')}>
            <Download size={14} /> Export
          </button>
          <button className="primary panel-action" onClick={() => setEditing({})}>
            <Plus size={14} /> Create audience
          </button>
        </div>
      </div>
      <p className="text-xs text-secondary-500 mb-4">
        An audience is a saved set of lead filters. Matching leads are hashed and uploaded to a Meta
        Custom Audience — the CRM never sends raw contact details, and every Meta call happens on the server.
      </p>

      {!audiences.length ? (
        <p className="text-sm text-secondary-600">No audiences yet. Create one to start remarketing to CRM leads.</p>
      ) : (
        <div className="table-wrap overflow-x-auto">
          <table className="table rm-audience-table">
            <thead>
              <tr>
                <th>Audience</th><th>Ad account</th><th className="num">CRM leads</th><th className="num">Synced</th>
                <th>Sync</th><th>Status</th><th>Last sync</th><th>Created</th><th />
              </tr>
            </thead>
            <tbody>
              {audiences.map((audience) => (
                <tr key={audience.id}>
                  <td>
                    <div className="font-semibold">{audience.name}</div>
                    <div className="text-xs text-secondary-500">
                      {audience.metaAudienceId ? `Meta ID ${audience.metaAudienceId}` : 'Not yet created at Meta'}
                    </div>
                    {audience.lastError && (
                      <div className="text-xs text-red-600 mt-1 rm-audience-error" title={audience.lastError}>
                        {audience.lastError}
                      </div>
                    )}
                  </td>
                  <td className="text-sm">{audience.adAccountName || audience.adAccountId}</td>
                  <td className="num">{audience.crmLeadCount}</td>
                  <td className="num">{audience.syncedLeadCount}</td>
                  <td className="text-xs">
                    {audience.syncType === 'automatic'
                      ? (SYNC_INTERVALS.find(([v]) => v === audience.syncInterval)?.[1] || 'Automatic')
                      : 'Manual'}
                  </td>
                  <td><StatusPill status={audience.status} /></td>
                  <td className="text-xs">{fmt(audience.lastSyncAt)}</td>
                  <td className="text-xs">{audience.createdBy || '—'}<br />{fmt(audience.createdAt)}</td>
                  <td>
                    <div className="rm-actions">
                      <button className="secondary text-xs" disabled={busy === `sync-${audience.id}`}
                        onClick={() => run(`sync-${audience.id}`, () => api(`/meta/audiences/${audience.id}/sync`, { method: 'POST', body: JSON.stringify({ mode: 'delta' }) }),
                          (r) => `Synced: ${r.data.added} added, ${r.data.removed} removed`)}>
                        {busy === `sync-${audience.id}` ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Sync
                      </button>
                      <button className="secondary text-xs" title="Re-upload every matching lead"
                        disabled={busy === `full-${audience.id}`}
                        onClick={() => run(`full-${audience.id}`, () => api(`/meta/audiences/${audience.id}/sync`, { method: 'POST', body: JSON.stringify({ mode: 'full' }) }),
                          (r) => `Refreshed: ${r.data.added} uploaded`)}>
                        Refresh
                      </button>
                      <button className="secondary text-xs" onClick={() => viewLeads(audience)}><Users size={12} /> Leads</button>
                      <button className="secondary text-xs" onClick={() => setEditing(audience)}>Edit</button>
                      <button className="secondary text-xs" disabled={busy === `pause-${audience.id}`}
                        onClick={() => run(`pause-${audience.id}`, () => api(`/meta/audiences/${audience.id}/pause`, { method: 'POST', body: JSON.stringify({ paused: audience.status !== 'paused' }) }),
                          (r) => (r.data.paused ? 'Sync paused' : 'Sync resumed'))}>
                        {audience.status === 'paused' ? <Play size={12} /> : <Pause size={12} />}
                        {audience.status === 'paused' ? 'Resume' : 'Pause'}
                      </button>
                      {/* Two questions, deliberately: removing the CRM
                          definition should not silently destroy an audience
                          that live ads may be targeting. */}
                      <button className="secondary text-xs text-danger" disabled={busy === `del-${audience.id}`}
                        onClick={() => {
                          if (!window.confirm(`Delete the CRM audience "${audience.name}"?`)) return;
                          const alsoMeta = audience.metaAudienceId
                            && window.confirm(`Also DELETE the Custom Audience at Meta (${audience.metaAudienceId})?\n\nAds currently targeting it will stop delivering. Cancel to keep it at Meta.`);
                          run(`del-${audience.id}`,
                            () => api(`/meta/audiences/${audience.id}?deleteMeta=${alsoMeta ? 'true' : 'false'}`, { method: 'DELETE' }),
                            (r) => r.data.warning || (r.data.metaDeleted ? 'Audience deleted here and at Meta' : 'Audience deleted from the CRM'));
                        }}>
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <AudienceEditor
          meta={meta} adAccounts={adAccounts} audience={editing.id ? editing : null}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} onMessage={onMessage}
        />
      )}

      {viewing && (
        <div className="modal-overlay">
          <section className="modal-content rm-editor">
            <header className="modal-header">
              <div><h2>{viewing.audience.name}</h2><p>{viewing.leads.length} matching leads</p></div>
              <button type="button" onClick={() => setViewing(null)}><X size={20} /></button>
            </header>
            <div className="rm-editor-body">
              <div className="table-wrap overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Lead</th><th>Match keys</th><th>Eligible</th><th>Sync status</th><th>Last synced</th></tr></thead>
                  <tbody>
                    {viewing.leads.map((lead) => (
                      <tr key={lead.id}>
                        <td><div className="font-semibold">{lead.name || `Lead ${lead.id}`}</div><div className="text-xs text-secondary-500">{lead.city || ''}</div></td>
                        <td className="text-xs">{lead.matchKeys.join(', ') || '—'}</td>
                        <td>{lead.eligible ? <CheckCircle2 size={15} className="text-emerald-600" /> : <AlertCircle size={15} className="text-amber-600" />}</td>
                        <td className="text-xs">{lead.syncStatus}</td>
                        <td className="text-xs">{fmt(lead.lastSyncedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="modal-footer"><button type="button" onClick={() => setViewing(null)}>Close</button></div>
          </section>
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------------
   Sync history.
   --------------------------------------------------------------------- */

export function MetaSyncHistory({ onMessage }) {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState({ q: '', status: '' });

  const load = useCallback(() => {
    api('/meta/sync-logs').then((r) => setLogs(r.data || [])).catch((e) => onMessage({ type: 'error', text: e.message }));
  }, [onMessage]);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = filter.q.trim().toLowerCase();
    return logs.filter((log) => (!q || `${log.audienceName} ${log.metaAudienceId || ''}`.toLowerCase().includes(q))
      && (!filter.status || log.status === filter.status));
  }, [logs, filter]);

  return (
    <>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <h3 className="card-title">Sync history ({logs.length})</h3>
        <div className="flex items-center gap-2">
          <button className="secondary panel-action" disabled={!visible.length}
            onClick={() => downloadCsv('meta-remarketing-sync-history.csv', [
              { label: 'Audience', get: (l) => l.audienceName },
              { label: 'Meta audience ID', get: (l) => l.metaAudienceId || '' },
              { label: 'Action', get: (l) => l.action },
              { label: 'Status', get: (l) => l.status },
              { label: 'Started', get: (l) => fmt(l.startedAt) },
              { label: 'Completed', get: (l) => fmt(l.completedAt) },
              { label: 'Considered', get: (l) => l.leadsConsidered },
              { label: 'Added', get: (l) => l.leadsAdded },
              { label: 'Removed', get: (l) => l.leadsRemoved },
              { label: 'Failed', get: (l) => l.leadsFailed },
              { label: 'Skipped', get: (l) => l.leadsSkipped },
              { label: 'Triggered by', get: (l) => `${l.triggeredBy}${l.triggeredByUser ? ` (${l.triggeredByUser})` : ''}` },
              { label: 'Error', get: (l) => l.errorMessage || '' },
            ], visible, 'Remarketing sync history')}>
            <Download size={14} /> Export
          </button>
          <button className="secondary panel-action" onClick={load}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      <div className="meta-filter-bar">
        <label className="meta-filter-search">
          <input value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} placeholder="Search audience or Meta ID…" />
        </label>
        <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} aria-label="Status">
          <option value="">Any status</option>
          {['completed', 'partial', 'failed', 'running'].map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        {visible.length !== logs.length && (
          <span className="meta-filter-count">{visible.length} of {logs.length}
            <button type="button" onClick={() => setFilter({ q: '', status: '' })}><X size={13} /></button>
          </span>
        )}
      </div>

      {!visible.length ? (
        <p className="text-sm text-secondary-600">{logs.length ? 'No runs match these filters.' : 'No syncs have run yet.'}</p>
      ) : (
        <div className="table-wrap overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Audience</th><th>Action</th><th>Status</th><th>Started</th><th>Completed</th>
                <th className="num">Considered</th><th className="num">Added</th><th className="num">Removed</th>
                <th className="num">Failed</th><th>Triggered by</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((log) => (
                <tr key={log.id}>
                  <td>
                    <div className="font-semibold">{log.audienceName}</div>
                    <div className="text-xs text-secondary-500">{log.metaAudienceId || 'not created at Meta'}</div>
                    {log.errorMessage && (
                      <div className="text-xs text-red-600 mt-1 rm-audience-error" title={log.errorMessage}>
                        {log.errorMessage}
                      </div>
                    )}
                  </td>
                  <td className="text-xs">{log.action}</td>
                  <td><StatusPill status={log.status === 'completed' ? 'active' : log.status === 'failed' ? 'error' : 'draft'} /></td>
                  <td className="text-xs">{fmt(log.startedAt)}</td>
                  <td className="text-xs">{fmt(log.completedAt)}</td>
                  <td className="num">{log.leadsConsidered}</td>
                  <td className="num">{log.leadsAdded}</td>
                  <td className="num">{log.leadsRemoved}</td>
                  <td className="num">{log.leadsFailed}</td>
                  <td className="text-xs">{log.triggeredBy}{log.triggeredByUser ? ` · ${log.triggeredByUser}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
