import { useEffect, useState } from 'react';
import { Plus, Copy, Eye, Trash2, X } from 'lucide-react';
import { api } from '../api.js';
import FormFieldBuilder from '../components/FormFieldBuilder.jsx';
import '../styles/PaymentForms.css';

export default function PaymentFormsPage({ onMessage }) {
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    branchId: '',
    selectionType: 'single',
    fields: [],
    categories: [{ name: '', amount: '' }],
    successMessage: '',
    redirectUrl: '',
  });
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

  async function handleCreate() {
    if (!formData.title || !formData.branchId) {
      notify('error', 'Title and branch are required');
      return;
    }

    const validCategories = formData.categories.filter(c => c.name && c.amount);
    if (!validCategories.length) {
      notify('error', 'Add at least one category with name and amount');
      return;
    }

    try {
      const result = await api.post('/payment-forms/admin', {
        title: formData.title,
        description: formData.description,
        branchId: Number(formData.branchId),
        selectionType: formData.selectionType,
        fields: formData.fields,
        categories: validCategories.map(c => ({
          name: c.name,
          amount: Number(c.amount),
        })),
        successMessage: formData.successMessage,
        redirectUrl: formData.redirectUrl,
      });

      notify('success', 'Payment form created successfully');
      setShowCreate(false);
      setFormData({
        title: '',
        description: '',
        branchId: '',
        selectionType: 'single',
        fields: [],
        categories: [{ name: '', amount: '' }],
        successMessage: '',
        redirectUrl: '',
      });
      await loadData();
    } catch (error) {
      notify('error', error.message);
    }
  }

  if (loading) return <div className="payment-forms"><p>Loading...</p></div>;

  return (
    <main className="payment-forms">
      <header>
        <div>
          <span>PAYMENT FORMS</span>
          <h1>Public Payment Collection</h1>
          <p>Create reusable payment forms for customers to fill in their details and select categories to pay.</p>
        </div>
        <button className="primary" onClick={() => setShowCreate(true)}>
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
          <div className="forms-grid">
            {forms.map(form => (
              <div key={form.id} className="form-card">
                <div className="form-header">
                  <h3>{form.title}</h3>
                  <span className={`status ${form.is_active ? 'active' : 'inactive'}`}>
                    {form.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p className="branch-info">{form.branch_name}</p>
                <p className="category-count">{form.categoryCount} categor{form.categoryCount !== 1 ? 'ies' : 'y'}</p>
                <p className="submission-count">{form.submissionCount} submission{form.submissionCount !== 1 ? 's' : ''}</p>
                <div className="form-actions">
                  <button
                    title="Copy public link"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/payment/${form.form_key}`);
                      notify('success', 'Payment form link copied');
                    }}
                  >
                    <Copy size={16} />
                  </button>
                  <a href={`/payment/${form.form_key}`} target="_blank" rel="noreferrer" title="Preview form">
                    <Eye size={16} />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {showCreate && (
        <div className="modal-overlay">
          <section className="modal-content">
            <header className="modal-header">
              <h2>Create Payment Form</h2>
              <button onClick={() => setShowCreate(false)}>
                <X size={20} />
              </button>
            </header>

            <form onSubmit={(e) => { e.preventDefault(); handleCreate(); }}>
              <div className="form-group">
                <label>Form Title *</label>
                <input
                  type="text"
                  placeholder="e.g., Admission Fee Payment"
                  value={formData.title}
                  onChange={e => setFormData({ ...formData, title: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  placeholder="What is this payment for?"
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                />
              </div>

              <div className="form-group">
                <label>Branch *</label>
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

              <div className="form-group">
                <label>Selection Type *</label>
                <select
                  value={formData.selectionType}
                  onChange={e => setFormData({ ...formData, selectionType: e.target.value })}
                >
                  <option value="single">Single Selection (Radio Buttons)</option>
                  <option value="multiple">Multiple Selection (Checkboxes)</option>
                </select>
                <small style={{ color: '#6b7280', marginTop: '0.25rem' }}>
                  {formData.selectionType === 'single'
                    ? 'Customers can only select one category'
                    : 'Customers can select multiple categories'}
                </small>
              </div>

              <FormFieldBuilder
                fields={formData.fields}
                onChange={fields => setFormData({ ...formData, fields })}
              />

              <fieldset className="categories-section">
                <legend>Payment Categories *</legend>
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
                <label>Success Message</label>
                <textarea
                  placeholder="Message shown after successful payment"
                  value={formData.successMessage}
                  onChange={e => setFormData({ ...formData, successMessage: e.target.value })}
                  rows={2}
                />
              </div>

              <div className="form-group">
                <label>Redirect URL (after payment)</label>
                <input
                  type="url"
                  placeholder="https://example.com/success"
                  value={formData.redirectUrl}
                  onChange={e => setFormData({ ...formData, redirectUrl: e.target.value })}
                />
              </div>

              <div className="modal-footer">
                <button type="button" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="primary">
                  <Plus size={16} />
                  Create Form
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
