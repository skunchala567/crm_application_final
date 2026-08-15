import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { api } from '../api';
import TemplateVisibilityPicker from '../components/TemplateVisibilityPicker';

/**
 * SMS templates for one connected account.
 *
 * Unlike WhatsApp, these are not synced from the provider: SmartPing exposes
 * only a send endpoint, and a template's DLT registration happens on the
 * operator's portal. So each template records the Content ID that portal
 * issued for its exact wording -- send with the wrong one and the operator
 * rejects the message.
 *
 * Bodies use {{1}}, {{2}} placeholders, the same convention as the WhatsApp
 * templates, and the preview shows the rendered text with its length and
 * segment count before anything is sent.
 */
const blank = { templateName: '', category: 'General', body: '', dltContentId: '', senderId: '', isActive: true, visibleUserIds: [] };

export default function SmsTemplatesSettings({ onMessage }) {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [templates, setTemplates] = useState([]);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);

  const notify = useCallback((type, text) => onMessage?.({ type, text }), [onMessage]);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api('/hub/integrations').catch(() => ({ data: [] }));
      const sms = (list.data || []).filter(
        item => String(item.provider_name || '').toLowerCase() === 'smartping_sms',
      );
      setAccounts(sms);
      setAccountId(current => current || (sms[0] ? String(sms[0].id) : ''));
    } catch (error) {
      notify('error', error.message);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  const loadTemplates = useCallback(async () => {
    if (!accountId) { setTemplates([]); return; }
    try {
      const result = await api(`/sms/integrations/${accountId}/sms-templates`);
      setTemplates(result.data || []);
    } catch (error) {
      notify('error', error.message);
    }
  }, [accountId, notify]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return templates;
    return templates.filter(t => `${t.templateName} ${t.body} ${t.dltContentId}`.toLowerCase().includes(term));
  }, [templates, search]);

  // How many {{n}} the body uses, mirroring what the API stores on save.
  const variableCount = useMemo(() => {
    const seen = new Set();
    for (const match of String(form.body || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)) seen.add(match[1]);
    return seen.size;
  }, [form.body]);

  const closeEditor = () => {
    if (saving) return;
    setEditorOpen(false);
    setEditing(null);
    setForm({ ...blank });
    setPreview(null);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...blank });
    setPreview(null);
    setEditorOpen(true);
  };

  const openEdit = template => {
    setEditing(template.id);
    setPreview(null);
    setForm({
      templateName: template.templateName,
      category: template.category || 'General',
      body: template.body,
      dltContentId: template.dltContentId,
      senderId: template.senderId || '',
      isActive: template.isActive,
      visibleUserIds: template.visibleUserIds || [],
    });
    setEditorOpen(true);
  };

  async function save(event) {
    event.preventDefault();
    if (!form.templateName.trim()) return notify('error', 'Enter a template name');
    if (!form.body.trim()) return notify('error', 'Enter the message text');
    if (!/^\d{4,19}$/.test(form.dltContentId.trim())) return notify('error', 'DLT Content ID must contain 4 to 19 digits');
    setSaving(true);
    try {
      await api(editing ? `/sms/sms-templates/${editing}` : `/sms/integrations/${accountId}/sms-templates`, {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({
          templateName: form.templateName.trim(),
          category: form.category.trim() || 'General',
          body: form.body.trim(),
          dltContentId: form.dltContentId.trim(),
          senderId: form.senderId.trim() || null,
          isActive: form.isActive,
          visibleUserIds: form.visibleUserIds,
        }),
      });
      notify('success', editing ? 'Template saved' : 'Template added');
      setEditorOpen(false);
      setEditing(null);
      setForm({ ...blank });
      setPreview(null);
      await loadTemplates();
    } catch (error) {
      notify('error', error.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(template) {
    if (!window.confirm(`Delete "${template.templateName}"?`)) return;
    try {
      await api(`/sms/sms-templates/${template.id}`, { method: 'DELETE' });
      if (editing === template.id) closeEditor();
      await loadTemplates();
    } catch (error) {
      notify('error', error.message);
    }
  }

  async function showPreview() {
    if (!editing) return notify('error', 'Save the template first to preview it');
    try {
      const result = await api(`/sms/sms-templates/${editing}/preview`, {
        method: 'POST',
        body: JSON.stringify({ params: Array.from({ length: variableCount }, (_, i) => `value ${i + 1}`) }),
      });
      setPreview(result.data);
    } catch (error) {
      notify('error', error.message);
    }
  }

  if (loading) return <div className="loading"><span /></div>;

  if (!accounts.length) {
    return (
      <div className="empty">
        <strong>No SMS account connected</strong>
        <span>Connect a SmartPing SMS account under Settings &rarr; Integrations, then add its templates here.</span>
      </div>
    );
  }

  return (
    <section className="panel">
      <div className="config-toolbar">
        <div>
          <strong>SMS templates</strong>
          <span>Each template carries the DLT Content ID registered for its exact wording.</span>
        </div>
        <div className="sms-template-toolbar-actions">
          {accounts.length > 1 && (
            <select value={accountId} onChange={event => { setAccountId(event.target.value); closeEditor(); }}>
              {accounts.map(account => (
                <option key={account.id} value={String(account.id)}>{account.integration_name || account.name}</option>
              ))}
            </select>
          )}
          <button type="button" className="primary" onClick={openCreate}><Plus size={16} /> Add Template</button>
        </div>
      </div>

      <div className="config-content stacked">
        <div className="config-list">
          <div className="config-list-tools">
            <div className="local-search">
              <Search size={16} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search templates…" />
            </div>
            <span>{filtered.length} templates</span>
          </div>

          <div className="config-records">
            {filtered.map(template => (
              <article key={template.id}>
                <div>
                  <strong>{template.templateName}</strong>
                  <em className="config-parent-of">{template.body}</em>
                  <small>
                    DLT {template.dltContentId} · {template.variableCount} variable{template.variableCount === 1 ? '' : 's'}
                    {template.senderId ? ` · sender ${template.senderId}` : ''} · {template.isActive ? 'Active' : 'Inactive'}
                  </small>
                </div>
                <div className="config-record-actions">
                  <button className="config-edit" type="button" onClick={() => openEdit(template)}><Pencil size={14} /> Edit</button>
                  <button type="button" title="Delete" onClick={() => remove(template)}><Trash2 size={14} /></button>
                </div>
              </article>
            ))}
            {!filtered.length && (
              <div className="empty">
                <strong>{templates.length ? 'No results match your search' : 'No SMS templates yet'}</strong>
                {!templates.length && <><span>Add the wordings you have registered on the DLT portal.</span><button type="button" className="primary" onClick={openCreate}><Plus size={16} /> Add Template</button></>}
              </div>
            )}
          </div>
        </div>
      </div>

      {editorOpen && (
        <div className="assignment-rule-overlay" onMouseDown={event => event.target === event.currentTarget && closeEditor()}>
          <section className="assignment-rule-modal sms-template-modal" role="dialog" aria-modal="true" aria-labelledby="sms-template-editor-title">
            <header className="modal-header">
              <div>
                <h2 id="sms-template-editor-title">{editing ? 'Edit SMS template' : 'Add SMS template'}</h2>
                <p>{editing ? 'Update the approved wording, DLT details, and visibility.' : 'Add wording already approved in the DLT portal.'}</p>
              </div>
              <button type="button" title="Close" aria-label="Close" onClick={closeEditor} disabled={saving}><X size={18} /></button>
            </header>

            <form className="config-add" onSubmit={save}>

          <label>
            Template name *
            <input value={form.templateName} onChange={e => setForm({ ...form, templateName: e.target.value })} placeholder="Application reminder" />
          </label>

          <label>
            DLT Content ID *
            <input value={form.dltContentId} onChange={e => setForm({ ...form, dltContentId: e.target.value })} placeholder="1234567890123" inputMode="numeric" />
            <small>Issued by the DLT portal for this wording. 4 to 19 digits.</small>
          </label>

          <label>
            Message *
            <textarea
              rows={4}
              value={form.body}
              onChange={e => setForm({ ...form, body: e.target.value })}
              placeholder="Dear {{1}}, your application {{2}} is pending."
            />
            <small>
              {variableCount} variable{variableCount === 1 ? '' : 's'} · {form.body.length} characters ·{' '}
              {Math.ceil(form.body.length / 160) || 1} segment{Math.ceil(form.body.length / 160) === 1 ? '' : 's'}.
              Use {'{{1}}'}, {'{{2}}'} for values filled in at send time.
            </small>
          </label>

          <label>
            Category
            <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="General" />
          </label>

          <label>
            Sender ID
            <input value={form.senderId} onChange={e => setForm({ ...form, senderId: e.target.value })} placeholder="Leave blank to use the account's" />
          </label>

          <label className="config-check">
            <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />
            Active
          </label>

          <TemplateVisibilityPicker
            value={form.visibleUserIds}
            onChange={visibleUserIds => setForm({ ...form, visibleUserIds })}
            disabled={saving}
          />

          {preview && (
            <p className="config-hint">
              <strong>Preview:</strong> {preview.text}
              <br /><small>{preview.characters} characters · {preview.segments} segment{preview.segments === 1 ? '' : 's'}</small>
            </p>
          )}

          <div className="config-form-actions">
            <button className="primary" disabled={saving}>
              {saving ? <Loader2 size={15} /> : editing ? <Pencil size={15} /> : <Plus size={16} />}
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add template'}
            </button>
            {editing && <button type="button" className="secondary" onClick={showPreview}>Preview</button>}
            <button type="button" className="secondary" onClick={closeEditor} disabled={saving}>Cancel</button>
          </div>
        </form>
          </section>
        </div>
      )}
    </section>
  );
}
