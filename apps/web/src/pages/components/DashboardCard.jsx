import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

export default function DashboardCard({
  icon: Icon,
  label,
  value,
  subtitle,
  trend,
  color = 'blue',
  onClick,
  loading = false
}) {
  const colorConfig = {
    blue: { bg: 'rgba(59, 130, 246, 0.1)', border: '#3b82f6', icon: '#3b82f6' },
    green: { bg: 'rgba(34, 197, 94, 0.1)', border: '#22c55e', icon: '#22c55e' },
    orange: { bg: 'rgba(249, 115, 22, 0.1)', border: '#f97316', icon: '#f97316' },
    red: { bg: 'rgba(239, 68, 68, 0.1)', border: '#ef4444', icon: '#ef4444' },
    purple: { bg: 'rgba(168, 85, 247, 0.1)', border: '#a855f7', icon: '#a855f7' },
  };

  const config = colorConfig[color] || colorConfig.blue;

  return (
    <div
      className="dashboard-card"
      style={{
        borderColor: config.border,
        backgroundColor: config.bg,
        cursor: onClick ? 'pointer' : 'default'
      }}
      onClick={onClick}
    >
      <div className="card-header">
        <div
          className="icon-container"
          style={{ color: config.icon, borderColor: config.border }}
        >
          {loading ? (
            <div className="spinner" />
          ) : (
            <Icon size={24} strokeWidth={2} />
          )}
        </div>
        {trend && (
          <div className={`trend ${trend.type}`}>
            {trend.type === 'up' ? (
              <TrendingUp size={16} />
            ) : (
              <TrendingDown size={16} />
            )}
            <span>{trend.value}</span>
          </div>
        )}
      </div>

      <div className="card-content">
        <div className="card-value">{value}</div>
        <div className="card-label">{label}</div>
        {subtitle && <div className="card-subtitle">{subtitle}</div>}
      </div>
    </div>
  );
}
