import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { api } from '../api';
import {
  CRM_FIELDS, ExportButton, FilterBar, PaginationBar, downloadCsv, usePaged,
} from './MetaLeadAdsSettings.jsx';
import './MetaLeadAdsFilters.css';

/**
 * Meta lead forms, and where each one's leads go.
 *
 * Lifted out of the Meta Lead Ads settings screen so it can live on
 * Automations: choosing a form's destination and checking its field mapping
 * is day-to-day work, not part of setting the integration up. It loads its
 * own data rather than taking it from a parent, so it can be dropped onto
 * any screen.
 */
export default function MetaLeadForms({ onMessage }) {
  const [forms, setForms] = useState([]);
  const [pages, setPages] = useState([]);
  const [lookups, setLookups] = useState({ users: [], branches: [], businessUnits: [], pipelines: [], stages: [], substages: [] });
  const [routing, setRouting] = useState({ defaultBranchId: '', defaultBusinessUnitId: '', actorUserId: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [formFilter, setFormFilter] = useState({ q: '', page: '', status: '', mapped: '', unit: '' });

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [formResult, pageResult, lookupResult, configResult] = await Promise.all([
        api.get('/meta/forms').catch(() => ({ data: [] })),
        api.get('/meta/pages').catch(() => ({ data: [] })),
        api.get('/meta/lookups').catch(() => ({ data: { users: [], branches: [], businessUnits: [], pipelines: [], stages: [], substages: [] } })),
        api.get('/meta/config').catch(() => ({ data: null })),
      ]);
      setForms(formResult.data || []);
      setPages(pageResult.data || []);
      setLookups(lookupResult.data || {});
      const config = configResult.data?.config || configResult.data || {};
      setRouting({
        defaultBranchId: config.defaultBranchId ?? '',
        defaultBusinessUnitId: config.defaultBusinessUnitId ?? '',
        actorUserId: config.actorUserId ?? '',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  /** Runs one action, reports it, and refreshes what it changed. */
  const run = async (key, action, success) => {
    setBusy(key);
    try {
      const result = await action();
      onMessage?.({ type: 'success', text: typeof success === 'function' ? success(result) : success });
      await loadAll();
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    } finally {
      setBusy('');
    }
  };

  /*
   * Sync every connected Page at once.
   *
   * Meta has no "all my forms" endpoint -- forms belong to a Page -- so this
   * walks the Pages this CRM knows about. One Page failing (a revoked token,
   * a Page removed at Meta) must not stop the others, so each is caught and
   * counted rather than thrown.
   */
  async function syncAllForms() {
    setBusy('sync-forms');
    let synced = 0;
    const failed = [];
    for (const page of pages) {
      try {
        const result = await api.post(`/meta/pages/${page.page_id}/forms/sync`, {});
        synced += (result.data || []).length;
      } catch (error) {
        failed.push(`${page.page_name || page.page_id}: ${error.message}`);
      }
    }
    await loadAll();
    setBusy('');
    onMessage?.({
      type: failed.length ? 'error' : 'success',
      text: failed.length
        ? `${synced} form${synced === 1 ? '' : 's'} synced. ${failed.length} page${failed.length === 1 ? '' : 's'} failed — ${failed[0]}`
        : `${synced} form${synced === 1 ? '' : 's'} synced from ${pages.length} page${pages.length === 1 ? '' : 's'}`,
    });
  }

  /* Saves one question's target. Sent as the whole mapping because the API
     replaces field_mapping wholesale. */
  async function updateMapping(form, question, crmField) {
    const next = { ...(form.field_mapping || {}) };
    if (crmField) next[question] = crmField; else delete next[question];
    await run(`map-${form.form_id}-${question}`,
      () => api.patch(`/meta/forms/${form.form_id}`, { fieldMapping: next }),
      crmField ? 'Field mapping updated' : 'Question left unmapped');
  }

  const unitName = useCallback(
    (id) => lookups.businessUnits?.find((u) => String(u.id) === String(id))?.name || null,
    [lookups.businessUnits],
  );
  const branchName = useCallback(
    (id) => lookups.branches?.find((b) => String(b.id) === String(id))?.name || null,
    [lookups.branches],
  );

  /* Mirrors resolveRouting on the server: a form's own value wins, then the
     Page's, then the global default. */
  const effectiveDestination = useCallback((form) => {
    const page = pages.find((p) => String(p.page_id) === String(form.page_id));
    const unitId = form.business_unit_id ?? page?.business_unit_id ?? routing.defaultBusinessUnitId;
    const branchId = form.branch_id ?? page?.branch_id ?? routing.defaultBranchId;
    const source = form.business_unit_id || form.branch_id ? 'form'
      : (page?.business_unit_id || page?.branch_id) ? 'page' : 'default';
    return { unitId, branchId, unit: unitName(unitId), branch: branchName(branchId), source };
  }, [pages, routing.defaultBusinessUnitId, routing.defaultBranchId, unitName, branchName]);

  /* Stages this form may route to, labelled by their pipeline and narrowed to
     the unit the form is bound to. */
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

  const pagedForms = usePaged(visibleForms);

  const exportForms = () => downloadCsv('meta-lead-forms.csv', [
    { label: 'Form', get: (r) => r.form_name || '' },
    { label: 'Form ID', get: (r) => r.form_id },
    { label: 'Page', get: (r) => pages.find((p) => String(p.page_id) === String(r.page_id))?.page_name || '' },
    { label: 'Page ID', get: (r) => r.page_id },
    { label: 'Status', get: (r) => r.form_status || '' },
    { label: 'Business unit', get: (r) => unitName(r.business_unit_id) || 'Default' },
    { label: 'Branch', get: (r) => branchName(r.branch_id) || 'Default' },
    { label: 'Effective unit', get: (r) => effectiveDestination(r).unit || '' },
    { label: 'Effective branch', get: (r) => effectiveDestination(r).branch || '' },
    { label: 'Mapped questions', get: (r) => Object.keys(r.field_mapping || {}).length },
  ], forms, 'Meta lead forms');

  if (loading) return <div className="loading"><span /></div>;

  return (
      <section className="panel card">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
          <h3 className="card-title">Meta lead forms ({forms.length})</h3>
          <div className="flex items-center gap-2">
            {/* Pulls every connected Page's forms again, so a form created in
                Ads Manager after the Page was connected -- or one that has
                since been archived -- shows up without reconnecting anything. */}
            <button className="secondary panel-action" disabled={busy === 'sync-forms' || !pages.length}
              title={pages.length ? 'Fetch new forms and refresh their status from Meta' : 'Connect a Facebook page first'}
              onClick={syncAllForms}>
              {busy === 'sync-forms' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Sync forms from Meta
            </button>
            <ExportButton onClick={exportForms} disabled={!forms.length} />
          </div>
        </div>
        <p className="text-xs text-secondary-500 mb-4">
          Send each form&apos;s leads to a business unit, pipeline stage and branch, and check
          that its questions land on the right CRM fields. <strong>Sync forms from Meta</strong>
          fetches forms added since the Page was connected; <strong>Backfill</strong> pulls in
          leads submitted before the form was connected.
        </p>
        <FilterBar
          search={formFilter.q}
          onSearch={(q) => setFormFilter({ ...formFilter, q })}
          placeholder="Search form name or ID…"
          showing={visibleForms.length}
          total={forms.length}
          onClear={() => setFormFilter({ q: '', page: '', status: '', mapped: '' })}
          selects={[
            { label: 'All pages', value: formFilter.page, onChange: (v) => setFormFilter({ ...formFilter, page: v }),
              options: [...new Map(forms.map((f) => [String(f.page_id), pages.find((p) => String(p.page_id) === String(f.page_id))?.page_name || f.page_id])).entries()]
                .map(([value, label]) => ({ value, label })) },
            { label: 'Any status', value: formFilter.status, onChange: (v) => setFormFilter({ ...formFilter, status: v }),
              options: [...new Set(forms.map((f) => String(f.form_status || '').toUpperCase()).filter(Boolean))]
                .map((value) => ({ value, label: value })) },
            /* Which forms still have questions landing nowhere -- the thing
               most worth finding on this tab. */
            { label: 'Mapping: any', value: formFilter.mapped, onChange: (v) => setFormFilter({ ...formFilter, mapped: v }),
              options: [{ value: 'yes', label: 'Questions mapped' }, { value: 'no', label: 'Not mapped yet' }] },
            /* Matches on where a lead actually lands, defaults included --
               filtering on the stored column alone would show nothing until
               every form had been set explicitly. */
            { label: 'Any business unit', value: formFilter.unit, onChange: (v) => setFormFilter({ ...formFilter, unit: v }),
              options: lookups.businessUnits.map((u) => ({ value: String(u.id), label: u.name })) },
          ]}
        />
        {forms.length === 0 ? (
          <p className="text-sm text-secondary-600">No forms yet. Sync forms from a page above.</p>
        ) : (
          <div className="space-y-4">
            {!visibleForms.length && (
              <p className="text-sm text-secondary-600">No forms match these filters.</p>
            )}
            {pagedForms.slice.map((f) => (
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
                    {/* Where this form's leads land: business unit and branch.
                        Both are needed -- a branch does not belong to a unit,
                        so naming only the branch left every lead in whichever
                        unit happened to be the global default.

                        Native selects on purpose: these write as soon as they
                        change, and a type-ahead fires onChange while you are
                        still typing -- which would blank the value mid-search. */}
                    <div className="w-[190px]">
                      <span className="label text-xs">Business unit</span>
                      <select
                        className="input"
                        aria-label={`Business unit for ${f.form_name || f.form_id}`}
                        value={String(f.business_unit_id ?? '')}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (String(value) === String(f.business_unit_id ?? '')) return;
                          run(`unit-${f.form_id}`,
                            () => api.patch(`/meta/forms/${f.form_id}`, { businessUnitId: value || null }),
                            'Business unit updated');
                        }}
                      >
                        <option value="">Use default unit</option>
                        {lookups.businessUnits.map((u) => (
                          <option key={u.id} value={String(u.id)}>{u.name}</option>
                        ))}
                      </select>
                    </div>
                    {/* Stage decides the pipeline: whichever pipeline the
                        chosen stage belongs to is where this form's leads
                        land. Pick a sub-stage to be more specific still. */}
                    <div className="w-[190px]">
                      <span className="label text-xs">Stage (sets pipeline)</span>
                      <select
                        className="input"
                        aria-label={`Stage for ${f.form_name || f.form_id}`}
                        value={String(f.stage_id ?? '')}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (String(value) === String(f.stage_id ?? '')) return;
                          run(`stage-${f.form_id}`,
                            () => api.patch(`/meta/forms/${f.form_id}`, { stageId: value || null, substageId: null }),
                            'Stage updated');
                        }}
                      >
                        <option value="">Use default stage</option>
                        {stageOptionsFor(f).map((stage) => (
                          <option key={stage.id} value={String(stage.id)}>{stage.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="w-[190px]">
                      <span className="label text-xs">Sub-stage</span>
                      <select
                        className="input"
                        aria-label={`Sub-stage for ${f.form_name || f.form_id}`}
                        value={String(f.substage_id ?? '')}
                        disabled={!f.stage_id}
                        title={f.stage_id ? undefined : 'Choose a stage first'}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (String(value) === String(f.substage_id ?? '')) return;
                          run(`substage-${f.form_id}`,
                            () => api.patch(`/meta/forms/${f.form_id}`, { substageId: value || null }),
                            'Sub-stage updated');
                        }}
                      >
                        <option value="">Use default sub-stage</option>
                        {(lookups.substages || []).filter((item) => String(item.stageId) === String(f.stage_id)).map((item) => (
                          <option key={item.id} value={String(item.id)}>{item.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="w-[190px]">
                      <span className="label text-xs">Branch</span>
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

                {/* Every question this form asks, whether mapped or not.
                    It used to list only questions already in field_mapping,
                    so a form with nothing mapped -- which was all of them --
                    offered nothing to map. The question list now comes from
                    the form itself, fetched on sync. */}
                {(() => {
                  const questions = (f.questions || []).map(q => q.key).filter(Boolean);
                  const mappedOnly = Object.keys(f.field_mapping || {}).filter(key => !questions.includes(key));
                  const all = [...questions, ...mappedOnly];
                  if (!all.length) {
                    return (
                      <p className="text-xs text-secondary-500 mt-3 pt-3 border-t border-border">
                        No questions known for this form yet — use <strong>Sync forms from Meta</strong> to fetch them.
                      </p>
                    );
                  }
                  const mappedCount = Object.keys(f.field_mapping || {}).length;
                  return (
                    <div className="mt-3 pt-3 border-t border-border">
                      <div className="text-xs font-semibold text-secondary-700 mb-2">
                        Form question → CRM field
                        <span className="font-normal text-secondary-500"> · {mappedCount} of {all.length} mapped</span>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {all.map((question) => {
                          const label = (f.questions || []).find(q => q.key === question)?.label || question;
                          return (
                            <label key={question} className="flex items-center gap-2 text-xs">
                              <span className="flex-1 truncate text-secondary-700" title={`${label} (${question})`}>{label}</span>
                              <select
                                className="input py-1 text-xs w-40"
                                disabled={busy === `map-${f.form_id}-${question}`}
                                value={(f.field_mapping || {})[question] || ''}
                                onChange={(e) => updateMapping(f, question, e.target.value)}
                              >
                                {CRM_FIELDS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </label>
                          );
                        })}
                      </div>
                      <p className="text-xs text-secondary-500 mt-2">
                        Unmapped answers are still kept on the lead and shown under Source details — mapping only decides
                        which ones also fill a CRM field.
                      </p>
                    </div>
                  );
                })()}
                <p className="text-xs text-secondary-500 mt-2">
                  {(() => {
                    const dest = effectiveDestination(f);
                    return (
                      <>
                        Leads land in{' '}
                        <strong className="text-secondary-700">{dest.unit || 'no business unit'}</strong>
                        {' · '}
                        <strong className="text-secondary-700">{dest.branch || 'no branch'}</strong>
                        {dest.source === 'page' && ' (inherited from the Page)'}
                        {dest.source === 'default' && ' (the defaults in step 2)'}
                        {'. '}
                      </>
                    );
                  })()}
                  Unmapped questions are auto-detected by name and stored on the lead.
                </p>
              </div>
            ))}
          </div>
        )}
        <PaginationBar {...pagedForms.bar} />
      </section>
  );
}
