-- Migration: Add Lead Stage History tracking table
-- Purpose: Track stage and sub-stage changes for leads with full audit trail

CREATE TABLE IF NOT EXISTS `crm_lead_stage_history` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `lead_id` BIGINT UNSIGNED NOT NULL,
  `from_stage_id` BIGINT UNSIGNED,
  `to_stage_id` BIGINT UNSIGNED NOT NULL,
  `from_substage_id` BIGINT UNSIGNED,
  `to_substage_id` BIGINT UNSIGNED NOT NULL,
  `changed_by_user_id` BIGINT UNSIGNED NOT NULL,
  `changed_at_utc` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_at_utc` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY `idx_lead_id` (`lead_id`),
  KEY `idx_to_stage_id` (`to_stage_id`),
  KEY `idx_changed_at_utc` (`changed_at_utc`),
  KEY `idx_stage_history_lead_date` (`lead_id`, `changed_at_utc`),
  KEY `idx_stage_history_user` (`changed_by_user_id`, `changed_at_utc`),
  FOREIGN KEY (`lead_id`) REFERENCES `crm_leads` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (`from_stage_id`) REFERENCES `crm_lead_stages` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  FOREIGN KEY (`to_stage_id`) REFERENCES `crm_lead_stages` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (`from_substage_id`) REFERENCES `crm_lead_substages` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  FOREIGN KEY (`to_substage_id`) REFERENCES `crm_lead_substages` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (`changed_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
