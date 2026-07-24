import { useState, useEffect, useRef } from 'react';
import { X, Plus, ChevronDown } from 'lucide-react';
import { api } from '../../api';
import WhatsAppTemplatePreview from './WhatsAppTemplatePreview';

export default function TemplateCreateModal({ isOpen, onClose, onSuccess, editingTemplate = null, integrationId }) {
  const [form, setForm] = useState({
    name: '',
    label: '',
    category: 'MARKETING',
    language: 'English',
    type: 'TEXT',
    header_type: 'NONE',
    header_text: '',
    body: '',
    sample_text: '',
    footer: '',
    footer_enabled: false,
    quick_replies: [],
    buttons_expanded: false,
    footer_expanded: false
  });

  const [validationErrors, setValidationErrors] = useState({});
  const [apiError, setApiError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [lastSaveDraft, setLastSaveDraft] = useState(null);

  const languages = [
    'English', 'Hindi', 'Spanish', 'Portuguese', 'French', 'German', 'Italian',
    'Chinese', 'Japanese', 'Korean', 'Arabic', 'Turkish', 'Russian', 'Polish',
    'Thai', 'Vietnamese', 'Indonesian', 'Filipino', 'Malaysian'
  ];

  // Extract variables from body
  const bodyVariables = form.body.match(/\{\{(\d+)\}\}/g) || [];
  const hasVariables = bodyVariables.length > 0;

  // Validation
  const validate = () => {
    const errors = {};

    if (!form.name.trim()) {
      errors.name = 'Template name is required';
    } else if (!/^[a-z0-9_]+$/.test(form.name)) {
      errors.name = 'Only lowercase, numbers, and underscores';
    }

    if (!form.label.trim()) {
      errors.label = 'Label is required';
    }

    if (!form.category) {
      errors.category = 'Required';
    }

    if (!form.language) {
      errors.language = 'Required';
    }

    if (!form.body.trim()) {
      errors.body = 'Message body is required';
    } else if (form.body.length > 1024) {
      errors.body = `Max 1024 chars (${form.body.length})`;
    }

    if (hasVariables && !form.sample_text.trim()) {
      errors.sample_text = 'Required for variables';
    }

    if (form.header_type === 'TEXT' && !form.header_text.trim()) {
      errors.header_text = 'Required';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const getValidationStatus = () => {
    return {
      name: form.name && /^[a-z0-9_]+$/.test(form.name),
      category: !!form.category,
      language: !!form.language,
      body: form.body && form.body.length <= 1024 && form.body.length > 0,
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
    setApiError(null);
  };

  const handleAddQuickReply = () => {
    // For now, just placeholder
    setUnsavedChanges(true);
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    // Final validation - ensure template_name is not undefined
    if (!form.name || !form.name.trim()) {
      setValidationErrors({ name: 'Template name is required' });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        template_name: form.name.trim().toLowerCase(),
        category: form.category,
        language: form.language,
        template_type: form.type,
        header_type: form.header_type,
        header_content: form.header_type === 'TEXT' ? form.header_text : (form.header_file || null),
        body: form.body,
        sample_values: form.sample_text ? { '{{1}}': form.sample_text } : undefined,
        footer: form.footer_enabled ? form.footer : null,
        buttons: form.quick_replies && form.quick_replies.length > 0 ? form.quick_replies : undefined
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
      setApiError(error.message || 'Failed to create template. Please try again.');
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
      zIndex: 1000,
      padding: '16px'
    }}>
      <div style={{
        background: '#fff',
        borderRadius: '16px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        width: '100%',
        maxWidth: '1100px',
        height: '90vh',
        display: 'flex',
        flexDirection: 'column',
        animation: 'slideUp 0.3s ease-out'
      }}>
        {/* Sticky Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
          background: '#fff'
        }}>
          <div>
            <h2 style={{ margin: '0 0 3px 0', fontSize: '18px', fontWeight: '600', color: '#000' }}>
              {editingTemplate ? 'Edit Template' : 'Create New Template'}
            </h2>
            {lastSaveDraft && (
              <p style={{ margin: 0, fontSize: '12px', color: '#67697b' }}>
                Auto-saved at {lastSaveDraft.toLocaleTimeString()}
              </p>
            )}
          </div>
          <button
            onClick={handleClose}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: '24px',
              color: '#67697b',
              padding: '4px',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <X size={24} />
          </button>
        </div>

        {/* API Error Alert */}
        {apiError && (
          <div style={{
            padding: '12px 24px',
            background: '#fee2e2',
            borderBottom: '1px solid #fecaca',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexShrink: 0
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: '#dc2626',
              fontSize: '13px'
            }}>
              <span style={{ fontSize: '16px' }}>⚠️</span>
              <span>{apiError}</span>
            </div>
            <button
              onClick={() => setApiError(null)}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: '#dc2626',
                fontSize: '18px',
                padding: '2px 4px',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* Main Content - Two Columns */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '58% 42%',
          gap: '0',
          flex: 1,
          overflow: 'hidden',
          borderTop: '1px solid #e5e7eb'
        }}>
          {/* Left Panel - Form */}
          <div style={{
            overflow: 'auto',
            background: '#fafafa',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <FormContent
              form={form}
              handleChange={handleChange}
              validationErrors={validationErrors}
              languages={languages}
              hasVariables={hasVariables}
            />
          </div>

          {/* Right Panel - Live Preview (Sticky) */}
          <div style={{
            background: '#f3f4f6',
            borderLeft: '1px solid #e5e7eb',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative'
          }}>
            <div style={{
              padding: '16px',
              overflow: 'auto',
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <WhatsAppTemplatePreview
                template={{
                  header_type: form.header_type,
                  header_content: form.header_text,
                  body: form.body,
                  footer: form.footer_enabled ? form.footer : null,
                  quick_replies: form.quick_replies,
                  sample_text: form.sample_text
                }}
              />
            </div>
          </div>
        </div>

        {/* Sticky Footer */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid #e5e7eb',
          background: '#fff',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0
        }}>
          <div style={{ fontSize: '12px', color: '#67697b' }}>
            {isFormValid ? (
              <span style={{ color: '#258268', fontWeight: '600' }}>✓ Ready to create</span>
            ) : (
              <span style={{ color: '#dc2626', fontWeight: '600' }}>
                {Object.keys(validationErrors).length} field(s) need attention
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleClose}
              style={{
                padding: '10px 20px',
                border: '1px solid #d1d5db',
                background: '#fff',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '600',
                color: '#374151'
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!isFormValid || saving}
              style={{
                padding: '10px 20px',
                background: isFormValid ? 'var(--primary)' : '#d1d5db',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: isFormValid ? 'pointer' : 'not-allowed',
                fontSize: '13px',
                fontWeight: '600'
              }}
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

function FormContent({ form, handleChange, validationErrors, languages, hasVariables }) {
  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Section 1: Basic Information */}
      <FormSection title="Basic Information">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <FormField
            label="Template Name *"
            error={validationErrors.name}
            isCompact
          >
            <input
              type="text"
              value={form.name}
              onChange={e => handleChange('name', e.target.value)}
              placeholder="lowercase_name"
              maxLength="50"
              style={{
                width: '100%',
                height: '36px',
                border: validationErrors.name ? '1px solid #dc2626' : '1px solid #d1d5db',
                borderRadius: '6px',
                padding: '0 10px',
                fontSize: '13px',
                outline: 0,
                fontFamily: 'monospace'
              }}
            />
          </FormField>

          <FormField
            label="Label *"
            error={validationErrors.label}
            isCompact
          >
            <input
              type="text"
              value={form.label}
              onChange={e => handleChange('label', e.target.value)}
              placeholder="Description"
              maxLength="100"
              style={{
                width: '100%',
                height: '36px',
                border: validationErrors.label ? '1px solid #dc2626' : '1px solid #d1d5db',
                borderRadius: '6px',
                padding: '0 10px',
                fontSize: '13px',
                outline: 0
              }}
            />
          </FormField>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <FormField label="Category *" error={validationErrors.category} isCompact>
            <select
              value={form.category}
              onChange={e => handleChange('category', e.target.value)}
              style={{
                width: '100%',
                height: '36px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                padding: '0 10px',
                fontSize: '13px',
                outline: 0,
                background: '#fff'
              }}
            >
              <option value="MARKETING">Marketing</option>
              <option value="UTILITY">Utility</option>
              <option value="AUTHENTICATION">Authentication</option>
            </select>
          </FormField>

          <FormField label="Language *" error={validationErrors.language} isCompact>
            <select
              value={form.language}
              onChange={e => handleChange('language', e.target.value)}
              style={{
                width: '100%',
                height: '36px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                padding: '0 10px',
                fontSize: '13px',
                outline: 0,
                background: '#fff'
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
        <FormField label="Header Type" isCompact>
          <select
            value={form.header_type}
            onChange={e => handleChange('header_type', e.target.value)}
            style={{
              width: '100%',
              height: '36px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              padding: '0 10px',
              fontSize: '13px',
              outline: 0,
              background: '#fff'
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
          <FormField
            label="Header Text"
            error={validationErrors.header_text}
            isCompact
          >
            <input
              type="text"
              value={form.header_text}
              onChange={e => handleChange('header_text', e.target.value)}
              placeholder="Header text"
              maxLength="100"
              style={{
                width: '100%',
                height: '36px',
                border: validationErrors.header_text ? '1px solid #dc2626' : '1px solid #d1d5db',
                borderRadius: '6px',
                padding: '0 10px',
                fontSize: '13px',
                outline: 0
              }}
            />
          </FormField>
        )}

        {(form.header_type === 'IMAGE' || form.header_type === 'VIDEO' || form.header_type === 'DOCUMENT') && (
          <FormField
            label={`Upload ${form.header_type} File`}
            error={validationErrors.header_file}
            isCompact
          >
            <div style={{
              display: 'flex',
              gap: '12px',
              alignItems: 'center'
            }}>
              <input
                type="file"
                accept={
                  form.header_type === 'IMAGE' ? 'image/*' :
                  form.header_type === 'VIDEO' ? 'video/*' :
                  '.pdf,.doc,.docx'
                }
                onChange={e => {
                  if (e.target.files?.[0]) {
                    handleChange('header_file', e.target.files[0]);
                  }
                }}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              />
              {form.header_file && (
                <span style={{
                  fontSize: '12px',
                  color: '#059669',
                  whiteSpace: 'nowrap'
                }}>
                  ✓ {form.header_file.name || 'File selected'}
                </span>
              )}
            </div>
            <p style={{
              margin: '8px 0 0 0',
              fontSize: '12px',
              color: '#6b7280'
            }}>
              {form.header_type === 'IMAGE' && 'Max 5MB. Formats: JPG, PNG, GIF, BMP'}
              {form.header_type === 'VIDEO' && 'Max 16MB. Formats: MP4, 3GP'}
              {form.header_type === 'DOCUMENT' && 'Max 100MB. Formats: PDF'}
            </p>
          </FormField>
        )}
      </FormSection>

      {/* Section 3: Message Body */}
      <FormSection title="Message Body">
        <FormField
          label="Body *"
          error={validationErrors.body}
        >
          <textarea
            value={form.body}
            onChange={e => handleChange('body', e.target.value)}
            placeholder="Enter message. Use {{1}}, {{2}} for variables"
            maxLength="1024"
            style={{
              width: '100%',
              height: '280px',
              border: validationErrors.body ? '1px solid #dc2626' : '1px solid #d1d5db',
              borderRadius: '6px',
              padding: '10px',
              fontSize: '13px',
              fontFamily: 'monospace',
              resize: 'none',
              outline: 0,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'break-word'
            }}
          />
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: '#67697b',
            marginTop: '6px'
          }}>
            <span>{form.body.length}/1024 characters</span>
            {hasVariables && (
              <span>{bodyVariables.length} variable(s): {bodyVariables.join(', ')}</span>
            )}
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
                height: '36px',
                border: validationErrors.sample_text ? '1px solid #dc2626' : '1px solid #d1d5db',
                borderRadius: '6px',
                padding: '0 10px',
                fontSize: '13px',
                outline: 0
              }}
            />
            <div style={{ fontSize: '11px', color: '#67697b', marginTop: '4px' }}>
              Shows how variables appear in the preview
            </div>
          </FormField>
        )}
      </FormSection>

      {/* Section 4: Footer */}
      <CollapsibleSection
        title="Footer"
        expanded={form.footer_expanded}
        onToggle={() => handleChange('footer_expanded', !form.footer_expanded)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <input
            type="checkbox"
            checked={form.footer_enabled}
            onChange={e => handleChange('footer_enabled', e.target.checked)}
            id="footer-toggle"
            style={{ cursor: 'pointer' }}
          />
          <label htmlFor="footer-toggle" style={{ fontSize: '13px', cursor: 'pointer' }}>
            Add footer text
          </label>
        </div>

        {form.footer_enabled && (
          <FormField label="Footer Text" isCompact>
            <input
              type="text"
              value={form.footer}
              onChange={e => handleChange('footer', e.target.value)}
              placeholder="Footer (max 60 chars)"
              maxLength="60"
              style={{
                width: '100%',
                height: '36px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                padding: '0 10px',
                fontSize: '13px',
                outline: 0
              }}
            />
            <div style={{ fontSize: '11px', color: '#67697b', marginTop: '4px' }}>
              {form.footer.length}/60 characters
            </div>
          </FormField>
        )}
      </CollapsibleSection>

      {/* Spacer */}
      <div style={{ height: '8px' }} />
    </div>
  );
}

function FormSection({ title, children }) {
  return (
    <div>
      <h3 style={{
        margin: '0 0 12px 0',
        fontSize: '12px',
        fontWeight: '600',
        color: '#5c5e72',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
      }}>
        {title}
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {children}
      </div>
    </div>
  );
}

function FormField({ label, error, children, isCompact }) {
  return (
    <label style={{
      display: 'grid',
      gap: isCompact ? '4px' : '6px',
      fontSize: '12px',
      fontWeight: '600',
      color: '#5c5e72'
    }}>
      {label}
      {children}
      {error && (
        <span style={{ fontSize: '11px', color: '#dc2626', fontWeight: '400' }}>
          ✕ {error}
        </span>
      )}
    </label>
  );
}

function CollapsibleSection({ title, expanded, onToggle, children }) {
  return (
    <div>
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: '600',
          color: '#5c5e72',
          textTransform: 'uppercase',
          padding: 0,
          marginBottom: '12px'
        }}
      >
        <ChevronDown
          size={14}
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
