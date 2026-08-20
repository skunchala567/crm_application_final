SET NAMES utf8mb4;

-- User-level template assignment, matching WhatsApp template visibility.
-- No assigned users means the template is visible to CRM/Super Admins only.
CREATE TABLE IF NOT EXISTS crm_email_template_user_visibility (
  template_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (template_id, user_id),
  KEY ix_email_template_visibility_user (user_id),
  CONSTRAINT fk_email_template_visibility_template FOREIGN KEY (template_id) REFERENCES crm_email_templates(id) ON DELETE CASCADE,
  CONSTRAINT fk_email_template_visibility_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_sms_template_user_visibility (
  template_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (template_id, user_id),
  KEY ix_sms_template_visibility_user (user_id),
  CONSTRAINT fk_sms_template_visibility_template FOREIGN KEY (template_id) REFERENCES crm_sms_templates(id) ON DELETE CASCADE,
  CONSTRAINT fk_sms_template_visibility_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
