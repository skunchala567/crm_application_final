import { useState, useEffect } from 'react';
import { Plus, Search, Filter, Trash2, Copy, Eye, RefreshCw, Archive } from 'lucide-react';
import { api } from '../../api';

export default function WhatsAppTemplateList({ integrationId, onEditTemplate, onNewTemplate, onRefresh }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ category: '', language: '', type: '' });
  const [showFilters, setShowFilters] = useState(false);

  const tabs = [
    { id: 'all', label: 'All Templates', status: null },
    { id: 'drafts', label: 'Drafts', status: 'DRAFT' },
    { id: 'pending', label: 'Pending', status: 'PENDING' },
    { id: 'approved', label: 'Approved', status: 'APPROVED' },
    { id: 'rejected', label: 'Rejected', status: 'REJECTED' },
    { id: 'archived', label: 'Archived', status: 'ARCHIVED' }
  ];

  const categories = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];
  const types = ['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'];

  useEffect(() => {
    loadTemplates();
  }, [activeTab, search, filters]);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const currentTab = tabs.find(t => t.id === activeTab);
      const queryParams = new URLSearchParams({
        ...(currentTab.status && { status: currentTab.status }),
        ...(search && { search }),
        ...(filters.category && { category: filters.category }),
        ...(filters.language && { language: filters.language }),
        ...(filters.type && { type: filters.type })
      });

      const response = await api.get(
        `/whatsapp/integrations/${integrationId}/templates?${queryParams}`
      );
      setTemplates(response.data.data || []);
    } catch (error) {
      console.error('Failed to load templates:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (templateId) => {
    if (!confirm('Delete this template?')) return;

    try {
      await api.delete(`/whatsapp/integrations/${integrationId}/templates/${templateId}`);
      loadTemplates();
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  };

  const handleClone = async (template) => {
    const newName = prompt('New template name:', `${template.template_name}_copy`);
    if (!newName) return;

    try {
      await api.post(
        `/whatsapp/integrations/${integrationId}/templates/${template.id}/clone`,
        { newName }
      );
      loadTemplates();
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  };

  const handleArchive = async (templateId) => {
    try {
      await api.post(`/whatsapp/integrations/${integrationId}/templates/${templateId}/archive`);
      loadTemplates();
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      DRAFT: '#93c5fd',
      PENDING: '#fbbf24',
      APPROVED: '#86efac',
      REJECTED: '#f87171',
      ARCHIVED: '#d1d5db'
    };
    return colors[status] || '#d1d5db';
  };

  return (
    <div style={styles.container}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <div style={styles.toolbarLeft}>
          <button onClick={onNewTemplate} style={styles.newButton}>
            <Plus size={18} /> New Template
          </button>
          <button onClick={loadTemplates} style={styles.refreshButton}>
            <RefreshCw size={18} />
          </button>
        </div>

        <div style={styles.toolbarRight}>
          <div style={styles.searchBox}>
            <Search size={16} />
            <input
              type="text"
              placeholder="Search templates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={styles.searchInput}
            />
          </div>

          <button
            onClick={() => setShowFilters(!showFilters)}
            style={styles.filterButton}
          >
            <Filter size={18} /> Filters
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div style={styles.filtersPanel}>
          <div style={styles.filterGroup}>
            <label>Category</label>
            <select
              value={filters.category}
              onChange={(e) => setFilters(prev => ({ ...prev, category: e.target.value }))}
              style={styles.filterSelect}
            >
              <option value="">All</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div style={styles.filterGroup}>
            <label>Type</label>
            <select
              value={filters.type}
              onChange={(e) => setFilters(prev => ({ ...prev, type: e.target.value }))}
              style={styles.filterSelect}
            >
              <option value="">All</option>
              {types.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div style={styles.filterGroup}>
            <label>Language</label>
            <input
              type="text"
              placeholder="e.g., English"
              value={filters.language}
              onChange={(e) => setFilters(prev => ({ ...prev, language: e.target.value }))}
              style={styles.filterInput}
            />
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={styles.tabs}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...styles.tab,
              ...(activeTab === tab.id ? styles.tabActive : styles.tabInactive)
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div style={styles.loading}>Loading templates...</div>
      ) : templates.length === 0 ? (
        <div style={styles.empty}>No templates found</div>
      ) : (
        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th>Template Name</th>
                <th>Category</th>
                <th>Language</th>
                <th>Type</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map(template => (
                <tr key={template.id} style={styles.tableRow}>
                  <td style={styles.nameCell}>{template.template_name}</td>
                  <td>{template.category}</td>
                  <td>{template.language}</td>
                  <td>{template.template_type}</td>
                  <td>
                    <span
                      style={{
                        ...styles.statusBadge,
                        backgroundColor: getStatusColor(template.status)
                      }}
                    >
                      {template.status}
                    </span>
                  </td>
                  <td>{new Date(template.created_at).toLocaleDateString()}</td>
                  <td style={styles.actionsCell}>
                    <button
                      onClick={() => onEditTemplate(template.id)}
                      title="Preview"
                      style={styles.actionButton}
                    >
                      <Eye size={16} />
                    </button>
                    {template.status === 'DRAFT' && (
                      <button
                        onClick={() => onEditTemplate(template.id)}
                        title="Edit"
                        style={styles.actionButton}
                      >
                        ✏️
                      </button>
                    )}
                    <button
                      onClick={() => handleClone(template)}
                      title="Clone"
                      style={styles.actionButton}
                    >
                      <Copy size={16} />
                    </button>
                    {template.status === 'DRAFT' && (
                      <button
                        onClick={() => handleDelete(template.id)}
                        title="Delete"
                        style={{ ...styles.actionButton, color: '#dc2626' }}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                    {template.status !== 'ARCHIVED' && (
                      <button
                        onClick={() => handleArchive(template.id)}
                        title="Archive"
                        style={styles.actionButton}
                      >
                        <Archive size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '1rem',
  },
  toolbarLeft: {
    display: 'flex',
    gap: '0.5rem',
  },
  toolbarRight: {
    display: 'flex',
    gap: '1rem',
    alignItems: 'center',
  },
  newButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.75rem 1rem',
    background: '#667eea',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  refreshButton: {
    padding: '0.75rem 1rem',
    background: '#f3f4f6',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.75rem 1rem',
    background: '#f3f4f6',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
  },
  searchInput: {
    border: 'none',
    background: 'none',
    fontSize: '0.95rem',
    outline: 'none',
    width: '200px',
  },
  filterButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.75rem 1rem',
    background: '#f3f4f6',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  filtersPanel: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem',
    padding: '1rem',
    background: '#f9fafb',
    borderRadius: '6px',
    border: '1px solid #e5e7eb',
  },
  filterGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  filterSelect: {
    padding: '0.5rem',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontSize: '0.9rem',
  },
  filterInput: {
    padding: '0.5rem',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontSize: '0.9rem',
  },
  tabs: {
    display: 'flex',
    gap: '0.5rem',
    borderBottom: '2px solid #e5e7eb',
    overflowX: 'auto',
  },
  tab: {
    padding: '0.75rem 1rem',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  tabActive: {
    color: '#667eea',
    borderBottom: '3px solid #667eea',
    marginBottom: '-2px',
  },
  tabInactive: {
    color: '#666',
  },
  loading: {
    textAlign: 'center',
    padding: '3rem',
    color: '#666',
  },
  empty: {
    textAlign: 'center',
    padding: '3rem',
    color: '#999',
  },
  tableWrapper: {
    overflowX: 'auto',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.9rem',
  },
  tableRow: {
    borderBottom: '1px solid #e5e7eb',
    '&:hover': {
      background: '#f9fafb',
    }
  },
  nameCell: {
    fontWeight: 500,
  },
  statusBadge: {
    display: 'inline-block',
    padding: '0.25rem 0.75rem',
    borderRadius: '12px',
    fontSize: '0.8rem',
    fontWeight: 500,
    color: '#000',
  },
  actionsCell: {
    display: 'flex',
    gap: '0.5rem',
    padding: '0.5rem',
  },
  actionButton: {
    padding: '0.5rem',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#667eea',
    display: 'flex',
    alignItems: 'center',
  },
};
