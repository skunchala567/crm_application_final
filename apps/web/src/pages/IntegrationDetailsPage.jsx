import { useState } from 'react';
import {
  ArrowLeft,
  Settings,
  Zap,
  BarChart3,
  FileText,
  MessageSquare,
  Send,
  Eye,
  Share2,
  AlertTriangle,
} from 'lucide-react';
import StatusBadge from './components/StatusBadge';
import HealthIndicator from './components/HealthIndicator';
import '../styles/integrations-premium.css';

const TAB_CONFIG = [
  { id: 'overview', label: 'Overview', icon: Eye },
  { id: 'configuration', label: 'Configuration', icon: Settings },
  { id: 'templates', label: 'Templates', icon: MessageSquare },
  { id: 'conversations', label: 'Conversations', icon: Send },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'logs', label: 'Logs', icon: FileText },
  { id: 'webhooks', label: 'Webhooks', icon: Share2 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function IntegrationDetailsPage({ integrationId, onBack }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [integration] = useState({
    id: 1,
    integration_name: 'Smartping WhatsApp',
    provider_name: 'AiSensy',
    status: 'active',
    health: 'excellent',
    last_synced_at: new Date().toISOString(),
    description: 'Enterprise WhatsApp messaging platform for business communications',
    version: '2.1.0',
    config: {
      projectId: '6923f6a78e77a6798e5b9f23',
      apiEndpoint: 'https://apis.aisensy.com/project-apis/v1/project',
      webhookUrl: 'https://yourdomain.com/webhooks/smartping',
    },
  });

  return (
    <div className="integration-details-page">
      {/* Header */}
      <div className="details-header">
        <div className="header-top">
          <button className="btn-icon" onClick={onBack}>
            <ArrowLeft size={20} />
          </button>
          <div className="header-info">
            <div className="header-breadcrumb">Integrations / {integration.integration_name}</div>
            <h1>{integration.integration_name}</h1>
            <p>{integration.description}</p>
          </div>
          <div className="header-status">
            <StatusBadge status="connected" />
            <HealthIndicator health="excellent" />
          </div>
        </div>

        {/* Tabs */}
        <nav className="details-tabs">
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
      <div className="details-content">
        {activeTab === 'overview' && (
          <div className="tab-panel overview-panel">
            <div className="panel-grid">
              <div className="info-card">
                <h3>Connection Details</h3>
                <div className="info-list">
                  <div className="info-item">
                    <span className="info-label">Provider</span>
                    <span className="info-value">{integration.provider_name}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Version</span>
                    <span className="info-value">{integration.version}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Status</span>
                    <span className="info-value">
                      <StatusBadge status="connected" size="sm" />
                    </span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Last Synced</span>
                    <span className="info-value">
                      {new Date(integration.last_synced_at).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              <div className="info-card">
                <h3>Credentials</h3>
                <div className="credentials-list">
                  <div className="credential-item">
                    <span className="credential-label">Project ID</span>
                    <div className="credential-value">
                      <code>{integration.config.projectId.substring(0, 12)}••••</code>
                      <button className="btn-icon-small">📋</button>
                    </div>
                  </div>
                  <div className="credential-item">
                    <span className="credential-label">API Endpoint</span>
                    <div className="credential-value">
                      <code>{integration.config.apiEndpoint}</code>
                    </div>
                  </div>
                </div>
              </div>

              <div className="info-card">
                <h3>Quick Actions</h3>
                <div className="actions-list">
                  <button className="action-btn">
                    <Zap size={16} />
                    Test Connection
                  </button>
                  <button className="action-btn">
                    <ArrowLeft size={16} />
                    Sync Now
                  </button>
                  <button className="action-btn">
                    <Settings size={16} />
                    Configure
                  </button>
                </div>
              </div>

              <div className="info-card warning">
                <div className="warning-header">
                  <AlertTriangle size={18} />
                  <h3>Recent Activity</h3>
                </div>
                <div className="activity-list">
                  <div className="activity-item">
                    <span className="activity-time">2 hours ago</span>
                    <span className="activity-text">Sync completed successfully</span>
                  </div>
                  <div className="activity-item">
                    <span className="activity-time">5 hours ago</span>
                    <span className="activity-text">Connection tested successfully</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'configuration' && (
          <div className="tab-panel">
            <div className="panel-section">
              <h2>Integration Configuration</h2>
              <p className="section-description">Manage your integration settings and credentials</p>
              {/* Configuration content */}
            </div>
          </div>
        )}

        {activeTab === 'templates' && (
          <div className="tab-panel">
            <div className="panel-section">
              <h2>Message Templates</h2>
              <p className="section-description">Create and manage message templates</p>
              {/* Templates content */}
            </div>
          </div>
        )}

        {activeTab === 'conversations' && (
          <div className="tab-panel">
            <div className="panel-section">
              <h2>Conversations</h2>
              <p className="section-description">View and manage conversations</p>
              {/* Conversations content */}
            </div>
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="tab-panel">
            <div className="panel-section">
              <h2>Analytics & Insights</h2>
              <p className="section-description">View integration performance metrics</p>
              {/* Analytics content */}
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="tab-panel">
            <div className="panel-section">
              <h2>Integration Logs</h2>
              <p className="section-description">View detailed integration logs</p>
              {/* Logs content */}
            </div>
          </div>
        )}

        {activeTab === 'webhooks' && (
          <div className="tab-panel">
            <div className="panel-section">
              <h2>Webhooks Configuration</h2>
              <p className="section-description">Configure and test webhooks</p>
              <div className="webhook-url-box">
                <label>Webhook URL</label>
                <div className="webhook-input">
                  <code>{integration.config.webhookUrl}</code>
                  <button className="btn-icon-small">📋</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="tab-panel">
            <div className="panel-section">
              <h2>Settings</h2>
              <p className="section-description">Manage integration settings and preferences</p>
              {/* Settings content */}
            </div>
          </div>
        )}
      </div>

      <style>{`
        .integration-details-page {
          display: flex;
          flex-direction: column;
          min-height: 100vh;
          background: linear-gradient(135deg, #f5f7fa 0%, #f9fafb 100%);
        }

        .details-header {
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

        .btn-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border-radius: var(--radius-lg);
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          cursor: pointer;
          transition: all var(--transition-base);
        }

        .btn-icon:hover {
          background: white;
          border-color: #d1d5db;
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

        .header-status {
          display: flex;
          align-items: center;
          gap: var(--space-16);
          padding-left: var(--space-24);
          border-left: 1px solid #e5e7eb;
        }

        .details-tabs {
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

        .details-content {
          flex: 1;
          padding: var(--space-32);
          max-width: 1600px;
          margin: 0 auto;
          width: 100%;
        }

        .tab-panel {
          animation: slideInUp 400ms cubic-bezier(0.4, 0, 0.2, 1);
        }

        .panel-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: var(--space-24);
        }

        .panel-section {
          background: white;
          padding: var(--space-24);
          border-radius: var(--radius-lg);
          border: 1px solid #e5e7eb;
          box-shadow: var(--shadow-md);
        }

        .panel-section h2 {
          margin: 0 0 var(--space-8) 0;
          font-size: 20px;
          font-weight: 700;
          color: #0f172a;
        }

        .section-description {
          margin: 0 0 var(--space-24) 0;
          color: #6b7280;
          font-size: 14px;
        }

        .info-card {
          background: white;
          padding: var(--space-24);
          border-radius: var(--radius-lg);
          border: 1px solid #e5e7eb;
          box-shadow: var(--shadow-md);
          transition: all var(--transition-base);
        }

        .info-card:hover {
          box-shadow: var(--shadow-lg);
          border-color: #d1d5db;
        }

        .info-card h3 {
          margin: 0 0 var(--space-16) 0;
          font-size: 16px;
          font-weight: 700;
          color: #0f172a;
        }

        .info-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-16);
        }

        .info-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: var(--space-12) 0;
          border-bottom: 1px solid #f3f4f6;
        }

        .info-item:last-child {
          border-bottom: none;
        }

        .info-label {
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #6b7280;
        }

        .info-value {
          font-size: 14px;
          color: #0f172a;
          font-weight: 500;
        }

        .credentials-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-16);
        }

        .credential-item {
          display: flex;
          flex-direction: column;
          gap: var(--space-8);
        }

        .credential-label {
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #6b7280;
        }

        .credential-value {
          display: flex;
          align-items: center;
          gap: var(--space-8);
        }

        .credential-value code {
          flex: 1;
          padding: var(--space-8) var(--space-12);
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: var(--radius-md);
          font-family: 'Monaco', 'Courier New', monospace;
          font-size: 12px;
          color: #0f172a;
          overflow: auto;
        }

        .btn-icon-small {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border: 1px solid #e5e7eb;
          background: #f9fafb;
          border-radius: var(--radius-md);
          cursor: pointer;
          font-size: 16px;
          transition: all var(--transition-base);
        }

        .btn-icon-small:hover {
          background: white;
          border-color: #d1d5db;
        }

        .actions-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-8);
        }

        .action-btn {
          display: flex;
          align-items: center;
          gap: var(--space-12);
          padding: var(--space-12) var(--space-16);
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: var(--radius-lg);
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          color: #3b82f6;
          transition: all var(--transition-base);
        }

        .action-btn:hover {
          background: #f0f9ff;
          border-color: #3b82f6;
        }

        .info-card.warning {
          border-left: 4px solid #f97316;
          background: #fff7ed;
        }

        .warning-header {
          display: flex;
          align-items: center;
          gap: var(--space-8);
          margin-bottom: var(--space-16);
          color: #f97316;
        }

        .warning-header h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 700;
          color: #0f172a;
        }

        .activity-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-12);
        }

        .activity-item {
          display: flex;
          gap: var(--space-12);
          padding: var(--space-8) 0;
        }

        .activity-time {
          font-size: 12px;
          color: #9ca3af;
          white-space: nowrap;
          font-weight: 600;
        }

        .activity-text {
          font-size: 14px;
          color: #0f172a;
        }

        .webhook-url-box {
          display: flex;
          flex-direction: column;
          gap: var(--space-8);
          padding: var(--space-16);
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: var(--radius-lg);
        }

        .webhook-url-box label {
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #6b7280;
        }

        .webhook-input {
          display: flex;
          gap: var(--space-8);
        }

        .webhook-input code {
          flex: 1;
          padding: var(--space-8) var(--space-12);
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: var(--radius-md);
          font-family: 'Monaco', 'Courier New', monospace;
          font-size: 12px;
          color: #0f172a;
          overflow: auto;
        }

        @media (max-width: 1024px) {
          .header-top {
            flex-direction: column;
            align-items: flex-start;
            gap: var(--space-16);
          }

          .header-status {
            border-left: none;
            border-top: 1px solid #e5e7eb;
            padding-left: 0;
            padding-top: var(--space-16);
            width: 100%;
          }

          .panel-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 640px) {
          .details-content {
            padding: var(--space-16);
          }

          .details-tabs {
            padding: 0 var(--space-16);
            -webkit-overflow-scrolling: touch;
          }

          .tab-button {
            font-size: 12px;
            padding: var(--space-12) var(--space-16);
          }
        }
      `}</style>
    </div>
  );
}
