import React from 'react';
import { CheckCircle2, Clock, AlertCircle, XCircle, Zap, Pause } from 'lucide-react';

const STATUS_CONFIG = {
  connected: { color: '#22c55e', icon: CheckCircle2, label: 'Connected' },
  pending: { color: '#f97316', icon: Clock, label: 'Pending' },
  disconnected: { color: '#ef4444', icon: XCircle, label: 'Disconnected' },
  expired: { color: '#9ca3af', icon: AlertCircle, label: 'Expired' },
  failed: { color: '#ef4444', icon: AlertCircle, label: 'Failed' },
  syncing: { color: '#3b82f6', icon: Zap, label: 'Syncing' },
  paused: { color: '#8b5cf6', icon: Pause, label: 'Paused' },
};

export default function StatusBadge({ status = 'pending', label, size = 'md', animated = false }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = config.icon;

  const sizeClass = {
    sm: 'badge-sm',
    md: 'badge-md',
    lg: 'badge-lg',
  }[size] || 'badge-md';

  return (
    <div
      className={`status-badge ${sizeClass} ${animated && status === 'syncing' ? 'animated' : ''}`}
      style={{
        backgroundColor: `${config.color}15`,
        borderColor: config.color,
        color: config.color,
      }}
    >
      <Icon size={size === 'sm' ? 14 : size === 'lg' ? 18 : 16} />
      <span>{label || config.label}</span>
    </div>
  );
}
