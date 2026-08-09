import { useEffect, useState } from 'react';
import { Plus, Copy, Eye, X, CreditCard, FileText, Building2, ListChecks, MessageSquareText, Link, Tags, CircleDot, ListPlus, CalendarClock, Pencil, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import FormFieldBuilder from '../components/FormFieldBuilder.jsx';
import '../styles/PaymentForms.css';

const emptyForm = {
  title: '',
  description: '',
  branchId: '',
  selectionType: 'single',
  fields: [],
  categories: [{ name: '', amount: '' }],
  successMessage: '',
  redirectUrl: '',
  expiresOn: '',
  isActive: true,
};

/** "2026-08-20 23:59:59" -> "2026-08-20" for the date input. */
const toDateInput = value => (value ? String(value).slice(0, 10) : '');

const formatExpiry = value => (value
  ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  : null);

export default function PaymentFormsPage({ onMessage }) {
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  // The id being edited, or null when the modal is creating a new form.
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [branches, setBranches] = useState([]);

  const notify = (type, text) => onMessage?.({ type, text });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [formsResult, branchesResult] = await Promise.all([
        api('/payment-forms/admin'),
        api('/jodo/payment-links/branches'),
      ]);
      setForms(formsResult.data || []);
      setBranches(branchesResult.data || []);
    } catch (error) {
      notify('error', `Failed to load: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditingId(null);
    setFormData(emptyForm);
    setShowCreate(true);
  }

  /** Loads the full record, so editing does not blank what the list omits. */
  async function openEdit(form) {
    try {
      const result = await api(`/payment-forms/admin/${form.id}`);
      const detail = result.data || {};
      setEditingId(form.id);
      setFormData({
        title: detail.title || '',
        description: detail.description || '',
        branchId: String(detail.branch_id || ''),
        selectionType: detail.selection_type || 'single',
        fields: Array.isArray(detail.additional_fields_json) ? detail.additional_fields_json : [],
        categories: (detail.categories || []).length
          ? detail.categories.map(c => ({ name: c.category_name, amount: String(c.amount) }))
          : [{ name: '', amount: '' }],
        successMessage: detail.success_message || '',
        redirectUrl: detail.redirect_url || '',
        expiresOn: toDateInput(detail.expires_at_utc),
        isActive: detail.is_active !== 0,
      });
      setShowCreate(true);
    } catch (error) {
      notify('error', `Could not open the form: ${error.message}`);
    }
  }

  async function handleSave() {
    if (!formData.title || !formData.branchId) {
      notify('error', 'Title and branch are required');
      return;
    }

    const validCategories = formData.categories.filter(c => c.name && c.amount);
    if (!validCategories.length) {
      notify('error', 'Add at least one category with name and amount');
      return;
    }

    const payload = {
      title: formData.title,
      description: formData.description,
      branchId: Number(formData.branchId),
      selectionType: formData.selectionType,
      fields: formData.fields,
      categories: validCategories.map(c => ({ name: c.name, amount: Number(c.amount) })),
      successMessage: formData.successMessage,
      redirectUrl: formData.redirectUrl,
      expiresOn: formData.expiresOn || null,
      isActive: formData.isActive,
    };

    try {
      setSaving(true);
      if (editingId) {
        await api(`/payment-forms/admin/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        notify('success', 'Payment form updated');
      } else {
        await api.post('/payment-forms/admin', payload);
        notify('success', 'Payment form created successfully');
      }
      setShowCreate(false);
      setEditingId(null);
      setFormData(emptyForm);
      await loadData();
    } catch (error) {
      notify('error', error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(form) {
    try {
      await api(`/payment-forms/admin/${form.id}`, { method: 'DELETE' });
      notify('success', `"${form.title}" deleted`);
      setConfirmDelete(null);
      await loadData();
    } catch (error) {
      // The API refuses to delete a form that has taken payments; its message
      // explains why and what to do instead, so it is shown as-is.
      notify('error', error.message);
      setConfirmDelete(null);
    }
  }

  if (loading) return <div className="payment-forms"><p>Loading...</p></div>;

  return (
    <main className="payment-forms">
      <header className="page-action-row">
        <span className="forms-count">
          {forms.length} payment form{forms.length === 1 ? '' : 's'}
        </span>
        <button className="primary" onClick={openCreate}>
          <Plus size={16} />
          Create Form
        </button>
      </header>

      <section className="forms-list">
        {forms.length === 0 ? (
          <div className="empty">
            <h3>No payment forms yet</h3>
            <p>Click "Create Form" to add your first payment collection form.</p>
          </div>
        ) : (
          <div className="payment-forms-table-wrap">
            <table className="payment-forms-table">
              <thead>
                <tr>
                  <th>Form</th>
                  <th>Branch</th>
                  <th className="num">Categories</th>
                  <th className="num">Submissions</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th className="actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {forms.map(form => {
                  // Expired is not the same as switched off, and the two need
                  // telling apart: one is a decision, the other is a date
                  // passing on its own.
                  const expiry = formatExpiry(form.expires_at_utc);
                  const status = !form.is_active ? 'inactive' : form.expired ? 'expired' : 'active';
                  return (
                    <tr key={form.id} className={status === 'active' ? '' : 'is-dim'}>
                      <td>
                        <strong>{form.title}</strong>
                        {form.description && <small>{form.description}</small>}
                      </td>
                      <td>{form.branch_name}</td>
                      <td className="num">{form.categoryCount}</td>
                      <td className="num">{form.submissionCount}</td>
                      <td className={form.expired ? 'expiry-past' : ''}>
                        {expiry || <span className="muted">No expiry</span>}
                      </td>
                      <td>
                        <span className={`status ${status}`}>
                          {status === 'inactive' ? 'Inactive' : status === 'expired' ? 'Expired' : 'Active'}
                        </span>
                      </td>
                      <td className="actions-col">
                        <div className="row-actions">
                          <button
                            type="button"
                            title="Copy public link"
                            aria-label={`Copy the public link for ${form.title}`}
                            onClick={() => {
                              navigator.clipboard.writeText(`${window.location.origin}/payment/${form.form_key}`);
                              notify('success', 'Payment form link copied');
                            }}
                          >
                            <Copy size={15} />
                          </button>
                          <a
                            href={`/payment/${form.form_key}`}
                            target="_blank"
                            rel="noreferrer"
                            title="Preview form"
                            aria-label={`Preview ${form.title}`}
                          >
                            <Eye size={15} />
                          </a>
                          <button
                            type="button"
                            title="Edit form"
                            aria-label={`Edit ${form.title}`}
                            onClick={() => openEdit(form)}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            className="danger"
                            title="Delete form"
                            aria-label={`Delete ${form.title}`}
                            onClick={() => setConfirmDelete(form)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirmDelete && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setConfirmDelete(null); }}>
          <section className="modal-content confirm-delete-modal">
            <header className="modal-header">
              <div className="payment-modal-title">
                <span className="danger-icon"><Trash2 size={18} /></span>
                <div>
                  <h2>Delete payment form</h2>
                  <p>This cannot be undone.</p>
                </div>
              </div>
            </header>
            <div className="confirm-delete-body">
              <p><strong>{confirmDelete.title}</strong> and its {confirmDelete.categoryCount} categor{confirmDelete.categoryCount === 1 ? 'y' : 'ies'} will be removed, and its public link will stop working.</p>
              {confirmDelete.submissionCount > 0 && (
                <p className="confirm-warning">
                  This form has {confirmDelete.submissionCount} payment submission{confirmDelete.submissionCount === 1 ? '' : 's'}.
                  Forms that have taken money cannot be deleted — deactivate it instead to close the link and keep the records.
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button type="button" className="danger-btn" onClick={() => handleDelete(confirmDelete)}>
                <Trash2 size={15} />
                Delete form
              </button>
            </div>
          </section>
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay">
          <section className="modal-content payment-form-modal">
            <header className="modal-header">
              <div className="payment-modal-title"><span><CreditCard size={19} /></span><div><h2>{editingId ? 'Edit Payment Form' : 'Create Payment Form'}</h2><p>Configure customer details and payment options.</p></div></div>
              <button type="button" onClick={() => { setShowCreate(false); setEditingId(null); }}>
                <X size={20} />
              </button>
            </header>

            <form className="payment-form-create" onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
              <div className="payment-form-basics-row">
              <div className="form-group">
                <label><FileText size={14} />Form Title *</label>
                <input
                  type="text"
                  placeholder="e.g., Admission Fee Payment"
                  value={formData.title}
                  onChange={e => setFormData({ ...formData, title: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label><FileText size={14} />Description</label>
                <textarea
                  placeholder="What is this payment for?"
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  rows={1}
                />
              </div>

              <div className="form-group">
                <label><Building2 size={14} />Branch *</label>
                <select
                  value={formData.branchId}
                  onChange={e => setFormData({ ...formData, branchId: e.target.value })}
                  required
                >
                  <option value="">Select branch</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id} disabled={!b.enabled || !b.configured}>
                      {b.name} {!b.enabled || !b.configured ? ' · Jodo not configured' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group selection-type-group">
                <label><ListChecks size={14} />Selection Type *</label>
                <div className="selection-type-toggle" role="group" aria-label="Selection type">
                  <button
                    type="button"
                    className={formData.selectionType === 'single' ? 'active' : ''}
                    aria-pressed={formData.selectionType === 'single'}
                    onClick={() => setFormData({ ...formData, selectionType: 'single' })}
                  >
                    <CircleDot size={15} />
                    <span><strong>Single</strong><small>One category</small></span>
                  </button>
                  <button
                    type="button"
                    className={formData.selectionType === 'multiple' ? 'active' : ''}
                    aria-pressed={formData.selectionType === 'multiple'}
                    onClick={() => setFormData({ ...formData, selectionType: 'multiple' })}
                  >
                    <ListPlus size={15} />
                    <span><strong>Multiple</strong><small>Many categories</small></span>
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label><CalendarClock size={14} />Expiry Date</label>
                <input
                  type="date"
                  value={formData.expiresOn}
                  onChange={e => setFormData({ ...formData, expiresOn: e.target.value })}
                />
                <small className="field-hint">
                  {formData.expiresOn
                    ? 'The link stops accepting payments at the end of this day.'
                    : 'Leave blank for no expiry.'}
                </small>
              </div>

              <div className="form-group">
                <label><ListChecks size={14} />Status</label>
                <select
                  value={formData.isActive ? 'active' : 'inactive'}
                  onChange={e => setFormData({ ...formData, isActive: e.target.value === 'active' })}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              </div>

              <FormFieldBuilder
                fields={formData.fields}
                onChange={fields => setFormData({ ...formData, fields })}
              />

              <fieldset className="categories-section">
                <legend><Tags size={15} />Payment Categories *</legend>
                <p className="legend-text">Define payment options customers can select from</p>
                {formData.categories.map((cat, idx) => (
                  <div key={idx} className="category-row">
                    <input
                      type="text"
                      placeholder="Category name (e.g., Admission Fee)"
                      value={cat.name}
                      onChange={e => {
                        const newCats = [...formData.categories];
                        newCats[idx].name = e.target.value;
                        setFormData({ ...formData, categories: newCats });
                      }}
                    />
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="Amount (₹)"
                      value={cat.amount}
                      onChange={e => {
                        const newCats = [...formData.categories];
                        newCats[idx].amount = e.target.value;
                        setFormData({ ...formData, categories: newCats });
                      }}
                    />
                    {formData.categories.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setFormData({
                            ...formData,
                            categories: formData.categories.filter((_, i) => i !== idx)
                          });
                        }}
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setFormData({
                      ...formData,
                      categories: [...formData.categories, { name: '', amount: '', selectionType: 'single', isRequired: false }]
                    });
                  }}
                >
                  <Plus size={16} />
                  Add Category
                </button>
              </fieldset>

              <div className="form-group">
                <label><MessageSquareText size={14} />Success Message</label>
                <textarea
                  placeholder="Message shown after successful payment"
                  value={formData.successMessage}
                  onChange={e => setFormData({ ...formData, successMessage: e.target.value })}
                  rows={2}
                />
              </div>

              <div className="form-group">
                <label><Link size={14} />Redirect URL (after payment)</label>
                <input
                  type="url"
                  placeholder="https://example.com/success"
                  value={formData.redirectUrl}
                  onChange={e => setFormData({ ...formData, redirectUrl: e.target.value })}
                />
              </div>

              <div className="modal-footer">
                <button type="button" onClick={() => { setShowCreate(false); setEditingId(null); }}>Cancel</button>
                <button type="submit" className="primary" disabled={saving}>
                  {editingId ? <Pencil size={16} /> : <Plus size={16} />}
                  {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Form'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
