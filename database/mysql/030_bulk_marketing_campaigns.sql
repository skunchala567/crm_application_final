USE attendance_biometric;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS crm_marketing_campaigns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  rule_type ENUM('days_gap','calendar_dates','weekdays') NOT NULL,
  communication_count SMALLINT UNSIGNED NOT NULL,
  first_communication_at DATETIME(6) NOT NULL,
  gap_days SMALLINT UNSIGNED NULL,
  weekdays_json JSON NULL,
  calendar_dates_json JSON NULL,
  audience_filters_json JSON NOT NULL,
  integration_id INT NOT NULL,
  response_owner ENUM('sender','lead_owner') NOT NULL DEFAULT 'sender',
  retry_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('ACTIVE','PAUSED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_crm_marketing_campaign_status (status, first_communication_at),
  KEY ix_crm_marketing_campaign_org (organization_id, created_at_utc),
  CONSTRAINT fk_crm_marketing_campaign_creator FOREIGN KEY (created_by)
    REFERENCES app_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_crm_marketing_campaign_integration FOREIGN KEY (integration_id)
    REFERENCES crm_integrations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS crm_marketing_campaign_touches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  sequence_number SMALLINT UNSIGNED NOT NULL,
  template_id INT NOT NULL,
  template_name VARCHAR(180) NOT NULL,
  template_body TEXT NOT NULL,
  template_language VARCHAR(30) NULL,
  template_params_json JSON NULL,
  media_url VARCHAR(1000) NULL,
  media_filename VARCHAR(255) NULL,
  scheduled_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_marketing_campaign_touch (campaign_id, sequence_number),
  CONSTRAINT fk_crm_marketing_touch_campaign FOREIGN KEY (campaign_id)
    REFERENCES crm_marketing_campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_marketing_touch_template FOREIGN KEY (template_id)
    REFERENCES crm_whatsapp_templates(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS crm_marketing_campaign_recipients (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  lead_id BIGINT UNSIGNED NOT NULL,
  phone VARCHAR(30) NOT NULL,
  phone_type ENUM('primary','alternate') NOT NULL DEFAULT 'primary',
  status ENUM('PENDING','IN_PROGRESS','COMPLETED','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_marketing_recipient (campaign_id, lead_id, phone_type),
  KEY ix_crm_marketing_recipient_lead (lead_id),
  CONSTRAINT fk_crm_marketing_recipient_campaign FOREIGN KEY (campaign_id)
    REFERENCES crm_marketing_campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_marketing_recipient_lead FOREIGN KEY (lead_id)
    REFERENCES crm_leads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS crm_marketing_campaign_deliveries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  recipient_id BIGINT UNSIGNED NOT NULL,
  touch_id BIGINT UNSIGNED NOT NULL,
  sequence_number SMALLINT UNSIGNED NOT NULL,
  scheduled_for DATETIME(6) NOT NULL,
  status ENUM('PENDING','RUNNING','QUEUED','SENT','DELIVERED','READ','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  whatsapp_message_id VARCHAR(255) NULL,
  error_message VARCHAR(1000) NULL,
  sent_at_utc DATETIME(6) NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_marketing_delivery (recipient_id, touch_id),
  KEY ix_crm_marketing_delivery_due (status, scheduled_for),
  KEY ix_crm_marketing_delivery_campaign (campaign_id, status),
  CONSTRAINT fk_crm_marketing_delivery_campaign FOREIGN KEY (campaign_id)
    REFERENCES crm_marketing_campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_marketing_delivery_recipient FOREIGN KEY (recipient_id)
    REFERENCES crm_marketing_campaign_recipients(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_marketing_delivery_touch FOREIGN KEY (touch_id)
    REFERENCES crm_marketing_campaign_touches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
