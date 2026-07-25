import { AlertCircle } from 'lucide-react';
import '../styles/TemplateFormBuilder.css';
import '../styles/BasicInfoGrid.css';

export default function TemplateFormBuilder({ formData, onChange, errors = {} }) {
  // ✅ FIXED: Updated enum values to match AiSensy API
  const categories = ['MARKETING', 'TRANSACTIONAL', 'OTP'];
  const languages = ['English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Russian', 'Chinese', 'Japanese', 'Korean', 'Arabic', 'Hindi'];
  const types = ['TEXT', 'IMAGE', 'VIDEO', 'FILE', 'LOCATION', 'CAROUSEL', 'ORDER_DETAILS'];
  const messageActionTypes = ['NONE', 'QuickReplies', 'CTA'];

  // ✅ FIXED: Detect variables in body text ({{1}}, {{2}}, etc)
  const detectVariables = (text) => {
    if (!text) return [];
    const matches = text.match(/\{\{(\d+)\}\}/g) || [];
    return [...new Set(matches)].sort();
  };

  const bodyVariables = detectVariables(formData.body);
  const hasVariables = bodyVariables.length > 0;

  const handleAddQuickReply = () => {
    onChange('quick_replies', [...(formData.quick_replies || []), '']);
  };

  const handleRemoveQuickReply = (index) => {
    const updated = formData.quick_replies.filter((_, i) => i !== index);
    onChange('quick_replies', updated);
  };

  const handleQuickReplyChange = (index, value) => {
    const updated = [...formData.quick_replies];
    updated[index] = value;
    onChange('quick_replies', updated);
  };

  const handleAddCTA = () => {
    onChange('call_to_action', [...(formData.call_to_action || []), { type: 'URL', button_title: '', button_value: '' }]);
  };

  const handleRemoveCTA = (index) => {
    const updated = formData.call_to_action.filter((_, i) => i !== index);
    onChange('call_to_action', updated);
  };

  const handleCTAChange = (index, field, value) => {
    const updated = [...formData.call_to_action];
    updated[index][field] = value;
    onChange('call_to_action', updated);
  };

  return (
    <div className="template-form-builder">
      <h2 className="basic-info-title">Basic Information</h2>

      <div className="template-basic-grid">
        <div className="grid-field">
          <label htmlFor="template_name">
            Template Name *
            <span className="field-hint">(lowercase, underscores only)</span>
          </label>
          <input
            id="template_name"
            type="text"
            value={formData.template_name}
            onChange={(e) => {
              // Convert to lowercase
              let value = e.target.value.toLowerCase();
              // Replace spaces with underscores
              value = value.replace(/\s+/g, '_');
              // Remove special characters except underscores
              value = value.replace(/[^a-z0-9_]/g, '');
              onChange('template_name', value);
            }}
            placeholder="my_template_name"
            className={errors.template_name ? 'field-error' : ''}
          />
          {errors.template_name && <span className="field-error-msg">{errors.template_name}</span>}
        </div>

        <div className="grid-field">
          <label htmlFor="label">
            Label *
            <span className="field-hint">(display name)</span>
          </label>
          <input
            id="label"
            type="text"
            value={formData.label}
            onChange={(e) => onChange('label', e.target.value)}
            placeholder="My Template"
            className={errors.label ? 'field-error' : ''}
          />
          {errors.label && <span className="field-error-msg">{errors.label}</span>}
        </div>

        <div className="grid-field">
          <label htmlFor="category">Category *</label>
          <select
            id="category"
            value={formData.category}
            onChange={(e) => onChange('category', e.target.value)}
            className={errors.category ? 'field-error' : ''}
          >
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          {errors.category && <span className="field-error-msg">{errors.category}</span>}
        </div>

        <div className="grid-field">
          <label htmlFor="language">Language *</label>
          <select
            id="language"
            value={formData.language}
            onChange={(e) => onChange('language', e.target.value)}
            className={errors.language ? 'field-error' : ''}
          >
            {languages.map(lang => (
              <option key={lang} value={lang}>{lang}</option>
            ))}
          </select>
          {errors.language && <span className="field-error-msg">{errors.language}</span>}
        </div>

        <div className="grid-field">
          <label htmlFor="template_type">Template Type *</label>
          <select
            id="template_type"
            value={formData.template_type}
            onChange={(e) => onChange('template_type', e.target.value)}
            className={errors.template_type ? 'field-error' : ''}
          >
            {types.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          {errors.template_type && <span className="field-error-msg">{errors.template_type}</span>}
        </div>

        {/* ✅ FIXED: Added Message Action Type selector */}
        <div className="grid-field">
          <label htmlFor="message_action_type">Message Buttons</label>
          <select
            id="message_action_type"
            value={formData.message_action_type || 'NONE'}
            onChange={(e) => onChange('message_action_type', e.target.value)}
          >
            {messageActionTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Header Content - Based on template_type for media templates */}
      {formData.template_type && ['IMAGE', 'VIDEO', 'FILE'].includes(formData.template_type) && (
        <div className="form-group">
          <label htmlFor="header_content">
            Header Content ({formData.template_type.toLowerCase()} URL)
          </label>
          <input
            id="header_content"
            type="text"
            value={formData.header_content}
            onChange={(e) => onChange('header_content', e.target.value)}
            placeholder="https://..."
          />
        </div>
      )}

      {/* Message Body */}
      <div className="form-group full-width">
        <label htmlFor="body">
          Message Body *
          <span className="help-text">(Use {'{'}1{'}'}, {'{'}2{'}'} for parameters)</span>
        </label>
        <textarea
          id="body"
          value={formData.body}
          onChange={(e) => onChange('body', e.target.value)}
          placeholder="Hello {'{'}1{'}'}, welcome to {'{'}2{'}'}!"
          rows={6}
          className={errors.body ? 'error' : ''}
        />
        {errors.body && <span className="error-message">{errors.body}</span>}
        <small className="char-count">{formData.body.length} / 1024</small>
      </div>

      {/* Footer */}
      <div className="form-group full-width">
        <label htmlFor="footer">
          Footer
          <span className="help-text">(max 60 characters)</span>
        </label>
        <input
          id="footer"
          type="text"
          value={formData.footer}
          onChange={(e) => onChange('footer', e.target.value)}
          placeholder="Optional footer text"
          maxLength="60"
        />
        <small className="char-count">{formData.footer.length} / 60</small>
      </div>

      {/* ✅ FIXED: Sample Text only shown when variables detected */}
      {hasVariables && (
        <div className="form-group full-width">
          <label htmlFor="sample_text">
            Sample Text *
            <span className="help-text">({bodyVariables.length} variables found: {bodyVariables.join(', ')})</span>
          </label>
          <textarea
            id="sample_text"
            value={formData.sample_text}
            onChange={(e) => onChange('sample_text', e.target.value)}
            placeholder="Hello John, welcome to Acme School!"
            rows={3}
            className={errors.sample_text ? 'error' : ''}
          />
          {errors.sample_text && <span className="error-message">{errors.sample_text}</span>}
        </div>
      )}

      {/* ✅ FIXED: Quick Replies only shown when message_action_type === 'QuickReplies' */}
      {formData.message_action_type === 'QuickReplies' && (
        <div className="form-section">
          <h3>Quick Replies</h3>
          <p className="section-help">Add up to 3 quick reply options</p>
          <div className="quick-replies-list">
            {formData.quick_replies.map((reply, index) => (
              <div key={index} className="quick-reply-item">
                <input
                  type="text"
                  value={reply}
                  onChange={(e) => handleQuickReplyChange(index, e.target.value)}
                  placeholder={`Reply ${index + 1}`}
                />
                <button
                  type="button"
                  className="btn-remove"
                  onClick={() => handleRemoveQuickReply(index)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          {formData.quick_replies.length < 3 && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={handleAddQuickReply}
            >
              + Add Quick Reply
            </button>
          )}
        </div>
      )}

      {/* ✅ FIXED: CTA only shown when message_action_type === 'CTA' */}
      {formData.message_action_type === 'CTA' && (
        <div className="form-section">
          <h3>Call-to-Action Buttons</h3>
          <p className="section-help">Add up to 2 CTA buttons</p>
          <div className="cta-list">
            {formData.call_to_action.map((btn, index) => (
              <div key={index} className="cta-item">
                <select
                  value={btn.type}
                  onChange={(e) => handleCTAChange(index, 'type', e.target.value)}
                >
                  <option value="URL">URL</option>
                  <option value="Phone Number">Phone Number</option>
                </select>
                <input
                  type="text"
                  value={btn.button_title}
                  onChange={(e) => handleCTAChange(index, 'button_title', e.target.value)}
                  placeholder="Button text"
                  maxLength="30"
                />
                <input
                  type="text"
                  value={btn.button_value}
                  onChange={(e) => handleCTAChange(index, 'button_value', e.target.value)}
                  placeholder={btn.type === 'URL' ? 'https://...' : '+1234567890'}
                />
                <button
                  type="button"
                  className="btn-remove"
                  onClick={() => handleRemoveCTA(index)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          {formData.call_to_action.length < 2 && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={handleAddCTA}
            >
              + Add CTA Button
            </button>
          )}
        </div>
      )}

      {Object.keys(errors).length > 0 && (
        <div className="validation-summary">
          <AlertCircle size={18} />
          <p>Please fix the errors above before submitting</p>
        </div>
      )}
    </div>
  );
}
