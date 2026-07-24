import { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, AlertCircle, CheckCircle, Loader, X } from 'lucide-react';
import { api } from '../../api';

export default function WhatsAppTemplateForm({ integrationId, templateId, onSave, onCancel, isEmbedded = false }) {
  const [loading, setLoading] = useState(!!templateId);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState({ errors: [] });
  const [activeTab, setActiveTab] = useState('basic');

  const [form, setForm] = useState({
    template_name: '',
    category: 'MARKETING',
    language: 'English',
    template_type: 'TEXT',
    header_type: 'NONE',
    header_content: '',
    body: '',
    footer: '',
    buttons: [],
    sample_values: {}
  });

  const [currentButton, setCurrentButton] = useState({
    type: 'CALL_TO_ACTION',
    cta_type: 'VISIT_WEBSITE',
    button_text: '',
    button_value: ''
  });

  const languages = [
    'Afrikaans', 'Albanian', 'Arabic', 'Azerbaijani', 'Bengali', 'Bulgarian', 'Catalan',
    'Chinese (CHN)', 'Chinese (HKG)', 'Chinese (TAI)', 'Croatian', 'Czech', 'Danish',
    'Dutch', 'English', 'English (UK)', 'English (US)', 'Estonian', 'Filipino', 'Finnish',
    'French', 'German', 'Greek', 'Gujarati', 'Hebrew', 'Hindi', 'Hungarian',
    'Indonesian', 'Italian', 'Japanese', 'Kannada', 'Korean', 'Malayalam', 'Marathi',
    'Norwegian', 'Persian', 'Polish', 'Portuguese (BR)', 'Portuguese (POR)', 'Punjabi',
    'Romanian', 'Russian', 'Slovak', 'Slovenian', 'Spanish', 'Spanish (ARG)',
    'Spanish (MEX)', 'Swedish', 'Tamil', 'Telugu', 'Thai', 'Turkish', 'Ukrainian',
    'Urdu', 'Vietnamese'
  ];

  const extractVariables = (text) => {
    const matches = text.match(/\{\{(\d+)\}\}/g) || [];
    const unique = [...new Set(matches)];
    return unique.sort((a, b) => {
      const numA = parseInt(a.replace(/\{\{|\}\}/g, ''));
      const numB = parseInt(b.replace(/\{\{|\}\}/g, ''));
      return numA - numB;
    });
  };

  const bodyVariables = useMemo(() => extractVariables(form.body), [form.body]);

  useEffect(() => {
    if (templateId) {
      loadTemplate();
    }
  }, [templateId, integrationId]);

  const loadTemplate = async () => {
    try {
      const response = await api.get(`/whatsapp/integrations/${integrationId}/templates/${templateId}`);
      const template = response.data.data;
      setForm({
        template_name: template.template_name,
        category: template.category,
        language: template.language,
        template_type: template.template_type,
        header_type: template.header_type,
        header_content: template.header_content || '',
        body: template.body,
        footer: template.footer || '',
        buttons: template.buttons_json || [],
        sample_values: template.sample_values_json || {}
      });
    } catch (error) {
      setValidation({ errors: [`Failed to load template: ${error.message}`] });
    } finally {
      setLoading(false);
    }
  };

  const validateForm = async () => {
    try {
      const response = await api.post(
        `/whatsapp/integrations/${integrationId}/templates/validate`,
        {
          ...form,
          buttons_json: form.buttons,
          sample_values_json: form.sample_values,
          variables_list: bodyVariables
        }
      );
      setValidation(response.data);
      return response.data.valid;
    } catch (error) {
      setValidation({ errors: [error.message] });
      return false;
    }
  };

  const handleSubmit = async (isDraft = true) => {
    const isValid = await validateForm();
    if (!isValid) return;

    setSaving(true);
    try {
      const payload = {
        template_name: form.template_name,
        category: form.category,
        language: form.language,
        template_type: form.template_type,
        header_type: form.header_type,
        header_content: form.header_content,
        body: form.body,
        footer: form.footer,
        buttons: form.buttons,
        sample_values: form.sample_values,
        variables: bodyVariables
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

      if (!isDraft) {
        await api.post(
          `/whatsapp/integrations/${integrationId}/templates/${response.data.data.id}/submit`
        );
      }

      onSave(response.data.data);
    } catch (error) {
      setValidation({ errors: [error.message] });
    } finally {
      setSaving(false);
    }
  };

  const addButton = () => {
    if (!currentButton.button_text || !currentButton.button_value) {
      setValidation({ errors: ['Please fill in button text and value'] });
      return;
    }

    setForm(prev => ({
      ...prev,
      buttons: [...prev.buttons, currentButton]
    }));
    setCurrentButton({
      type: 'CALL_TO_ACTION',
      cta_type: 'VISIT_WEBSITE',
      button_text: '',
      button_value: ''
    });
  };

  const removeButton = (idx) => {
    setForm(prev => ({
      ...prev,
      buttons: prev.buttons.filter((_, i) => i !== idx)
    }));
  };

  const updateSampleValue = (variable, value) => {
    setForm(prev => ({
      ...prev,
      sample_values: { ...prev.sample_values, [variable]: value }
    }));
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <Loader style={{ animation: 'spin 1s linear infinite' }} />
          <p>Loading template...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2>{templateId ? 'Edit Template' : 'Create New Template'}</h2>
      </div>

      {validation.errors.length > 0 && (
        <div style={styles.errorBox}>
          <AlertCircle size={18} />
          <div>
            {validation.errors.map((err, idx) => (
              <div key={idx}>{err}</div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={styles.tabs}>
        {['basic', 'content', 'buttons', 'variables'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              ...styles.tab,
              ...(activeTab === tab ? styles.tabActive : styles.tabInactive)
            }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div style={styles.formContent}>
        {/* Basic Tab */}
        {activeTab === 'basic' && (
          <div style={styles.tabContent}>
            <div style={styles.formGroup}>
              <label>Template Name *</label>
              <input
                type="text"
                value={form.template_name}
                onChange={(e) => {
                  const val = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
                  setForm(prev => ({ ...prev, template_name: val }));
                }}
                placeholder="my_template_name"
                style={styles.input}
              />
              <p style={styles.hint}>Lowercase letters, numbers, underscores only</p>
            </div>

            <div style={styles.twoColumn}>
              <div style={styles.formGroup}>
                <label>Category *</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm(prev => ({ ...prev, category: e.target.value }))}
                  style={styles.select}
                >
                  {['MARKETING', 'UTILITY', 'AUTHENTICATION'].map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div style={styles.formGroup}>
                <label>Language *</label>
                <select
                  value={form.language}
                  onChange={(e) => setForm(prev => ({ ...prev, language: e.target.value }))}
                  style={styles.select}
                >
                  {languages.map(lang => (
                    <option key={lang} value={lang}>{lang}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={styles.formGroup}>
              <label>Template Type *</label>
              <div style={styles.radioGroup}>
                {['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'].map(type => (
                  <label key={type} style={styles.radioLabel}>
                    <input
                      type="radio"
                      value={type}
                      checked={form.template_type === type}
                      onChange={(e) => setForm(prev => ({ ...prev, template_type: e.target.value }))}
                    />
                    {type}
                  </label>
                ))}
              </div>
            </div>

            <div style={styles.formGroup}>
              <label>Header (Optional)</label>
              <select
                value={form.header_type}
                onChange={(e) => setForm(prev => ({ ...prev, header_type: e.target.value }))}
                style={styles.select}
              >
                {['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'].map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            {form.header_type !== 'NONE' && (
              <div style={styles.formGroup}>
                <label>Header Content</label>
                {form.header_type === 'TEXT' ? (
                  <textarea
                    value={form.header_content}
                    onChange={(e) => setForm(prev => ({ ...prev, header_content: e.target.value }))}
                    placeholder="Header text"
                    style={styles.textarea}
                    rows={2}
                  />
                ) : (
                  <div style={styles.uploadPlaceholder}>
                    📤 Upload {form.header_type.toLowerCase()} file
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Content Tab */}
        {activeTab === 'content' && (
          <div style={styles.tabContent}>
            <div style={styles.formGroup}>
              <label>Body Text * (Max 1024 chars)</label>
              <textarea
                value={form.body}
                onChange={(e) => setForm(prev => ({ ...prev, body: e.target.value }))}
                placeholder={`Hello {{1}},\n\nYour order {{2}} is confirmed.`}
                style={styles.textarea}
                rows={6}
              />
              <div style={styles.charCount}>
                {form.body.length}/1024
              </div>
              <p style={styles.hint}>{`Use variables like {{1}}, {{2}}, etc. Supports **bold**, __underline__, ~~strike~~, \`\`\`code\`\`\``}</p>
            </div>

            <div style={styles.formGroup}>
              <label>Footer (Optional, Max 60 chars)</label>
              <input
                type="text"
                value={form.footer}
                onChange={(e) => setForm(prev => ({ ...prev, footer: e.target.value }))}
                placeholder="Company name or footer text"
                style={styles.input}
              />
              <div style={styles.charCount}>{form.footer.length}/60</div>
            </div>
          </div>
        )}

        {/* Buttons Tab */}
        {activeTab === 'buttons' && (
          <div style={styles.tabContent}>
            <div style={styles.formGroup}>
              <label>Button Type</label>
              <div style={styles.radioGroup}>
                <label style={styles.radioLabel}>
                  <input
                    type="radio"
                    checked={currentButton.type === 'CALL_TO_ACTION'}
                    onChange={() => setCurrentButton(prev => ({ ...prev, type: 'CALL_TO_ACTION' }))}
                  />
                  Call to Action
                </label>
                <label style={styles.radioLabel}>
                  <input
                    type="radio"
                    checked={currentButton.type === 'QUICK_REPLY'}
                    onChange={() => setCurrentButton(prev => ({ ...prev, type: 'QUICK_REPLY' }))}
                  />
                  Quick Reply
                </label>
              </div>
            </div>

            {currentButton.type === 'CALL_TO_ACTION' && (
              <div style={styles.formGroup}>
                <label>CTA Type</label>
                <select
                  value={currentButton.cta_type}
                  onChange={(e) => setCurrentButton(prev => ({ ...prev, cta_type: e.target.value }))}
                  style={styles.select}
                >
                  <option value="VISIT_WEBSITE">Visit Website</option>
                  <option value="CALL_PHONE">Call Phone</option>
                </select>
              </div>
            )}

            <div style={styles.twoColumn}>
              <div style={styles.formGroup}>
                <label>Button Text *</label>
                <input
                  type="text"
                  value={currentButton.button_text}
                  onChange={(e) => setCurrentButton(prev => ({ ...prev, button_text: e.target.value.slice(0, 25) }))}
                  placeholder="Button text (max 25 chars)"
                  style={styles.input}
                />
                <p style={styles.charCount}>{currentButton.button_text.length}/25</p>
              </div>

              <div style={styles.formGroup}>
                <label>Button Value *</label>
                <input
                  type="text"
                  value={currentButton.button_value}
                  onChange={(e) => setCurrentButton(prev => ({ ...prev, button_value: e.target.value }))}
                  placeholder={currentButton.cta_type === 'VISIT_WEBSITE' ? 'https://example.com' : '+918116856153'}
                  style={styles.input}
                />
              </div>
            </div>

            <button
              onClick={addButton}
              style={styles.addButton}
              disabled={!currentButton.button_text || !currentButton.button_value}
            >
              <Plus size={18} /> Add Button
            </button>

            {form.buttons.length > 0 && (
              <div style={styles.buttonsList}>
                {form.buttons.map((btn, idx) => (
                  <div key={idx} style={styles.buttonItem}>
                    <span>{btn.button_text} ({btn.type})</span>
                    <button
                      onClick={() => removeButton(idx)}
                      style={styles.removeBtn}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Variables Tab */}
        {activeTab === 'variables' && (
          <div style={styles.tabContent}>
            {bodyVariables.length === 0 ? (
              <p style={styles.emptyState}>{`No variables found in body text. Add {{1}}, {{2}}, etc. to define variables.`}</p>
            ) : (
              <div style={styles.variablesGrid}>
                {bodyVariables.map(variable => (
                  <div key={variable} style={styles.variableInput}>
                    <label>{variable}</label>
                    <input
                      type="text"
                      value={form.sample_values[variable] || ''}
                      onChange={(e) => updateSampleValue(variable, e.target.value)}
                      placeholder="Sample value"
                      style={styles.input}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div style={styles.actions}>
        <button onClick={onCancel} style={styles.cancelBtn}>Cancel</button>
        <button
          onClick={() => handleSubmit(true)}
          disabled={saving}
          style={styles.draftBtn}
        >
          {saving ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : '💾'} Save Draft
        </button>
        <button
          onClick={() => handleSubmit(false)}
          disabled={saving}
          style={styles.submitBtn}
        >
          {saving ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : '🚀'} Submit for Approval
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    padding: '2rem',
    background: '#fff',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  header: {
    marginBottom: '2rem',
  },
  errorBox: {
    display: 'flex',
    gap: '1rem',
    padding: '1rem',
    background: '#fee2e2',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    color: '#991b1b',
    marginBottom: '2rem',
  },
  tabs: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '2rem',
    borderBottom: '2px solid #e5e7eb',
  },
  tab: {
    padding: '0.75rem 1rem',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontSize: '0.95rem',
    fontWeight: 500,
    transition: 'all 0.2s',
    position: 'relative',
  },
  tabActive: {
    color: '#667eea',
    borderBottom: '3px solid #667eea',
    marginBottom: '-2px',
  },
  tabInactive: {
    color: '#666',
  },
  formContent: {
    marginBottom: '2rem',
  },
  tabContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  twoColumn: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '1rem',
  },
  label: {
    fontWeight: 600,
    fontSize: '0.9rem',
    color: '#1a1a1a',
  },
  input: {
    padding: '0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.95rem',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  select: {
    padding: '0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.95rem',
    background: '#fff',
    cursor: 'pointer',
    boxSizing: 'border-box',
  },
  textarea: {
    padding: '0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.95rem',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    resize: 'vertical',
  },
  hint: {
    fontSize: '0.8rem',
    color: '#666',
    margin: 0,
  },
  charCount: {
    fontSize: '0.8rem',
    color: '#999',
    textAlign: 'right',
  },
  radioGroup: {
    display: 'flex',
    gap: '1rem',
    flexWrap: 'wrap',
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    cursor: 'pointer',
  },
  uploadPlaceholder: {
    padding: '2rem',
    background: '#f9fafb',
    border: '2px dashed #d1d5db',
    borderRadius: '8px',
    textAlign: 'center',
    color: '#666',
  },
  addButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    padding: '0.75rem 1rem',
    background: '#667eea',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  buttonsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  buttonItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.75rem',
    background: '#f9fafb',
    borderRadius: '6px',
    border: '1px solid #e5e7eb',
  },
  removeBtn: {
    padding: '0.5rem',
    background: '#fee2e2',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    color: '#dc2626',
  },
  variablesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '1rem',
  },
  variableInput: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    padding: '1rem',
    background: '#f9fafb',
    borderRadius: '6px',
    border: '1px solid #e5e7eb',
  },
  emptyState: {
    textAlign: 'center',
    color: '#999',
    padding: '2rem',
  },
  actions: {
    display: 'flex',
    gap: '1rem',
    justifyContent: 'flex-end',
  },
  cancelBtn: {
    padding: '0.75rem 1.5rem',
    background: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  draftBtn: {
    padding: '0.75rem 1.5rem',
    background: '#6b7280',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  submitBtn: {
    padding: '0.75rem 1.5rem',
    background: '#667eea',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 500,
  },
};
