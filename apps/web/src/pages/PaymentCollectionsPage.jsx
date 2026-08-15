import { useEffect, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { api } from '../api';
import '../styles/PaymentForms.css';

/**
 * Every payment that came in, whichever form took it.
 *
 * Enquiry fees, payment forms and Jodo payment links are three different
 * journeys that end in the same place -- money received -- so they share one
 * table with a Source column rather than three screens to check.
 *
 * This is a tab inside Payments, so it carries no title of its own; the tab
 * already names it, and the sibling Payment Forms tab is laid out the same
 * way, down to the count-and-action row at the top.
 */

const today = () => new Date().toISOString().slice(0, 10);

const SOURCES = [
  { value: 'enquiry', label: 'Enquiry form' },
  { value: 'payment_form', label: 'Payment form' },
  { value: 'payment_link', label: 'Payment link' },
];

const STATUSES = ['order_created', 'unpaid', 'paid', 'settled', 'expired', 'failed', 'cancelled'];

/* Money in the bank, money still expected, and money that will never arrive --
   the three outcomes worth telling apart at a glance. */
const statusTone = (status) => {
  const value = String(status || '').toLowerCase();
  if (['paid', 'settled', 'success', 'completed', 'captured'].includes(value)) return 'paid';
  if (['expired', 'failed', 'cancelled'].includes(value)) return 'failed';
  return 'pending';
};

const titleCase = value => String(value || '').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());

export default function PaymentCollectionsPage({ onMessage }) {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    search: '', status: '', source: '', branchId: '', from: '', to: today(),
  });

  const patch = (key, value) => setFilters(current => ({ ...current, [key]: value }));

  useEffect(() => {
    api('/jodo/payment-links/branches').then(r => setBranches(r.data || [])).catch(() => {});
  }, []);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
        const result = await api(`/jodo/payment-links/collections/report?${query}`);
        setRows(result.data || []);
        setSummary(result.summary || {});
        setError('');
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [filters]);

  const money = value => Number(value || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

  function exportCsv() {
    const columns = [
      ['Source', 'source'], ['Branch', 'branchName'], ['Lead', 'leadNumber'], ['Payer', 'payerName'],
      ['Email', 'payerEmail'], ['Phone', 'payerPhone'], ['Order ID', 'orderId'], ['Transaction ID', 'transactionId'],
      ['Amount', 'amount'], ['Status', 'status'], ['Paid at', 'paidAt'], ['Settled at', 'settledAt'],
      ['Settlement UTR', 'settlementUtr'], ['Created at', 'createdAt'],
    ];
    const cell = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const csv = [
      columns.map(c => cell(c[0])).join(','),
      ...rows.map(row => columns.map(([, key]) => cell(row[key])).join(',')),
    ].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = `payment-collections-${today()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    onMessage?.({ type: 'success', text: `Exported ${rows.length} payment records` });
  }

  const stats = [
    { label: 'Records', value: summary.count || 0 },
    { label: 'Expected', value: money(summary.total) },
    { label: 'Collected', value: summary.collectedCount || 0 },
    { label: 'Collected amount', value: money(summary.collectedAmount), tone: 'paid' },
  ];

  return (
    <main className="payment-forms payment-collections">
      <header className="page-action-row">
        <span className="forms-count">
          {rows.length} payment record{rows.length === 1 ? '' : 's'}
        </span>
        <button className="primary" onClick={exportCsv} disabled={!rows.length}>
          <Download size={16} />
          Export CSV
        </button>
      </header>

      {error && <div className="collections-error">{error}</div>}

      <section className="collection-stats">
        {stats.map(({ label, value, tone }) => (
          <article key={label} className={tone ? `stat is-${tone}` : 'stat'}>
            <small>{label}</small>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <div className="collection-filters">
        <label className="collection-search">
          <Search size={15} />
          <input
            value={filters.search}
            onChange={e => patch('search', e.target.value)}
            placeholder="Order, transaction, payer or lead…"
            aria-label="Search payments"
          />
        </label>
        <select value={filters.status} onChange={e => patch('status', e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map(status => <option key={status} value={status}>{titleCase(status)}</option>)}
        </select>
        <select value={filters.source} onChange={e => patch('source', e.target.value)} aria-label="Source">
          <option value="">All sources</option>
          {SOURCES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={filters.branchId} onChange={e => patch('branchId', e.target.value)} aria-label="Branch">
          <option value="">All branches</option>
          {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
        <span className="collection-dates">
          <input type="date" value={filters.from} onChange={e => patch('from', e.target.value)} aria-label="From date" />
          <input type="date" value={filters.to} onChange={e => patch('to', e.target.value)} aria-label="To date" />
        </span>
      </div>

      <section className="forms-list">
        {loading ? (
          <div className="empty"><p>Loading payments…</p></div>
        ) : !rows.length ? (
          <div className="empty">
            <h3>No payments yet</h3>
            <p>Payments taken through enquiry forms, payment forms and payment links appear here.</p>
          </div>
        ) : (
          <div className="payment-forms-table-wrap">
            <table className="payment-forms-table">
              <thead>
                <tr>
                  <th>Payer</th>
                  <th>Source</th>
                  <th>Branch</th>
                  <th>Reference</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Settlement</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.source}-${row.orderId}-${index}`}>
                    <td>
                      <strong>{row.payerName || '—'}</strong>
                      <small>{row.leadNumber || row.payerEmail || row.payerPhone || '—'}</small>
                    </td>
                    <td><span className={`source-pill is-${row.source}`}>{titleCase(row.source)}</span></td>
                    {/* A lead with no branch yet still owes or has paid money. */}
                    <td>{row.branchName || <span className="muted">Unassigned</span>}</td>
                    <td className="reference-col">
                      <span>{row.orderId || '—'}</span>
                      {row.transactionId && <small>{row.transactionId}</small>}
                    </td>
                    <td className="num"><strong>{money(row.amount)}</strong></td>
                    <td><span className={`status ${statusTone(row.status)}`}>{titleCase(row.status) || 'Unknown'}</span></td>
                    <td>{new Date(row.paidAt || row.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td>{row.settlementUtr || <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
