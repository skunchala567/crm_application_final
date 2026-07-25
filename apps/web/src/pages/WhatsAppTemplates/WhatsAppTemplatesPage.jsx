import { useState, useEffect, useMemo } from 'react';
import { Plus, Search, Settings2, Pencil, Trash2 } from 'lucide-react';
import { api } from '../../api';
import TemplateCreateModal from './TemplateCreateModal';

export default function WhatsAppTemplatesPage({ integrationId }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);

  const tabs = [
    { id: 'all', label: 'All Templates', status: null },
    { id: 'drafts', label: 'Drafts', status: 'DRAFT' },
    { id: 'pending', label: 'Pending', status: 'PENDING' },
    { id: 'approved', label: 'Approved', status: 'APPROVED' },
    { id: 'rejected', label: 'Rejected', status: 'REJECTED' },
    { id: 'archived', label: 'Archived', status: 'ARCHIVED' }
  ];

  useEffect(() => {
    loadTemplates();
  }, [activeTab]);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const currentTab = tabs.find(t => t.id === activeTab);
      const queryParams = new URLSearchParams(
        currentTab.status ? { status: currentTab.status } : {}
      );

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

  const filteredTemplates = useMemo(() => {
    return templates.filter(t =>
      `${t.template_name} ${t.category || ''} ${t.language || ''}`.toLowerCase().includes(search.toLowerCase())
    );
  }, [templates, search]);

  const getStatusBadge = (status) => {
    const styles = {
      DRAFT: { bg: '#eef2ff', color: '#4338ca', text: '📝' },
      PENDING: { bg: '#fef3c7', color: '#b45309', text: '⏳' },
      APPROVED: { bg: '#e8f6f0', color: '#258268', text: '✓' },
      REJECTED: { bg: '#fee2e2', color: '#dc2626', text: '✕' },
      ARCHIVED: { bg: '#f3f4f6', color: '#858696', text: '📦' }
    };
    return styles[status] || styles.DRAFT;
  };

  const getTabCount = (tabId) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab.status) return templates.length;
    return templates.filter(t => t.status === tab.status).length;
  };

  const handleCreateModal = (template = null) => {
    setEditingTemplate(template);
    setShowCreateModal(true);
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    setEditingTemplate(null);
  };

  const handleSuccess = () => {
    loadTemplates();
    handleCloseModal();
  };

  const handleDeleteTemplate = async (templateId, templateName) => {
    if (!templateId || isNaN(templateId)) {
      alert('Error: Invalid template ID');
      return;
    }

    if (!window.confirm(`Delete template "${templateName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await api.delete(`/whatsapp/integrations/${integrationId}/templates/${templateId}`);
      loadTemplates();
    } catch (error) {
      alert(`Failed to delete template: ${error.message}`);
      console.error('Delete error:', error);
    }
  };

  return (
    <section className="lead-config-panel panel" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="lead-config-head">
        <div>
          <span className="eyebrow">Communication Settings</span>
          <h2>WhatsApp Templates</h2>
          <p>Create and manage WhatsApp message templates for Smartping</p>
        </div>
        <button
          onClick={() => handleCreateModal()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 16px',
            background: 'var(--primary)',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: '600'
          }}
        >
          <Plus size={18} /> New Template
        </button>
      </div>

      {/* Tabs */}
      <div className="config-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            <span>{getTabCount(tab.id)}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Search & Tools */}
        <div className="config-list-tools">
          <div className="local-search">
            <Search size={16} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search templates"
            />
          </div>
          <span>{filteredTemplates.length} templates</span>
        </div>

        {/* Templates List */}
        <div className="config-records">
          {filteredTemplates.length === 0 ? (
            <div className="empty" style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '300px',
              color: '#67697b'
            }}>
              <Settings2 size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
              <strong style={{ fontSize: '16px', color: '#1a1a1a', marginBottom: '8px' }}>
                {search ? 'No templates found' : 'No templates yet'}
              </strong>
              <p style={{ margin: 0, fontSize: '13px' }}>
                {search ? 'Try a different search' : 'Create your first WhatsApp template to get started'}
              </p>
              {!search && (
                <button
                  onClick={() => handleCreateModal()}
                  style={{
                    marginTop: '16px',
                    padding: '10px 16px',
                    background: 'var(--primary)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '600',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Plus size={16} /> Create Template
                </button>
              )}
            </div>
          ) : (
            filteredTemplates.map(template => {
              const statusStyle = getStatusBadge(template.status);
              return (
                <article
                  key={template.id}
                  style={{
                    minHeight: '58px',
                    padding: '10px 18px',
                    borderBottom: '1px solid #eff0f4',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '15px'
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: '12px', color: '#000' }}>
                      {template.template_name}
                    </strong>
                    <small style={{ fontSize: '9px', color: '#67697b', display: 'block', marginTop: '3px' }}>
                      {template.category ? `${template.category} · ` : ''}
                      {template.language || 'English'}
                    </small>
                  </div>

                  <div className="config-record-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      onClick={() => handleCreateModal(template)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--primary)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '12px',
                        fontWeight: '600',
                        padding: 0
                      }}
                    >
                      <Pencil size={14} /> Edit
                    </button>

                    {template.status === 'DRAFT' && (
                      <button
                        onClick={() => handleDeleteTemplate(template.id, template.template_name)}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: '#dc2626',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '12px',
                          fontWeight: '600',
                          padding: 0,
                          hover: { opacity: 0.7 }
                        }}
                        title="Delete draft template"
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    )}

                    <button
                      style={{
                        background: statusStyle.bg,
                        color: statusStyle.color,
                        border: 'none',
                        borderRadius: '16px',
                        padding: '4px 12px',
                        fontSize: '10px',
                        fontWeight: '700',
                        cursor: 'default',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                      disabled
                    >
                      <i style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: statusStyle.color,
                        display: 'inline-block'
                      }} />
                      {template.status}
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>

      {/* Template Creation Modal */}
      <TemplateCreateModal
        isOpen={showCreateModal}
        onClose={handleCloseModal}
        onSuccess={handleSuccess}
        editingTemplate={editingTemplate}
        integrationId={integrationId}
      />
    </section>
  );
}
