import { useState } from 'react';
import {
  ArrowLeft,
  Plus,
  Search,
  Filter,
  MoreVertical,
  Eye,
  Trash2,
  Edit2,
  CheckCircle,
  Clock,
  AlertCircle,
  Copy,
} from 'lucide-react';
import StatusBadge from './components/StatusBadge';
import '../styles/integrations-premium.css';

const TEMPLATE_DATA = [
  {
    id: 1,
    name: 'Welcome Message',
    category: 'Greetings',
    status: 'approved',
    language: 'English',
    variables: 2,
    created: '2024-01-10',
    usage: 245,
    preview: 'Hi {{1}}, welcome to {{2}}! We\'re excited to have you on board.',
  },
  {
    id: 2,
    name: 'Order Confirmation',
    category: 'Transactional',
    status: 'approved',
    language: 'English',
    variables: 3,
    created: '2024-01-08',
    usage: 189,
    preview: 'Your order {{1}} has been confirmed. Total: {{2}}. ETA: {{3}}',
  },
  {
    id: 3,
    name: 'Shipping Notification',
    category: 'Transactional',
    status: 'pending',
    language: 'English',
    variables: 2,
    created: '2024-01-12',
    usage: 0,
    preview: 'Your order {{1}} has shipped! Tracking: {{2}}',
  },
  {
    id: 4,
    name: 'Customer Feedback',
    category: 'Survey',
    status: 'rejected',
    language: 'English',
    variables: 1,
    created: '2024-01-05',
    usage: 0,
    preview: 'How was your experience? Please rate us: {{1}}',
  },
  {
    id: 5,
    name: 'Password Reset',
    category: 'Security',
    status: 'approved',
    language: 'English',
    variables: 1,
    created: '2024-01-03',
    usage: 42,
    preview: 'Reset your password here: {{1}}. Valid for 24 hours.',
  },
];

export default function TemplateManagementPage({ onBack }) {
  const [search, setSearch] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState(TEMPLATE_DATA[0]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const filtered = TEMPLATE_DATA.filter(t => {
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase());
    const matchCategory = !categoryFilter || t.category === categoryFilter;
    const matchStatus = !statusFilter || t.status === statusFilter;
    return matchSearch && matchCategory && matchStatus;
  });

  const categories = [...new Set(TEMPLATE_DATA.map(t => t.category))];

  return (
    <div className="template-management-page">
      {/* Header */}
      <div className="template-header">
        <button className="btn-icon" onClick={onBack}>
          <ArrowLeft size={20} />
        </button>
        <div className="header-info">
          <div className="header-breadcrumb">WhatsApp Workspace / Templates</div>
          <h1>Message Templates</h1>
          <p>Create, manage, and organize WhatsApp message templates</p>
        </div>
        <button className="btn-create-template">
          <Plus size={18} />
          Create Template
        </button>
      </div>

      <div className="template-content">
        {/* Left Panel - List */}
        <div className="template-list-panel">
          {/* Toolbar */}
          <div className="template-toolbar">
            <div className="search-box">
              <Search size={18} color="#9ca3af" />
              <input
                type="text"
                placeholder="Search templates..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* Filters */}
            <div className="filters-row">
              <div className="filter-group">
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
              <div className="filter-group">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="filter-select"
                >
                  <option value="">All Status</option>
                  <option value="approved">Approved</option>
                  <option value="pending">Pending</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
            </div>
          </div>

          {/* Template List */}
          <div className="template-list">
            {filtered.length === 0 ? (
              <div className="empty-list-message">
                <Search size={32} color="#d1d5db" />
                <p>No templates found</p>
              </div>
            ) : (
              filtered.map(template => (
                <div
                  key={template.id}
                  className={`template-item ${selectedTemplate.id === template.id ? 'active' : ''}`}
                  onClick={() => setSelectedTemplate(template)}
                >
                  <div className="template-item-header">
                    <h3>{template.name}</h3>
                    <StatusBadge status={getStatusBadge(template.status)} size="sm" />
                  </div>
                  <p className="template-item-category">{template.category}</p>
                  <p className="template-item-preview">{template.preview}</p>
                  <div className="template-item-meta">
                    <span>{{template.variables}} vars</span>
                    <span>{template.usage} uses</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Panel - Preview */}
        {selectedTemplate && (
          <div className="template-preview-panel">
            <div className="preview-header">
              <div className="preview-title-section">
                <h2>{selectedTemplate.name}</h2>
                <span className="preview-category">{selectedTemplate.category}</span>
              </div>
              <div className="preview-actions">
                <button className="preview-action-btn" title="Copy template">
                  <Copy size={18} />
                </button>
                <button className="preview-action-btn" title="Edit template">
                  <Edit2 size={18} />
                </button>
                <button className="preview-action-btn" title="Delete template">
                  <Trash2 size={18} />
                </button>
              </div>
            </div>

            {/* Status Info */}
            <div className="status-info-box">
              <div className="status-info-item">
                <span className="status-info-label">Status</span>
                <StatusBadge status={getStatusBadge(selectedTemplate.status)} size="md" />
              </div>
              <div className="status-info-item">
                <span className="status-info-label">Language</span>
                <span className="status-info-value">{selectedTemplate.language}</span>
              </div>
              <div className="status-info-item">
                <span className="status-info-label">Created</span>
                <span className="status-info-value">{new Date(selectedTemplate.created).toLocaleDateString()}</span>
              </div>
              <div className="status-info-item">
                <span className="status-info-label">Usage</span>
                <span className="status-info-value">{selectedTemplate.usage} times</span>
              </div>
            </div>

            {/* Preview */}
            <div className="message-preview-box">
              <h3>Message Preview</h3>
              <div className="whatsapp-bubble">
                <div className="bubble-header">
                  <div className="bubble-name">{selectedTemplate.name}</div>
                  <div className="bubble-time">Today 2:30 PM</div>
                </div>
                <div className="bubble-content">
                  {selectedTemplate.preview}
                </div>
                <div className="bubble-status">
                  <CheckCircle size={14} />
                  Delivered
                </div>
              </div>
            </div>

            {/* Variables */}
            {selectedTemplate.variables > 0 && (
              <div className="variables-box">
                <h3>Template Variables</h3>
                <div className="variables-list">
                  {[...Array(selectedTemplate.variables)].map((_, i) => (
                    <div key={i} className="variable-item">
                      <span className="variable-name">{{i + 1}}</span>
                      <input
                        type="text"
                        placeholder={`Variable ${i + 1} example`}
                        className="variable-input"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Details */}
            <div className="details-box">
              <h3>Template Details</h3>
              <div className="details-grid">
                <div className="detail-item">
                  <span className="detail-label">Template ID</span>
                  <code className="detail-code">tpl_{selectedTemplate.id}_whatsapp</code>
                </div>
                <div className="detail-item">
                  <span className="detail-label">API Name</span>
                  <code className="detail-code">{selectedTemplate.name.replace(/\s+/g, '_').toLowerCase()}</code>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .template-management-page {
          display: flex;
          flex-direction: column;
          min-height: 100vh;
          background: linear-gradient(135deg, #f5f7fa 0%, #f9fafb 100%);
        }

        .template-header {
          display: flex;
          align-items: center;
          gap: var(--space-24);
          background: white;
          padding: var(--space-24);
          border-bottom: 1px solid #e5e7eb;
          box-shadow: var(--shadow-sm);
        }

        .template-header .header-info {
          flex: 1;
        }

        .template-header .header-breadcrumb {
          font-size: 12px;
          color: #9ca3af;
          margin-bottom: var(--space-8);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .template-header h1 {
          margin: 0 0 var(--space-8) 0;
          font-size: 24px;
          font-weight: 700;
          color: #0f172a;
        }

        .template-header p {
          margin: 0;
          color: #6b7280;
          font-size: 14px;
        }

        .btn-create-template {
          display: flex;
          align-items: center;
          gap: var(--space-8);
          padding: var(--space-12) var(--space-16);
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
          color: white;
          border: none;
          border-radius: var(--radius-lg);
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-base);
          white-space: nowrap;
        }

        .btn-create-template:hover {
          box-shadow: var(--shadow-lg);
          transform: translateY(-2px);
        }

        .template-content {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--space-24);
          padding: var(--space-24);
          max-width: 1600px;
          margin: 0 auto;
          width: 100%;
          flex: 1;
        }

        .template-list-panel {
          display: flex;
          flex-direction: column;
          gap: var(--space-16);
          background: white;
          border-radius: var(--radius-lg);
          border: 1px solid #e5e7eb;
          overflow: hidden;
          box-shadow: var(--shadow-md);
        }

        .template-toolbar {
          padding: var(--space-16);
          border-bottom: 1px solid #e5e7eb;
        }

        .search-box {
          display: flex;
          align-items: center;
          gap: var(--space-12);
          padding: var(--space-12) var(--space-16);
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: var(--radius-lg);
          margin-bottom: var(--space-12);
        }

        .search-box input {
          flex: 1;
          border: none;
          background: none;
          font-size: 14px;
          outline: none;
          color: #0f172a;
        }

        .search-box input::placeholder {
          color: #9ca3af;
        }

        .filters-row {
          display: flex;
          gap: var(--space-12);
        }

        .filter-group {
          flex: 1;
        }

        .filter-select {
          width: 100%;
          padding: var(--space-10) var(--space-12);
          border: 1px solid #e5e7eb;
          border-radius: var(--radius-lg);
          font-size: 14px;
          color: #0f172a;
          background: white;
          cursor: pointer;
          transition: all var(--transition-base);
        }

        .filter-select:hover,
        .filter-select:focus {
          border-color: #d1d5db;
          outline: none;
        }

        .template-list {
          flex: 1;
          overflow-y: auto;
          padding: var(--space-12);
          display: flex;
          flex-direction: column;
          gap: var(--space-8);
        }

        .template-list::-webkit-scrollbar {
          width: 6px;
        }

        .template-list::-webkit-scrollbar-track {
          background: transparent;
        }

        .template-list::-webkit-scrollbar-thumb {
          background: #d1d5db;
          border-radius: 3px;
        }

        .template-list::-webkit-scrollbar-thumb:hover {
          background: #9ca3af;
        }

        .template-item {
          padding: var(--space-16);
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: var(--radius-lg);
          cursor: pointer;
          transition: all var(--transition-base);
        }

        .template-item:hover {
          background: white;
          border-color: #d1d5db;
        }

        .template-item.active {
          background: white;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        .template-item-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: var(--space-12);
          margin-bottom: var(--space-8);
        }

        .template-item h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 700;
          color: #0f172a;
        }

        .template-item-category {
          margin: 0 0 var(--space-8) 0;
          font-size: 12px;
          color: #9ca3af;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .template-item-preview {
          margin: 0 0 var(--space-8) 0;
          font-size: 12px;
          color: #6b7280;
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .template-item-meta {
          display: flex;
          gap: var(--space-12);
          font-size: 11px;
          color: #9ca3af;
        }

        .empty-list-message {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: var(--space-12);
          padding: var(--space-48);
          text-align: center;
          color: #9ca3af;
        }

        .template-preview-panel {
          display: flex;
          flex-direction: column;
          gap: var(--space-16);
          background: white;
          border-radius: var(--radius-lg);
          border: 1px solid #e5e7eb;
          overflow-y: auto;
          box-shadow: var(--shadow-md);
          padding: var(--space-24);
        }

        .template-preview-panel::-webkit-scrollbar {
          width: 6px;
        }

        .template-preview-panel::-webkit-scrollbar-track {
          background: transparent;
        }

        .template-preview-panel::-webkit-scrollbar-thumb {
          background: #d1d5db;
          border-radius: 3px;
        }

        .preview-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: var(--space-16);
          padding-bottom: var(--space-16);
          border-bottom: 1px solid #e5e7eb;
        }

        .preview-title-section h2 {
          margin: 0 0 var(--space-8) 0;
          font-size: 18px;
          font-weight: 700;
          color: #0f172a;
        }

        .preview-category {
          font-size: 12px;
          color: #9ca3af;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .preview-actions {
          display: flex;
          gap: var(--space-8);
        }

        .preview-action-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border: 1px solid #e5e7eb;
          background: #f9fafb;
          border-radius: var(--radius-md);
          cursor: pointer;
          color: #6b7280;
          transition: all var(--transition-base);
        }

        .preview-action-btn:hover {
          background: white;
          border-color: #d1d5db;
          color: #0f172a;
        }

        .status-info-box {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--space-16);
          padding: var(--space-16);
          background: #f9fafb;
          border-radius: var(--radius-lg);
          border: 1px solid #e5e7eb;
        }

        .status-info-item {
          display: flex;
          flex-direction: column;
          gap: var(--space-8);
        }

        .status-info-label {
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #6b7280;
        }

        .status-info-value {
          font-size: 14px;
          color: #0f172a;
          font-weight: 600;
        }

        .message-preview-box {
          display: flex;
          flex-direction: column;
          gap: var(--space-12);
        }

        .message-preview-box h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 700;
          color: #0f172a;
        }

        .whatsapp-bubble {
          background: linear-gradient(135deg, #25d366 0%, #20ba5f 100%);
          color: white;
          padding: var(--space-16);
          border-radius: 12px;
          border-radius: 4px 12px 12px 12px;
          font-size: 14px;
          line-height: 1.5;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        }

        .bubble-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: var(--space-8);
          font-size: 12px;
          opacity: 0.9;
        }

        .bubble-name {
          font-weight: 700;
        }

        .bubble-time {
          font-size: 11px;
        }

        .bubble-content {
          margin-bottom: var(--space-8);
        }

        .bubble-status {
          display: flex;
          align-items: center;
          gap: var(--space-6);
          font-size: 12px;
          opacity: 0.9;
        }

        .variables-box {
          display: flex;
          flex-direction: column;
          gap: var(--space-12);
          padding: var(--space-16);
          background: #f9fafb;
          border-radius: var(--radius-lg);
          border: 1px solid #e5e7eb;
        }

        .variables-box h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 700;
          color: #0f172a;
        }

        .variables-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-12);
        }

        .variable-item {
          display: flex;
          align-items: center;
          gap: var(--space-12);
        }

        .variable-name {
          min-width: 32px;
          padding: var(--space-8) var(--space-12);
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: var(--radius-md);
          font-size: 12px;
          font-weight: 700;
          text-align: center;
          color: #0f172a;
        }

        .variable-input {
          flex: 1;
          padding: var(--space-8) var(--space-12);
          border: 1px solid #e5e7eb;
          border-radius: var(--radius-md);
          font-size: 13px;
          background: white;
          transition: all var(--transition-base);
        }

        .variable-input:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        .details-box {
          display: flex;
          flex-direction: column;
          gap: var(--space-12);
          padding: var(--space-16);
          background: #f9fafb;
          border-radius: var(--radius-lg);
          border: 1px solid #e5e7eb;
        }

        .details-box h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 700;
          color: #0f172a;
        }

        .details-grid {
          display: flex;
          flex-direction: column;
          gap: var(--space-12);
        }

        .detail-item {
          display: flex;
          flex-direction: column;
          gap: var(--space-6);
        }

        .detail-label {
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #6b7280;
        }

        .detail-code {
          padding: var(--space-8) var(--space-12);
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: var(--radius-md);
          font-family: 'Monaco', 'Courier New', monospace;
          font-size: 12px;
          color: #0f172a;
          word-break: break-all;
        }

        @media (max-width: 1024px) {
          .template-content {
            grid-template-columns: 1fr;
          }

          .status-info-box {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 640px) {
          .template-header {
            flex-direction: column;
            align-items: flex-start;
          }

          .filters-row {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
}

function getStatusBadge(status) {
  const map = {
    approved: 'connected',
    pending: 'pending',
    rejected: 'failed',
  };
  return map[status] || 'unknown';
}
