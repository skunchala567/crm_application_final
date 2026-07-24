-- =====================================================
-- Integration Hub - Database Schema
-- Phase 4-5: Google Sheets, WhatsApp, and Multi-Provider Support
-- =====================================================

-- Integration Hub Configurations
CREATE TABLE IF NOT EXISTS integration_configs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  organization_id INT NOT NULL,
  integration_type VARCHAR(50) NOT NULL COMMENT 'meta, google_sheets, whatsapp, sms, google_ads, email, erp',
  provider_name VARCHAR(100) NOT NULL COMMENT 'Meta Cloud API, SmartPing, 360Dialog, etc.',
  integration_name VARCHAR(255),
  status ENUM('active', 'inactive', 'error', 'pending_auth') DEFAULT 'pending_auth',
  config JSON NOT NULL COMMENT 'Provider-specific configuration',
  last_synced_at TIMESTAMP NULL,
  next_sync_at TIMESTAMP NULL,
  last_error_message VARCHAR(1000),
  is_webhook_active BOOLEAN DEFAULT FALSE,
  webhook_url VARCHAR(500),
  webhook_secret VARCHAR(256) COMMENT 'For HMAC signature verification',
  api_quota_limit INT,
  api_quota_remaining INT,
  api_quota_reset_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by_id INT,

  INDEX idx_org_type (organization_id, integration_type),
  INDEX idx_status (status),
  INDEX idx_sync_schedule (next_sync_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- OAuth Token Storage
CREATE TABLE IF NOT EXISTS integration_oauth_tokens (
  id INT PRIMARY KEY AUTO_INCREMENT,
  integration_config_id INT NOT NULL,
  provider_name VARCHAR(100),
  access_token LONGTEXT NOT NULL COMMENT 'Encrypted token',
  refresh_token LONGTEXT COMMENT 'Encrypted refresh token',
  token_type VARCHAR(50),
  expires_at TIMESTAMP NULL,
  scope VARCHAR(500),
  obtained_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_config (integration_config_id),
  UNIQUE KEY unique_config_oauth (integration_config_id),
  FOREIGN KEY (integration_config_id) REFERENCES integration_configs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sync Job Queue
CREATE TABLE IF NOT EXISTS integration_sync_jobs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  integration_config_id INT NOT NULL,
  sync_type ENUM('manual', 'scheduled', 'webhook_triggered', 'retry') DEFAULT 'manual',
  status ENUM('pending', 'running', 'success', 'failed', 'partial') DEFAULT 'pending',
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  error_message VARCHAR(1000),
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 5,
  next_retry_at TIMESTAMP NULL,
  records_processed INT DEFAULT 0,
  records_created INT DEFAULT 0,
  records_updated INT DEFAULT 0,
  records_failed INT DEFAULT 0,
  metadata JSON COMMENT 'Job-specific data (filter params, batch info, etc.)',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_config_status (integration_config_id, status),
  INDEX idx_sync_time (created_at),
  INDEX idx_retry_schedule (next_retry_at),
  FOREIGN KEY (integration_config_id) REFERENCES integration_configs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sync History and Audit
CREATE TABLE IF NOT EXISTS integration_sync_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  integration_config_id INT NOT NULL,
  sync_job_id INT,
  sync_type ENUM('manual', 'scheduled', 'webhook') DEFAULT 'manual',
  status ENUM('success', 'partial', 'failed'),
  records_processed INT DEFAULT 0,
  records_created INT DEFAULT 0,
  records_updated INT DEFAULT 0,
  records_failed INT DEFAULT 0,
  records_skipped INT DEFAULT 0,
  error_summary VARCHAR(1000),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  duration_seconds INT,
  created_by_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_config (integration_config_id),
  INDEX idx_sync_time (created_at),
  FOREIGN KEY (integration_config_id) REFERENCES integration_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (sync_job_id) REFERENCES integration_sync_jobs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Field Mapping Configuration
CREATE TABLE IF NOT EXISTS integration_field_mappings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  integration_config_id INT NOT NULL,
  crm_field VARCHAR(100) NOT NULL COMMENT 'CRM field name',
  external_field VARCHAR(100) NOT NULL COMMENT 'Provider field name',
  field_type VARCHAR(50) COMMENT 'text, email, phone, date, number, select, etc.',
  is_required BOOLEAN DEFAULT FALSE,
  transform_rule JSON COMMENT 'Data transformation rules',
  direction ENUM('import', 'export', 'both') DEFAULT 'both',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_config (integration_config_id),
  UNIQUE KEY unique_mapping (integration_config_id, crm_field, external_field),
  FOREIGN KEY (integration_config_id) REFERENCES integration_configs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Webhook Subscriptions
CREATE TABLE IF NOT EXISTS integration_webhooks (
  id INT PRIMARY KEY AUTO_INCREMENT,
  integration_config_id INT NOT NULL,
  webhook_event VARCHAR(100) COMMENT 'lead_received, message_status_update, etc.',
  webhook_url VARCHAR(500) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  signature_algorithm VARCHAR(50) COMMENT 'hmac_sha256, hmac_sha512, etc.',
  retry_policy JSON COMMENT '{"max_retries": 5, "backoff_multiplier": 2}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_config (integration_config_id),
  FOREIGN KEY (integration_config_id) REFERENCES integration_configs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Webhook Delivery Logs
CREATE TABLE IF NOT EXISTS integration_webhook_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  webhook_id INT NOT NULL,
  event_id VARCHAR(255),
  payload_hash VARCHAR(64),
  http_status_code INT,
  response_body TEXT,
  attempt_number INT DEFAULT 1,
  next_retry_at TIMESTAMP NULL,
  delivered_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_webhook (webhook_id),
  INDEX idx_delivery_status (delivered_at),
  FOREIGN KEY (webhook_id) REFERENCES integration_webhooks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Error Tracking
CREATE TABLE IF NOT EXISTS integration_error_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  integration_config_id INT NOT NULL,
  error_type VARCHAR(100) COMMENT 'auth_failure, rate_limit, invalid_data, etc.',
  error_message VARCHAR(1000),
  error_details JSON,
  affected_records INT DEFAULT 0,
  is_resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_config (integration_config_id),
  INDEX idx_type (error_type),
  INDEX idx_created (created_at),
  FOREIGN KEY (integration_config_id) REFERENCES integration_configs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit Log for Integration Changes
CREATE TABLE IF NOT EXISTS integration_audit_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  integration_config_id INT NOT NULL,
  action VARCHAR(50) COMMENT 'created, connected, disconnected, config_updated, sync_started, etc.',
  old_values JSON,
  new_values JSON,
  notes VARCHAR(500),
  created_by_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_config (integration_config_id),
  INDEX idx_time (created_at),
  FOREIGN KEY (integration_config_id) REFERENCES integration_configs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
