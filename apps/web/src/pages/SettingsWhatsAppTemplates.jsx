import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Trash2, Edit2, Copy, RefreshCw, Loader, AlertCircle, Funnel, X, ChevronLeft, ChevronRight, MessageSquarePlus, Send, History } from 'lucide-react';
import { api } from '../api';
import WhatsAppPreview from '../components/WhatsAppPreview';
import '../styles/SettingsWhatsAppTemplatesRedesigned.css';
import '../ProjectPagination.css';
import '../styles/WhatsAppTemplateTableAlignment.css';

export default function SettingsWhatsAppTemplates({ integrationId, integrations, onIntegrationChange, onNavigate, onMessage, onSendMessage, onMessageHistory }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [templateType, setTemplateType] = useState('');
  const [category, setCategory] = useState('');
  const [language, setLanguage] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [error, setError] = useState(null);
  const [syncMessage, setSyncMessage] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Load templates once on mount
  useEffect(() => {
    loadTemplates();
  }, [integrationId, integrations]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, selectedStatus, dateFrom, dateTo, templateType, category, language]);

  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // ✅ Fetch all templates (backend now handles fetching all pages from AiSensy)
      const eligible = integrations.filter(item => item.has_credentials && (!integrationId || String(item.id) === String(integrationId)));
      const responses = await Promise.all(eligible.map(item =>
        api.get(`/whatsapp/integrations/${item.id}/templates?limit=1000&offset=0`).then(response => {
          const rows = response.data?.data || response.data || [];
          return rows.map(template => ({ ...template, integrationId: item.id, integrationName: item.integration_name }));
        })
      ));
      const data = responses.flat();

      // ✅ FIX 5: Sort by newest first (created_at DESC)
      const sorted = [...data].sort((a, b) => {
        const dateA = new Date(a.created_at || 0).getTime();
        const dateB = new Date(b.created_at || 0).getTime();
        return dateB - dateA;
      });

      setTemplates(sorted);

      // ✅ FIX 9: Maintain selected template if it still exists
      setSelectedTemplate(prev => {
        if (prev) {
          const stillExists = sorted.find(t => (t.id || t.aisensy_template_id) === (prev.id || prev.aisensy_template_id));
          if (!stillExists) {
            return sorted[0] || null;
          }
        }
        return prev;
      });
    } catch (err) {
      setError(`Failed to load templates: ${err.message}`);
      console.error('Error loading templates:', err);
    } finally {
      setLoading(false);
    }
  }, [integrationId, integrations]);

  // ✅ FIX 7: Proper sync function that actually syncs with AiSensy
  const handleSync = async () => {
    try {
      setSyncing(true);
      setError(null);
      setSyncMessage('');

      // Sync with AiSensy to get latest statuses
      const eligible = integrations.filter(item => item.has_credentials && (!integrationId || String(item.id) === String(integrationId)));
      const responses = await Promise.all(eligible.map(item => api.post(`/whatsapp/integrations/${item.id}/sync`)));

      // Reload templates to reflect updated statuses
      await loadTemplates();

      // Show sync summary
      const synced = responses.reduce((sum,response)=>sum+(response.data?.data?.synced||0),0);
      const updated = responses.reduce((sum,response)=>sum+(response.data?.data?.updated||0),0);
      const total = synced + updated;

      if (total === 0) {
        setSyncMessage('No changes found');
      } else {
        setSyncMessage(`${synced} new templates synced, ${updated} updated`);
      }
    } catch (err) {
      setError(`Sync failed: ${err.message}`);
      console.error('Sync error:', err);
    } finally {
      setSyncing(false);
      // Clear sync message after 3 seconds
      setTimeout(() => setSyncMessage(''), 3000);
    }
  };

  const handleDelete = async (templateId, templateName) => {
    if (!window.confirm(`Delete template "${templateName}"?`)) return;

    try {
      setError(null);
      // ✅ FIX: Use aisensy_template_id for delete endpoint (not local id)
      const aisensy_id = selectedTemplate?.aisensy_template_id || templateId;
      await api.delete(`/whatsapp/integrations/${selectedTemplate?.integrationId || integrationId}/templates/${aisensy_id}`);

      if (selectedTemplate) {
        setSelectedTemplate(null);
      }

      // ✅ Reload templates to reflect deletion
      await loadTemplates();

      // Show success message
      if (onMessage) {
        onMessage({ type: 'success', text: `Template "${templateName}" deleted successfully` });
      }
    } catch (err) {
      setError(`Failed to delete: ${err.message}`);
    }
  };

  /**
   * Open the create form prefilled from an existing template.
   *
   * This used to POST a copy immediately, named `<name>_copy_<timestamp>`, so
   * a duplicate was published to the account before anyone could change a
   * word of it -- and with no users selected, so nobody could use it either.
   */
  const handleDuplicate = (templateId) => {
    const template = templates.find(t => (t.id || t.aisensy_template_id) === templateId);
    if (!template) return;
    onNavigate('create', null, template.integrationId || integrationId, {
      // The name must differ; the rest is the operator's to edit.
      template_name: `${template.template_name}_copy`,
      label: `${template.label || template.template_name} (Copy)`,
      category: template.category || 'MARKETING',
      language: template.language || 'English',
      template_type: template.template_type || 'TEXT',
      body: template.body || '',
      header_content: template.header_content || '',
      footer: template.footer || '',
      sample_text: template.sample_text || '',
      quick_replies: template.quick_replies || [],
      call_to_action: template.call_to_action || [],
      visibleUserIds: template.visibleUserIds || [],
    });
  };

  const countVariables = (text) => {
    if (!text) return 0;
    const matches = text.match(/\{\{(\d+)\}\}/g) || [];
    return new Set(matches).size;
  };

  // ✅ FIX 6: Calculate filter counts dynamically from current templates
  const calculateCounts = () => {
    return {
      ALL: templates.length,
      APPROVED: templates.filter(t => t.status === 'APPROVED').length,
      PENDING: templates.filter(t => t.status === 'PENDING').length,
      DRAFT: templates.filter(t => t.status === 'DRAFT').length,
      REJECTED: templates.filter(t => t.status === 'REJECTED').length,
      ARCHIVED: templates.filter(t => t.status === 'ARCHIVED').length
    };
  };

  const counts = calculateCounts();

  // ✅ FIX 10: Search everything - name, label, body, category, language, status
  const filtered = templates.filter(t => {
    const searchLower = search.toLowerCase();
    const matchSearch = !search ||
      (t.template_name && t.template_name.toLowerCase().includes(searchLower)) ||
      (t.label && t.label.toLowerCase().includes(searchLower)) ||
      (t.body && t.body.toLowerCase().includes(searchLower)) ||
      (t.category && t.category.toLowerCase().includes(searchLower)) ||
      (t.language && t.language.toLowerCase().includes(searchLower)) ||
      (t.status && t.status.toLowerCase().includes(searchLower));
    const matchStatus = !selectedStatus || t.status === selectedStatus;
    const matchType = !templateType || t.template_type === templateType;
    const matchCategory = !category || t.category === category;
    const matchLanguage = !language || t.language === language;
    const createdAt = t.created_at ? new Date(t.created_at) : null;
    const matchDateFrom = !dateFrom || (createdAt && createdAt >= new Date(`${dateFrom}T00:00:00`));
    const matchDateTo = !dateTo || (createdAt && createdAt <= new Date(`${dateTo}T23:59:59`));
    return matchSearch && matchStatus && matchType && matchCategory && matchLanguage && matchDateFrom && matchDateTo;
  });

  const uniqueValues = (field) => [...new Set(templates.map(t => t[field]).filter(Boolean))].sort();
  const templateTypes = uniqueValues('template_type');
  const categories = uniqueValues('category');
  const languages = uniqueValues('language');
  const activeAdvancedFilterCount = [dateFrom, dateTo, templateType, selectedStatus, category, language].filter(Boolean).length;
  const clearAdvancedFilters = () => {
    setDateFrom('');
    setDateTo('');
    setTemplateType('');
    setCategory('');
    setLanguage('');
    setSelectedStatus('');
  };

  // ✅ Pagination logic
  const totalItems = filtered.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedTemplates = filtered.slice(startIndex, endIndex);

  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  return (
    <div className="templates-redesigned">
      <header className="template-page-header">
        <div className="template-header-controls">
          <label className="template-header-search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search templates"
              aria-label="Search templates"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button className="template-header-button secondary" onClick={handleSync} disabled={syncing}>
            <RefreshCw size={17} className={syncing ? 'spinning' : ''} />
            <span>Sync</span>
          </button>
          <button className="template-header-button secondary" onClick={onMessageHistory}>
            <History size={17} />
            <span>History</span>
          </button>
          <button className="template-header-button secondary" onClick={onSendMessage}>
            <Send size={17} />
            <span>Send message</span>
          </button>
          <button className="template-header-button primary" onClick={() => onNavigate('create')}>
            <Plus size={18} />
            <span>New template</span>
          </button>
        </div>
      </header>

      {/* ✅ FIX 2: Error message outside scroll container */}
      {error && (
        <div className="alert alert-error">
          <AlertCircle size={18} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="alert-close">✕</button>
        </div>
      )}

      {/* ✅ FIX 6: Sync success message */}
      {syncMessage && (
        <div className="alert alert-success">
          <span>{syncMessage}</span>
        </div>
      )}

      {/* ✅ FIX 3, 4: Main layout with proper scroll behavior and width split */}
      <div className="templates-main">
        {/* Left Panel - List (65%) */}
        <div className="templates-list-panel">
          <nav className="templates-list-nav" aria-label="Filter templates by status">
            <div className="filter-tabs">
              <button
                className={`filter-chip ${!selectedStatus ? 'active' : ''}`}
                onClick={() => setSelectedStatus('')}
              >
                <span className="chip-label">All</span>
                <span className="chip-count">{counts.ALL}</span>
              </button>
              {['APPROVED', 'PENDING', 'DRAFT', 'REJECTED', 'ARCHIVED'].map(status => (
                <button
                  key={status}
                  className={`filter-chip filter-${status.toLowerCase()} ${selectedStatus === status ? 'active' : ''}`}
                  onClick={() => setSelectedStatus(status)}
                >
                  <span className="chip-label">{status}</span>
                  <span className="chip-count">{counts[status] || 0}</span>
                </button>
              ))}
            </div>
            <div className="templates-list-nav-actions">
              <select className="template-integration-filter template-list-integration-filter" value={integrationId} onChange={event=>onIntegrationChange(event.target.value)} aria-label="WhatsApp integration">
                <option value="">All integrations</option>
                {integrations.map(item=><option key={item.id} value={item.id}>{item.integration_name}</option>)}
              </select>
              <div className="advanced-filter">
                <button
                  className={`list-nav-icon-button ${showFilters || activeAdvancedFilterCount ? 'active' : ''}`}
                  onClick={() => setShowFilters(open => !open)}
                  title="More filters"
                  aria-label="Open template filters"
                  aria-expanded={showFilters}
                >
                  <Funnel size={17} />
                  {activeAdvancedFilterCount > 0 && (
                    <span className="filter-active-count">{activeAdvancedFilterCount}</span>
                  )}
                </button>
                {showFilters && (
                  <div className="advanced-filter-popover">
                    <div className="advanced-filter-header">
                      <div>
                        <strong>Filter templates</strong>
                        <span>Narrow the template list</span>
                      </div>
                      <button onClick={() => setShowFilters(false)} aria-label="Close filters">
                        <X size={17} />
                      </button>
                    </div>

                    <div className="advanced-filter-grid">
                      <label>
                        <span>Created from</span>
                        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                      </label>
                      <label>
                        <span>Created to</span>
                        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                      </label>
                      <label>
                        <span>Template type</span>
                        <select value={templateType} onChange={(e) => setTemplateType(e.target.value)}>
                          <option value="">All types</option>
                          {templateTypes.map(value => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>Status</span>
                        <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}>
                          <option value="">All statuses</option>
                          {['APPROVED', 'PENDING', 'DRAFT', 'REJECTED', 'ARCHIVED'].map(value => (
                            <option key={value} value={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Category</span>
                        <select value={category} onChange={(e) => setCategory(e.target.value)}>
                          <option value="">All categories</option>
                          {categories.map(value => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>Language</span>
                        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                          <option value="">All languages</option>
                          {languages.map(value => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                    </div>

                    <div className="advanced-filter-footer">
                      <span>{filtered.length} templates</span>
                      <button onClick={clearAdvancedFilters}>Reset filters</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </nav>

          {loading ? (
            <div className="list-loading">
              <Loader size={32} className="spinning" />
              <p>Loading templates...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="list-empty">
              <span className="list-empty-icon" aria-hidden="true">
                <MessageSquarePlus size={26} strokeWidth={1.8} />
              </span>
              <div className="list-empty-copy">
                <h3>No templates found</h3>
                <p>
                  {search || selectedStatus || dateFrom || dateTo || templateType || category || language
                    ? 'Try clearing the active filters to see more templates.'
                    : 'Create a template for the selected WhatsApp Business account.'}
                </p>
              </div>
              {search || selectedStatus || dateFrom || dateTo || templateType || category || language ? (
                <button className="template-empty-action template-empty-action-secondary" onClick={() => { setSearch(''); clearAdvancedFilters(); }}>
                  Clear filters
                </button>
              ) : (
                <button className="template-empty-action" onClick={() => onNavigate('create')}>
                  <Plus size={16} />
                  Create template
                </button>
              )}
            </div>
          ) : (
            <>
            <div className="template-table-header" role="row">
              <span>Template</span>
              <span>Category</span>
              <span>Type</span>
              <span>Created</span>
              <span>Modified</span>
              <span>Status</span>
            </div>
            <div className="list-scroll">
              {paginatedTemplates.map((template) => {
                const messageText = template.text || template.body || '';
                const preview = messageText.replace(/\s+/g, ' ').substring(0, 90);

                return (
                  <button
                    type="button"
                    key={template.id || template.aisensy_template_id}
                    className="template-list-item"
                    onClick={() => setSelectedTemplate(template)}
                  >
                    <div className="item-name-section">
                        <h4>{template.label || template.template_name}</h4>
                        <p className="item-preview">{preview}{messageText.length > 90 ? '...' : ''}</p>
                    </div>
                    <span className="table-cell">{template.category || '—'}</span>
                    <span className="table-cell">{template.template_type || '—'}</span>
                    <span className="table-cell">
                      {template.created_at ? new Date(template.created_at).toLocaleString('en-US', {
                        month: '2-digit', day: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                        hour12: true
                      }) : '—'}
                    </span>
                    <span className="table-cell">
                      {template.updated_at ? new Date(template.updated_at).toLocaleString('en-US', {
                        month: '2-digit', day: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                        hour12: true
                      }) : '—'}
                    </span>
                    <span className={`status-badge status-${template.status?.toLowerCase()}`}>
                      {template.status || 'DRAFT'}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="pagination-controls">
                <div className="page-size-selector">
                  <span>Show per page:</span>
                  <select value={pageSize} onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}>
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
                <div className="pagination-info">
                  Showing {startIndex + 1} to {Math.min(endIndex, totalItems)} of {totalItems} templates
                </div>
                <div className="pagination-buttons">
                  <button
                    className="pagination-btn"
                    onClick={() => handlePageChange(1)}
                    disabled={currentPage === 1}
                    title="First page"
                  >
                    &lsaquo;&lsaquo;
                  </button>
                  <button
                    className="pagination-btn"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    title="Previous page"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="page-indicator">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    className="pagination-btn"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    title="Next page"
                  >
                    <ChevronRight size={16} />
                  </button>
                  <button
                    className="pagination-btn"
                    onClick={() => handlePageChange(totalPages)}
                    disabled={currentPage === totalPages}
                    title="Last page"
                  >
                    &rsaquo;&rsaquo;
                  </button>
                </div>
              </div>
            )}
            </>
          )}
        </div>

        {/* Right-side template preview drawer */}
        {selectedTemplate && (
          <>
          <button
            className="template-drawer-backdrop"
            onClick={() => setSelectedTemplate(null)}
            aria-label="Close template preview"
          />
          <aside className="templates-detail-panel" aria-label="Template preview">
            {/* Header Info Section - Compact */}
            <div className="detail-info-section">
              <div className="info-header">
                <div>
                  <h2>{selectedTemplate.label || selectedTemplate.template_name}</h2>
                  <p className="technical-name">{selectedTemplate.template_name}</p>
                </div>
                <span className={`status-badge status-${selectedTemplate.status?.toLowerCase()}`}>
                  {selectedTemplate.status || 'DRAFT'}
                </span>
                <button
                  className="drawer-close"
                  onClick={() => setSelectedTemplate(null)}
                  aria-label="Close template preview"
                  title="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="info-grid compact">
                <div className="info-item">
                  <label>Category</label>
                  <p>{selectedTemplate.category || '—'}</p>
                </div>
                <div className="info-item">
                  <label>Language</label>
                  <p>{selectedTemplate.language || '—'}</p>
                </div>
                <div className="info-item">
                  <label>Type</label>
                  <p>{selectedTemplate.template_type || '—'}</p>
                </div>
                {selectedTemplate.header_content && (
                  <div className="info-item">
                    <label>Header Content</label>
                    <p className="footer-preview">{selectedTemplate.header_content.substring(0, 50)}{selectedTemplate.header_content.length > 50 ? '...' : ''}</p>
                  </div>
                )}
                {selectedTemplate.footer && (
                  <div className="info-item">
                    <label>Footer</label>
                    <p className="footer-preview">{selectedTemplate.footer}</p>
                  </div>
                )}
                {countVariables(selectedTemplate.text || selectedTemplate.body) > 0 && (
                  <div className="info-item">
                    <label>Variables</label>
                    <p>{countVariables(selectedTemplate.text || selectedTemplate.body)}</p>
                  </div>
                )}
              </div>

              {/* Quick Replies Summary */}
              {selectedTemplate.quick_replies && selectedTemplate.quick_replies.length > 0 && (
                <div className="info-summary">
                  <label>Quick Replies:</label>
                  <div className="summary-list">
                    {selectedTemplate.quick_replies.map((reply, idx) => (
                      <span key={idx} className="summary-chip">{reply}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* CTA Summary */}
              {selectedTemplate.call_to_action && selectedTemplate.call_to_action.length > 0 && (
                <div className="info-summary">
                  <label>CTA Buttons:</label>
                  <div className="summary-list">
                    {selectedTemplate.call_to_action.map((btn, idx) => (
                      <span key={idx} className="summary-chip">{btn.button_title}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Timestamps */}
              <div className="timestamps-compact">
                <div className="timestamp-item">
                  <label>Created</label>
                  <p>{selectedTemplate.created_at ? new Date(selectedTemplate.created_at).toLocaleDateString() : 'N/A'}</p>
                </div>
                <div className="timestamp-item">
                  <label>Updated</label>
                  <p>{selectedTemplate.updated_at ? new Date(selectedTemplate.updated_at).toLocaleDateString() : 'N/A'}</p>
                </div>
              </div>

              {/* Rejection Reason */}
              {selectedTemplate.rejection_reason && (
                <div className="rejection-notice">
                  <h4>Rejection Reason</h4>
                  <p>{selectedTemplate.rejection_reason}</p>
                </div>
              )}
            </div>

            {/* WhatsApp Preview - Large */}
            <div className="preview-section">
              <WhatsAppPreview template={selectedTemplate} />
            </div>

            {/* Action Buttons - Bottom */}
            <div className="detail-actions-bottom">
              <button
                className="btn btn-sm btn-primary"
                onClick={() => onNavigate('view', selectedTemplate.id || selectedTemplate.aisensy_template_id, selectedTemplate.integrationId || integrationId)}
              >
                <Edit2 size={16} />
                Edit
              </button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => handleDuplicate(selectedTemplate.id || selectedTemplate.aisensy_template_id)}
              >
                <Copy size={16} />
                Duplicate
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={() => handleDelete(selectedTemplate.id || selectedTemplate.aisensy_template_id, selectedTemplate.label || selectedTemplate.template_name)}
              >
                <Trash2 size={16} />
                Delete
              </button>
            </div>
          </aside>
          </>
        )}
        {/* Split-screen empty state removed.
          <div className="templates-detail-empty">
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <p>Select a template to preview</p>
            </div>
          </div>
        */}
      </div>
    </div>
  );
}
