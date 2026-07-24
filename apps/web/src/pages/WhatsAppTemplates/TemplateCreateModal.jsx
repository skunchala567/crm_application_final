import { useState, useEffect, useRef } from 'react';
import { X, Plus, ChevronDown, AlertCircle, CheckCircle } from 'lucide-react';
import { api } from '../../api';
import WhatsAppTemplatePreview from './WhatsAppTemplatePreview';

export default function TemplateCreateModal({ isOpen, onClose, onSuccess, editingTemplate = null, integrationId }) {
  const modalRef = useRef(null);
  const [form, setForm] = useState({
    name: '',
    label: '',
    category: 'MARKETING',
    language: 'English',
    type: 'TEXT',
    header_type: 'NONE',
    header_text: '',
    header_file: null,
    text: '',
    sample_text: '',
    footer: '',
    footer_enabled: false,
    call_to_action: [],
    quick_replies: [],
    buttons_expanded: false,
    footer_expanded: false
  });

  const [currentButton, setCurrentButton] = useState({
    type: 'quick_reply',
    button_type: 'Quick Reply',
    button_title: '',
    button_value: '',
    cta_type: 'URL'
  });

  const [validationErrors, setValidationErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [lastSaveDraft, setLastSaveDraft] = useState(null);

  const languages = [
    'English', 'Hindi', 'Spanish', 'Portuguese', 'French', 'German', 'Italian',
    'Chinese', 'Japanese', 'Korean', 'Arabic', 'Turkish', 'Russian', 'Polish',
    'Thai', 'Vietnamese', 'Indonesian', 'Filipino', 'Malaysian'
  ];

  const buttonTypes = ['Quick Reply', 'Call', 'Website', 'Copy Code'];

  // Extract variables from body
  const bodyVariables = form.text.match(/\{\{(\d+)\}\}/g) || [];
  const hasVariables = bodyVariables.length > 0;

  // Validation
  const validate = () => {
    const errors = {};

    if (!form.name.trim()) {
      errors.name = 'Template name is required';
    } else if (!/^[a-z0-9_]+$/.test(form.name)) {
      errors.name = 'Only lowercase, numbers, and underscores allowed';
    }

    if (!form.label.trim()) {
      errors.label = 'Label is required';
    }

    if (!form.category) {
      errors.category = 'Category is required';
    }

    if (!form.language) {
      errors.language = 'Language is required';
    }

    if (!form.text.trim()) {
      errors.text = 'Body text is required';
    } else if (form.text.length > 1024) {
      errors.text = `Body exceeds maximum length (${form.text.length}/1024)`;
    }

    if (hasVariables && !form.sample_text.trim()) {
      errors.sample_text = 'Sample text required when variables exist';
    }

    if (form.header_type === 'TEXT' && !form.header_text.trim()) {
      errors.header_text = 'Header text required';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const getValidationStatus = () => {
    return {
      name: form.name && /^[a-z0-9_]+$/.test(form.name),
      category: !!form.category,
      language: !!form.language,
      body: form.text && form.text.length <= 1024 && form.text.length > 0,
      sample_values: !hasVariables || !!form.sample_text.trim()
    };
  };

  const validationStatus = getValidationStatus();
  const isFormValid = Object.values(validationStatus).every(v => v);

  // Auto-save draft
  useEffect(() => {
    const timer = setInterval(() => {
      if (unsavedChanges) {
        setLastSaveDraft(new Date());
        setUnsavedChanges(false);
      }
    }, 30000);

    return () => clearInterval(timer);
  }, [unsavedChanges]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        handleClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (isFormValid) handleSubmit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isFormValid]);

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setUnsavedChanges(true);
  };

  const handleAddButton = () => {
    if (!currentButton.button_title) {
      setValidationErrors(prev => ({ ...prev, button_title: 'Button title required' }));
      return;
    }

    setForm(prev => ({
      ...prev,
      quick_replies: [...prev.quick_replies, { ...currentButton }]
    }));

    setCurrentButton({
      type: 'quick_reply',
      button_type: 'Quick Reply',
      button_title: '',
      button_value: '',
      cta_type: 'URL'
    });
    setUnsavedChanges(true);
  };

  const handleRemoveButton = (idx) => {
    setForm(prev => ({
      ...prev,
      quick_replies: prev.quick_replies.filter((_, i) => i !== idx)
    }));
    setUnsavedChanges(true);
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setSaving(true);
    try {
      const payload = {
        template_name: form.name,
        category: form.category,
        language: form.language,
        template_type: form.type,
        header_type: form.header_type,
        header_content: form.header_type === 'TEXT' ? form.header_text : null,
        body: form.text,
        sample_values: form.sample_text ? { '{{1}}': form.sample_text } : undefined,
        footer: form.footer_enabled ? form.footer : null,
        buttons: form.quick_replies.length > 0 ? form.quick_replies : undefined
      };

      if (editingTemplate) {
        await api.put(
          `/whatsapp/integrations/${integrationId}/templates/${editingTemplate.id}`,
          payload
        );
      } else {
        await api.post(
          `/whatsapp/integrations/${integrationId}/templates`,
          payload
        );
      }

      onSuccess();
      handleClose();
    } catch (error) {
      setValidationErrors({ submit: error.message });
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (unsavedChanges) {
      if (!window.confirm('You have unsaved changes. Close without saving?')) {
        return;
      }
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div
        ref={modalRef}
        style={{
          background: '#fff',
          borderRadius: '16px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          width: '90%',
          maxWidth: '1200px',
          height: '85vh',
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideUp 0.3s ease-out'
        }}
      >
        {/* Sticky Header */}
        <div style={{
          padding: '24px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0
        }}>
          <div>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: '600' }}>
              {editingTemplate ? 'Edit Template' : 'Create New Template'}
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: '#67697b' }}>
              {lastSaveDraft && `Last auto-saved: ${lastSaveDraft.toLocaleTimeString()}`}
            </p>
          </div>
          <button
            onClick={handleClose}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: '24px',
              color: '#67697b',
              padding: '8px'
            }}
          >
            <X size={24} />
          </button>
        </div>

        {/* Content Area - Two Columns */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '60% 40%',
          gap: '24px',
          padding: '24px',
          flex: 1,
          overflow: 'hidden'
        }}>
          {/* Left Panel - Form */}
          <div style={{ overflow: 'auto', paddingRight: '12px' }}>
            <TemplateFormContent
              form={form}
              handleChange={handleChange}
              validationErrors={validationErrors}
              languages={languages}
              buttonTypes={buttonTypes}
              currentButton={currentButton}
              setCurrentButton={setCurrentButton}
              handleAddButton={handleAddButton}
              handleRemoveButton={handleRemoveButton}
              bodyVariables={bodyVariables}
              hasVariables={hasVariables}
            />
          </div>

          {/* Right Panel - Live Preview */}
          <div style={{
            background: '#f9fafb',
            borderRadius: '12px',
            padding: '16px',
            overflow: 'auto',
            position: 'sticky',
            top: 0
          }}>
            <WhatsAppTemplatePreview
              template={{
                header_type: form.header_type,
                header_content: form.header_text,
                body: form.text,
                footer: form.footer_enabled ? form.footer : null,
                quick_replies: form.quick_replies,
                sample_text: form.sample_text
              }}
            />
          </div>
        </div>

        {/* Sticky Footer */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid #e5e7eb',
          background: '#f9fafb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0
        }}>
          <div style={{ fontSize: '12px', color: '#67697b' }}>
            {validationStatus.name ? (
              <span style={{ color: '#258268' }}>✓ Ready to create</span>
            ) : (
              <span style={{ color: '#dc2626' }}>✗ Complete required fields</span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleClose}
              style={{
                padding: '10px 16px',
                border: '1px solid #d1d5db',
                background: '#fff',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '600'
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!isFormValid || saving}
              style={{
                padding: '10px 16px',
                background: isFormValid ? 'var(--primary)' : '#d1d5db',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: isFormValid ? 'pointer' : 'not-allowed',
                fontSize: '13px',
                fontWeight: '600'
              }}
              title={!isFormValid ? 'Complete required fields to create' : ''}
            >
              {saving ? 'Creating...' : editingTemplate ? 'Save Changes' : 'Create Template'}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

function TemplateFormContent({
  form,
  handleChange,
  validationErrors,
  languages,
  buttonTypes,
  currentButton,
  setCurrentButton,
  handleAddButton,
  handleRemoveButton,
  bodyVariables,
  hasVariables
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Section 1: Basic Information */}
      <FormSection title="Basic Information">
        <FormField
          label="Template Name *"
          error={validationErrors.name}
        >
          <input
            type="text"
            value={form.name}
            onChange={e => handleChange('name', e.target.value)}
            placeholder="lowercase_template_name"
            maxLength="50"
            style={{
              width: '100%',
              height: '40px',
              border: validationErrors.name ? '1px solid #dc2626' : '1px solid #d1d5db',
              borderRadius: '8px',
              padding: '0 12px',
              fontSize: '13px',
              outline: 0
            }}
          />
        </FormField>

        <FormField
          label="Label *"
          error={validationErrors.label}
        >
          <input
            type="text"
            value={form.label}
            onChange={e => handleChange('label', e.target.value)}
            placeholder="Template description"
            maxLength="100"
            style={{
              width: '100%',
              height: '40px',
              border: validationErrors.label ? '1px solid #dc2626' : '1px solid #d1d5db',
              borderRadius: '8px',
              padding: '0 12px',
              fontSize: '13px',
              outline: 0
            }}
          />
        </FormField>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <FormField label="Category *">
            <select
              value={form.category}
              onChange={e => handleChange('category', e.target.value)}
              style={{
                width: '100%',
                height: '40px',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                padding: '0 12px',
                fontSize: '13px',
                outline: 0
              }}
            >
              <option value="MARKETING">Marketing</option>
              <option value="UTILITY">Utility</option>
              <option value="AUTHENTICATION">Authentication</option>
            </select>
          </FormField>

          <FormField label="Language *">
            <select
              value={form.language}
              onChange={e => handleChange('language', e.target.value)}
              style={{
                width: '100%',
                height: '40px',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                padding: '0 12px',
                fontSize: '13px',
                outline: 0
              }}
            >
              {languages.map(lang => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </FormField>
        </div>
      </FormSection>

      {/* Section 2: Header */}
      <FormSection title="Header (Optional)">
        <FormField label="Header Type">
          <select
            value={form.header_type}
            onChange={e => handleChange('header_type', e.target.value)}
            style={{
              width: '100%',
              height: '40px',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              padding: '0 12px',
              fontSize: '13px',
              outline: 0
            }}
          >
            <option value="NONE">None</option>
            <option value="TEXT">Text</option>
            <option value="IMAGE">Image</option>
            <option value="VIDEO">Video</option>
            <option value="DOCUMENT">Document</option>
          </select>
        </FormField>

        {form.header_type === 'TEXT' && (
          <FormField label="Header Text" error={validationErrors.header_text}>
            <input
              type="text"
              value={form.header_text}
              onChange={e => handleChange('header_text', e.target.value)}
              placeholder="Header text"
              maxLength="100"
              style={{
                width: '100%',
                height: '40px',
                border: validationErrors.header_text ? '1px solid #dc2626' : '1px solid #d1d5db',
                borderRadius: '8px',
                padding: '0 12px',
                fontSize: '13px',
                outline: 0
              }}
            />
          </FormField>
        )}

        {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(form.header_type) && (
          <FormField label={`Upload ${form.header_type}`}>
            <input
              type="file"
              onChange={e => handleChange('header_file', e.target.files?.[0])}
              style={{
                width: '100%',
                height: '40px',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                padding: '8px 12px',
                fontSize: '13px'
              }}
            />
          </FormField>
        )}
      </FormSection>

      {/* Section 3: Body */}
      <FormSection title="Message Body">
        <FormField
          label="Body *"
          error={validationErrors.text}
        >
          <textarea
            value={form.text}
            onChange={e => handleChange('text', e.target.value)}
            placeholder="Message body. Use {{1}}, {{2}} for variables"
            maxLength="1024"
            style={{
              width: '100%',
              minHeight: '100px',
              border: validationErrors.text ? '1px solid #dc2626' : '1px solid #d1d5db',
              borderRadius: '8px',
              padding: '12px',
              fontSize: '13px',
              fontFamily: 'monospace',
              resize: 'vertical',
              outline: 0
            }}
          />
          <div style={{ fontSize: '12px', color: '#67697b', marginTop: '4px' }}>
            {form.text.length}/1024 characters
          </div>
        </FormField>

        {hasVariables && (
          <FormField
            label="Sample Text *"
            error={validationErrors.sample_text}
          >
            <input
              type="text"
              value={form.sample_text}
              onChange={e => handleChange('sample_text', e.target.value)}
              placeholder="Example with sample values"
              style={{
                width: '100%',
                height: '40px',
                border: validationErrors.sample_text ? '1px solid #dc2626' : '1px solid #d1d5db',
                borderRadius: '8px',
                padding: '0 12px',
                fontSize: '13px',
                outline: 0
              }}
            />
          </FormField>
        )}
      </FormSection>

      {/* Section 4: Footer */}
      <CollapsibleSection
        title="Footer"
        expanded={form.footer_expanded}
        onToggle={() => handleChange('footer_expanded', !form.footer_expanded)}
      >
        <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={form.footer_enabled}
            onChange={e => handleChange('footer_enabled', e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <label style={{ fontSize: '13px', cursor: 'pointer' }}>Add footer text</label>
        </div>

        {form.footer_enabled && (
          <FormField label="Footer Text">
            <input
              type="text"
              value={form.footer}
              onChange={e => handleChange('footer', e.target.value)}
              placeholder="Footer text (max 60 chars)"
              maxLength="60"
              style={{
                width: '100%',
                height: '40px',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                padding: '0 12px',
                fontSize: '13px',
                outline: 0
              }}
            />
            <div style={{ fontSize: '12px', color: '#67697b', marginTop: '4px' }}>
              {form.footer.length}/60 characters
            </div>
          </FormField>
        )}
      </CollapsibleSection>

      {/* Section 5: Buttons */}
      <CollapsibleSection
        title="Buttons"
        expanded={form.buttons_expanded}
        onToggle={() => handleChange('buttons_expanded', !form.buttons_expanded)}
      >
        {form.quick_replies.length > 0 && (
          <div style={{ marginBottom: '12px' }}>
            {form.quick_replies.map((btn, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px',
                  background: '#f3f4f6',
                  borderRadius: '6px',
                  marginBottom: '6px',
                  fontSize: '12px'
                }}
              >
                <span>{btn.button_title} ({btn.button_type})</span>
                <button
                  onClick={() => handleRemoveButton(idx)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#dc2626',
                    cursor: 'pointer'
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <FormField label="Button Type">
          <select
            value={currentButton.button_type}
            onChange={e => setCurrentButton(prev => ({ ...prev, button_type: e.target.value }))}
            style={{
              width: '100%',
              height: '40px',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              padding: '0 12px',
              fontSize: '13px',
              outline: 0
            }}
          >
            {buttonTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </FormField>

        <FormField label="Button Title">
          <input
            type="text"
            value={currentButton.button_title}
            onChange={e => setCurrentButton(prev => ({ ...prev, button_title: e.target.value.slice(0, 25) }))}
            placeholder="Button text"
            maxLength="25"
            style={{
              width: '100%',
              height: '40px',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              padding: '0 12px',
              fontSize: '13px',
              outline: 0
            }}
          />
          <div style={{ fontSize: '12px', color: '#67697b', marginTop: '4px' }}>
            {currentButton.button_title.length}/25 characters
          </div>
        </FormField>

        <button
          onClick={handleAddButton}
          style={{
            width: '100%',
            padding: '10px',
            background: '#667eea',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px'
          }}
        >
          <Plus size={16} /> Add Button
        </button>
      </CollapsibleSection>
    </div>
  );
}

function FormSection({ title, children }) {
  return (
    <div style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: '16px' }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: '600', color: '#5c5e72', textTransform: 'uppercase' }}>
        {title}
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {children}
      </div>
    </div>
  );
}

function FormField({ label, error, children }) {
  return (
    <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: '600', color: '#5c5e72' }}>
      {label}
      {children}
      {error && <span style={{ fontSize: '11px', color: '#dc2626' }}>✕ {error}</span>}
    </label>
  );
}

function CollapsibleSection({ title, expanded, onToggle, children }) {
  return (
    <div style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: '16px' }}>
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: '600',
          color: '#5c5e72',
          textTransform: 'uppercase',
          padding: 0,
          marginBottom: '12px'
        }}
      >
        <ChevronDown
          size={16}
          style={{
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 0.2s'
          }}
        />
        {title}
      </button>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {children}
        </div>
      )}
    </div>
  );
}
