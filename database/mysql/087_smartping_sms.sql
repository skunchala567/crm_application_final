-- SmartPing SMS uses crm_integrations.config for account and DLT settings.
-- A separate ledger is necessary because SMS delivery reports and identifiers
-- are not compatible with the existing WhatsApp message tables.
CREATE TABLE IF NOT EXISTS crm_sms_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  integration_id INT NOT NULL,
  lead_id BIGINT UNSIGNED NULL,
  transaction_id VARCHAR(100) NULL,
  correlation_id VARCHAR(100) NOT NULL,
  recipient VARCHAR(20) NOT NULL,
  sender_id VARCHAR(6) NOT NULL,
  message_text TEXT NOT NULL,
  dlt_content_id VARCHAR(19) NOT NULL,
  unicode_message BOOLEAN NOT NULL DEFAULT FALSE,
  flash_message BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  description VARCHAR(500) NULL,
  pdu INT NULL,
  provider_response JSON NULL,
  submitted_at DATETIME NULL,
  delivered_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sms_integration_correlation (integration_id, correlation_id),
  KEY ix_sms_transaction (integration_id, transaction_id),
  KEY ix_sms_recipient_created (organization_id, recipient, created_at),
  KEY ix_sms_lead_created (lead_id, created_at),
  CONSTRAINT fk_sms_integration FOREIGN KEY (integration_id) REFERENCES crm_integrations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
