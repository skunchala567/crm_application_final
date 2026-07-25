import '../styles/StatusTabs.css';

export default function StatusTabs({ counts, selectedStatus, onStatusChange }) {
  const statuses = [
    { id: '', label: 'All', icon: '📋' },
    { id: 'DRAFT', label: 'Draft', icon: '📝' },
    { id: 'PENDING', label: 'Pending', icon: '⏳' },
    { id: 'APPROVED', label: 'Approved', icon: '✅' },
    { id: 'REJECTED', label: 'Rejected', icon: '❌' },
    { id: 'ARCHIVED', label: 'Archived', icon: '📦' }
  ];

  const totalCount = Object.values(counts).reduce((sum, count) => sum + count, 0);

  return (
    <div className="status-tabs">
      <button
        className={`status-tab ${selectedStatus === '' ? 'active' : ''}`}
        onClick={() => onStatusChange('')}
      >
        <span className="tab-icon">📋</span>
        <span className="tab-label">All</span>
        <span className="tab-count">{totalCount}</span>
      </button>

      {statuses.slice(1).map(status => (
        <button
          key={status.id}
          className={`status-tab ${selectedStatus === status.id ? 'active' : ''}`}
          onClick={() => onStatusChange(status.id)}
        >
          <span className="tab-icon">{status.icon}</span>
          <span className="tab-label">{status.label}</span>
          <span className="tab-count">{counts[status.id] || 0}</span>
        </button>
      ))}
    </div>
  );
}
