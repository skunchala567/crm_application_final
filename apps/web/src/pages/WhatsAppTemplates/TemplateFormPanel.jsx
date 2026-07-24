import { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, AlertCircle, CheckCircle, X } from 'lucide-react';
import { api } from '../../api';

export default function TemplateFormPanel({ integrationId, onCancel, onSuccess }) {
  const [form, setForm] = useState({
    name: '',
    label: '',
    category: 'MARKETING',
    language: 'English',
    type: 'TEXT',
    text: '',
    sample_text: '',
    message_action_type: 'NONE',
    call_to_action: [],
    quick_replies: []
  });

  const [currentCTA, setCurrentCTA] = useState({
    type: 'URL',
    button_title: '',
    button_value: ''
  });

  const [currentQuickReply, setCurrentQuickReply] = useState({
    button_title: '',
    button_value: ''
  });

  const [validationErrors, setValidationErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [showValidationChecklist, setShowValidationChecklist] = useState(false);

  const languages = [
    'Afrikaans', 'Albanian', 'Arabic', 'Azerbaijani', 'Bengali', 'Bulgarian', 'Catalan',
    'Chinese', 'Chinese (Hong Kong)', 'Chinese (Taiwan)', 'Croatian', 'Czech', 'Danish',
    'Dutch', 'English', 'English (UK)', 'English (US)', 'Estonian', 'Filipino', 'Finnish',
    'French', 'German', 'Greek', 'Gujarati', 'Hebrew', 'Hindi', 'Hungarian',
    'Indonesian', 'Italian', 'Japanese', 'Kannada', 'Korean', 'Malayalam', 'Marathi',
    'Norwegian', 'Persian', 'Polish', 'Portuguese', 'Portuguese (Brazil)', 'Punjabi',
    'Romanian', 'Russian', 'Slovak', 'Slovenian', 'Spanish', 'Spanish (Argentina)',
    'Spanish (Mexico)', 'Swedish', 'Tamil', 'Telugu', 'Thai', 'Turkish', 'Ukrainian',
    'Urdu', 'Vietnamese'
  ];

  const ctaTypes = ['URL', 'Phone Number', 'Dynamic URL'];

  // Validation logic
  const validate = () => {
    const errors = {};

    // Name validation (matches template_name rules)
    if (!form.name.trim()) {
      errors.name = 'Template name is required';
    } else if (!/^[a-z0-9_]+$/.test(form.name)) {
      errors.name = 'Only lowercase, numbers, and underscores allowed';
    } else if (form.name.includes(' ')) {
      errors.name = 'No spaces allowed';
    }

    // Label validation
    if (!form.label.trim()) {
      errors.label = 'Label is required';
    }

    // Category validation
    if (!form.category) {
      errors.category = 'Category is required';
    }

    // Language validation
    if (!form.language) {
      errors.language = 'Language is required';
    }

    // Text validation (body)
    if (!form.text.trim()) {
      errors.text = 'Message body is required';
    } else if (form.text.length > 1024) {
      errors.text = `Message exceeds maximum length (${form.text.length}/1024)`;
    }

    // Sample text validation (required if variables exist in text)
    if (form.text.includes('{{') && !form.sample_text.trim()) {
      errors.sample_text = 'Sample text required for variables';
    }

    // CTA buttons validation
    if (form.call_to_action.length > 0) {
      form.call_to_action.forEach((cta, idx) => {
        if (!cta.button_title) {
          errors[`cta_${idx}_title`] = 'Button title required';
        }
        if (!cta.button_value) {
          errors[`cta_${idx}_value`] = 'Button value required';
        }
        if (cta.type === 'URL' || cta.type === 'Dynamic URL') {
          if (!cta.button_value.startsWith('https://')) {
            errors[`cta_${idx}_value`] = 'HTTPS URL required';
          }
        }
        if (cta.type === 'Phone Number') {
          if (!/^\d{7,15}$/.test(cta.button_value.replace(/\D/g, ''))) {
            errors[`cta_${idx}_value`] = 'Valid phone number required';
          }
        }
      });
    }

    // Quick replies validation (max 3)
    if (form.quick_replies.length > 3) {
      errors.quick_replies = 'Maximum 3 quick replies allowed';
    }

    form.quick_replies.forEach((qr, idx) => {
      if (!qr.button_title) {
        errors[`qr_${idx}_title`] = 'Button title required';
      }
      if (qr.button_title && qr.button_title.length > 20) {
        errors[`qr_${idx}_title`] = 'Maximum 20 characters';
      }
    });

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const getValidationStatus = () => {
    const checks = {
      name: form.name && /^[a-z0-9_]+$/.test(form.name) && !form.name.includes(' '),
      label: !!form.label.trim(),
      category: !!form.category,
      language: !!form.language,
      text: form.text && form.text.length <= 1024 && form.text.length > 0,
      sample_text: !form.text.includes('{{') || !!form.sample_text.trim(),
      cta: form.call_to_action.every(cta => {
        if (!cta.button_title || !cta.button_value) return false;
        if (['URL', 'Dynamic URL'].includes(cta.type)) {
          return cta.button_value.startsWith('https://');
        } else if (cta.type === 'Phone Number') {
          return /^\d{7,15}$/.test(cta.button_value.replace(/\D/g, ''));
        }
        return true;
      }),
      quick_replies: form.quick_replies.length <= 3 && form.quick_replies.every(qr => qr.button_title && qr.button_title.length <= 20)
    };

    return checks;
  };

  const validationStatus = getValidationStatus();
  const isFormValid = Object.values(validationStatus).every(v => v);

  const handleAddCTA = () => {
    if (!currentCTA.button_title || !currentCTA.button_value) {
      setValidationErrors(prev => ({ ...prev, cta: 'Title and value required' }));
      return;
    }

    setForm(prev => ({
      ...prev,
      call_to_action: [...prev.call_to_action, { ...currentCTA }]
    }));

    setCurrentCTA({ type: 'URL', button_title: '', button_value: '' });
    setValidationErrors(prev => ({ ...prev, cta: undefined }));
  };

  const handleRemoveCTA = (idx) => {
    setForm(prev => ({
      ...prev,
      call_to_action: prev.call_to_action.filter((_, i) => i !== idx)
    }));
  };

  const handleAddQuickReply = () => {
    if (!currentQuickReply.button_title) {
      setValidationErrors(prev => ({ ...prev, qr: 'Button title required' }));
      return;
    }

    if (form.quick_replies.length >= 3) {
      setValidationErrors(prev => ({ ...prev, qr: 'Maximum 3 quick replies allowed' }));
      return;
    }

    setForm(prev => ({
      ...prev,
      quick_replies: [...prev.quick_replies, { button_title: currentQuickReply.button_title, button_value: currentQuickReply.button_title }]
    }));

    setCurrentQuickReply({ button_title: '', button_value: '' });
    setValidationErrors(prev => ({ ...prev, qr: undefined }));
  };

  const handleRemoveQuickReply = (idx) => {
    setForm(prev => ({
      ...prev,
      quick_replies: prev.quick_replies.filter((_, i) => i !== idx)
    }));
  };

  const handleSubmit = async () => {
    if (!validate()) {
      setShowValidationChecklist(true);
      return;
    }

    setSaving(true);
    try {
      // Ensure template_name is not undefined
      if (!form.name || !form.name.trim()) {
        setValidationErrors({ name: 'Template name is required' });
        setSaving(false);
        return;
      }

      // Map form to WhatsApp template API payload
      const payload = {
        template_name: form.name.trim().toLowerCase(),
        category: form.category,
        language: form.language,
        template_type: form.type,
        body: form.text,
        sample_values: form.sample_text ? { '{{1}}': form.sample_text } : undefined,
        buttons: form.call_to_action.length > 0 || form.quick_replies.length > 0
          ? [...(form.call_to_action || []), ...(form.quick_replies || [])]
          : undefined
      };

      // Remove undefined fields
      Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);

      const response = await api.post(
        `/whatsapp/integrations/${integrationId}/templates`,
        payload
      );

      onSuccess(response.data.data);
    } catch (error) {
      setValidationErrors({ submit: error.message });
    } finally {
      setSaving(false);
    }
  };

  const hasVariables = form.text.includes('{{');

  return (
    <form onSubmit={e => e.preventDefault()} className="template-form-panel">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

        {/* Basic Information Section */}
        <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '14px' }}>
          <h4 style={{ margin: '0 0 12px', fontSize: '11px', fontWeight: '700', color: '#5c5e72', textTransform: 'uppercase' }}>
            Basic Information
          </h4>

          <label style={{ display: 'grid', gap: '6px', fontSize: '11px', fontWeight: '700', color: '#5c5e72', marginBottom: '12px' }}>
            Template Name *
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="lowercase_template_name"
              maxLength="50"
              style={{
                height: '40px',
                border: validationErrors.name ? '1px solid #dc2626' : '1px solid var(--border)',
                borderRadius: '8px',
                background: '#fff',
                padding: '0 11px',
                color: 'var(--ink)',
                outline: 0,
                fontSize: '12px'
              }}
            />
            {validationErrors.name && (
              <span style={{ fontSize: '10px', color: '#dc2626' }}>✕ {validationErrors.name}</span>
            )}
          </label>

          <label style={{ display: 'grid', gap: '6px', fontSize: '11px', fontWeight: '700', color: '#5c5e72', marginBottom: '12px' }}>
            Label *
            <input
              type="text"
              value={form.label}
              onChange={e => setForm(prev => ({ ...prev, label: e.target.value }))}
              placeholder="Template description"
              maxLength="100"
              style={{
                height: '40px',
                border: validationErrors.label ? '1px solid #dc2626' : '1px solid var(--border)',
                borderRadius: '8px',
                background: '#fff',
                padding: '0 11px',
                color: 'var(--ink)',
                outline: 0,
                fontSize: '12px'
              }}
            />
            {validationErrors.label && (
              <span style={{ fontSize: '10px', color: '#dc2626' }}>✕ {validationErrors.label}</span>
            )}
          </label>

          <label style={{ display: 'grid', gap: '6px', fontSize: '11px', fontWeight: '700', color: '#5c5e72', marginBottom: '12px' }}>
            Category *
            <select
              value={form.category}
              onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))}
              style={{
                height: '40px',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                background: '#fff',
                padding: '0 11px',
                color: 'var(--ink)',
                outline: 0,
                fontSize: '12px'
              }}
            >
              <option value="MARKETING">Marketing</option>
              <option value="UTILITY">Utility</option>
              <option value="AUTHENTICATION">Authentication</option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: '6px', fontSize: '11px', fontWeight: '700', color: '#5c5e72' }}>
            Language *
            <select
              value={form.language}
              onChange={e => setForm(prev => ({ ...prev, language: e.target.value }))}
              style={{
                height: '40px',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                background: '#fff',
                padding: '0 11px',
                color: 'var(--ink)',
                outline: 0,
                fontSize: '12px'
              }}
            >
              {languages.map(lang => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Message Content Section */}
        <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '14px' }}>
          <h4 style={{ margin: '0 0 12px', fontSize: '11px', fontWeight: '700', color: '#5c5e72', textTransform: 'uppercase' }}>
            Message Content
          </h4>

          <label style={{ display: 'grid', gap: '6px', fontSize: '11px', fontWeight: '700', color: '#5c5e72', marginBottom: '12px' }}>
            Message Body *
            <div style={{ position: 'relative' }}>
              <textarea
                value={form.text}
                onChange={e => setForm(prev => ({ ...prev, text: e.target.value }))}
                placeholder="Message body. Use {{1}}, {{2}} for variables"
                maxLength="1024"
                style={{
                  minHeight: '80px',
                  border: validationErrors.text ? '1px solid #dc2626' : '1px solid var(--border)',
                  borderRadius: '8px',
                  background: '#fff',
                  padding: '8px 11px',
                  color: 'var(--ink)',
                  outline: 0,
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  resize: 'vertical'
                }}
              />
              <span style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '4px', display: 'block' }}>
                {form.text.length}/1024 characters
              </span>
            </div>
            {validationErrors.text && (
              <span style={{ fontSize: '10px', color: '#dc2626' }}>✕ {validationErrors.text}</span>
            )}
          </label>

          {hasVariables && (
            <label style={{ display: 'grid', gap: '6px', fontSize: '11px', fontWeight: '700', color: '#5c5e72', marginBottom: '12px' }}>
              Sample Text *
              <input
                type="text"
                value={form.sample_text}
                onChange={e => setForm(prev => ({ ...prev, sample_text: e.target.value }))}
                placeholder="Example: John Doe attends XYZ School"
                style={{
                  height: '40px',
                  border: validationErrors.sample_text ? '1px solid #dc2626' : '1px solid var(--border)',
                  borderRadius: '8px',
                  background: '#fff',
                  padding: '0 11px',
                  color: 'var(--ink)',
                  outline: 0,
                  fontSize: '12px'
                }}
              />
              <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                Example of your message with sample values
              </span>
              {validationErrors.sample_text && (
                <span style={{ fontSize: '10px', color: '#dc2626' }}>✕ {validationErrors.sample_text}</span>
              )}
            </label>
          )}
        </div>

        {/* Call-To-Action Buttons */}
        <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '14px' }}>
          <h4 style={{ margin: '0 0 12px', fontSize: '11px', fontWeight: '700', color: '#5c5e72', textTransform: 'uppercase' }}>
            Call-To-Action Buttons (Optional)
          </h4>

          {form.call_to_action.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              {form.call_to_action.map((cta, idx) => (
                <div key={idx} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px',
                  background: '#f9fafb',
                  borderRadius: '6px',
                  marginBottom: '6px',
                  fontSize: '12px'
                }}>
                  <span>{cta.button_title} ({cta.type})</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveCTA(idx)}
                    style={{ border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <label style={{ display: 'grid', gap: '6px', fontSize: '11px', fontWeight: '700', color: '#5c5e72', marginBottom: '12px' }}>
            Button Type
            <select
              value={currentCTA.type}
              onChange={e => setCurrentCTA(prev => ({ ...prev, type: e.target.value }))}
              style={{
                height: '40px',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                background: '#fff',
                padding: '0 11px',
                color: 'var(--ink)',
                outline: 0,
                fontSize: '12px'
              }}
            >
              <option value="URL">Website URL</option>
              <option value="Phone Number">Phone Number</option>
              <option value="Dynamic URL">Dynamic URL</option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: '6px', fontSize: '11px', fontWeight: '700', color: '#5c5e72', marginBottom: '12px' }}>
            Button Title
            <input
              type="text"
              value={currentCTA.button_title}
              onChange={e => setCurrentCTA(prev => ({ ...prev, button_title: e.target.value.slice(0, 25) }))}
              placeholder="Visit Website"
              maxLength="25"
              style={{
                height: '40px',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                background: '#fff',
                padding: '0 11px',
                color: 'var(--ink)',
                outline: 0,
                fontSize: '12px'
              }}
            />
          </label>

          <label style={{ display: 'grid', gap: '6px', fontSize: '11px', fontWeight: '700', color: '#5c5e72', marginBottom: '12px' }}>
            Button Value
            <input
              type="text"
              value={currentCTA.button_value}
              onChange={e => setCurrentCTA(prev => ({ ...prev, button_value: e.target.value }))}
              placeholder={currentCTA.type === 'Phone Number' ? '+918116856153' : 'https://example.com/{{1}}'}
              style={{
                height: '40px',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                background: '#fff',
                padding: '0 11px',
                color: 'var(--ink)',
                outline: 0,
                fontSize: '12px'
              }}
            />
            <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
              {currentCTA.type === 'Phone Number' ? 'Phone number with country code' : 'HTTPS URL only (supports variables)'}
            </span>
          </label>

          <button
            type="button"
            onClick={handleAddCTA}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'var(--primary)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <Plus size={14} /> Add CTA Button
          </button>
        </div>

        {/* Quick Replies */}
        <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '14px' }}>
          <h4 style={{ margin: '0 0 12px', fontSize: '11px', fontWeight: '700', color: '#5c5e72', textTransform: 'uppercase' }}>
            Quick Replies (Optional - Max 3)
          </h4>

          {form.quick_replies.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              {form.quick_replies.map((qr, idx) => (
                <div key={idx} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px',
                  background: '#f9fafb',
                  borderRadius: '6px',
                  marginBottom: '6px',
                  fontSize: '12px'
                }}>
                  <span>{qr.button_title}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveQuickReply(idx)}
                    style={{ border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <label style={{ display: 'grid', gap: '6px', fontSize: '11px', fontWeight: '700', color: '#5c5e72', marginBottom: '12px' }}>
            Quick Reply Text
            <input
              type="text"
              value={currentQuickReply.button_title}
              onChange={e => setCurrentQuickReply(prev => ({ ...prev, button_title: e.target.value.slice(0, 20) }))}
              placeholder="Yes"
              maxLength="20"
              style={{
                height: '40px',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                background: '#fff',
                padding: '0 11px',
                color: 'var(--ink)',
                outline: 0,
                fontSize: '12px'
              }}
            />
            <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
              {currentQuickReply.button_title.length}/20 characters
            </span>
          </label>

          <button
            type="button"
            onClick={handleAddQuickReply}
            disabled={form.quick_replies.length >= 3}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: form.quick_replies.length >= 3 ? '#d1d5db' : 'var(--primary)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: form.quick_replies.length >= 3 ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              opacity: form.quick_replies.length >= 3 ? 0.6 : 1
            }}
          >
            <Plus size={14} /> Add Quick Reply
          </button>
        </div>

        {/* Validation Checklist */}
        {showValidationChecklist && (
          <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '6px', padding: '12px' }}>
            <h4 style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: '700', color: '#92400e' }}>
              Validation Required
            </h4>
            <div style={{ fontSize: '11px', color: '#78350f' }}>
              {validationStatus.name ? (
                <div style={{ color: '#258268' }}>✓ Template name valid</div>
              ) : (
                <div style={{ color: '#dc2626' }}>✗ Template name invalid</div>
              )}
              {validationStatus.label ? (
                <div style={{ color: '#258268' }}>✓ Label provided</div>
              ) : (
                <div style={{ color: '#dc2626' }}>✗ Label required</div>
              )}
              {validationStatus.category ? (
                <div style={{ color: '#258268' }}>✓ Category selected</div>
              ) : (
                <div style={{ color: '#dc2626' }}>✗ Category required</div>
              )}
              {validationStatus.language ? (
                <div style={{ color: '#258268' }}>✓ Language selected</div>
              ) : (
                <div style={{ color: '#dc2626' }}>✗ Language required</div>
              )}
              {validationStatus.text ? (
                <div style={{ color: '#258268' }}>✓ Message body valid</div>
              ) : (
                <div style={{ color: '#dc2626' }}>✗ Message body invalid or missing</div>
              )}
              {validationStatus.sample_text ? (
                <div style={{ color: '#258268' }}>✓ Sample text provided</div>
              ) : (
                <div style={{ color: '#dc2626' }}>✗ Sample text required</div>
              )}
              {validationStatus.cta ? (
                <div style={{ color: '#258268' }}>✓ CTA buttons valid</div>
              ) : (
                <div style={{ color: '#dc2626' }}>✗ CTA buttons invalid</div>
              )}
              {validationStatus.quick_replies ? (
                <div style={{ color: '#258268' }}>✓ Quick replies valid</div>
              ) : (
                <div style={{ color: '#dc2626' }}>✗ Quick replies invalid</div>
              )}
            </div>
          </div>
        )}

        {/* Form Actions */}
        <div style={{ display: 'flex', gap: '8px', paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isFormValid || saving}
            style={{
              flex: 1,
              padding: '10px 12px',
              background: isFormValid ? 'var(--primary)' : '#d1d5db',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: isFormValid ? 'pointer' : 'not-allowed',
              fontSize: '12px',
              fontWeight: '600',
              opacity: isFormValid ? 1 : 0.6
            }}
          >
            {saving ? 'Creating...' : 'Create Template'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            style={{
              flex: 1,
              padding: '10px 12px',
              background: 'transparent',
              color: 'var(--muted)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '600'
            }}
          >
            Cancel
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </form>
  );
}
