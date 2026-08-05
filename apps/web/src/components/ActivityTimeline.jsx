import { ChevronDown, ChevronUp, Filter, CheckCircle, FileText, User, Clock } from 'lucide-react';
import { useState, useMemo } from 'react';

const ACTIVITY_CONFIG = {
  payment_recorded: {
    label: 'Payment Recorded',
    icon: CheckCircle,
    badgeColor: '#22c55e',
    backgroundColor: '#f0fdf4',
  },
  bill_created: {
    label: 'Bill Created',
    icon: FileText,
    badgeColor: '#7c3aed',
    backgroundColor: '#faf5ff',
  },
  vendor_updated: {
    label: 'Vendor Details Updated',
    icon: User,
    badgeColor: '#6b7280',
    backgroundColor: '#f9fafb',
  },
  stage_change: {
    label: 'Stage Changed',
    icon: Clock,
    badgeColor: '#3b82f6',
    backgroundColor: '#eff6ff',
  },
  call: {
    label: 'Call',
    icon: Clock,
    badgeColor: '#f59e0b',
    backgroundColor: '#fffbeb',
  },
  message: {
    label: 'Message',
    icon: Clock,
    badgeColor: '#06b6d4',
    backgroundColor: '#ecfdf5',
  },
};

function getActivityConfig(summary) {
  if (!summary) return ACTIVITY_CONFIG.stage_change;
  const lower = summary.toLowerCase();
  if (lower.includes('payment')) return ACTIVITY_CONFIG.payment_recorded;
  if (lower.includes('bill')) return ACTIVITY_CONFIG.bill_created;
  if (lower.includes('vendor')) return ACTIVITY_CONFIG.vendor_updated;
  if (lower.includes('stage')) return ACTIVITY_CONFIG.stage_change;
  if (lower.includes('call')) return ACTIVITY_CONFIG.call;
  if (lower.includes('message')) return ACTIVITY_CONFIG.message;
  return ACTIVITY_CONFIG.stage_change;
}

function formatActivityDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatActivityTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ActivityTimeline({ activities = [] }) {
  const [expandedItems, setExpandedItems] = useState({});

  const sortedActivities = useMemo(() => {
    return [...activities].sort(
      (a, b) => new Date(b.occurredAt) - new Date(a.occurredAt)
    );
  }, [activities]);

  const toggleExpanded = (id) => {
    setExpandedItems((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  if (!activities.length) {
    return (
      <div className="activity-timeline-empty">
        <p>No activity recorded.</p>
      </div>
    );
  }

  return (
    <div className="activity-timeline-wrapper">
      <div className="timeline-view">
        {sortedActivities.map((item) => {
          const config = getActivityConfig(item.summary);
          const Icon = config.icon;
          const isExpanded = expandedItems[item.id];
          const hasDetails = !!(item.commentText || (item.details && Object.keys(item.details).length > 0) || item.actorName);

          return (
            <div
              key={item.id}
              className="timeline-item"
              style={{ borderLeftColor: config.badgeColor }}
            >
              <div className="timeline-marker" style={{ backgroundColor: config.badgeColor }}>
                <Icon size={18} color="white" />
              </div>

              <div
                className="activity-card"
                style={{ backgroundColor: config.backgroundColor }}
              >
                <div className="activity-card-header">
                  <div className="activity-info">
                    <h3 className="activity-title">{config.label}</h3>
                    <span className="activity-time">
                      {formatActivityDate(item.occurredAt)} · {formatActivityTime(item.occurredAt)}
                    </span>
                  </div>
                  {hasDetails && (
                    <button
                      className="view-more-btn"
                      onClick={() => toggleExpanded(item.id)}
                    >
                      {isExpanded ? 'View Less' : 'View More'}
                      <ChevronDown size={14} style={{
                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s ease',
                      }} />
                    </button>
                  )}
                </div>

                {item.summary && (
                  <p className="activity-summary">{item.summary}</p>
                )}

                {isExpanded && (
                  <div className="activity-details">
                    {item.commentText && (
                      <p className="detail-text">{item.commentText}</p>
                    )}

                    {item.details && Object.entries(item.details).map(([key, value]) => (
                      value && typeof value === 'string' && !key.includes('url') ? (
                        <div key={key} className="detail-item">
                          <span className="detail-key">{key}:</span>
                          <span className="detail-value">{value}</span>
                        </div>
                      ) : null
                    ))}

                    {item.details?.recordingUrl && (
                      <audio
                        controls
                        preload="none"
                        src={item.details.recordingUrl}
                        className="activity-audio"
                      >
                        Your browser cannot play this call recording.
                      </audio>
                    )}

                    {item.actorName && (
                      <div className="detail-footer">
                        <span className="actor-label">Created by:</span>
                        <span className="actor-name">{item.actorName}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
