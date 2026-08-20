SET NAMES utf8mb4;

-- SMS templates, so an account is not limited to a single message.
--
-- The SmartPing SMS integration held one `dltContentId` in its config, and
-- every send reused it -- one approved template per account, with the text
-- typed fresh each time. The provider itself never had that limit: its
-- sendMessage() already accepts a per-message DLT Content ID. What was missing
-- was somewhere to keep more than one.
--
-- Templates are maintained here rather than synced from the provider, as
-- WhatsApp templates are: SmartPing exposes only a send endpoint, and DLT
-- registration happens on the operator's portal. Each row therefore records
-- the Content ID that the portal issued for that wording.
--
-- Bodies use the same {{1}}, {{2}} placeholders as the WhatsApp templates, so
-- one idea of "a template with variables" runs through the whole CRM.
CREATE TABLE IF NOT EXISTS crm_sms_templates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  integration_id INT NOT NULL,
  business_unit_id BIGINT UNSIGNED NULL,
  template_name VARCHAR(150) NOT NULL,
  category VARCHAR(60) NOT NULL DEFAULT 'General',
  body TEXT NOT NULL,
  -- Issued by the DLT portal for this exact wording. Without it the operator
  -- rejects the message, which is why it belongs to the template and not to
  -- the account.
  dlt_content_id VARCHAR(32) NOT NULL,
  -- Optional per-template overrides; blank falls back to the account's.
  sender_id VARCHAR(16) NULL,
  variable_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  sample_values_json JSON NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_sms_template (integration_id, template_name),
  KEY ix_crm_sms_template_active (integration_id, is_active, template_name),
  CONSTRAINT fk_crm_sms_template_integration FOREIGN KEY (integration_id) REFERENCES crm_integrations(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_sms_template_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE SET NULL,
  CONSTRAINT fk_crm_sms_template_creator FOREIGN KEY (created_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Carry the single configured Content ID over as a first template, so an
-- account that was already sending keeps working and has something to edit
-- rather than an empty list.
INSERT INTO crm_sms_templates (integration_id, template_name, category, body, dlt_content_id, created_by_user_id)
SELECT i.id, 'Existing message', 'General',
       'Migrated from the account settings. Edit this wording to match the text registered on the DLT portal.',
       JSON_UNQUOTE(JSON_EXTRACT(i.config, '$.dltContentId')), NULL
  FROM crm_integrations i
 WHERE i.deleted_at IS NULL
   AND LOWER(COALESCE(i.provider,'')) = 'smartping_sms'
   AND JSON_UNQUOTE(JSON_EXTRACT(i.config, '$.dltContentId')) REGEXP '^[0-9]{4,19}$'
ON DUPLICATE KEY UPDATE crm_sms_templates.id = crm_sms_templates.id;
