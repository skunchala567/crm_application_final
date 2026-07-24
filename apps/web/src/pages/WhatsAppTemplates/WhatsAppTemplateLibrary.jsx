import { useState, useEffect } from 'react';
import { Plus, Search, Filter, Trash2, Edit2, Copy, MoreVertical } from 'lucide-react';
import { api } from '../../api';
import './WhatsAppTemplateLibrary.css';

const STATUS_COLORS = {
  DRAFT: '#f97316',
  PENDING: '#f59e0b',
  APPROVED: '#22c55e',
  REJECTED: '#ef4444',
  DISABLED: '#9ca3af'
};

export default function WhatsAppTemplateLibrary({
  integrationId,
  onCreateNew,
  onEdit,
  onDelete
}) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  useEffect(() => {
    loadTemplates();
  }, [integrationId]);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/whatsapp/integrations/${integrationId}/templates`);
      setTemplates(response.data?.data || response.data || []);
    } catch (error) {
      console.error('Failed to load templates:', error);
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (templateId, templateName) => {
    if (!window.confirm(`Delete template "${templateName}"?`)) return;

    try {
      await api.delete(`/whatsapp/integrations/${integrationId}/templates/${templateId}`);
      setTemplates(prev => prev.filter(t => t.id !== templateId));
      if (onDelete) onDelete();
    } catch (error) {
      alert('Failed to delete template: ' + error.message);
    }
  };

  const handleClone = async (template) => {
    const newName = prompt('Enter name for cloned template:', `${template.template_name}_copy`);
    if (!newName) return;

    try {
      await api.post(
        `/whatsapp/integrations/${integrationId}/templates/${template.id}/clone`,
        { newName }
      );
      loadTemplates();
    } catch (error) {
      alert('Failed to clone template: ' + error.message);
    }
  };

  const filtered = templates.filter(t => {
    const matchSearch = !search ||
      t.template_name.toLowerCase().includes(search.toLowerCase()) ||
      t.category?.toLowerCase().includes(search.toLowerCase());

    const matchStatus = !statusFilter || t.status === statusFilter;
    const matchCategory = !categoryFilter || t.category === categoryFilter;

    return matchSearch && matchStatus && matchCategory;
  });

  const categories = [...new Set(templates.map(t => t.category).filter(Boolean))];

  if (loading) {
    return (
      <div className="library-loading">
        <div className="spinner"></div>
        <p>Loading templates...</p>
      </div>
    );
  }

  return (
    <div className="template-library">
      {/* Header */}
      <div className="library-header">
        <div>
          <h2 className="library-title">WhatsApp Templates</h2>
          <p className="library-subtitle">Create and manage WhatsApp Business templates</p>
        </div>
        <button className="btn btn-primary" onClick={onCreateNew}>
          <Plus size={18} />
          New Template
        </button>
      </div>

      {/* Search & Filters */}
      <div className="library-toolbar">
        <div className="search-box">
          <Search size={18} color="#9ca3af" />
          <input
            type="text"
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="filters">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="filter-select"
          >
            <option value="">All Status</option>
            <option value="DRAFT">Draft</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="filter-select"
          >
            <option value="">All Categories</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Templates List */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <h3>No templates found</h3>
          <p>
            {templates.length === 0
              ? 'Create your first WhatsApp Business template'
              : 'No templates match your search'}
          </p>
          <button className="btn btn-primary" onClick={onCreateNew}>
            <Plus size={16} />
            Create Template
          </button>
        </div>
      ) : (
        <div className="templates-grid">
          {filtered.map(template => (
            <div key={template.id} className="template-card">
              <div className="card-header">
                <div className="card-title">
                  <h3>{template.template_name}</h3>
                  <span
                    className="status-badge"
                    style={{ borderColor: STATUS_COLORS[template.status] || '#9ca3af' }}
                  >
                    {template.status}
                  </span>
                </div>
                <div className="card-menu">
                  <button
                    className="btn-icon"
                    onClick={() => handleClone(template)}
                    title="Clone"
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    className="btn-icon"
                    onClick={() => onEdit(template.id)}
                    title="Edit"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    className="btn-icon btn-danger"
                    onClick={() => handleDelete(template.id, template.template_name)}
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <div className="card-meta">
                <span className="meta-item">
                  <span className="meta-label">Category</span>
                  <span className="meta-value">{template.category || '—'}</span>
                </span>
                <span className="meta-item">
                  <span className="meta-label">Language</span>
                  <span className="meta-value">{template.language || '—'}</span>
                </span>
                <span className="meta-item">
                  <span className="meta-label">Type</span>
                  <span className="meta-value">{template.template_type || 'TEXT'}</span>
                </span>
              </div>

              <div className="card-preview">
                <p>{template.body?.substring(0, 100) || '[No body]'}
                  {template.body?.length > 100 ? '...' : ''}
                </p>
              </div>

              <div className="card-footer">
                <small>
                  Created {new Date(template.created_at).toLocaleDateString()}
                </small>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
