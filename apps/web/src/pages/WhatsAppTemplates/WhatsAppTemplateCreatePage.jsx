import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Save, FileText, AlertCircle, CheckCircle, Plus, Trash2 } from 'lucide-react';
import { api } from '../../api';
import WhatsAppTemplatePreview from './WhatsAppTemplatePreview';
import './WhatsAppTemplateCreatePage.css';

export default function WhatsAppTemplateCreatePage({
  integrationId,
  templateId = null,
  onSave,
  onCancel,
  businessName = 'Pallavi International School'
}) {
  const [loading, setLoading] = useState(!!templateId);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState('basic');
  const [validationErrors, setValidationErrors] = useState({});
  const scrollContainerRef = useRef(null);

  const [form, setForm] = useState({
    template_name: '',
    category: 'MARKETING',
    language: 'English',
    template_type: 'TEXT',
    header_content: '',
    body: '',
    footer: '',
    sample_values: {},
    buttons: []
  });

  const [currentButton, setCurrentButton] = useState({
    type: 'QUICK_REPLY',
    button_text: '',
    button_value: '',
    cta_type: 'VISIT_WEBSITE'
  });

  useEffect(() => {
    if (templateId) {
      loadTemplate();
    }
  }, [templateId]);

  const loadTemplate = async () => {
    try {
      const response = await api.get(`/whatsapp/integrations/${integrationId}/templates/${templateId}`);
      const template = response.data.data;
      setForm({
        template_name: template.template_name,
        category: template.category,
        language: template.language,
        template_type: template.template_type,
        header_content: template.header_content || '',
        body: template.body,
        footer: template.footer || '',
        sample_values: template.sample_values_json || {},
        buttons: template.buttons_json || []
      });
    } catch (error) {
      setValidationErrors({ load: error.message });
    } finally {
      setLoading(false);
    }
  };

  const variables = form.body?.match(/\{\{(\d+)\}\}/g) || [];

  const validate = () => {
    const errors = {};

    if (!form.template_name?.trim()) {
      errors.template_name = 'Template name is required';
    } else if (!/^[a-z0-9_]+$/.test(form.template_name)) {
      errors.template_name = 'Only lowercase letters, numbers, and underscores';
    }

    if (!form.category) {
      errors.category = 'Category is required';
    }

    if (!form.language) {
      errors.language = 'Language is required';
    }

    if (!form.template_type) {
      errors.template_type = 'Template type is required';
    }

    if (form.header_type !== 'NONE' && form.header_type === 'TEXT' && !form.header_content?.trim()) {
      errors.header_content = 'Header content is required for TEXT header';
    }

    if (!form.body?.trim()) {
      errors.body = 'Message body is required';
    } else if (form.body.length > 1024) {
      errors.body = `Message exceeds maximum length (${form.body.length}/1024)`;
    }

    if (variables.length > 0) {
      for (let i = 1; i <= variables.length; i++) {
        const varKey = `{{${i}}}`;
        if (!form.sample_values[varKey]?.trim()) {
          errors[`sample_${i}`] = `Sample value for {{${i}}} is required`;
        }
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (validationErrors[field]) {
      const newErrors = { ...validationErrors };
      delete newErrors[field];
      setValidationErrors(newErrors);
    }
  };

  const handleAddButton = () => {
    if (!currentButton.button_text?.trim()) {
      setValidationErrors(prev => ({ ...prev, button_text: 'Button text is required' }));
      return;
    }

    setForm(prev => ({
      ...prev,
      buttons: [...prev.buttons, { ...currentButton }]
    }));

    setCurrentButton({
      type: 'QUICK_REPLY',
      button_text: '',
      button_value: '',
      cta_type: 'VISIT_WEBSITE'
    });
  };

  const handleRemoveButton = (idx) => {
    setForm(prev => ({
      ...prev,
      buttons: prev.buttons.filter((_, i) => i !== idx)
    }));
  };

  const handleSubmit = async (isDraft = false) => {
    if (!validate()) return;

    setSaving(true);
    try {
      const payload = {
        template_name: form.template_name.trim().toLowerCase(),
        category: form.category,
        language: form.language,
        template_type: form.template_type,
        header_content: form.header_content || null,
        body: form.body,
        footer: form.footer || null,
        sample_values: form.sample_values,
        buttons: form.buttons,
        variables: variables
      };

      let response;
      if (templateId) {
        response = await api.put(
          `/whatsapp/integrations/${integrationId}/templates/${templateId}`,
          payload
        );
      } else {
        response = await api.post(
          `/whatsapp/integrations/${integrationId}/templates`,
          payload
        );
      }

      if (!isDraft && response.data?.data?.id) {
        await api.post(
          `/whatsapp/integrations/${integrationId}/templates/${response.data.data.id}/submit`
        );
      }

      if (onSave) {
        onSave(response.data?.data);
      }
    } catch (error) {
      setValidationErrors({ submit: error.message });
    } finally {
      setSaving(false);
    }
  };

  const requiredFieldsCount = Object.keys(validationErrors).filter(k => validationErrors[k]).length;
  const isReady = requiredFieldsCount === 0 && form.body?.trim();

  if (loading) {
    return (
      <div className="template-create-loading">
        <div className="spinner"></div>
        <p>Loading template...</p>
      </div>
    );
  }

  return (
    <div className="template-create-container">
      {/* Header */}
      <div className="template-create-header">
        <div>
          <h2 className="page-title">Create WhatsApp Template</h2>
          <p className="page-subtitle">
            Create an approved WhatsApp Business template that can be submitted to Meta through AiSensy
          </p>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-secondary" onClick={() => handleSubmit(true)}>Save Draft</button>
          <button className="btn btn-primary" onClick={() => handleSubmit(false)} disabled={!isReady || saving}>
            {saving ? 'Creating...' : 'Create Template'}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="template-create-content">
        {/* Left Column - Form */}
        <div className="template-form-column" ref={scrollContainerRef}>
          {/* Basic Information */}
          <Section
            id="basic"
            title="Basic Information"
            expanded={activeSection === 'basic'}
            onToggle={() => setActiveSection(activeSection === 'basic' ? null : 'basic')}
          >
            <div className="form-grid-2">
              <FormField
                label="Template Name *"
                error={validationErrors.template_name}
              >
                <input
                  type="text"
                  value={form.template_name}
                  onChange={(e) => handleChange('template_name', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                  placeholder="e.g., order_confirmation"
                  className="input"
                />
                <small className="hint">Lowercase letters, numbers, underscores only</small>
              </FormField>

              <FormField
                label="Category *"
                error={validationErrors.category}
              >
                <select
                  value={form.category}
                  onChange={(e) => handleChange('category', e.target.value)}
                  className="input"
                >
                  <option value="MARKETING">Marketing</option>
                  <option value="UTILITY">Utility</option>
                  <option value="AUTHENTICATION">Authentication</option>
                </select>
              </FormField>

              <FormField
                label="Language *"
                error={validationErrors.language}
              >
                <select
                  value={form.language}
                  onChange={(e) => handleChange('language', e.target.value)}
                  className="input"
                >
                  {['English', 'Hindi', 'Spanish', 'French', 'German', 'Portuguese', 'Chinese', 'Japanese'].map(lang => (
                    <option key={lang} value={lang}>{lang}</option>
                  ))}
                </select>
              </FormField>

              <FormField
                label="Template Type *"
                error={validationErrors.template_type}
              >
                <select
                  value={form.template_type}
                  onChange={(e) => handleChange('template_type', e.target.value)}
                  className="input"
                >
                  <option value="TEXT">Text</option>
                  <option value="IMAGE">Image</option>
                  <option value="VIDEO">Video</option>
                  <option value="DOCUMENT">Document</option>
                </select>
              </FormField>
            </div>
          </Section>

          {/* Header - Only for media templates */}
          {form.template_type !== 'TEXT' && (
            <Section
              id="header"
              title="Header Content (Optional)"
              expanded={activeSection === 'header'}
              onToggle={() => setActiveSection(activeSection === 'header' ? null : 'header')}
            >
              <FormField
                label={`${form.template_type} URL`}
                error={validationErrors.header_content}
              >
                <input
                  type="text"
                  value={form.header_content}
                  onChange={(e) => handleChange('header_content', e.target.value)}
                  placeholder="https://..."
                  className="input"
                />
              </FormField>
            </Section>
          )}

          {/* Message Body */}
          <Section
            id="body"
            title="Message Body *"
            expanded={activeSection === 'body'}
            onToggle={() => setActiveSection(activeSection === 'body' ? null : 'body')}
            required
          >
            <FormField
              label="Body Text"
              error={validationErrors.body}
            >
              <textarea
                value={form.body}
                onChange={(e) => handleChange('body', e.target.value)}
                placeholder="Enter message body. Use {{1}}, {{2}} for variables"
                className="input textarea"
                maxLength="1024"
                rows="8"
              />
              <div className="char-count">
                {form.body.length} / 1024
              </div>
              <small className="hint">
                {"Use {{1}}, {{2}}, etc. for variables. Supports **bold**, __underline__, ~~strike~~"}
              </small>
            </FormField>
          </Section>

          {/* Variables */}
          {variables.length > 0 && (
            <Section
              id="variables"
              title={`Variables (${variables.length})`}
              expanded={activeSection === 'variables'}
              onToggle={() => setActiveSection(activeSection === 'variables' ? null : 'variables')}
              required
            >
              <div className="variables-section">
                {variables.map((variable, idx) => {
                  const varNum = parseInt(variable.replace(/\{\{|\}\}/g, ''));
                  const varKey = `{{${varNum}}}`;
                  return (
                    <FormField
                      key={idx}
                      label={`Sample Value for ${variable}`}
                      error={validationErrors[`sample_${varNum}`]}
                    >
                      <input
                        type="text"
                        value={form.sample_values[varKey] || ''}
                        onChange={(e) => handleChange('sample_values', {
                          ...form.sample_values,
                          [varKey]: e.target.value
                        })}
                        placeholder={`Example value for ${variable}`}
                        className="input"
                      />
                    </FormField>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Footer */}
          <Section
            id="footer"
            title="Footer (Optional)"
            expanded={activeSection === 'footer'}
            onToggle={() => setActiveSection(activeSection === 'footer' ? null : 'footer')}
          >
            <FormField label="Footer Text">
              <input
                type="text"
                value={form.footer}
                onChange={(e) => handleChange('footer', e.target.value)}
                placeholder="e.g., Company name or footer text"
                className="input"
                maxLength="60"
              />
            </FormField>
          </Section>

          {/* Buttons */}
          <Section
            id="buttons"
            title="Buttons (Optional)"
            expanded={activeSection === 'buttons'}
            onToggle={() => setActiveSection(activeSection === 'buttons' ? null : 'buttons')}
          >
            {form.buttons.length > 0 && (
              <div className="buttons-list">
                {form.buttons.map((btn, idx) => (
                  <div key={idx} className="button-item">
                    <div className="button-info">
                      <span className="button-type">{btn.type}</span>
                      <span className="button-text">{btn.button_text}</span>
                    </div>
                    <button
                      className="btn-remove"
                      onClick={() => handleRemoveButton(idx)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="add-button-form">
              <div className="form-grid-2">
                <FormField label="Button Type">
                  <select
                    value={currentButton.type}
                    onChange={(e) => setCurrentButton({ ...currentButton, type: e.target.value })}
                    className="input"
                  >
                    <option value="QUICK_REPLY">Quick Reply</option>
                    <option value="CALL_TO_ACTION">Call to Action</option>
                  </select>
                </FormField>

                {currentButton.type === 'CALL_TO_ACTION' && (
                  <FormField label="Action Type">
                    <select
                      value={currentButton.cta_type}
                      onChange={(e) => setCurrentButton({ ...currentButton, cta_type: e.target.value })}
                      className="input"
                    >
                      <option value="VISIT_WEBSITE">Visit Website</option>
                      <option value="CALL_PHONE">Call Phone</option>
                    </select>
                  </FormField>
                )}
              </div>

              <FormField label="Button Text">
                <input
                  type="text"
                  value={currentButton.button_text}
                  onChange={(e) => setCurrentButton({ ...currentButton, button_text: e.target.value })}
                  placeholder="e.g., View Website"
                  className="input"
                />
              </FormField>

              <FormField label="Button Value">
                <input
                  type="text"
                  value={currentButton.button_value}
                  onChange={(e) => setCurrentButton({ ...currentButton, button_value: e.target.value })}
                  placeholder="e.g., https://example.com"
                  className="input"
                />
              </FormField>

              <button className="btn btn-secondary btn-block" onClick={handleAddButton}>
                <Plus size={16} />
                Add Button
              </button>
            </div>
          </Section>
        </div>

        {/* Right Column - Preview */}
        <div className="template-preview-column">
          <div className="preview-sticky">
            <h3 className="preview-title">Live Preview</h3>
            <WhatsAppTemplatePreview
              template={{
                template_type: form.template_type,
                header_content: form.header_content,
                body: form.body,
                footer: form.footer,
                sample_text: Object.values(form.sample_values).join(' '),
                buttons: form.buttons,
                quick_replies: form.buttons.filter(b => b.type === 'QUICK_REPLY')
              }}
              businessName={businessName}
            />
          </div>
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="template-create-footer">
        <div className="footer-status">
          {isReady ? (
            <div className="status-ready">
              <CheckCircle size={16} />
              Ready for Submission
            </div>
          ) : (
            <div className="status-error">
              <AlertCircle size={16} />
              {requiredFieldsCount} {requiredFieldsCount === 1 ? 'Field' : 'Fields'} Required
            </div>
          )}
        </div>
        <div className="footer-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-secondary" onClick={() => handleSubmit(true)}>Save Draft</button>
          <button className="btn btn-primary" onClick={() => handleSubmit(false)} disabled={!isReady || saving}>
            {saving ? 'Creating...' : 'Create Template'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ id, title, expanded, onToggle, children, required = false }) {
  return (
    <div className="form-section">
      <button className="section-header" onClick={onToggle}>
        <div className="section-title">
          {title}
          {required && <span className="required-star">*</span>}
        </div>
        <ChevronDown
          size={18}
          className={`chevron ${expanded ? 'expanded' : ''}`}
        />
      </button>
      {expanded && (
        <div className="section-content">
          {children}
        </div>
      )}
    </div>
  );
}

function FormField({ label, error, children }) {
  return (
    <div className="form-field">
      {label && <label className="field-label">{label}</label>}
      {children}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
