import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Mail, MessageSquare, Send, X } from 'lucide-react';
import { api } from '../api';

/**
 * Send one template to the selected leads, by SMS or by email.
 *
 * Both channels answer the same question -- which template, to whom -- so they
 * share this dialog rather than growing two near-identical ones. What differs
 * is only where the templates come from and what a recipient needs: a mobile
 * number for SMS, an email address for email.
 *
 * Neither send is silent about who it could not reach. A lead with no number
 * or no address is counted and named in the result, because that is the usual
 * reason a bulk send under-delivers and the least obvious from the outside.
 */
export default function BulkMessageSend({ channel, leads, onClose, onMessage }) {
  const isSms = channel === 'sms';
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [params, setParams] = useState([]);
  const [preview, setPreview] = useState('');
  const [summary, setSummary] = useState(null);
  const onMessageRef = useRef(onMessage);

  // The Leads screen passes a small inline notification callback. Keep the
  // latest callback without making it a data-loading dependency: an API error
  // updates the parent toast, which creates a new callback identity, and used
  // to restart this request indefinitely (visible as a flashing dialog).
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
  const notify = useCallback(message => onMessageRef.current?.(message), []);

  // Who can actually be reached, worked out before anything is sent.
  const reachable = useMemo(
    () => leads.filter(lead => (isSms ? lead.phone : lead.email)),
    [leads, isSms],
  );
  const unreachable = leads.length - reachable.length;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (isSms) {
        const list = await api('/whatsapp/integrations?provider=SMARTPING_SMS').catch(() => ({ data: [] }));
        const live = (list.data || []).filter(item => item.has_credentials !== false);
        setAccounts(live);
        setAccountId(live[0] ? String(live[0].id) : '');
      } else {
        const result = await api('/email/templates');
        setTemplates(result.data || []);
      }
    } catch (error) {
      notify({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  }, [isSms, notify]);

  useEffect(() => { load(); }, [load]);

  // SMS templates hang off an account, so they reload when it changes.
  useEffect(() => {
    if (!isSms || !accountId) return;
    api(`/sms/integrations/${accountId}/sms-templates`)
      .then(result => setTemplates((result.data || []).filter(t => t.isActive)))
      .catch(error => notify({ type: 'error', text: error.message }));
  }, [isSms, accountId, notify]);

  const template = templates.find(t => String(t.id) === String(templateId));
  const variableCount = isSms ? (template?.variableCount || 0) : 0;

  useEffect(() => { setParams(current => current.slice(0, variableCount)); }, [variableCount]);

  // What the message will look like, before anyone is charged for it.
  useEffect(() => {
    if (!isSms || !template) { setPreview(''); return; }
    api(`/sms/sms-templates/${template.id}/preview`, { method: 'POST', body: JSON.stringify({ params }) })
      .then(result => setPreview(result.data?.text || ''))
      .catch(() => setPreview(''));
  }, [isSms, template, params]);

  async function send() {
    if (!template) return notify({ type: 'error', text: 'Choose a template' });
    if (!reachable.length) return notify({ type: 'error', text: `None of the selected leads have ${isSms ? 'a mobile number' : 'an email address'}` });
    setSending(true);
    try {
      const result = isSms
        ? await api(`/sms/integrations/${accountId}/sms-templates/${template.id}/send-bulk`, {
            method: 'POST',
            body: JSON.stringify({
              recipients: reachable.map(lead => ({ phoneNumber: lead.phone, leadId: lead.id, params })),
            }),
          })
        : await api('/email/send-bulk', {
            method: 'POST',
            body: JSON.stringify({
              leadIds: reachable.map(lead => lead.id),
              templateId: template.id,
              subject: template.subject,
              bodyHtml: template.bodyHtml || template.body_html,
            }),
          });
      setSummary(result.data || {});
    } catch (error) {
      notify({ type: 'error', text: error.message });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="assignment-rule-overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="assignment-rule-modal" role="dialog" aria-modal="true">
        <header className="modal-header">
          <h2>{isSms ? <MessageSquare size={17} /> : <Mail size={17} />} Send {isSms ? 'SMS' : 'email'} to {leads.length} lead{leads.length === 1 ? '' : 's'}</h2>
          <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>

        {loading ? <div className="loading"><span /></div> : summary ? (
          <div className="bulk-send-summary">
            <p><strong>{summary.sent || 0}</strong> sent{summary.failed ? `, ${summary.failed} failed` : ''}{summary.noEmail ? `, ${summary.noEmail} without an address` : ''}.</p>
            {(summary.failures || []).length > 0 && (
              <ul>{summary.failures.map((failure, index) => (
                <li key={index}>{failure.name || failure.phoneNumber || failure.leadId}: {failure.error}</li>
              ))}</ul>
            )}
            <div className="modal-footer"><button type="button" className="primary" onClick={onClose}>Done</button></div>
          </div>
        ) : (
          <form onSubmit={event => { event.preventDefault(); send(); }}>
            {isSms && (
              <label>
                SMS account *
                <select value={accountId} onChange={event => { setAccountId(event.target.value); setTemplateId(''); }}>
                  <option value="">Select an account</option>
                  {accounts.map(account => <option key={account.id} value={String(account.id)}>{account.name || account.integration_name}</option>)}
                </select>
                {!accounts.length && <small>No SMS account is connected yet.</small>}
              </label>
            )}

            <label>
              Template *
              <select value={templateId} onChange={event => setTemplateId(event.target.value)} disabled={isSms && !accountId}>
                <option value="">Select a template</option>
                {templates.map(item => (
                  <option key={item.id} value={String(item.id)}>{item.templateName || item.name}</option>
                ))}
              </select>
              {!templates.length && !loading && <small>No templates available for this {isSms ? 'account' : 'channel'} yet.</small>}
            </label>

            {variableCount > 0 && Array.from({ length: variableCount }, (_, index) => (
              <label key={index}>
                {`Variable {{${index + 1}}}`}
                <input
                  value={params[index] || ''}
                  onChange={event => setParams(current => {
                    const next = [...current];
                    next[index] = event.target.value;
                    return next;
                  })}
                  placeholder={`Value for {{${index + 1}}}`}
                />
              </label>
            ))}

            {preview && <p className="config-hint"><strong>Preview:</strong> {preview}</p>}

            <p className="config-hint">
              {reachable.length} of {leads.length} selected lead{leads.length === 1 ? '' : 's'} {reachable.length === 1 ? 'has' : 'have'} {isSms ? 'a mobile number' : 'an email address'}
              {unreachable > 0 && <> — <b>{unreachable}</b> will be skipped and listed afterwards</>}.
            </p>

            <div className="modal-footer">
              <button type="button" className="secondary" onClick={onClose} disabled={sending}>Cancel</button>
              <button type="submit" className="primary" disabled={sending || !template || !reachable.length}>
                {sending ? <Loader2 size={15} /> : <Send size={15} />}
                {sending ? 'Sending…' : `Send to ${reachable.length}`}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
