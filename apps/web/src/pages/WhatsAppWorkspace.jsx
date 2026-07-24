import { useState } from 'react';
import {
  ArrowLeft,
  MessageSquare,
  Send,
  Eye,
  Users,
  BarChart3,
  FileText,
  Settings,
  Plus,
  Search,
  Filter,
  MoreVertical,
} from 'lucide-react';
import StatusBadge from './components/StatusBadge';
import '../styles/integrations-premium.css';

const TAB_CONFIG = [
  { id: 'overview', label: 'Overview', icon: Eye },
  { id: 'templates', label: 'Templates', icon: MessageSquare },
  { id: 'conversations', label: 'Conversations', icon: Send },
  { id: 'broadcasts', label: 'Broadcasts', icon: Send },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'logs', label: 'Logs', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function WhatsAppWorkspace({ onBack }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [search, setSearch] = useState('');

  return (
    <div className="whatsapp-workspace">
      {/* Header */}
      <div className="workspace-header">
        <div className="header-top">
          <button className="btn-icon" onClick={onBack}>
            <ArrowLeft size={20} />
          </button>
          <div className="header-info">
            <div className="header-breadcrumb">Integrations / WhatsApp Workspace</div>
            <h1>WhatsApp Business Platform</h1>
            <p>Manage templates, conversations, broadcasts, and contacts</p>
          </div>
          <div className="header-actions">
            <StatusBadge status="connected" size="md" />
          </div>
        </div>

        {/* Tabs */}
        <nav className="workspace-tabs">
          {TAB_CONFIG.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={18} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Content */}
      <div className="workspace-content">
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'templates' && <TemplatesTab search={search} setSearch={setSearch} />}
        {activeTab === 'conversations' && <ConversationsTab search={search} setSearch={setSearch} />}
        {activeTab === 'broadcasts' && <BroadcastsTab />}
        {activeTab === 'contacts' && <ContactsTab search={search} setSearch={setSearch} />}
        {activeTab === 'analytics' && <AnalyticsTab />}
        {activeTab === 'logs' && <LogsTab />}
        {activeTab === 'settings' && <SettingsTab />}
      </div>

      <style>{`
        .whatsapp-workspace {
          display: flex;
          flex-direction: column;
          min-height: 100vh;
          background: linear-gradient(135deg, #f5f7fa 0%, #f9fafb 100%);
        }

        .workspace-header {
          background: white;
          border-bottom: 1px solid #e5e7eb;
          box-shadow: var(--shadow-sm);
        }

        .header-top {
          display: flex;
          align-items: center;
          gap: var(--space-24);
          padding: var(--space-24);
          max-width: 1600px;
          margin: 0 auto;
          width: 100%;
        }

        .header-info {
          flex: 1;
        }

        .header-breadcrumb {
          font-size: 12px;
          color: #9ca3af;
          margin-bottom: var(--space-8);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .header-info h1 {
          margin: 0 0 var(--space-8) 0;
          font-size: 28px;
          font-weight: 700;
          color: #0f172a;
        }

        .header-info p {
          margin: 0;
          color: #6b7280;
          font-size: 14px;
        }

        .header-actions {
          display: flex;
          gap: var(--space-16);
          align-items: center;
          padding-left: var(--space-24);
          border-left: 1px solid #e5e7eb;
        }

        .workspace-tabs {
          display: flex;
          gap: 0;
          padding: 0 var(--space-24);
          overflow-x: auto;
          border-top: 1px solid #f3f4f6;
        }

        .tab-button {
          display: flex;
          align-items: center;
          gap: var(--space-8);
          padding: var(--space-16) var(--space-20);
          background: none;
          border: none;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          color: #6b7280;
          border-bottom: 3px solid transparent;
          transition: all var(--transition-base);
          white-space: nowrap;
        }

        .tab-button:hover {
          color: #3b82f6;
        }

        .tab-button.active {
          color: #3b82f6;
          border-bottom-color: #3b82f6;
        }

        .workspace-content {
          flex: 1;
          padding: var(--space-32);
          max-width: 1600px;
          margin: 0 auto;
          width: 100%;
        }

        .tab-section {
          animation: slideInUp 400ms cubic-bezier(0.4, 0, 0.2, 1);
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--space-24);
        }

        .section-title {
          font-size: 20px;
          font-weight: 700;
          color: #0f172a;
          margin: 0;
        }

        .section-actions {
          display: flex;
          gap: var(--space-12);
        }

        .btn-primary {
          display: flex;
          align-items: center;
          gap: var(--space-8);
          padding: var(--space-10) var(--space-16);
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
          color: white;
          border: none;
          border-radius: var(--radius-lg);
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-base);
        }

        .btn-primary:hover {
          box-shadow: var(--shadow-lg);
          transform: translateY(-2px);
        }

        .toolbar {
          display: flex;
          gap: var(--space-12);
          margin-bottom: var(--space-24);
        }

        .search-box {
          flex: 1;
          display: flex;
          align-items: center;
          gap: var(--space-12);
          padding: var(--space-12) var(--space-16);
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: var(--radius-lg);
          max-width: 400px;
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

        .filter-btn {
          display: flex;
          align-items: center;
          gap: var(--space-8);
          padding: var(--space-10) var(--space-16);
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: var(--radius-lg);
          font-size: 14px;
          font-weight: 600;
          color: #6b7280;
          cursor: pointer;
          transition: all var(--transition-base);
        }

        .filter-btn:hover {
          border-color: #d1d5db;
          background: #f9fafb;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: var(--space-16);
          margin-bottom: var(--space-32);
        }

        .stat-card {
          background: white;
          padding: var(--space-20);
          border-radius: var(--radius-lg);
          border: 1px solid #e5e7eb;
          box-shadow: var(--shadow-md);
        }

        .stat-label {
          font-size: 12px;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: var(--space-8);
          font-weight: 600;
        }

        .stat-value {
          font-size: 28px;
          font-weight: 700;
          color: #0f172a;
          margin-bottom: var(--space-8);
        }

        .stat-change {
          font-size: 12px;
          color: #22c55e;
          font-weight: 600;
        }

        .table-container {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: var(--radius-lg);
          overflow: hidden;
          box-shadow: var(--shadow-md);
        }

        .table {
          width: 100%;
          border-collapse: collapse;
        }

        .table thead {
          background: #f9fafb;
          border-bottom: 1px solid #e5e7eb;
        }

        .table th {
          padding: var(--space-16);
          text-align: left;
          font-size: 12px;
          font-weight: 700;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .table tbody tr {
          border-bottom: 1px solid #f3f4f6;
          transition: background-color var(--transition-base);
        }

        .table tbody tr:hover {
          background-color: #f9fafb;
        }

        .table td {
          padding: var(--space-16);
          font-size: 14px;
          color: #0f172a;
        }

        .empty-message {
          text-align: center;
          padding: var(--space-48);
          color: #9ca3af;
        }

        .empty-icon {
          font-size: 48px;
          margin-bottom: var(--space-16);
        }

        @media (max-width: 1024px) {
          .header-top {
            flex-direction: column;
            align-items: flex-start;
          }

          .header-actions {
            border-left: none;
            border-top: 1px solid #e5e7eb;
            padding-left: 0;
            padding-top: var(--space-16);
            width: 100%;
          }

          .stats-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 640px) {
          .workspace-content {
            padding: var(--space-16);
          }

          .stats-grid {
            grid-template-columns: 1fr;
          }

          .search-box {
            max-width: 100%;
          }
        }
      `}</style>
    </div>
  );
}

function OverviewTab() {
  return (
    <div className="tab-section">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Active Conversations</div>
          <div className="stat-value">42</div>
          <div className="stat-change">+5 today</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Messages Sent</div>
          <div className="stat-value">1,234</div>
          <div className="stat-change">+89 today</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Templates</div>
          <div className="stat-value">18</div>
          <div className="stat-change">Approved</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Contacts</div>
          <div className="stat-value">567</div>
          <div className="stat-change">+12 this week</div>
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Recent Conversations</th>
              <th>Participants</th>
              <th>Last Message</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Customer Inquiry - Order #1234</td>
              <td>John Doe</td>
              <td>2 minutes ago</td>
              <td><StatusBadge status="syncing" size="sm" animated /></td>
            </tr>
            <tr>
              <td>Support Ticket - Account Issue</td>
              <td>Jane Smith</td>
              <td>1 hour ago</td>
              <td><StatusBadge status="connected" size="sm" /></td>
            </tr>
            <tr>
              <td>Product Recommendation</td>
              <td>Michael Johnson</td>
              <td>3 hours ago</td>
              <td><StatusBadge status="connected" size="sm" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TemplatesTab({ search, setSearch }) {
  return (
    <div className="tab-section">
      <div className="section-header">
        <h2 className="section-title">Message Templates</h2>
        <div className="section-actions">
          <button className="btn-primary">
            <Plus size={18} />
            Create Template
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <Search size={18} color="#9ca3af" />
          <input
            type="text"
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="filter-btn">
          <Filter size={18} />
          Filter
        </button>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Template Name</th>
              <th>Category</th>
              <th>Status</th>
              <th>Usage</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Welcome Message</td>
              <td>Greetings</td>
              <td><StatusBadge status="connected" size="sm" label="Approved" /></td>
              <td>245 times</td>
              <td>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                  <MoreVertical size={16} color="#6b7280" />
                </button>
              </td>
            </tr>
            <tr>
              <td>Order Confirmation</td>
              <td>Transactional</td>
              <td><StatusBadge status="connected" size="sm" label="Approved" /></td>
              <td>189 times</td>
              <td>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                  <MoreVertical size={16} color="#6b7280" />
                </button>
              </td>
            </tr>
            <tr>
              <td>Shipping Notification</td>
              <td>Transactional</td>
              <td><StatusBadge status="pending" size="sm" label="Pending" /></td>
              <td>0 times</td>
              <td>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                  <MoreVertical size={16} color="#6b7280" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ConversationsTab({ search, setSearch }) {
  return (
    <div className="tab-section">
      <div className="section-header">
        <h2 className="section-title">Conversations</h2>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <Search size={18} color="#9ca3af" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="filter-btn">
          <Filter size={18} />
          Filter by Status
        </button>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Contact</th>
              <th>Last Message</th>
              <th>Messages</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>John Doe</td>
              <td>Thanks for your help!</td>
              <td>12</td>
              <td><StatusBadge status="connected" size="sm" /></td>
              <td>Today, 2:30 PM</td>
            </tr>
            <tr>
              <td>Jane Smith</td>
              <td>When will my order arrive?</td>
              <td>8</td>
              <td><StatusBadge status="syncing" size="sm" animated /></td>
              <td>Today, 1:15 PM</td>
            </tr>
            <tr>
              <td>Michael Johnson</td>
              <td>Can you send me the invoice?</td>
              <td>5</td>
              <td><StatusBadge status="connected" size="sm" /></td>
              <td>Yesterday, 4:45 PM</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BroadcastsTab() {
  return (
    <div className="tab-section">
      <div className="section-header">
        <h2 className="section-title">Broadcasts</h2>
        <div className="section-actions">
          <button className="btn-primary">
            <Plus size={18} />
            New Broadcast
          </button>
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Broadcast Name</th>
              <th>Recipients</th>
              <th>Sent</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Weekend Special Offer</td>
              <td>234 contacts</td>
              <td>234</td>
              <td><StatusBadge status="connected" size="sm" label="Completed" /></td>
              <td>2 days ago</td>
            </tr>
            <tr>
              <td>New Product Launch</td>
              <td>567 contacts</td>
              <td>567</td>
              <td><StatusBadge status="connected" size="sm" label="Completed" /></td>
              <td>5 days ago</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ContactsTab({ search, setSearch }) {
  return (
    <div className="tab-section">
      <div className="section-header">
        <h2 className="section-title">Contacts</h2>
        <div className="section-actions">
          <button className="btn-primary">
            <Plus size={18} />
            Add Contact
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <Search size={18} color="#9ca3af" />
          <input
            type="text"
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Messages</th>
              <th>Added</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>John Doe</td>
              <td>+1 (555) 123-4567</td>
              <td>12</td>
              <td>3 weeks ago</td>
              <td><StatusBadge status="connected" size="sm" label="Active" /></td>
            </tr>
            <tr>
              <td>Jane Smith</td>
              <td>+1 (555) 234-5678</td>
              <td>8</td>
              <td>2 weeks ago</td>
              <td><StatusBadge status="connected" size="sm" label="Active" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnalyticsTab() {
  return (
    <div className="tab-section">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Messages</div>
          <div className="stat-value">4,892</div>
          <div className="stat-change">+12% from last week</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Delivery Rate</div>
          <div className="stat-value">98.5%</div>
          <div className="stat-change">+0.5% trend</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Response Rate</div>
          <div className="stat-value">67%</div>
          <div className="stat-change">+5% from last month</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Response Time</div>
          <div className="stat-value">2.3h</div>
          <div className="stat-change">-0.5h improvement</div>
        </div>
      </div>
    </div>
  );
}

function LogsTab() {
  return (
    <div className="tab-section">
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Event</th>
              <th>Details</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>2024-01-15 14:32:15</td>
              <td>Message Sent</td>
              <td>Order confirmation to John Doe</td>
              <td><StatusBadge status="connected" size="sm" label="Success" /></td>
            </tr>
            <tr>
              <td>2024-01-15 14:31:02</td>
              <td>Webhook Received</td>
              <td>Conversation update from WhatsApp</td>
              <td><StatusBadge status="connected" size="sm" label="Success" /></td>
            </tr>
            <tr>
              <td>2024-01-15 14:29:45</td>
              <td>Template Approved</td>
              <td>Welcome Message approved by WhatsApp</td>
              <td><StatusBadge status="connected" size="sm" label="Success" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SettingsTab() {
  return (
    <div className="tab-section">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-24)' }}>
        <div style={{ background: 'white', padding: 'var(--space-24)', borderRadius: 'var(--radius-lg)', border: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 var(--space-16) 0', fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>
            Webhook Configuration
          </h3>
          <p style={{ margin: '0 0 var(--space-16) 0', color: '#6b7280', fontSize: '14px' }}>
            Configure how WhatsApp communicates with your system
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
            <label style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#6b7280' }}>
              Webhook URL
            </label>
            <input
              type="text"
              value="https://yourdomain.com/webhooks/whatsapp"
              readOnly
              style={{
                padding: 'var(--space-12) var(--space-16)',
                border: '1px solid #e5e7eb',
                borderRadius: 'var(--radius-md)',
                fontSize: '14px',
                fontFamily: "'Monaco', 'Courier New', monospace",
              }}
            />
          </div>
        </div>

        <div style={{ background: 'white', padding: 'var(--space-24)', borderRadius: 'var(--radius-lg)', border: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 var(--space-16) 0', fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>
            Notification Settings
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-12)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-12)', cursor: 'pointer' }}>
              <input type="checkbox" defaultChecked style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
              <span style={{ fontSize: '14px', color: '#0f172a' }}>Notify on new conversations</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-12)', cursor: 'pointer' }}>
              <input type="checkbox" defaultChecked style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
              <span style={{ fontSize: '14px', color: '#0f172a' }}>Notify on failed deliveries</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-12)', cursor: 'pointer' }}>
              <input type="checkbox" style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
              <span style={{ fontSize: '14px', color: '#0f172a' }}>Daily summary report</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
