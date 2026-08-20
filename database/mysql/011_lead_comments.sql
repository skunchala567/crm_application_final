SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS crm_lead_comments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id BIGINT UNSIGNED NOT NULL,
  comment_text TEXT NOT NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_crm_lead_comments_lead_created (lead_id, created_at_utc),
  CONSTRAINT fk_crm_lead_comments_lead FOREIGN KEY (lead_id) REFERENCES crm_leads(id),
  CONSTRAINT fk_crm_lead_comments_user FOREIGN KEY (created_by_user_id) REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
