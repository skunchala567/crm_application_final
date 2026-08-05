import { Plus, X, ChevronDown } from 'lucide-react';

const FIELD_TYPES = [
  { value: 'text', label: 'Text Input' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone Number' },
  { value: 'number', label: 'Number' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'select', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
];

export default function FormFieldBuilder({ fields, onChange }) {
  const addField = () => {
    const newField = {
      id: Date.now(),
      name: '',
      label: '',
      type: 'text',
      required: false,
      placeholder: '',
      options: [],
    };
    onChange([...fields, newField]);
  };

  const updateField = (id, updates) => {
    onChange(fields.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const removeField = (id) => {
    onChange(fields.filter(f => f.id !== id));
  };

  const addOption = (fieldId) => {
    onChange(fields.map(f =>
      f.id === fieldId ? { ...f, options: [...(f.options || []), ''] } : f
    ));
  };

  const updateOption = (fieldId, optionIdx, value) => {
    onChange(fields.map(f =>
      f.id === fieldId
        ? { ...f, options: f.options.map((opt, i) => i === optionIdx ? value : opt) }
        : f
    ));
  };

  const removeOption = (fieldId, optionIdx) => {
    onChange(fields.map(f =>
      f.id === fieldId
        ? { ...f, options: f.options.filter((_, i) => i !== optionIdx) }
        : f
    ));
  };

  return (
    <div className="form-builder">
      <div className="builder-header">
        <h3>Customer Details Form</h3>
        <p>Add fields to collect customer information when they pay</p>
      </div>

      <div className="fields-list">
        {fields.length === 0 ? (
          <div className="empty-fields">
            <p>No fields added yet. Click "Add Field" to get started.</p>
          </div>
        ) : (
          fields.map(field => (
            <div key={field.id} className="field-card">
              <div className="field-header">
                <div className="field-info">
                  <strong>{field.label || field.name || 'Untitled Field'}</strong>
                  <span className="field-type">{FIELD_TYPES.find(t => t.value === field.type)?.label}</span>
                  {field.required && <span className="required-badge">Required</span>}
                </div>
                <button
                  type="button"
                  className="remove-btn"
                  onClick={() => removeField(field.id)}
                  title="Remove field"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="field-grid">
                <label>
                  Field Name *
                  <input
                    type="text"
                    placeholder="e.g., studentName"
                    value={field.name}
                    onChange={e => updateField(field.id, { name: e.target.value })}
                    required
                  />
                </label>

                <label>
                  Display Label *
                  <input
                    type="text"
                    placeholder="e.g., Student Name"
                    value={field.label}
                    onChange={e => updateField(field.id, { label: e.target.value })}
                    required
                  />
                </label>

                <label>
                  Field Type *
                  <select
                    value={field.type}
                    onChange={e => updateField(field.id, { type: e.target.value, options: [] })}
                  >
                    {FIELD_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </label>

                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={e => updateField(field.id, { required: e.target.checked })}
                  />
                  Required field
                </label>
              </div>

              {!['checkbox'].includes(field.type) && (
                <label className="placeholder-label">
                  Placeholder Text
                  <input
                    type="text"
                    placeholder="e.g., Enter student name"
                    value={field.placeholder}
                    onChange={e => updateField(field.id, { placeholder: e.target.value })}
                  />
                </label>
              )}

              {field.type === 'select' && (
                <div className="options-section">
                  <label>Options *</label>
                  {(field.options || []).map((option, idx) => (
                    <div key={idx} className="option-row">
                      <input
                        type="text"
                        placeholder={`Option ${idx + 1}`}
                        value={option}
                        onChange={e => updateOption(field.id, idx, e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => removeOption(field.id, idx)}
                        title="Remove option"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="add-option-btn"
                    onClick={() => addOption(field.id)}
                  >
                    <Plus size={14} />
                    Add Option
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        className="add-field-btn"
        onClick={addField}
      >
        <Plus size={16} />
        Add Field
      </button>
    </div>
  );
}
