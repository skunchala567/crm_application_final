export default function StatCard({ icon: Icon, label, value, trend, color = 'primary' }) {
  const colorMap = {
    primary: '#007bff',
    success: '#28a745',
    warning: '#ffc107',
    danger: '#dc3545',
    info: '#17a2b8'
  };

  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ color: colorMap[color] }}>
        <Icon size={24} />
      </div>
      <div className="stat-content">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {trend && (
          <div className="stat-trend" style={{ color: trend.positive ? '#28a745' : '#dc3545' }}>
            {trend.positive ? '↑' : '↓'} {trend.text}
          </div>
        )}
      </div>
    </div>
  );
}
