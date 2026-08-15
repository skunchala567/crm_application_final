import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../api';
import {
  EnquiryFormsPanel, EnquiryFormEditor, defaultEnquiryFields, emptyEnquiryForm,
} from '../BusinessUnitsPage.jsx';

/**
 * Public enquiry forms, on their own rather than inside Business Units.
 *
 * They sit under Payments because that is what they are used for: a form that
 * takes an application fee. The panel and editor are the same components the
 * Business Units tab used -- only the surrounding state moves here, so the
 * form builder behaves identically wherever it is opened from.
 *
 * The business unit comes from the header switcher rather than a picker of its
 * own, matching every other screen outside Business Units.
 */
export default function EnquiryFormsSettings({ onMessage }) {
  const [config, setConfig] = useState(null);
  const [unit, setUnit] = useState(null);
  const [form, setForm] = useState(emptyEnquiryForm);
  const [editingId, setEditingId] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const notify = useCallback((message) => message && onMessage?.(message), [onMessage]);
  const unitId = unit?.id;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Whichever unit the header is on: business-units returns the caller's,
      // and requireCrmAccess has already resolved which one that is.
      const units = await api('/platform/business-units');
      const active = (units.data || [])[0] || null;
      setUnit(active);
      if (active) setConfig(await api(`/platform/business-units/${active.id}/config`));
    } catch (error) {
      notify({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await api(
        editingId
          ? `/platform/business-units/${unitId}/enquiry-forms/${editingId}`
          : `/platform/business-units/${unitId}/enquiry-forms`,
        { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(form) },
      );
      notify({ type: 'success', text: result.message || 'Enquiry form saved' });
      setDialogOpen(false);
      setEditingId(null);
      setConfig(await api(`/platform/business-units/${unitId}/config`));
    } catch (error) {
      notify({ type: 'error', text: error.message });
    } finally {
      setSaving(false);
    }
  }

  async function remove(row) {
    if (!window.confirm(`Delete "${row.displayName || row.title}"?`)) return;
    try {
      const result = await api(`/platform/business-units/${unitId}/enquiry-forms/${row.id}`, { method: 'DELETE' });
      notify({ type: 'success', text: result.message || 'Enquiry form deleted' });
      setConfig(await api(`/platform/business-units/${unitId}/config`));
    } catch (error) {
      notify({ type: 'error', text: error.message });
    }
  }

  if (loading) return <div className="loading"><span /></div>;
  if (!config || !unit) {
    return <div className="empty"><strong>No business unit available</strong></div>;
  }

  return (
    <>
      <EnquiryFormsPanel
        config={config}
        selected={unit}
        onAdd={() => {
          setEditingId(null);
          setForm({ ...emptyEnquiryForm, fields: defaultEnquiryFields(config.fields) });
          setDialogOpen(true);
        }}
        onEdit={(row) => {
          setEditingId(row.id);
          setForm({ ...emptyEnquiryForm, ...row, fields: row.fieldSchema || [] });
          setDialogOpen(true);
        }}
        onDelete={remove}
        onMessage={notify}
      />

      {dialogOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => { setDialogOpen(false); setEditingId(null); }} />
          <section className="metadata-dialog" role="dialog" aria-modal="true">
            <header>
              <div>
                <span className="eyebrow">Configuration</span>
                <h2>{editingId ? 'Edit enquiry form' : 'Add enquiry form'}</h2>
              </div>
              <button className="icon-btn" onClick={() => { setDialogOpen(false); setEditingId(null); }} aria-label="Close"><X /></button>
            </header>
            <EnquiryFormEditor
              form={form}
              setForm={setForm}
              config={config}
              saving={saving}
              onCancel={() => { setDialogOpen(false); setEditingId(null); }}
              onSubmit={save}
            />
          </section>
        </>
      )}
    </>
  );
}
