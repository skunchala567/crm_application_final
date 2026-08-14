import { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageCircle, Save, X } from 'lucide-react';
import { api } from '../api';

/**
 * Which WhatsApp templates the Tracker sends when an action item is created.
 *
 * The owner and each approver already get an in-app notification, which only
 * reaches someone already in the CRM. These templates go to the number
 * captured on their account in User Management.
 *
 * Both templates receive the same two variables, in this order:
 *   {{1}}  the action item's title
 *   {{2}}  its due date
 * so the two wordings differ only in who they address.
 */
export default function TrackerNotificationSettings({ businessUnitId, onClose, onMessage }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [form, setForm] = useState({
    isEnabled: false, integrationId: '', actionItemTemplate: '', approvalTemplate: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api(`/platform/business-units/${businessUnitId}/tracker-notifications`);
      setAccounts(result.accounts || []);
      setTemplates(result.templates || []);
      const data = result.data || {};
      setForm({
        isEnabled: Boolean(Number(data.isEnabled)),
        integrationId: data.integrationId ? String(data.integrationId) : '',
        actionItemTemplate: data.actionItemTemplate || '',
        approvalTemplate: data.approvalTemplate || '',
      });
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  }, [businessUnitId, onMessage]);

  useEffect(() => { load(); }, [load]);

  // Templates belong to one WhatsApp account, so only that account's are offered.
  const forAccount = templates.filter(
    template => !form.integrationId || String(template.integrationId) === String(form.integrationId),
  );

  async function save() {
    setSaving(true);
    try {
      await api(`/platform/business-units/${businessUnitId}/tracker-notifications`, {
        method: 'PUT',
        body: JSON.stringify({
          isEnabled: form.isEnabled,
          integrationId: form.integrationId || null,
          actionItemTemplate: form.actionItemTemplate || null,
          approvalTemplate: form.approvalTemplate || null,
        }),
      });
      onMessage?.({ type: 'success', text: 'Tracker notifications saved' });
      onClose?.();
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="assignment-rule-overlay" onMouseDown={event => event.target === event.currentTarget && onClose?.()}>
      <section className="assignment-rule-modal" role="dialog" aria-modal="true">
        <header className="modal-header">
          <h2><MessageCircle size={17} /> Action item notifications</h2>
          <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>

        {loading ? <div className="loading"><span /></div> : (
          <form onSubmit={event => { event.preventDefault(); save(); }}>
            <label className="config-check">
              <input
                type="checkbox"
                checked={form.isEnabled}
                onChange={event => setForm({ ...form, isEnabled: event.target.checked })}
              />
              Send a WhatsApp message when an action item is created
            </label>

            {form.isEnabled && <>
              <label>
                WhatsApp account *
                <select
                  value={form.integrationId}
                  onChange={event => setForm({ ...form, integrationId: event.target.value, actionItemTemplate: '', approvalTemplate: '' })}
                >
                  <option value="">Select an account</option>
                  {accounts.map(account => <option key={account.id} value={String(account.id)}>{account.name}</option>)}
                </select>
              </label>

              <label>
                Action item template — sent to the owner
                <select
                  value={form.actionItemTemplate}
                  disabled={!form.integrationId}
                  onChange={event => setForm({ ...form, actionItemTemplate: event.target.value })}
                >
                  <option value="">Do not message the owner</option>
                  {forAccount.map(template => (
                    <option key={template.id} value={template.templateName}>{template.templateName}</option>
                  ))}
                </select>
              </label>

              <label>
                Approval template — sent to each approver
                <select
                  value={form.approvalTemplate}
                  disabled={!form.integrationId}
                  onChange={event => setForm({ ...form, approvalTemplate: event.target.value })}
                >
                  <option value="">Do not message approvers</option>
                  {forAccount.map(template => (
                    <option key={template.id} value={template.templateName}>{template.templateName}</option>
                  ))}
                </select>
              </label>

              <p className="config-hint">
                Both templates receive two variables: <b>{'{{1}}'}</b> the action item text
                and <b>{'{{2}}'}</b> the due date. Messages go to the number on each
                person's account in User Management; anyone without one is skipped.
              </p>
            </>}

            <div className="modal-footer">
              <button type="button" className="secondary" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="submit" className="primary" disabled={saving}>
                {saving ? <Loader2 size={15} /> : <Save size={15} />} {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
