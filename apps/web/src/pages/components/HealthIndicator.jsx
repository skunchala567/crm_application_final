import React from 'react';

const HEALTH_LEVELS = {
  excellent: { color: '#22c55e', label: 'Excellent', level: 4 },
  good: { color: '#84cc16', label: 'Good', level: 3 },
  fair: { color: '#f97316', label: 'Fair', level: 2 },
  poor: { color: '#ef4444', label: 'Poor', level: 1 },
  unknown: { color: '#d1d5db', label: 'Unknown', level: 0 },
};

export default function HealthIndicator({ health = 'unknown', showLabel = true, size = 'md' }) {
  const config = HEALTH_LEVELS[health] || HEALTH_LEVELS.unknown;

  const sizeConfig = {
    sm: { height: 6, gap: 2 },
    md: { height: 8, gap: 2.5 },
    lg: { height: 10, gap: 3 },
  }[size] || { height: 8, gap: 2.5 };

  return (
    <div className="health-indicator">
      <div
        className="health-bar-container"
        style={{
          gap: `${sizeConfig.gap}px`,
        }}
      >
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="health-segment"
            style={{
              height: `${sizeConfig.height}px`,
              backgroundColor: i < config.level ? config.color : '#e5e7eb',
            }}
          />
        ))}
      </div>
      {showLabel && (
        <span className="health-label" style={{ color: config.color }}>
          {config.label}
        </span>
      )}
    </div>
  );
}
