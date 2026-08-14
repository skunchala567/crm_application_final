-- SMTP credentials/settings reuse crm_integrations (provider='smtp'). These
-- tables hold reusable content and the delivery ledger, neither of which fits
-- the integration or generic lead-activity records.
CREATE TABLE IF NOT EXISTS crm_email_templates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT NOT NULL,
  template_name VARCHAR(200) NOT NULL,
  category ENUM('Lead','Follow-up','Application','Admission','Payment','General','Other') NOT NULL DEFAULT 'General',
  subject VARCHAR(500) NOT NULL,
  body_html MEDIUMTEXT NOT NULL,
  body_text MEDIUMTEXT NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by_user_id BIGINT UNSIGNED NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at_utc DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_email_template_name (organization_id, template_name, deleted_at_utc),
  KEY ix_email_templates_filter (organization_id, status, category, updated_at_utc),
  CONSTRAINT fk_email_template_created_user FOREIGN KEY (created_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_email_template_updated_user FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_email_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT NOT NULL,
  integration_id INT NOT NULL,
  lead_id BIGINT UNSIGNED NULL,
  template_id BIGINT UNSIGNED NULL,
  sender_user_id BIGINT UNSIGNED NULL,
  from_name VARCHAR(200) NULL,
  from_email VARCHAR(254) NOT NULL,
  to_json JSON NOT NULL,
  cc_json JSON NULL,
  bcc_json JSON NULL,
  subject VARCHAR(500) NOT NULL,
  body_html MEDIUMTEXT NOT NULL,
  body_text MEDIUMTEXT NULL,
  attachments_json JSON NULL,
  status ENUM('DRAFT','SENDING','SENT','FAILED') NOT NULL DEFAULT 'DRAFT',
  smtp_message_id VARCHAR(500) NULL,
  error_message VARCHAR(500) NULL,
  technical_error TEXT NULL,
  retry_of_message_id BIGINT UNSIGNED NULL,
  sent_at_utc DATETIME(6) NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_email_messages_lead (lead_id, created_at_utc),
  KEY ix_email_messages_status (organization_id, status, created_at_utc),
  CONSTRAINT fk_email_message_integration FOREIGN KEY (integration_id) REFERENCES crm_integrations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_email_message_lead FOREIGN KEY (lead_id) REFERENCES crm_leads(id) ON DELETE SET NULL,
  CONSTRAINT fk_email_message_template FOREIGN KEY (template_id) REFERENCES crm_email_templates(id) ON DELETE SET NULL,
  CONSTRAINT fk_email_message_sender FOREIGN KEY (sender_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_email_message_retry FOREIGN KEY (retry_of_message_id) REFERENCES crm_email_messages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

