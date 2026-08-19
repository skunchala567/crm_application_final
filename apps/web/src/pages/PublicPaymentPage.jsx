import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Loader } from 'lucide-react';
import { api } from '../api.js';
import '../styles/PublicPayment.css';

export default function PublicPaymentPage() {
  const { formKey } = useParams();
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    studentName: '',
    selectedCategoryIds: [],
  });
  // Answers to whatever the Customer Details Form asked for, keyed by field name.
  const [answers, setAnswers] = useState({});

  useEffect(() => {
    loadForm();
  }, [formKey]);

  async function loadForm() {
    try {
      setLoading(true);
      const result = await api(`/payment-forms/public/${formKey}`);
      setForm(result.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  /*
   * Which boxes the page draws.
   *
   * It used to draw four fixed ones -- full name, email, phone, student name
   * -- no matter what the Customer Details Form said, so a form configured
   * with two fields showed four nobody had asked for and neither of the two.
   *
   * A payer name, email and phone are still collected on every form: Jodo
   * will not create a payment link without them. Anything else comes from the
   * configuration, and a form that configures none simply asks for less.
   */
  const PAYER_FIELDS = [
    { name: 'name', label: 'Full Name', type: 'text', required: true, placeholder: 'Enter your full name', core: true },
    { name: 'email', label: 'Email Address', type: 'email', required: true, placeholder: 'your@email.com', core: true },
    { name: 'phone', label: 'Phone Number', type: 'tel', required: true, placeholder: '10-digit mobile number', core: true },
  ];

  function visibleFields() {
    const configured = Array.isArray(form?.fields) ? form.fields : [];
    // A configured field that collects the payer's own name, email or phone
    // replaces the built-in one rather than sitting beside a duplicate.
    const claimed = new Set(configured.map(f => String(f.name || '').toLowerCase()));
    const core = PAYER_FIELDS.filter(f => !claimed.has(f.name));
    return [...core, ...configured.map(f => ({ ...f, core: PAYER_FIELDS.some(p => p.name === String(f.name || '').toLowerCase()) }))];
  }

  /** Core fields live on formData; everything else lives in answers. */
  const valueOf = (field) => (PAYER_FIELDS.some(p => p.name === field.name)
    ? formData[field.name === 'name' ? 'name' : field.name]
    : (answers[field.name] ?? ''));

  const setValue = (field, value) => {
    if (PAYER_FIELDS.some(p => p.name === field.name)) {
      setFormData(current => ({ ...current, [field.name]: value }));
    } else {
      setAnswers(current => ({ ...current, [field.name]: value }));
      // Student name is what Jodo is told the payment is for, so a field
      // named for it is passed through rather than left in the extras.
      if (String(field.name).toLowerCase() === 'studentname') {
        setFormData(current => ({ ...current, studentName: value }));
      }
    }
  };

  /** The public payload names it selectionType; selection_type never existed
      on it, so a single-choice form drew tick boxes and accepted several. */
  const isSingleChoice = () => (form?.selectionType || 'single') === 'single';

  function calculateTotal() {
    if (!form) return 0;
    return form.categories
      .filter(c => formData.selectedCategoryIds.includes(c.id))
      .reduce((sum, c) => sum + Number(c.amount), 0);
  }

  function toggleCategory(categoryId) {
    const newSelected = [...formData.selectedCategoryIds];
    if (isSingleChoice()) {
      // For single select, only one can be selected at a time
      setFormData({
        ...formData,
        selectedCategoryIds: newSelected.includes(categoryId) ? [] : [categoryId]
      });
    } else {
      // Multiple select
      setFormData({
        ...formData,
        selectedCategoryIds: newSelected.includes(categoryId)
          ? newSelected.filter(id => id !== categoryId)
          : newSelected.concat(categoryId)
      });
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const missing = visibleFields().find(field => field.required && !String(valueOf(field) || '').trim());
    if (missing) {
      setError(`Please fill in ${missing.label || missing.name}`);
      return;
    }

    if (!formData.selectedCategoryIds.length) {
      setError('Please select at least one category');
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.post(`/payment-forms/public/${formKey}/submit`, {
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        studentName: formData.studentName,
        selectedCategoryIds: formData.selectedCategoryIds,
        customFields: answers,
      });

      if (result.data?.redirectUrl) {
        window.location.href = result.data.redirectUrl;
      } else {
        setError('Failed to generate payment link');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="public-payment pp-status">
        <Loader className="pp-spinner" />
        <p>Loading payment form...</p>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="public-payment pp-status">
        <div className="pp-status-box">
          <AlertCircle size={48} />
          <h2>Payment Form Not Found</h2>
          <p>The payment form you're looking for doesn't exist or has been deactivated.</p>
        </div>
      </div>
    );
  }

  const total = calculateTotal();

  return (
    <div className="public-payment">
      <div className="pp-card">
        <div className="pp-head">
          {/* The logo is optional, and a form without one keeps the plain
              title rather than reserving an empty square for it. */}
          {form.logo && <img className="pp-logo" src={form.logo} alt="" />}
          <div className="pp-head-text">
            <h1>{form.title}</h1>
            {form.description && <p className="pp-description">{form.description}</p>}
          </div>
        </div>

        {error && (
          <div className="pp-alert">
            <AlertCircle size={20} />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="pp-form">
          <div className="pp-section">
            <h3>Your details</h3>
            <div className="pp-fields">
            {visibleFields().map(field => (
              <div className={`pp-field${['textarea', 'checkbox'].includes(field.type) ? ' pp-field-wide' : ''}`} key={field.name}>
                <label htmlFor={`pf-${field.name}`}>
                  {field.label || field.name}{field.required ? ' *' : ''}
                </label>
                {field.type === 'textarea' ? (
                  <textarea
                    id={`pf-${field.name}`}
                    rows={3}
                    required={Boolean(field.required)}
                    placeholder={field.placeholder || ''}
                    value={valueOf(field)}
                    onChange={e => setValue(field, e.target.value)}
                  />
                ) : field.type === 'select' ? (
                  <select
                    id={`pf-${field.name}`}
                    required={Boolean(field.required)}
                    value={valueOf(field)}
                    onChange={e => setValue(field, e.target.value)}
                  >
                    <option value="">{field.placeholder || 'Select an option'}</option>
                    {(field.options || []).map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                ) : field.type === 'checkbox' ? (
                  <label className="pp-checkbox">
                    <input
                      id={`pf-${field.name}`}
                      type="checkbox"
                      checked={valueOf(field) === 'yes'}
                      onChange={e => setValue(field, e.target.checked ? 'yes' : '')}
                    />
                    {field.placeholder || 'Yes'}
                  </label>
                ) : (() => {
                  const isPhone = field.type === 'phone' || field.type === 'tel';
                  return (
                  <input
                    id={`pf-${field.name}`}
                    type={field.type === 'phone' ? 'tel' : (field.type || 'text')}
                    inputMode={isPhone ? 'numeric' : undefined}
                    maxLength={isPhone ? 10 : undefined}
                    pattern={isPhone ? '[6-9][0-9]{9}' : undefined}
                    title={isPhone ? 'Enter a valid 10-digit Indian mobile number starting with 6-9' : undefined}
                    required={Boolean(field.required)}
                    placeholder={field.placeholder || ''}
                    value={valueOf(field)}
                    onChange={e => setValue(field, isPhone ? e.target.value.replace(/\D/g, '').slice(0, 10) : e.target.value)}
                  />
                  );
                })()}
              </div>
            ))}
            </div>
          </div>

          <div className="pp-section">
            <h3>Select categories</h3>
            <div className="pp-categories">
              {form.categories.map(category => (
                <label key={category.id} className="pp-category">
                  <input
                    type={isSingleChoice() ? 'radio' : 'checkbox'}
                    name={isSingleChoice() ? 'category-single' : 'category-multiple'}
                    value={category.id}
                    checked={formData.selectedCategoryIds.includes(category.id)}
                    onChange={() => toggleCategory(category.id)}
                  />
                  <span className="pp-category-info">
                    <span className="pp-category-name">{category.category_name}</span>
                    <span className="pp-category-amount">₹{Number(category.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="pp-footer">
          <div className="pp-total">
            <span>Total Amount</span>
            <strong>₹{Number(total).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          </div>

          <button
            type="submit"
            disabled={submitting || total <= 0}
            className="pp-submit"
          >
            {submitting ? (
              <>
                <Loader size={18} className="pp-spinner pp-spinner-sm" />
                Processing...
              </>
            ) : (
              `Proceed to Payment - ₹${Number(total).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            )}
          </button>

          <p className="pp-note">
            Secured by <strong>Jodo Pay</strong> • Your information is protected
          </p>
          </div>
        </form>
      </div>
    </div>
  );
}
