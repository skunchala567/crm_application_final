import { useState, useEffect } from 'react';
import { Plus, Sync, Edit, Trash2, AlertCircle, CheckCircle, Clock, Activity } from 'lucide-react';
import { api } from '../api';
import DashboardCard from './components/DashboardCard';
import PremiumTable from './components/PremiumTable';
import PremiumToolbar from './components/PremiumToolbar';
import StatusBadge from './components/StatusBadge';
import HealthIndicator from './components/HealthIndicator';
import '../styles/integrations-premium.css';

export default function IntegrationHubRedesigned({
  onSelectIntegration = () => {},
  onOpenWorkspace = () => {},
  onOpenTemplates = () => {},
}) {
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({});

  useEffect(() => {
    fetchIntegrations();
    const interval = setInterval(fetchIntegrations, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchIntegrations = async () => {
    try {
      const response = await api.get('/hub/integrations');
      setIntegrations(response.data || []);
    } catch (error) {
      console.error('Failed to load integrations:', error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate statistics
  const stats = {
    total: integrations.length,
    connected: integrations.filter(i => i.status === 'active').length,
    pending: integrations.filter(i => i.status === 'pending_auth').length,
    disconnected: integrations.filter(i => i.status === 'disconnected' || i.status === 'inactive').length,
    needsAttention: integrations.filter(i => i.status === 'error').length,
  };

  // Filter integrations
  const filtered = integrations.filter(i => {
    const matchSearch = !search ||
      i.integration_name.toLowerCase().includes(search.toLowerCase()) ||
      i.provider_name.toLowerCase().includes(search.toLowerCase());

    const matchFilters = Object.entries(filters).every(([key, value]) => {
      if (!value) return true;
      if (key === 'status') return i.status === value;
      return true;
    });

    return matchSearch && matchFilters;
  });

  const getStatus = (status) => {
    const map = {
      'active': 'connected',
      'pending_auth': 'pending',
      'disconnected': 'disconnected',
      'inactive': 'disconnected',
      'error': 'failed',
    };
    return map[status] || 'unknown';
  };

  const getHealth = (integration) => {
    if (integration.status === 'active') return 'excellent';
    if (integration.status === 'pending_auth') return 'fair';
    if (integration.status === 'error') return 'poor';
    return 'unknown';
  };

  const tableColumns = [
    {
      key: 'name',
      label: 'Integration',
      sortable: true,
      render: (_, row) => (
        <div className="table-integration-cell">
          <div className="integration-logo">{row.integration_name.charAt(0).toUpperCase()}</div>
          <div>
            <div className="integration-title">{row.integration_name}</div>
            <div className="integration-description">{row.provider_name}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'provider_name',
      label: 'Provider',
      sortable: true,
    },
    {
      key: 'category',
      label: 'Category',
      render: (val) => val || '—',
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (val) => <StatusBadge status={getStatus(val)} />,
    },
    {
      key: 'health',
      label: 'Health',
      render: (_, row) => <HealthIndicator health={getHealth(row)} showLabel={false} />,
    },
    {
      key: 'last_synced_at',
      label: 'Last Sync',
      render: (val) => val ? new Date(val).toLocaleDateString() : '—',
    },
  ];

  return (
    <div className="integrations-page">
      <div className="integrations-main">
        {/* Page Header */}
        <div className="page-header">
          <div className="header-content">
            <h3>CRM ADMINISTRATION</h3>
            <h1>Integration Management</h1>
            <p>Manage and monitor all connected third-party services used by your CRM.</p>
          </div>
          <div className="header-actions">
            <button className="btn-premium btn-secondary" onClick={fetchIntegrations}>
              <Sync size={18} />
              Sync All
            </button>
            <button className="btn-premium btn-primary" onClick={onOpenWorkspace}>
              <Plus size={18} />
              Add Integration
            </button>
          </div>
        </div>

        {/* Dashboard Cards */}
        <div className="dashboard-grid">
          <DashboardCard
            icon={Activity}
            label="Total Integrations"
            value={stats.total}
            color="blue"
          />
          <DashboardCard
            icon={CheckCircle}
            label="Connected"
            value={stats.connected}
            color="green"
            trend={{ type: 'up', value: '+2' }}
          />
          <DashboardCard
            icon={Clock}
            label="Pending"
            value={stats.pending}
            color="orange"
          />
          <DashboardCard
            icon={AlertCircle}
            label="Needs Attention"
            value={stats.needsAttention}
            color="red"
          />
        </div>

        {/* Toolbar */}
        <PremiumToolbar
          onSearch={setSearch}
          onFilter={setFilters}
          onRefresh={fetchIntegrations}
          filters={[
            {
              key: 'status',
              label: 'Status',
              options: [
                { label: 'Connected', value: 'active' },
                { label: 'Pending', value: 'pending_auth' },
                { label: 'Disconnected', value: 'disconnected' },
                { label: 'Error', value: 'error' },
              ],
            },
          ]}
        />

        {/* Table */}
        {filtered.length === 0 && !loading ? (
          <div className="empty-state">
            <div className="empty-state-icon">🔗</div>
            <h3>No integrations found</h3>
            <p>Get started by connecting your first third-party service</p>
            <button className="btn-premium btn-primary">
              <Plus size={18} />
              Add Integration
            </button>
          </div>
        ) : (
          <PremiumTable
            columns={tableColumns}
            data={filtered}
            loading={loading}
            onRowClick={(row) => onSelectIntegration(row)}
            onAction={(row) => console.log('More actions:', row)}
          />
        )}
      </div>
    </div>
  );
}
