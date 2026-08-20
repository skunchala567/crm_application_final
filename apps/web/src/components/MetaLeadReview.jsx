import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronRight as ChevronRightIcon, Download, Inbox, Loader2, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { api } from '../api';
import { recordDownload } from '../downloadAudit.js';
import '../pages/MetaLeadAdsFilters.css';

/**
 * Meta leads waiting to be looked at.
 *
 * Backfill used to create a CRM lead the moment it found one, so nobody saw
 * what a form had actually collected until it was already a record -- and a
 * wrong field mapping only showed up as a lead with a blank name. Leads now
 * wait here with their answers, and become leads when someone says so.
 *
 * Shown as a list: one row per lead, expanded on click to reveal both sides
 * -- the questions and answers exactly as Meta sent them, and what the form's
 * mapping makes of them. When those disagree, the mapping is what needs
 * fixing, and that is visible before any data lands.
 *
 * Rows can be selected and acted on together, because a campaign that ran
 * over a weekend arrives as hundreds of leads that one person has to decide
 * about, and deciding on each one separately is the slow part.
 */
const PAGE_SIZES = [10, 20, 50];
const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;

/*
 * The waiting list as a spreadsheet.
 *
 * Each lead carries whatever questions its form asked, and no two forms
 * necessarily ask the same ones -- so the columns are the union of every
 * question present, and a lead that was not asked one exports blank there.
 */
function exportWaiting(rows) {
  const questions = [...new Set(rows.flatMap((row) => (row.answers || []).map((a) => a.name)))];
  const columns = [
    { label: 'Leadgen ID', get: (r) => r.leadgenId },
    { label: 'Form', get: (r) => r.formName || r.formId || '' },
    { label: 'Page', get: (r) => r.pageName || r.pageId || '' },
    { label: 'Student name', get: (r) => r.mapped?.studentName || '' },
    { label: 'Phone', get: (r) => r.mapped?.phone || '' },
    { label: 'Email', get: (r) => r.mapped?.email || '' },
    { label: 'Received', get: (r) => (r.receivedAt ? new Date(r.receivedAt).toLocaleString() : '') },
    ...questions.map((name) => ({
      label: name,
      get: (r) => (r.answers || []).find((a) => a.name === name)?.value || '',
    })),
  ];
  const csv = [
    columns.map((c) => csvCell(c.label)).join(','),
    ...rows.map((row) => columns.map((c) => csvCell(c.get(row))).join(',')),
  ].join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = 'meta-leads-waiting-for-review.csv';
  link.click();
  URL.revokeObjectURL(link.href);
  // Recorded so Bulk Actions can say who took what, and when.
  recordDownload('Meta leads awaiting review', rows.length, link.download, { columns: columns.map((c) => c.label), content: csv });
}

export default function MetaLeadReview({ onMessage, meta = null }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState({ q: '', form: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  /* Which rows are ticked, and which one is open. Only one expands at a time:
     the answers table is tall, and several open at once turns the list back
     into the stack of cards this replaced. */
  const [selected, setSelected] = useState(() => new Set());
  const [expanded, setExpanded] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [truncated, setTruncated] = useState(false);
  /* Where approved leads land. Empty means "use the form's own mapping and
     the integration defaults", which is what approving always did. */
  const [assignOpen, setAssignOpen] = useState(false);
  const [assign, setAssign] = useState({ pipelineId: '', stageId: '', substageId: '', ownerEmployeeId: '', branchId: '' });

  /*
   * The callback is held in a ref rather than depended on.
   *
   * App re-renders every second -- the idle timer in useDailyUsage ticks that
   * often -- and this screen passes a fresh inline onMessage each time. With
   * onMessage in the dependency list, load() was rebuilt and the effect below
   * re-fired once a second: the list refetched continuously, and because the
   * whole section fell back to a skeleton while loading, the cards flickered
   * out from under the pointer. A click on "Add to CRM" frequently landed on
   * a button that had just been unmounted, which is why leads appeared to be
   * ignored rather than imported.
   */
  const messageRef = useRef(onMessage);
  useEffect(() => { messageRef.current = onMessage; }, [onMessage]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api('/meta/imports/pending');
      setRows(result.data || []);
      /* If the server had to cap the read, say so rather than letting the
         list quietly disagree with the queue. */
      setTruncated(Boolean(result.truncated));
    } catch (error) {
      messageRef.current?.({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Only what was actually chosen is sent; anything left blank keeps the
     form's own routing rather than overriding it with an empty value. */
  const assignmentPayload = () => Object.fromEntries(
    Object.entries(assign).filter(([, value]) => value !== '' && value !== null)
      .map(([key, value]) => [key, Number(value)]),
  );

  /* The pipelines, stages, sub-stages, owners and branches this unit has.
     Taken from the same lead metadata the Leads screen uses, so the choices
     here are exactly the ones a lead can actually hold. */
  const pipelines = meta?.pipelines || [];
  const stagesForPipeline = useMemo(() => (meta?.stages || []).filter(stage => (
    !assign.pipelineId || String(stage.pipelineId) === String(assign.pipelineId)
  )), [meta?.stages, assign.pipelineId]);
  const substagesForStage = useMemo(() => (meta?.substages || []).filter(item => (
    String(item.stageId) === String(assign.stageId)
  )), [meta?.substages, assign.stageId]);

  async function bulkAct(action) {
    const ids = [...selected];
    if (!ids.length) return;
    if (action === 'discard' && !window.confirm(`Leave ${ids.length} lead${ids.length === 1 ? '' : 's'} out of the CRM?`)) return;
    setBulkBusy(true);
    try {
      if (action === 'discard') {
        const result = await api('/meta/imports/bulk-discard', { method: 'POST', body: JSON.stringify({ leadgenIds: ids }) });
        messageRef.current?.({ type: 'success', text: `${result.data.discarded} lead${result.data.discarded === 1 ? '' : 's'} discarded` });
      } else {
        const result = await api('/meta/imports/bulk-approve', {
          method: 'POST', body: JSON.stringify({ leadgenIds: ids, ...assignmentPayload() }),
        });
        /* Reported per outcome, because a batch rarely lands one way: some
           become leads, some match an existing record, some cannot be
           imported at all, and hiding that behind one number would mislead. */
        const tally = result.data.tally || {};
        const parts = [
          tally.imported ? `${tally.imported} added` : null,
          tally.reenquired ? `${tally.reenquired} marked as re-enquiry` : null,
          tally.duplicate ? `${tally.duplicate} already in the CRM` : null,
          tally.skipped ? `${tally.skipped} no longer waiting` : null,
          tally.failed ? `${tally.failed} could not be added` : null,
        ].filter(Boolean);
        messageRef.current?.({
          type: tally.failed ? 'error' : 'success',
          text: parts.join(' · ') || 'Nothing changed',
        });
      }
      setSelected(new Set());
      await load();
    } catch (error) {
      messageRef.current?.({ type: 'error', text: error.message });
    } finally {
      setBulkBusy(false);
    }
  }

  async function act(row, action) {
    if (action === 'discard' && !window.confirm(`Leave "${row.mapped?.studentName || row.leadgenId}" out of the CRM?`)) return;
    setBusyId(row.leadgenId);
    try {
      const result = await api(`/meta/imports/${row.leadgenId}/${action}`, {
        method: 'POST',
        body: JSON.stringify(action === 'approve' ? assignmentPayload() : {}),
      });
      const status = result.data?.status;
      const leadNumber = result.data?.leadNumber;
      /*
       * Every outcome the import can reach, said plainly.
       *
       * "duplicate" used to be reported as "Could not add the lead", which is
       * the one thing it does not mean: the lead was recognised as somebody
       * already in the CRM and attached to that record. Reading it as a
       * failure sent people looking for a new row on the Leads screen that
       * was never going to be there.
       */
      const outcome = {
        imported: 'Lead added to the CRM',
        reenquired: `Existing lead ${leadNumber || ''} updated and marked as re-enquired`.trim(),
        duplicate: `Already in the CRM as ${leadNumber || 'an existing lead'} — no new lead was created`,
      }[status];
      messageRef.current?.({
        type: status === 'failed' ? 'error' : 'success',
        text: action === 'discard'
          ? 'Lead discarded'
          : outcome || `Could not add the lead: ${result.data?.reason || status}`,
      });
      await load();
    } catch (error) {
      messageRef.current?.({ type: 'error', text: error.message });
    } finally {
      setBusyId(null);
    }
  }

  /* Name, phone, email, the leadgen id, or anything a form asked -- someone
     looking for one lead in a waiting list searches for what they know. */
  const query = filter.q.trim().toLowerCase();
  const visible = rows.filter(row => (
    (!filter.form || String(row.formId) === filter.form)
    && (!query || [
      row.mapped?.studentName, row.mapped?.phone, row.mapped?.email, row.leadgenId, row.formName,
      ...(row.answers || []).map(answer => answer.value),
    ].some(value => String(value ?? '').toLowerCase().includes(query)))
  ));

  /* One page of the filtered list, and the selection helpers that act on it.
     "Select all" means every lead the current filters match -- not just the
     page on screen -- because filtering to one campaign and then acting on
     it is the whole point of the tick box. */
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows = visible.slice((currentPage - 1) * pageSize, (currentPage - 1) * pageSize + pageSize);

  const visibleIds = visible.map(row => row.leadgenId);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));
  const someVisibleSelected = visibleIds.some(id => selected.has(id));
  const toggleAllVisible = () => setSelected(current => {
    const next = new Set(current);
    if (allVisibleSelected) visibleIds.forEach(id => next.delete(id));
    else visibleIds.forEach(id => next.add(id));
    return next;
  });
  const toggleOne = id => setSelected(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /** The chosen routing as a sentence, so it is legible while collapsed. */
  const assignSummary = [
    pipelines.find(p => String(p.id) === String(assign.pipelineId))?.displayName,
    (meta?.stages || []).find(stage => String(stage.id) === String(assign.stageId))?.displayName,
    (meta?.employees || []).find(person => String(person.id) === String(assign.ownerEmployeeId))?.name,
    (meta?.branches || []).find(branch => String(branch.id) === String(assign.branchId))?.name,
  ].filter(Boolean).join(' · ');

  if (loading && !loaded) return <div className="loading"><span /></div>;

  return (
    <section className="meta-review">
      <header>
        <div>
          <strong>Review Meta leads</strong>
          <span>
            {rows.length
              ? `${rows.length} lead${rows.length === 1 ? '' : 's'} collected from Meta, not yet in the CRM.${truncated ? ' Showing the most recent — narrow the filters to reach the rest.' : ''}`
              : 'Nothing waiting. Leads collected from Meta appear here before they become CRM leads.'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button className="secondary panel-action" onClick={() => exportWaiting(visible)} disabled={!visible.length} title={rows.length ? 'Download this list as CSV' : 'Nothing to export'}>
            <Download size={15} /> Export
          </button>
          <button className="secondary panel-action" onClick={load}><RefreshCw size={15} /> Refresh</button>
        </div>
      </header>

      {rows.length > 0 && (
        <div className="meta-filter-bar">
          <label className="meta-filter-search">
            <Search size={15} />
            <input value={filter.q} onChange={e => setFilter({ ...filter, q: e.target.value })} placeholder="Search name, phone, email or answer…" />
          </label>
          <select value={filter.form} onChange={e => setFilter({ ...filter, form: e.target.value })} aria-label="Form">
            <option value="">All forms</option>
            {[...new Map(rows.map(row => [String(row.formId), row.formName || row.formId])).entries()]
              .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {visible.length !== rows.length && (
            <span className="meta-filter-count">
              {visible.length} of {rows.length}
              <button type="button" title="Clear filters" onClick={() => setFilter({ q: '', form: '' })}><X size={13} /></button>
            </span>
          )}
        </div>
      )}

      {!rows.length && <div className="empty"><Inbox size={30} /><strong>No leads waiting</strong></div>}
      {rows.length > 0 && !visible.length && (
        <div className="empty"><Inbox size={30} /><strong>No leads match these filters</strong></div>
      )}

      {/* Where approved leads go. Collapsed by default: most reviewing is
          done with the form's own routing, and this only matters when it
          needs overriding for a particular batch. */}
      {visible.length > 0 && meta && (
        <div className="review-assign">
          <button type="button" className="review-assign-toggle" onClick={() => setAssignOpen(open => !open)} aria-expanded={assignOpen}>
            {assignOpen ? <ChevronDown size={14} /> : <ChevronRightIcon size={14} />}
            <SlidersHorizontal size={14} />
            Where added leads go
            <em>{assignSummary || 'Using each form’s own routing'}</em>
          </button>
          {assignOpen && (
            <div className="review-assign-fields">
              <label>Pipeline
                <select value={assign.pipelineId} onChange={e => setAssign({ ...assign, pipelineId: e.target.value, stageId: '', substageId: '' })}>
                  <option value="">Form default</option>
                  {pipelines.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                </select>
              </label>
              <label>Stage
                <select value={assign.stageId} onChange={e => setAssign({ ...assign, stageId: e.target.value, substageId: '' })}>
                  <option value="">Form default</option>
                  {stagesForPipeline.map(stage => <option key={stage.id} value={stage.id}>{stage.displayName}</option>)}
                </select>
              </label>
              <label>Sub-stage
                <select value={assign.substageId} disabled={!assign.stageId} onChange={e => setAssign({ ...assign, substageId: e.target.value })}>
                  <option value="">{assign.stageId ? 'Form default' : 'Choose a stage first'}</option>
                  {substagesForStage.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}
                </select>
              </label>
              <label>Lead owner
                <select value={assign.ownerEmployeeId} onChange={e => setAssign({ ...assign, ownerEmployeeId: e.target.value })}>
                  <option value="">Form default</option>
                  {(meta.employees || []).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select>
              </label>
              <label>Branch
                <select value={assign.branchId} onChange={e => setAssign({ ...assign, branchId: e.target.value })}>
                  <option value="">Form default</option>
                  {(meta.branches || []).map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </label>
              {assignSummary && (
                <button type="button" className="secondary" onClick={() => setAssign({ pipelineId: '', stageId: '', substageId: '', ownerEmployeeId: '', branchId: '' })}>
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Acts on what is ticked, across pages -- a filter narrows the list,
          and the selection survives paging through it. */}
      {selected.size > 0 && (
        <div className="review-bulk-bar">
          <strong>{selected.size} selected</strong>
          <button type="button" className="text-btn" onClick={() => setSelected(new Set())}>Clear</button>
          <div className="review-bulk-actions">
            <button className="primary" disabled={bulkBusy} onClick={() => bulkAct('approve')}>
              {bulkBusy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Add {selected.size} to CRM
            </button>
            <button className="secondary" disabled={bulkBusy} onClick={() => bulkAct('discard')}>
              <X size={15} /> Discard {selected.size}
            </button>
          </div>
        </div>
      )}

      {visible.length > 0 && (
        <div className="table-wrap overflow-x-auto">
          <table className="table review-table">
            <thead>
              <tr>
                <th className="review-tick">
                  <input
                    type="checkbox"
                    aria-label="Select every lead in this list"
                    checked={allVisibleSelected}
                    ref={node => { if (node) node.indeterminate = someVisibleSelected && !allVisibleSelected; }}
                    onChange={toggleAllVisible}
                  />
                </th>
                <th />
                <th>Lead</th>
                <th>Phone</th>
                <th>Form</th>
                <th>Received</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pageRows.map(row => {
                const name = row.mapped?.studentName;
                const phone = row.mapped?.phone;
                const open = expanded === row.leadgenId;
                return [
                  <tr key={row.leadgenId} className={open ? 'is-open' : ''}>
                    <td className="review-tick">
                      <input
                        type="checkbox"
                        aria-label={`Select ${name || row.leadgenId}`}
                        checked={selected.has(row.leadgenId)}
                        onChange={() => toggleOne(row.leadgenId)}
                      />
                    </td>
                    <td className="review-tick">
                      <button type="button" className="review-expand" aria-expanded={open}
                        title={open ? 'Hide answers' : 'Show answers'}
                        onClick={() => setExpanded(open ? null : row.leadgenId)}>
                        {open ? <ChevronDown size={15} /> : <ChevronRightIcon size={15} />}
                      </button>
                    </td>
                    <td onClick={() => setExpanded(open ? null : row.leadgenId)} className="review-name">
                      <strong className={name ? '' : 'missing'}>{name || 'No name mapped'}</strong>
                      <small>{row.mapped?.email || row.leadgenId}</small>
                    </td>
                    <td className={phone ? 'text-sm' : 'text-sm missing'}>{phone || 'not mapped'}</td>
                    <td className="text-sm">
                      {row.formName || row.formId}
                      <small className="block text-secondary-500">{row.pageName || row.pageId}</small>
                    </td>
                    <td className="text-xs">{row.receivedAt ? new Date(row.receivedAt).toLocaleString('en-IN') : '—'}</td>
                    <td>
                      {/* Icons rather than labels: the same two words on
                          every row of a 200-row list is noise, and the wide
                          buttons were what pushed this column out of shape.
                          Both carry a title and an aria-label so the action
                          is still named to a pointer and a screen reader. */}
                      <div className="review-row-actions">
                        <button className="icon-action is-approve" disabled={busyId === row.leadgenId}
                          title={`Add ${name || row.leadgenId} to the CRM`} aria-label={`Add ${name || row.leadgenId} to the CRM`}
                          onClick={() => act(row, 'approve')}>
                          {busyId === row.leadgenId ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                        </button>
                        <button className="icon-action is-discard" disabled={busyId === row.leadgenId}
                          title={`Discard ${name || row.leadgenId}`} aria-label={`Discard ${name || row.leadgenId}`}
                          onClick={() => act(row, 'discard')}>
                          <X size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>,
                  open && (
                    <tr key={`${row.leadgenId}-detail`} className="review-detail-row">
                      <td colSpan={7}>
                        <div className="meta-review-mapped">
                          <span className={name ? '' : 'missing'}>Name: <b>{name || 'not mapped'}</b></span>
                          <span className={phone ? '' : 'missing'}>Phone: <b>{phone || 'not mapped'}</b></span>
                          {row.mapped?.email && <span>Email: <b>{row.mapped.email}</b></span>}
                          {row.unmapped?.length > 0 && <span className="missing">{row.unmapped.length} unmapped question{row.unmapped.length === 1 ? '' : 's'}</span>}
                        </div>
                        <table className="meta-review-answers">
                          <thead><tr><th>Question</th><th>Answer</th></tr></thead>
                          <tbody>
                            {row.answers.map((answer, index) => (
                              <tr key={`${answer.name}-${index}`}>
                                <td>{answer.name}</td>
                                <td>{answer.value || <em>blank</em>}</td>
                              </tr>
                            ))}
                            {!row.answers.length && <tr><td colSpan={2}><em>Meta sent no answers for this lead.</em></td></tr>}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      {visible.length > PAGE_SIZES[0] && (() => {
        const current = currentPage;
        const from = (current - 1) * pageSize + 1;
        return (
          <div className="pagination-controls">
            <div className="page-size-selector">
              <label>Records per page:</label>
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>
                {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="pagination-info">Showing {from} to {Math.min(from + pageSize - 1, visible.length)} of {visible.length} records</div>
            <div className="pagination-buttons">
              <button className="pagination-btn" title="First page" disabled={current === 1} onClick={() => setPage(1)}>&lsaquo;&lsaquo;</button>
              <button className="pagination-btn" title="Previous page" disabled={current === 1} onClick={() => setPage(current - 1)}><ChevronLeft size={16} /></button>
              <div className="page-indicator">Page {current} of {pages}</div>
              <button className="pagination-btn" title="Next page" disabled={current === pages} onClick={() => setPage(current + 1)}><ChevronRight size={16} /></button>
              <button className="pagination-btn" title="Last page" disabled={current === pages} onClick={() => setPage(pages)}>&rsaquo;&rsaquo;</button>
            </div>
          </div>
        );
      })()}
    </section>
  );
}
