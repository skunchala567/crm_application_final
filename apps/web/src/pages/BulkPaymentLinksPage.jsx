import { useCallback, useEffect, useMemo, useState } from 'react';
import { Upload, Download, Send, AlertCircle, CheckCircle2, Loader, RefreshCw, Ban, FileSpreadsheet } from 'lucide-react';
import { api } from '../api.js';
import '../styles/BulkPaymentLinks.css';

/**
 * Raise a payment link for every mobile number in an uploaded file, and send
 * each one on WhatsApp.
 *
 * The file is parsed here so the numbers can be checked before anything is
 * sent -- a mistyped mobile or a zero amount is worth catching in front of
 * the person who typed it, not in a failed-row report afterwards. The server
 * re-checks everything it is given; this is a preview, not the gate.
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

  const notify = useCallback((type, text) => onMessage?.({ type, text }), [onMessage]);

  const loadBatches = useCallback(() => {
    api('/jodo/payment-link-batches').then(r => setBatches(r.data || [])).catch(error => notify('error', error.message));
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
      loadBatches();
    } catch (error) {
      notify('error', error.message);
    } finally {
      setSending(false);
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

  return (
    <main className="bulk-links">
      <header className="bulk-links-head">
        <div>
          <h2>Bulk payment links</h2>
          <p>Upload mobile numbers with the amount each owes. Every number gets its own Jodo payment link, sent on WhatsApp.</p>
        </div>
      </header>

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

      {result && (
        <section className="bulk-links-card bulk-links-result">
          <h3><CheckCircle2 size={17}/>{result.queued} links queued</h3>
          <p>They are raised and sent a few at a time in the background. Refresh the history below to follow progress.</p>
          {result.skipped?.length > 0 && (
            <details>
              <summary>{result.skipped.length} rows skipped</summary>
              <ul>{result.skipped.map(item => <li key={item.rowNumber}>Row {item.rowNumber} · {item.phone || '—'} · {item.error}</li>)}</ul>
            </details>
          )}
        </section>
      )}

      <section className="bulk-links-card">
        <h3>Previous uploads <button className="bulk-links-refresh" onClick={loadBatches} aria-label="Refresh"><RefreshCw size={14}/></button></h3>
        {!batches.length && <p className="bulk-links-hint">Nothing uploaded yet.</p>}
        {batches.length > 0 && (
          <div className="bulk-links-table-wrap">
            <table>
              <thead><tr><th>File</th><th>Branch</th><th className="num">Numbers</th><th className="num">Sent</th><th className="num">Failed</th><th className="num">Amount</th><th>Status</th><th/></tr></thead>
              <tbody>
                {batches.map(batch => (
                  <>
                    <tr key={batch.id}>
                      <td><button className="bulk-links-link" onClick={() => openDetail(batch.id)}><FileSpreadsheet size={13}/>{batch.fileName || `Upload ${batch.id}`}</button></td>
                      <td>{batch.branchName}</td>
                      <td className="num">{batch.totalRows}</td>
                      <td className="num">{batch.sentRows}</td>
                      <td className="num">{batch.failedRows}</td>
                      <td className="num">{money(batch.totalAmount)}</td>
                      <td><span className={`bulk-links-status is-${batch.status}`}>{batch.status}</span></td>
                      <td>{['queued', 'processing'].includes(batch.status) && <button className="bulk-links-cancel" onClick={() => cancelBatch(batch.id)}><Ban size={13}/>Cancel</button>}</td>
                    </tr>
                    {openBatch?.id === batch.id && (
                      <tr key={`${batch.id}-detail`}>
                        <td colSpan={8}>
                          <div className="bulk-links-detail">
                            {openBatch.rows.map(row => (
                              <div key={row.id} className={`bulk-links-detail-row is-${row.status}`}>
                                <span>{row.phone}</span>
                                <span>{row.name || '—'}</span>
                                <span className="num">{money(row.amount)}</span>
                                <span>{row.leadNumber || '—'}</span>
                                <span>{row.status}{row.paymentStatus ? ` · ${row.paymentStatus}` : ''}</span>
                                <span className="bulk-links-error">{row.error || ''}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
