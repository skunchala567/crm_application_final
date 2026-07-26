import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, FileUp, History, Loader, MessageCircle, RefreshCw, Send, X } from 'lucide-react';
import { api } from '../api';
import './WhatsAppSendPanel.css';
import './WhatsAppSendAdvanced.css';

const cleanPhone = value => String(value || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
const validPhone = value => /^[6-9]\d{9}$/.test(cleanPhone(value));
const isImageUrl = value => /\.(avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(String(value || ''));
const safeMediaUrl = value => {
  try {
    return encodeURI(String(value || ''));
  } catch {
    return String(value || '');
  }
};

export function WhatsAppSendPanel({ open, onClose, initialRecipients = [], initialMode = 'single', onSent, presentation = 'modal' }) {
  const [integrations, setIntegrations] = useState([]);
  const [integrationId, setIntegrationId] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateLanguage, setTemplateLanguage] = useState('en');
  const [templateParams, setTemplateParams] = useState([]);
  const [templateButtons, setTemplateButtons] = useState([]);
  const [message, setMessage] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaFilename, setMediaFilename] = useState('');
  const [phone, setPhone] = useState('');
  const [uploadRecipients, setUploadRecipients] = useState([]);
  const [mode, setMode] = useState(initialMode);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [conversationMessages, setConversationMessages] = useState([]);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(initialRecipients.length > 1 ? 'selected' : initialMode);
    setPhone(initialRecipients.length === 1 ? cleanPhone(initialRecipients[0].phoneNumber) : '');
    setUploadRecipients([]);
    setTemplateId('');
    setTemplateName('');
    setTemplateLanguage('en');
    setTemplateParams([]);
    setTemplateButtons([]);
    setMessage('');
    setMediaUrl('');
    setMediaFilename('');
    setUploadingMedia(false);
    setNotice(null);
    setConversation(null);
    setConversationMessages([]);
    api.get('/whatsapp/integrations?provider=SMARTPING').then(result => {
      const ready = (result.data || []).filter(item => item.has_credentials);
      setIntegrations(ready);
      setIntegrationId(current => current || String(ready[0]?.id || ''));
    }).catch(error => setNotice({ type: 'error', text: error.message }));
    // Recipient arrays are assembled by the parent during render. Depending on
    // their reference would reset this form after every keystroke or tab click.
  }, [open]);

  useEffect(() => {
    if (!integrationId) return setTemplates([]);
    api.get(`/whatsapp/integrations/${integrationId}/templates?limit=500`).then(result => {
      setTemplates((result.data || []).filter(item => String(item.status).toUpperCase() === 'APPROVED'));
    }).catch(error => setNotice({ type: 'error', text: error.message }));
  }, [integrationId]);

  const recipients = mode === 'selected'
    ? initialRecipients
    : mode === 'upload'
      ? uploadRecipients
      : phone ? [{ phoneNumber: cleanPhone(phone) }] : [];
  const validRecipients = useMemo(
    () => recipients.filter(item => validPhone(item.phoneNumber)),
    [recipients]
  );
  const activePhone = validRecipients.length === 1 ? cleanPhone(validRecipients[0].phoneNumber) : '';
  const hasIncomingMessage = conversationMessages.some(item => String(item.direction).toLowerCase() === 'incoming');
  const selectedTemplate = useMemo(
    () => templates.find(item => String(item.id || item.aisensy_template_id) === String(templateId)),
    [templates, templateId]
  );
  const selectedTemplateType = String(
    selectedTemplate?.template_type || selectedTemplate?.header_type || selectedTemplate?.type || 'TEXT'
  ).toUpperCase();
  const templateRequiresMedia = ['IMAGE', 'VIDEO', 'DOCUMENT', 'FILE'].includes(selectedTemplateType);

  async function loadConversation() {
    if (!open || !integrationId || !activePhone) {
      setConversation(null);
      setConversationMessages([]);
      return;
    }
    setLoadingConversation(true);
    try {
      const conversations = await api.get(`/hub/smartping/conversations?search=${encodeURIComponent(activePhone)}&limit=20`);
      const match = (conversations.data || []).find(item =>
        cleanPhone(item.mobile) === activePhone
        && String(item.integration_id) === String(integrationId)
      );
      setConversation(match || null);
      if (!match) {
        setConversationMessages([]);
        return;
      }
      const messages = await api.get(`/hub/smartping/conversations/${match.id}/messages?limit=50`);
      setConversationMessages(messages.data || []);
      if (Number(match.unread_count) > 0) {
        api.put(`/hub/smartping/conversations/${match.id}/read`, {}).catch(() => {});
      }
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setLoadingConversation(false);
    }
  }

  useEffect(() => {
    if (!open || !integrationId || !activePhone) return undefined;
    const debounce = window.setTimeout(loadConversation, 300);
    const refresh = window.setInterval(loadConversation, 5000);
    return () => {
      window.clearTimeout(debounce);
      window.clearInterval(refresh);
    };
  }, [open, integrationId, activePhone]);

  function chooseTemplate(value) {
    setTemplateId(value);
    const template = templates.find(item => String(item.id || item.aisensy_template_id) === value);
    setTemplateName(template?.template_name || template?.name || template?.label || '');
    setTemplateLanguage(template?.language_code || template?.language || 'en');
    const templateText = template?.text || template?.body || '';
    setMessage(templateText);
    const indexes = [...templateText.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(match => Number(match[1]));
    const parameterCount = Math.max(Number(template?.total_parameters || 0), ...indexes, 0);
    setTemplateParams(Array.from({ length: parameterCount }, () => ''));
    const buttons = template?.buttons || template?.call_to_action || template?.callToAction || [];
    setTemplateButtons(Array.isArray(buttons) ? buttons : []);
    if (!['IMAGE', 'VIDEO', 'DOCUMENT', 'FILE'].includes(String(
      template?.template_type || template?.header_type || template?.type || 'TEXT'
    ).toUpperCase())) {
      setMediaUrl('');
      setMediaFilename('');
    }
  }

  function parseContacts(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = event => {
      const lines = String(event.target.result || '').split(/\r?\n/).filter(Boolean);
      const values = lines.flatMap((line, index) => {
        const cells = line.split(/,|\t/).map(cell => cell.replace(/^"|"$/g, '').trim());
        const candidate = cells.find(validPhone);
        return candidate ? [{ phoneNumber: cleanPhone(candidate), name: cells[0], row: index + 1 }] : [];
      });
      setUploadRecipients([...new Map(values.map(item => [item.phoneNumber, item])).values()]);
      setNotice(values.length ? null : { type: 'error', text: 'No valid mobile numbers were found in the file.' });
    };
    reader.readAsText(file);
  }

  async function uploadTemplateMedia(file) {
    if (!file || !templateRequiresMedia) return;
    setUploadingMedia(true);
    setNotice({ type: 'pending', text: `Uploading ${file.name}…` });
    try {
      const result = await api('/whatsapp/media-upload', {
        method: 'POST',
        body: file,
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
          'X-Template-Type': selectedTemplateType,
          'X-Integration-Id': integrationId
        }
      });
      setMediaUrl(result.data.url);
      setMediaFilename(result.data.filename || file.name);
      setNotice({ type: 'success', text: `${file.name} uploaded and ready to send.` });
    } catch (error) {
      setMediaUrl('');
      setMediaFilename('');
      setNotice({ type: 'error', text: error.message });
    } finally {
      setUploadingMedia(false);
    }
  }

  async function sendMessage() {
    const isFreeText = !templateId && hasIncomingMessage && validRecipients.length === 1;
    if (!integrationId || !message.trim() || !validRecipients.length || (!templateId && !isFreeText)) return;
    setSending(true);
    setNotice({ type: 'pending', text: `Sending to ${validRecipients.length} recipient${validRecipients.length === 1 ? '' : 's'}…` });
    try {
      const payload = {
        message: message.trim(),
        templateName: templateName || null,
        language: templateLanguage,
        templateParams,
        media: mediaUrl.trim() ? { url: mediaUrl.trim(), filename: mediaFilename.trim() || 'attachment' } : undefined,
        buttons: templateButtons.length ? templateButtons : undefined,
        clientRequestId: globalThis.crypto?.randomUUID?.() || `crm-${Date.now()}-${Math.random()}`
      };
      const result = validRecipients.length === 1
        ? await api.post(`/hub/integrations/${integrationId}/smartping/send`, {
            ...payload,
            phoneNumber: validRecipients[0].phoneNumber,
            leadId: validRecipients[0].leadId || null,
            userName: validRecipients[0].name || 'CRM Contact',
            source: validRecipients[0].source || 'CRM',
            attributes: {
              Branch: validRecipients[0].branch || '',
              Class: validRecipients[0].className || ''
            }
          })
        : await api.post(`/hub/integrations/${integrationId}/smartping/send-bulk`, {
            ...payload,
            phoneNumbers: validRecipients
          });
      const data = result.data || {};
      setNotice({
        type: 'success',
        text: validRecipients.length === 1
          ? 'WhatsApp message sent successfully.'
          : `${data.sent || 0} sent, ${data.failed || 0} failed.`
      });
      onSent?.(result);
      await loadConversation();
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;
  const isLeadDrawer = presentation === 'drawer';
  const freeTextAllowed = validRecipients.length === 1 && hasIncomingMessage;
  const canSend = Boolean(
    integrationId
    && validRecipients.length
    && message.trim()
    && (templateId || freeTextAllowed)
    && (!templateRequiresMedia || mediaUrl.trim())
    && !uploadingMedia
  );
  const activeRecipient = validRecipients[0] || initialRecipients[0] || {};
  return <div className={`wa-send-overlay${isLeadDrawer ? ' drawer-mode' : ''}`} onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className={`wa-send-panel${isLeadDrawer ? ' lead-chat-drawer' : ''}`}>
      <header>
        <div><MessageCircle/><span><h2>{isLeadDrawer ? (activeRecipient.name || 'WhatsApp conversation') : 'Send WhatsApp message'}</h2><p>{isLeadDrawer ? `Primary: ${activePhone || 'No valid mobile number'}` : 'Send an approved template from a connected WhatsApp account.'}</p></span></div>
        <div className="wa-chat-header-actions">
          {isLeadDrawer && <button onClick={loadConversation} disabled={loadingConversation} aria-label="Refresh conversation" title="Refresh messages"><RefreshCw className={loadingConversation ? 'spinning' : ''}/></button>}
          <button onClick={onClose} aria-label="Close"><X/></button>
        </div>
      </header>
      <div className="wa-send-body">
        {!isLeadDrawer && <div className="wa-send-modes">
          {!initialRecipients.length && <button className={mode === 'single' ? 'active' : ''} onClick={() => setMode('single')}>Single contact</button>}
          {initialRecipients.length > 0 && <button className={mode === 'selected' ? 'active' : ''} onClick={() => setMode('selected')}>Selected leads ({initialRecipients.length})</button>}
          {!initialRecipients.length && <button className={mode === 'upload' ? 'active' : ''} onClick={() => setMode('upload')}>Bulk upload</button>}
        </div>}
        {isLeadDrawer && <div className="wa-chat-thread">
          {loadingConversation && !conversationMessages.length && <div className="wa-chat-empty">Loading conversation…</div>}
          {!loadingConversation && !conversationMessages.length && <div className="wa-chat-empty"><MessageCircle/><strong>No messages yet</strong><span>Select an approved template to start this conversation.</span></div>}
          {conversationMessages.map(item => <div className={`wa-chat-bubble ${String(item.direction).toLowerCase()}${item.media_url ? ' has-media' : ''}`} key={item.id || item.message_id}>
            {item.media_url && isImageUrl(item.media_url)
              ? <a className="wa-chat-image" href={safeMediaUrl(item.media_url)} target="_blank" rel="noreferrer" title="Open image">
                  <img src={safeMediaUrl(item.media_url)} alt={item.caption || item.message || 'WhatsApp image'} loading="lazy"/>
                </a>
              : item.media_url
                ? <a className="wa-chat-attachment" href={safeMediaUrl(item.media_url)} target="_blank" rel="noreferrer"><FileUp/><span>Open attachment</span></a>
                : null}
            {(item.message || item.caption) && <span>{item.message || item.caption}</span>}
            <small>{item.created_at ? new Date(item.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : ''}{item.direction === 'outgoing' ? ` · ${item.status || 'SENT'}` : ''}</small>
          </div>)}
        </div>}
        <div className="wa-send-grid">
          <label><span>WhatsApp account *</span><select value={integrationId} onChange={event => setIntegrationId(event.target.value)}><option value="">Select account</option>{integrations.map(item => <option key={item.id} value={item.id}>{item.integration_name}</option>)}</select></label>
          <label><span>Approved template *</span><select value={templateId} onChange={event => chooseTemplate(event.target.value)}><option value="">Select template</option>{templates.map(item => <option key={item.id || item.aisensy_template_id} value={item.id || item.aisensy_template_id}>{item.label || item.template_name || item.name}</option>)}</select></label>
        </div>
        {mode === 'single' && <label className="wa-send-field"><span>Mobile number *</span><input value={phone} onChange={event => setPhone(event.target.value)} placeholder="10-digit mobile number"/></label>}
        {mode === 'upload' && <label className="wa-upload-box"><FileUp/><strong>Upload contacts</strong><small>CSV or tab-separated file containing mobile numbers</small><input type="file" accept=".csv,.txt,.tsv" onChange={event => parseContacts(event.target.files?.[0])}/><b>{uploadRecipients.length ? `${uploadRecipients.length} valid contacts ready` : 'Choose file'}</b></label>}
        {mode === 'selected' && <div className="wa-recipient-summary"><CheckCircle2/><span><strong>{validRecipients.length} valid recipients</strong><small>{initialRecipients.length - validRecipients.length} leads without a valid mobile number will not be sent.</small></span></div>}
        <label className="wa-send-field"><span>{templateId ? 'Template message' : 'Message'} *</span><textarea className={templateId ? 'template-locked' : ''} rows={isLeadDrawer ? 4 : 7} value={message} readOnly={Boolean(templateId) || !freeTextAllowed} onChange={event => setMessage(event.target.value)} placeholder={freeTextAllowed ? 'Type a reply' : 'Select a template to start the conversation'}/><small>{templateId ? 'Template content cannot be edited' : freeTextAllowed ? `${message.length} characters` : 'Free-text replies unlock after the contact messages you'}</small></label>
        {templateParams.length > 0 && <section className="wa-template-params">
          <div><strong>Template parameters</strong><small>Enter values in placeholder order.</small></div>
          <div>{templateParams.map((value, index) => <label key={index}><span>{`{{${index + 1}}}`}</span><input value={value} onChange={event => setTemplateParams(current => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder={`Value for parameter ${index + 1}`}/></label>)}</div>
        </section>}
        {templateRequiresMedia && <details className="wa-media-fields" open={isLeadDrawer}>
          <summary>{selectedTemplateType.toLowerCase()} required by this template</summary>
          <div className="wa-template-media-upload">
            <label>
              {uploadingMedia ? <Loader className="spinning"/> : <FileUp/>}
              <span><strong>{uploadingMedia ? 'Uploading attachment…' : mediaFilename || `Choose ${selectedTemplateType.toLowerCase()}`}</strong><small>{mediaFilename ? 'Click to replace this attachment' : 'Select a file from your system'}</small></span>
              <input
                type="file"
                disabled={uploadingMedia}
                accept={selectedTemplateType === 'IMAGE' ? 'image/jpeg,image/png,image/webp,image/gif' : selectedTemplateType === 'VIDEO' ? 'video/mp4' : '.pdf,.doc,.docx'}
                onChange={event => uploadTemplateMedia(event.target.files?.[0])}
              />
            </label>
            {mediaUrl && isImageUrl(mediaUrl) && <img src={safeMediaUrl(mediaUrl)} alt="Selected attachment preview"/>}
          </div>
        </details>}
        {notice && <div className={`wa-send-notice ${notice.type}`}><AlertCircle/>{notice.text}</div>}
      </div>
      <footer><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={sending || !canSend} onClick={sendMessage}>{sending ? <Loader className="spinning"/> : <Send/>}{sending ? 'Sending…' : isLeadDrawer ? 'Send' : `Send to ${validRecipients.length || 0}`}</button></footer>
    </section>
  </div>;
}

export function WhatsAppMessageHistory({ open, onClose }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const result = await api.get(`/hub/smartping/message-history?status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}`);
      setRows(result.data || []);
    } finally { setLoading(false); }
  };
  useEffect(() => {
    if (!open) return undefined;
    const debounce = window.setTimeout(load, 300);
    const timer = window.setInterval(load, 5000);
    return () => {
      window.clearTimeout(debounce);
      window.clearInterval(timer);
    };
  }, [open, status, search]);
  if (!open) return null;
  return <div className="wa-history-screen">
    <header><div><History/><span><h2>WhatsApp message history</h2><p>Template messages and their latest delivery status.</p></span></div><button onClick={onClose}><X/></button></header>
    <div className="wa-history-toolbar"><input placeholder="Search number or template" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => event.key === 'Enter' && load()}/><select value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option><option>SENT</option><option>DELIVERED</option><option>READ</option><option>FAILED</option></select><button onClick={load}>Refresh</button></div>
    <div className="wa-history-table"><table><thead><tr><th>Date</th><th>Account</th><th>Template</th><th>Recipient</th><th>Status</th><th>Failure reason</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{new Date(row.sent_at || row.created_at).toLocaleString('en-IN')}</td><td>{row.integration_name}</td><td>{row.template_name || 'Custom message'}</td><td>{row.phone_number}</td><td><b className={`wa-status ${String(row.status).toLowerCase()}`}><span>{row.status === 'READ' || row.status === 'DELIVERED' ? '✓✓' : row.status === 'SENT' ? '✓' : row.status === 'FAILED' || row.status === 'REJECTED' ? '!' : '◷'}</span>{row.status}</b></td><td>{row.failure_reason || '—'}</td></tr>)}</tbody></table>{!loading && !rows.length && <p className="wa-history-empty">No sent messages found.</p>}{loading && !rows.length && <p className="wa-history-empty">Loading history…</p>}</div>
  </div>;
}
