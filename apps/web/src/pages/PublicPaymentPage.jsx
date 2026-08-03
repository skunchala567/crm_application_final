import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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

  function calculateTotal() {
    if (!form) return 0;
    return form.categories
      .filter(c => formData.selectedCategoryIds.includes(c.id))
      .reduce((sum, c) => sum + Number(c.amount), 0);
  }

  function toggleCategory(categoryId) {
    const newSelected = [...formData.selectedCategoryIds];
    if (form.selection_type === 'single') {
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

    if (!formData.name || !formData.email || !formData.phone || !formData.studentName) {
      setError('Please fill in all required fields');
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
      <div className="public-payment loading">
        <Loader className="spinner" />
        <p>Loading payment form...</p>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="public-payment error-page">
        <div className="error-box">
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
      <div className="payment-container">
        <div className="payment-header">
          <h1>{form.title}</h1>
          {form.description && <p className="description">{form.description}</p>}
        </div>

        {error && (
          <div className="error-banner">
            <AlertCircle size={20} />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="payment-form">
          <div className="form-section">
            <h3>Personal Information</h3>

            <div className="form-group">
              <label>Full Name *</label>
              <input
                required
                type="text"
                placeholder="Enter your full name"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>Email Address *</label>
              <input
                required
                type="email"
                placeholder="your@email.com"
                value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>Phone Number *</label>
              <input
                required
                type="tel"
                inputMode="numeric"
                placeholder="10-digit mobile number"
                value={formData.phone}
                onChange={e => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>Student Name *</label>
              <input
                required
                type="text"
                placeholder="Student's full name"
                value={formData.studentName}
                onChange={e => setFormData({ ...formData, studentName: e.target.value })}
              />
            </div>
          </div>

          <div className="form-section">
            <h3>Select Categories</h3>
            <div className="categories-list">
              {form.categories.map(category => (
                <label key={category.id} className="category-item">
                  <input
                    type={form.selection_type === 'single' ? 'radio' : 'checkbox'}
                    name={form.selection_type === 'single' ? 'category-single' : 'category-multiple'}
                    value={category.id}
                    checked={formData.selectedCategoryIds.includes(category.id)}
                    onChange={() => toggleCategory(category.id)}
                  />
                  <span className="category-info">
                    <span className="category-name">{category.category_name}</span>
                    <span className="category-amount">₹{Number(category.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="amount-display">
            <span>Total Amount</span>
            <strong>₹{Number(total).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          </div>

          <button
            type="submit"
            disabled={submitting || total <= 0}
            className="submit-button"
          >
            {submitting ? (
              <>
                <Loader size={18} className="spinner-small" />
                Processing...
              </>
            ) : (
              `Proceed to Payment - ₹${Number(total).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            )}
          </button>

          <p className="security-note">
            Secured by <strong>Jodo Pay</strong> • Your information is protected
          </p>
        </form>
      </div>
    </div>
  );
}
