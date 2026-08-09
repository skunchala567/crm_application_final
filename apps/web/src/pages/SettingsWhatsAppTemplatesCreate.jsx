import { useEffect, useState } from 'react';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { api } from '../api';
import TemplateFormBuilder from '../components/TemplateFormBuilder';
import TemplatePreviewPanel from '../components/TemplatePreviewPanel';
import TemplateVisibilityPicker from '../components/TemplateVisibilityPicker';
import '../styles/SettingsWhatsAppTemplatesCreate.css';

export default function SettingsWhatsAppTemplatesCreate({ integrationId, onBack, onSuccess, initialTemplate = null }) {
  // Prefilled when duplicating; the operator still has to review and save.
  const [formData, setFormData] = useState({
    template_name: '',
    label: '',
    category: 'MARKETING',
    language: 'English',
    template_type: 'TEXT',
    header_content: '',
    body: '',
    footer: '',
    quick_replies: [],
    call_to_action: [],
    sample_text: '',
    message_action_type: 'NONE',
    // Who may use the template. The API has always accepted this on create;
    // the form simply never sent it, so every template came out visible to
    // administrators only.
    visibleUserIds: [],
    ...(initialTemplate || {}),
  });

  const [errors, setErrors] = useState({});

  /*
   * The label is the WhatsApp account the template is created on.
   *
   * It was a free-text "display name" that every operator had to invent, with
   * nothing tying it to the account chosen a moment earlier in the picker.
   * Filled in from the account and left read-only, so it always matches.
   *
   * Not applied when duplicating, where the copy carries the original's label.
   */
  useEffect(() => {
    if (!integrationId) return;
    let cancelled = false;
    api('/whatsapp/accounts')
      .then((result) => {
        if (cancelled) return;
        const account = (result.data || []).find(item => String(item.id) === String(integrationId));
        if (account?.name) setFormData(prev => ({ ...prev, label: account.name }));
      })
      .catch(() => { /* leave the field editable rather than block creation */ });
    return () => { cancelled = true; };
  }, [integrationId]);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState(null);

  const handleFieldChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: null
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError(null);
    setErrors({});

    try {
      setLoading(true);

      // ✅ FIXED: AiSensy always requires sample_text
      // - If no variables: use body as sample_text
      // - If variables: use provided sample_text
      const payload = { ...formData };
      const hasVariables = /\{\{(\d+)\}\}/.test(formData.body);
      if (!hasVariables) {
        payload.sample_text = formData.body;
      }

      const response = await api.post(
        `/whatsapp/integrations/${integrationId}/templates`,
        payload
      );

      if (onSuccess) {
        onSuccess(response.data?.data);
      } else {
        alert('Template created successfully!');
        onBack();
      }
    } catch (err) {
      if (err.response?.status === 400 && err.response?.data?.errors) {
        // Parse validation errors
        const fieldErrors = {};
        err.response.data.errors.forEach(error => {
          const match = error.match(/^(\w+):/);
          if (match) {
            fieldErrors[match[1]] = error.substring(match[1].length + 1).trim();
          }
        });
        setErrors(fieldErrors);
      } else if (err.response?.status === 409) {
        setServerError('Template with this name already exists');
      } else {
        setServerError(err.response?.data?.error?.message || err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (window.confirm('Discard unsaved changes?')) {
      onBack();
    }
  };

  return (
    <div className="settings-create-template">
      {/* Title and context removed with the page-header pattern; the back
          action is navigation and stays. */}
      <header className="create-page-header">
        <button className="btn-back" onClick={onBack}>
          <ArrowLeft size={17} />
          Back to templates
        </button>
      </header>

      {serverError && (
        <div className="alert alert-error">
          <AlertCircle size={18} />
          <span>{serverError}</span>
          <button onClick={() => setServerError(null)} className="alert-close">✕</button>
        </div>
      )}

      <div className="create-container">
        <form onSubmit={handleSubmit} className="template-form-wrapper">
          <TemplateFormBuilder
            formData={formData}
            onChange={handleFieldChange}
            errors={errors}
            lockLabel
          />

          <TemplateVisibilityPicker
            value={formData.visibleUserIds}
            onChange={(ids) => handleFieldChange('visibleUserIds', ids)}
            disabled={loading}
          />

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCancel}
              disabled={loading}
            >
              Discard
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? 'Submitting...' : 'Create template'}
            </button>
          </div>
        </form>

        <aside className="preview-sidebar">
          <TemplatePreviewPanel formData={formData} />
        </aside>
      </div>
    </div>
  );
}
