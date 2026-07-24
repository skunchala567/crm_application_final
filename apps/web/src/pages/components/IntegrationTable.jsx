import { Eye, RefreshCw, Settings, Trash2, AlertCircle, CheckCircle } from 'lucide-react';

export default function IntegrationTable({
  integrations,
  onViewDetails,
  onSync,
  onSettings,
  onDelete,
  loading
}) {
  const getStatusColor = (status) => {
    const colors = {
      active: { bg: '#d4edda', text: '#155724', label: 'Connected' },
      error: { bg: '#f8d7da', text: '#721c24', label: 'Error' },
      pending: { bg: '#fff3cd', text: '#856404', label: 'Pending' },
      disconnected: { bg: '#e2e3e5', text: '#383d41', label: 'Disconnected' }
    };
    return colors[status] || colors.pending;
  };

  const getStatusIcon = (status) => {
    if (status === 'active') return <CheckCircle size={16} />;
    if (status === 'error') return <AlertCircle size={16} />;
    return <AlertCircle size={16} />;
  };

  if (loading) {
    return <div className="table-loading">Loading integrations...</div>;
  }

  if (integrations.length === 0) {
    return <div className="table-empty">No integrations found</div>;
  }

  return (
    <div className="integration-table-wrapper">
      <table className="integration-table">
        <thead>
          <tr>
            <th>Integration</th>
            <th>Provider</th>
            <th>Status</th>
            <th>Last Sync</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {integrations.map((integration) => {
            const statusInfo = getStatusColor(integration.status);
            return (
              <tr key={integration.id} className="integration-row">
                <td className="integration-name">
                  <div className="integration-cell">
                    <strong>{integration.integration_name}</strong>
                  </div>
                </td>
                <td>{integration.provider_name}</td>
                <td>
                  <span
                    className="status-badge"
                    style={{
                      backgroundColor: statusInfo.bg,
                      color: statusInfo.text
                    }}
                  >
                    {getStatusIcon(integration.status)}
                    {statusInfo.label}
                  </span>
                </td>
                <td className="text-muted">
                  {integration.last_synced_at
                    ? new Date(integration.last_synced_at).toLocaleDateString()
                    : 'Never'}
                </td>
                <td className="text-muted">
                  {new Date(integration.created_at).toLocaleDateString()}
                </td>
                <td>
                  <div className="action-buttons">
                    <button
                      className="btn-icon"
                      title="View Details"
                      onClick={() => onViewDetails(integration)}
                    >
                      <Eye size={16} />
                    </button>
                    <button
                      className="btn-icon"
                      title="Sync Now"
                      onClick={() => onSync(integration)}
                    >
                      <RefreshCw size={16} />
                    </button>
                    <button
                      className="btn-icon"
                      title="Settings"
                      onClick={() => onSettings(integration)}
                    >
                      <Settings size={16} />
                    </button>
                    <button
                      className="btn-icon btn-danger"
                      title="Delete"
                      onClick={() => onDelete(integration)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
