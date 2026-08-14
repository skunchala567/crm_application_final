import { useCallback, useEffect, useState } from 'react';
import { Check, Inbox, Loader2, RefreshCw, X } from 'lucide-react';
import { api } from '../api';

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
export default function MetaLeadReview({ onMessage }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api('/meta/imports/pending');
      setRows(result.data || []);
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  }, [onMessage]);

  useEffect(() => { load(); }, [load]);

  async function act(row, action) {
    if (action === 'discard' && !window.confirm(`Leave "${row.mapped?.studentName || row.leadgenId}" out of the CRM?`)) return;
    setBusyId(row.leadgenId);
    try {
      const result = await api(`/meta/imports/${row.leadgenId}/${action}`, { method: 'POST', body: JSON.stringify({}) });
      const status = result.data?.status;
      onMessage?.({
        type: status === 'failed' ? 'error' : 'success',
        text: action === 'discard'
          ? 'Lead discarded'
          : status === 'imported' ? 'Lead added to the CRM'
            : `Could not add the lead: ${result.data?.reason || status}`,
      });
      await load();
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="loading"><span /></div>;

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
        <button className="secondary" onClick={load}><RefreshCw size={15} /> Refresh</button>
      </header>

      {!rows.length && <div className="empty"><Inbox size={30} /><strong>No leads waiting</strong></div>}

      {rows.map(row => {
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
    </section>
  );
}
