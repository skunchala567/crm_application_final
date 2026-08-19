import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Download, Inbox, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { api } from '../api';
import '../pages/MetaLeadAdsFilters.css';

/**
 * Meta leads waiting to be looked at.
 *
 * Backfill used to create a CRM lead the moment it found one, so nobody saw
 * what a form had actually collected until it was already a record -- and a
 * wrong field mapping only showed up as a lead with a blank name. Leads now
 * wait here with their answers, and become leads when someone says so.
 *
 * Each card shows both sides: the questions and answers exactly as Meta sent
 * them, and what the form's mapping makes of them. When those disagree, the
 * mapping is what needs fixing, and that is visible before any data lands.
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
}

export default function MetaLeadReview({ onMessage }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState({ q: '', form: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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
    } catch (error) {
      messageRef.current?.({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(row, action) {
    if (action === 'discard' && !window.confirm(`Leave "${row.mapped?.studentName || row.leadgenId}" out of the CRM?`)) return;
    setBusyId(row.leadgenId);
    try {
      const result = await api(`/meta/imports/${row.leadgenId}/${action}`, { method: 'POST', body: JSON.stringify({}) });
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

  if (loading && !loaded) return <div className="loading"><span /></div>;

  return (
    <section className="meta-review">
      <header>
        <div>
          <strong>Waiting for review</strong>
          <span>
            {rows.length
              ? `${rows.length} lead${rows.length === 1 ? '' : 's'} collected from Meta, not yet in the CRM.`
              : 'Nothing waiting. Leads collected from Meta appear here before they become CRM leads.'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button className="secondary" onClick={() => exportWaiting(visible)} disabled={!visible.length} title={rows.length ? 'Download this list as CSV' : 'Nothing to export'}>
            <Download size={15} /> Export
          </button>
          <button className="secondary" onClick={load}><RefreshCw size={15} /> Refresh</button>
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

      {visible.slice((Math.min(page, Math.max(1, Math.ceil(visible.length / pageSize))) - 1) * pageSize,
                     (Math.min(page, Math.max(1, Math.ceil(visible.length / pageSize))) - 1) * pageSize + pageSize).map(row => {
        const name = row.mapped?.studentName;
        const phone = row.mapped?.phone;
        return (
          <article key={row.leadgenId} className="meta-review-card">
            <div className="meta-review-head">
              <div>
                <strong>{name || 'No name mapped'}</strong>
                <small>
                  {row.formName || row.formId} · {row.pageName || row.pageId} · via {row.intakeSource}
                  {row.receivedAt ? ` · ${new Date(row.receivedAt).toLocaleString('en-IN')}` : ''}
                </small>
              </div>
              <div className="meta-review-actions">
                <button className="primary" disabled={busyId === row.leadgenId} onClick={() => act(row, 'approve')}>
                  {busyId === row.leadgenId ? <Loader2 size={15} /> : <Check size={15} />} Add to CRM
                </button>
                <button className="secondary" disabled={busyId === row.leadgenId} onClick={() => act(row, 'discard')}>
                  <X size={15} /> Discard
                </button>
              </div>
            </div>

            {/* What the mapping produced. Missing essentials are called out
                here rather than after an import has already failed. */}
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
          </article>
        );
      })}

      {visible.length > PAGE_SIZES[0] && (() => {
        const pages = Math.max(1, Math.ceil(visible.length / pageSize));
        const current = Math.min(page, pages);
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
