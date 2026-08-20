import { useCallback, useEffect, useMemo, useState } from 'react';
import { Upload, Download, Send, AlertCircle, CheckCircle2, Loader, RefreshCw, Ban, FileSpreadsheet, ChevronDown, ChevronRight, Plus, Search, X } from 'lucide-react';
import { api } from '../api.js';
import { recordDownload } from '../downloadAudit.js';
import DateRangePicker from '../components/DateRangePicker.jsx';
import '../styles/BulkPaymentLinks.css';

/**
 * Raise a payment link for every mobile number in an uploaded file, and send
 * each one on WhatsApp.
 *
 * The file is parsed here so the numbers can be checked before anything is
 * sent -- a mistyped mobile or a zero amount is worth catching in front of
 * the person who typed it, not in a failed-row report afterwards. The server
 * re-checks everything it is given; this is a preview, not the gate.
 *
 * What the screen leads with is the history. Uploading is something you do
 * occasionally; checking whether last night's four hundred links went out is
 * something you do every morning, and that read was previously below three
 * full-height form cards. The form now opens from a button instead.
 */

const HEADER_ALIASES = {
  phone: ['phone', 'mobile', 'mobile number', 'phone number', 'number', 'contact', 'whatsapp'],
  amount: ['amount', 'fee', 'due', 'amount due', 'payable', 'value'],
  name: ['name', 'student name', 'parent name', 'payer name'],
  email: ['email', 'email address', 'mail'],
};

/** Quoted fields and embedded commas, which a fee sheet exported from Excel has. */
function parseCsvLine(line) {
  const cells = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { cells.push(value.trim()); value = ''; }
    else value += char;
  }
  cells.push(value.trim());
  return cells;
}

const normalizePhone = value => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits.slice(-10);
};

function parseFile(text) {
  const lines = String(text || '').split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return { rows: [], error: 'The file is empty' };
  const header = parseCsvLine(lines[0]).map(cell => cell.toLowerCase().replace(/^"|"$/g, ''));
  const columnFor = key => header.findIndex(cell => HEADER_ALIASES[key].includes(cell));
  const phoneAt = columnFor('phone');
  const amountAt = columnFor('amount');
  if (phoneAt < 0) return { rows: [], error: 'No mobile number column found. Name it "phone" or "mobile".' };
  if (amountAt < 0) return { rows: [], error: 'No amount column found. Name it "amount".' };
  const nameAt = columnFor('name');
  const emailAt = columnFor('email');

  const seen = new Map();
  const rows = lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    const phone = String(cells[phoneAt] || '').trim();
    const amount = String(cells[amountAt] || '').trim().replace(/[₹,\s]/g, '');
    const normalized = normalizePhone(phone);
    const numeric = Number(amount);
    let error = '';
    if (!normalized) error = 'No mobile number';
    else if (!/^[6-9]\d{9}$/.test(normalized)) error = 'Not a valid Indian mobile number';
    else if (seen.has(normalized)) error = `Duplicate of row ${seen.get(normalized)}`;
    else if (!Number.isFinite(numeric) || numeric <= 0) error = 'Amount must be greater than zero';
    if (!error) seen.set(normalized, index + 1);
    return {
      rowNumber: index + 1,
      phone,
      name: nameAt >= 0 ? String(cells[nameAt] || '').trim() : '',
      email: emailAt >= 0 ? String(cells[emailAt] || '').trim() : '',
      amount,
      error,
    };
  });
  return { rows, error: '' };
}

/** How many {{n}} the template body actually uses, which the stored count does not reliably say. */
function placeholderCount(body) {
  const found = new Set(String(body || '').match(/\{\{(\d+)\}\}/g) || []);
  return found.size ? Math.max(...[...found].map(token => Number(token.replace(/\D/g, '')))) : 0;
}

/*
 * The sample file, written from the same column names the parser accepts.
 *
 * Its mobile numbers are deliberately placeholders rather than valid ones. A
 * sample that could be uploaded untouched would raise real payment links, and
 * send real demands for money, to whichever numbers happened to be in it --
 * so this one fails validation until somebody types their own.
 */
const SAMPLE_ROWS = [
  ['phone', 'name', 'email', 'amount'],
  ['9XXXXXXXXX', 'Ravi Kumar', 'ravi.kumar@example.com', '2500'],
  ['9XXXXXXXXX', '', '', '1200.50'],
  ['9XXXXXXXXX', 'Anita Sharma', '', '750'],
];

function downloadSample() {
  const csv = SAMPLE_ROWS.map(row => row.map(cell => (/[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = 'bulk-payment-links-sample.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

const money = value => Number(value || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export default function BulkPaymentLinksPage({ onMessage }) {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [componentType, setComponentType] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const [integrations, setIntegrations] = useState([]);
  const [integrationId, setIntegrationId] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [params, setParams] = useState([]);
  const [linkParamIndex, setLinkParamIndex] = useState(0);

  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  const [parseError, setParseError] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [batches, setBatches] = useState([]);
  const [openBatch, setOpenBatch] = useState(null);
  const [loadingBatches, setLoadingBatches] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState({ search: '', status: '', branchId: '', from: '', to: '' });
  const [exporting, setExporting] = useState(0);

  const notify = useCallback((type, text) => onMessage?.({ type, text }), [onMessage]);

  const loadBatches = useCallback(() => {
    setLoadingBatches(true);
    api('/jodo/payment-link-batches')
      .then(r => setBatches(r.data || []))
      .catch(error => notify('error', error.message))
      .finally(() => setLoadingBatches(false));
  }, [notify]);

  useEffect(() => {
    api('/jodo/payment-links/branches')
      .then(r => {
        const usable = (r.data || []).filter(item => item.configured);
        setBranches(usable);
        setBranchId(current => current || String(usable[0]?.id || ''));
      })
      .catch(error => notify('error', error.message));
    api('/whatsapp/accounts').then(r => setIntegrations(r.data || [])).catch(() => {});
    loadBatches();
  }, [loadBatches, notify]);

  useEffect(() => {
    if (!integrationId) { setTemplates([]); setTemplateId(''); return; }
    api.get(`/whatsapp/integrations/${integrationId}/templates?limit=500`)
      .then(r => setTemplates((r.data || []).filter(item => String(item.status).toUpperCase() === 'APPROVED')))
      .catch(error => notify('error', error.message));
  }, [integrationId, notify]);

  const template = useMemo(
    () => templates.find(item => String(item.id) === String(templateId)) || null,
    [templates, templateId],
  );

  // A template's placeholders decide how many inputs to draw, so changing the
  // template resets them rather than carrying the previous one's answers.
  useEffect(() => {
    const count = placeholderCount(template?.body);
    setParams(Array.from({ length: count }, (_, index) => (index === count - 1 ? '' : '')));
    setLinkParamIndex(count);
  }, [template]);

  const valid = useMemo(() => rows.filter(row => !row.error), [rows]);
  const invalid = useMemo(() => rows.filter(row => row.error), [rows]);
  const total = useMemo(() => valid.reduce((sum, row) => sum + Number(row.amount || 0), 0), [valid]);

  const preview = useMemo(() => {
    if (!template) return '';
    return String(template.body || '').replace(/\{\{(\d+)\}\}/g, (match, index) => {
      const position = Number(index);
      if (position === Number(linkParamIndex)) return 'https://pay.jodo.in/…';
      const value = params[position - 1] || match;
      return String(value)
        .replace(/\{name\}/gi, valid[0]?.name || 'Parent')
        .replace(/\{amount\}/gi, Number(valid[0]?.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }));
    });
  }, [template, params, linkParamIndex, valid]);

  function pickFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseFile(String(reader.result || ''));
      setRows(parsed.rows);
      setParseError(parsed.error);
      setFileName(file.name);
    };
    reader.onerror = () => notify('error', 'Could not read that file');
    reader.readAsText(file);
  }

  async function submit() {
    if (!branchId) return notify('error', 'Choose the branch collecting this money');
    if (!valid.length) return notify('error', 'No usable rows to send');
    if (template && !linkParamIndex) return notify('error', 'Choose which placeholder carries the payment link');
    setSending(true);
    try {
      const response = await api('/jodo/payment-link-batches', {
        method: 'POST',
        body: JSON.stringify({
          branchId: Number(branchId),
          componentType: componentType || undefined,
          expiresAt: expiresAt || null,
          fileName,
          integrationId: template ? Number(integrationId) : null,
          templateId: template ? Number(templateId) : null,
          templateParams: template ? params : [],
          linkParamIndex: template ? Number(linkParamIndex) : null,
          rows: valid.map(row => ({ phone: row.phone, name: row.name, email: row.email, amount: row.amount })),
        }),
      });
      setResult(response.data);
      setRows([]);
      setFileName('');
      notify('success', `${response.data.queued} payment links queued`);
      setShowForm(false);
      loadBatches();
    } catch (error) {
      notify('error', error.message);
    } finally {
      setSending(false);
    }
  }

  /**
   * One upload's rows as a CSV.
   *
   * Fetched rather than taken from `openBatch`, so a row can be exported
   * without expanding it first, and so the file always reflects the run as it
   * stands now rather than whenever it was last opened.
   *
   * Routed through recordDownload for the same reason every other export on
   * this screen's siblings is: a file of payer names, mobile numbers and
   * amounts leaving the CRM is exactly what Bulk Actions is meant to show.
   */
  async function exportBatch(batch) {
    setExporting(batch.id);
    try {
      const detail = (await api(`/jodo/payment-link-batches/${batch.id}`)).data;
      const header = ['Row', 'Mobile', 'Name', 'Email', 'Amount', 'Status', 'Payment', 'Lead', 'Order ID', 'Error', 'Processed'];
      const cell = value => {
        const text = value === null || value === undefined ? '' : String(value);
        return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
      };
      const body = (detail.rows || []).map(row => [
        row.rowNumber, row.phone, row.name, row.email, row.amount, row.status,
        row.paymentStatus || '', row.leadNumber || '', row.orderId || '', row.error || '',
        row.processedAt || '',
      ].map(cell).join(','));
      const csv = [header.join(','), ...body].join('\n');
      const fileName = `${(batch.fileName || `upload-${batch.id}`).replace(/\.csv$/i, '')}-results.csv`;

      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);

      recordDownload('Bulk payment link results', body.length, fileName, {
        columns: header,
        context: { batchId: batch.id, branch: batch.branchName, status: batch.status },
        content: csv,
      });
    } catch (error) {
      notify('error', error.message);
    } finally {
      setExporting(0);
    }
  }

  async function openDetail(id) {
    if (openBatch?.id === id) return setOpenBatch(null);
    try { setOpenBatch((await api(`/jodo/payment-link-batches/${id}`)).data); }
    catch (error) { notify('error', error.message); }
  }

  async function cancelBatch(id) {
    try {
      await api(`/jodo/payment-link-batches/${id}/cancel`, { method: 'POST' });
      notify('success', 'Upload cancelled. Links already sent are unaffected.');
      loadBatches();
    } catch (error) { notify('error', error.message); }
  }

  /* Filtered client-side: the endpoint returns the latest 100 uploads, which
     is already in hand, so a round trip per keystroke would buy nothing. */
  const visible = batches.filter(batch => {
    const text = `${batch.fileName || ''} ${batch.branchName || ''} ${batch.createdBy || ''}`.toLowerCase();
    if (filters.search && !text.includes(filters.search.toLowerCase())) return false;
    if (filters.status && batch.status !== filters.status) return false;
    if (filters.branchId && String(batch.branchId) !== String(filters.branchId)) return false;
    const day = (batch.createdAt || '').slice(0, 10);
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
    return true;
  });

  /* Sent counts every number in the upload, which is what was asked for:
     a raised link is a link the payer can use whether or not the CRM sent
     the WhatsApp itself, since Jodo messages them too. */
  const totals = visible.reduce((sum, batch) => ({
    uploads: sum.uploads + 1,
    sent: sum.sent + Number(batch.totalRows || 0),
    amount: sum.amount + Number(batch.totalAmount || 0),
    collected: sum.collected + Number(batch.paidAmount || 0),
    paidRows: sum.paidRows + Number(batch.paidRows || 0),
  }), { uploads: 0, sent: 0, amount: 0, collected: 0, paidRows: 0 });

  const filtersOn = Boolean(filters.search || filters.status || filters.branchId || filters.from || filters.to);
  const statuses = [...new Set(batches.map(batch => batch.status))];

  const form = <>
      <section className="bulk-links-card">
        <h3>1 · Who is collecting</h3>
        <div className="bulk-links-grid">
          <label>Branch
            <select value={branchId} onChange={e => setBranchId(e.target.value)}>
              <option value="">Select branch</option>
              {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
            <small>Only branches with Jodo credentials configured are listed.</small>
          </label>
          <label>Jodo component
            <input value={componentType} onChange={e => setComponentType(e.target.value)} placeholder="Leave blank for the branch default" maxLength={120}/>
            <small>What these payments settle against in Jodo. Must match a component on the collector.</small>
          </label>
          <label>Link expires
            <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}/>
            <small>Optional. After this date the link stops accepting payment.</small>
          </label>
        </div>
      </section>

      <section className="bulk-links-card">
        <h3>2 · The WhatsApp message</h3>
        <div className="bulk-links-grid">
          <label>WhatsApp account
            <select value={integrationId} onChange={e => setIntegrationId(e.target.value)}>
              <option value="">No message — raise links only</option>
              {integrations.map(item => <option key={item.id} value={item.id}>{item.name || item.displayName || `Account ${item.id}`}</option>)}
            </select>
          </label>
          <label>Template
            <select value={templateId} onChange={e => setTemplateId(e.target.value)} disabled={!integrationId}>
              <option value="">Select an approved template</option>
              {templates.map(item => <option key={item.id} value={item.id}>{item.template_name}</option>)}
            </select>
          </label>
        </div>
        {template && (
          <div className="bulk-links-template">
            {params.map((value, index) => (
              <div className="bulk-links-param" key={index}>
                <label>
                  <span>{`{{${index + 1}}}`}</span>
                  <input
                    value={Number(linkParamIndex) === index + 1 ? 'The payment link' : value}
                    disabled={Number(linkParamIndex) === index + 1}
                    onChange={e => setParams(current => current.map((item, position) => (position === index ? e.target.value : item)))}
                    placeholder="Text, or {name} / {amount}"
                  />
                </label>
                <label className="bulk-links-radio">
                  <input type="radio" name="link-param" checked={Number(linkParamIndex) === index + 1} onChange={() => setLinkParamIndex(index + 1)}/>
                  Carries the link
                </label>
              </div>
            ))}
            <p className="bulk-links-hint"><code>{'{name}'}</code> becomes the payer&apos;s name and <code>{'{amount}'}</code> what they owe, per recipient.</p>
            <div className="bulk-links-preview"><strong>Preview</strong><p>{preview}</p></div>
          </div>
        )}
        {!integrationId && <p className="bulk-links-hint">Without a template the links are still raised, and Jodo sends its own WhatsApp and email.</p>}
      </section>

      <section className="bulk-links-card">
        <h3>3 · The numbers</h3>
        <div className="bulk-links-file-row">
          <label className="bulk-links-file">
            <Upload size={16}/>
            <span>{fileName || 'Choose a CSV file'}</span>
            <input type="file" accept=".csv,text/csv" onChange={pickFile}/>
          </label>
          <button type="button" className="bulk-links-sample" onClick={downloadSample}>
            <Download size={15}/>Download sample file
          </button>
        </div>
        <p className="bulk-links-hint">
          Columns: <strong>phone</strong> and <strong>amount</strong> are required; <strong>name</strong> and <strong>email</strong> are optional.
          A number already in the CRM takes its name and email from that lead, and the payment shows on it.
          The sample file&apos;s numbers are written as <code>9XXXXXXXXX</code> placeholders — replace them with real ones before uploading.
        </p>
        {parseError && <div className="bulk-links-alert"><AlertCircle size={16}/>{parseError}</div>}

        {rows.length > 0 && (
          <>
            <div className="bulk-links-counts">
              <span className="is-ok"><CheckCircle2 size={14}/>{valid.length} ready · {money(total)}</span>
              {invalid.length > 0 && <span className="is-bad"><AlertCircle size={14}/>{invalid.length} skipped</span>}
            </div>
            <div className="bulk-links-table-wrap">
              <table>
                <thead><tr><th>#</th><th>Mobile</th><th>Name</th><th className="num">Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {rows.slice(0, 200).map(row => (
                    <tr key={row.rowNumber} className={row.error ? 'is-bad' : ''}>
                      <td>{row.rowNumber}</td>
                      <td>{row.phone || '—'}</td>
                      <td>{row.name || <span className="muted">From the lead</span>}</td>
                      <td className="num">{row.amount || '—'}</td>
                      <td>{row.error ? <span className="bulk-links-error">{row.error}</span> : <span className="bulk-links-ok">Ready</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 200 && <p className="bulk-links-hint">Showing the first 200 of {rows.length} rows. All of them are uploaded.</p>}
            </div>
          </>
        )}

        <button className="bulk-links-send" disabled={sending || !valid.length} onClick={submit}>
          {sending ? <><Loader size={16} className="bulk-links-spin"/>Queueing…</> : <><Send size={16}/>Raise {valid.length || ''} links and send</>}
        </button>
      </section>

  </>;

  return (
    <main className="bulk-links">
      <header className="bulk-links-head">
        <div>
          <h2>Bulk payment links</h2>
          <p>Upload mobile numbers with the amount each owes. Every number gets its own Jodo payment link, sent on WhatsApp.</p>
        </div>
        <div className="bulk-links-head-actions">
          <button type="button" className="bulk-links-ghost" onClick={loadBatches} disabled={loadingBatches}>
            <RefreshCw size={14} className={loadingBatches ? 'bulk-links-spin' : ''}/>Refresh
          </button>
          <button type="button" className="bulk-links-primary" onClick={() => { setResult(null); setShowForm(true); }}>
            <Plus size={16}/>New upload
          </button>
        </div>
      </header>

      {result && (
        <section className="bulk-links-card bulk-links-result">
          <h3><CheckCircle2 size={17}/>{result.queued} links queued</h3>
          <p>They are raised and sent a few at a time in the background. The table below follows their progress.</p>
          {result.skipped?.length > 0 && (
            <details>
              <summary>{result.skipped.length} rows skipped</summary>
              <ul>{result.skipped.map(item => <li key={item.rowNumber}>Row {item.rowNumber} · {item.phone || '—'} · {item.error}</li>)}</ul>
            </details>
          )}
        </section>
      )}

      <section className="bulk-links-stats">
        {[
          ['Uploads', totals.uploads],
          ['Sent', totals.sent.toLocaleString('en-IN')],
          ['Value', money(totals.amount)],
          ['Collected', money(totals.collected)],
        ].map(([label, value]) => (
          <article key={label} className={label === 'Collected' && totals.collected > 0 ? 'is-good' : ''}>
            <span>{label}</span><strong>{value}</strong>
            {label === 'Collected' && (
              <small>{totals.paidRows} of {totals.sent} paid</small>
            )}
          </article>
        ))}
      </section>

      <section className="bulk-links-card">
        <div className="bulk-links-filters">
          <div className="bulk-links-search">
            <Search size={15}/>
            <input value={filters.search} placeholder="Search file, branch or who uploaded"
              onChange={e => setFilters({ ...filters, search: e.target.value })}/>
          </div>
          <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
            <option value="">Any status</option>
            {statuses.map(status => <option key={status} value={status}>{status}</option>)}
          </select>
          <select value={filters.branchId} onChange={e => setFilters({ ...filters, branchId: e.target.value })}>
            <option value="">All branches</option>
            {[...new Map(batches.map(b => [b.branchId, b.branchName])).entries()]
              .map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <DateRangePicker
            label="Uploaded"
            from={filters.from}
            to={filters.to}
            onChange={(from, to) => setFilters({ ...filters, from, to })}
          />
          {filtersOn && (
            <button type="button" className="bulk-links-ghost"
              onClick={() => setFilters({ search: '', status: '', branchId: '', from: '', to: '' })}>
              <X size={14}/>Clear
            </button>
          )}
        </div>

        <div className="bulk-links-table-wrap">
          <table className="bulk-links-history">
            <thead>
              <tr>
                <th className="col-toggle" aria-label="Expand"/>
                <th>File</th><th>Branch</th><th>Uploaded</th>
                <th className="num">Sent</th><th className="num">Value</th>
                <th className="num">Collected</th>
                <th>Status</th><th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(batch => [
                <tr key={batch.id} className={openBatch?.id === batch.id ? 'is-open' : ''}>
                  <td className="col-toggle">
                    <button type="button" className="bulk-links-toggle" onClick={() => openDetail(batch.id)}
                      aria-expanded={openBatch?.id === batch.id}
                      aria-label={openBatch?.id === batch.id ? 'Hide rows' : 'Show rows'}>
                      {openBatch?.id === batch.id ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}
                    </button>
                  </td>
                  <td>
                    <button className="bulk-links-link" onClick={() => openDetail(batch.id)}>
                      <FileSpreadsheet size={13}/>{batch.fileName || `Upload ${batch.id}`}
                    </button>
                    {batch.templateName && <small className="bulk-links-sub">{batch.templateName}</small>}
                  </td>
                  <td>{batch.branchName}</td>
                  <td>
                    {batch.createdAt ? new Date(batch.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    {batch.createdBy && <small className="bulk-links-sub">{batch.createdBy}</small>}
                  </td>
                  <td className="num">{batch.totalRows}</td>
                  <td className="num">{money(batch.totalAmount)}</td>
                  <td className={`num${Number(batch.paidRows) > 0 ? ' is-good' : ''}`}>
                    {money(batch.paidAmount)}
                    <small className="bulk-links-sub">{batch.paidRows} of {batch.totalRows} paid</small>
                  </td>
                  <td><span className={`bulk-links-status is-${batch.status}`}>{batch.status}</span></td>
                  <td className="col-actions">
                    <button type="button" className="bulk-links-icon" title="Export these rows as CSV"
                      disabled={exporting === batch.id} onClick={() => exportBatch(batch)}>
                      {exporting === batch.id ? <Loader size={14} className="bulk-links-spin"/> : <Download size={14}/>}
                    </button>
                    {['queued', 'processing'].includes(batch.status) && (
                      <button type="button" className="bulk-links-icon is-danger" title="Cancel what has not been sent"
                        onClick={() => cancelBatch(batch.id)}><Ban size={14}/></button>
                    )}
                  </td>
                </tr>,
                openBatch?.id === batch.id ? (
                  <tr key={`${batch.id}-detail`} className="bulk-links-detail-row-wrap">
                    <td colSpan={9}>
                      <div className="bulk-links-table-wrap is-inner">
                        <table className="bulk-links-rows">
                          <thead>
                            <tr><th>#</th><th>Mobile</th><th>Name</th><th className="num">Amount</th><th>Lead</th><th>Status</th><th>Detail</th></tr>
                          </thead>
                          <tbody>
                            {openBatch.rows.map(row => (
                              <tr key={row.id} className={row.status === 'failed' ? 'is-bad' : ''}>
                                <td>{row.rowNumber}</td>
                                <td>{row.phone}</td>
                                <td>{row.name || <span className="muted">From the lead</span>}</td>
                                <td className="num">{money(row.amount)}</td>
                                <td>{row.leadNumber || '—'}</td>
                                <td><span className={`bulk-links-status is-${row.status}`}>{row.status}</span></td>
                                <td>{row.error
                                  ? <span className="bulk-links-error">{row.error}</span>
                                  : <span className="muted">{row.paymentStatus || '—'}</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                ) : null,
              ])}
            </tbody>
          </table>

          {!visible.length && (
            <div className="bulk-links-empty">
              {loadingBatches ? 'Loading uploads…'
                : batches.length ? 'No uploads match these filters.'
                  : 'Nothing uploaded yet. Start with New upload.'}
            </div>
          )}
        </div>

        {visible.length > 0 && (
          <p className="bulk-links-hint">
            Showing {visible.length} of {batches.length} upload{batches.length === 1 ? '' : 's'}
            {filtersOn ? ' matching these filters' : ''}. The list holds the most recent 100.
          </p>
        )}
      </section>

      {showForm && <>
        <div className="drawer-backdrop" onClick={() => setShowForm(false)}/>
        <section className="metadata-dialog bulk-links-dialog" role="dialog" aria-modal="true" aria-label="New bulk upload">
          <header>
            <div>
              <span className="eyebrow">Payments</span>
              <h2>New bulk upload</h2>
            </div>
            <button type="button" className="bulk-links-icon" onClick={() => setShowForm(false)} aria-label="Close"><X size={16}/></button>
          </header>
          <div className="bulk-links-dialog-body">{form}</div>
        </section>
      </>}
    </main>
  );
}
