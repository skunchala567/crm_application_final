-- Shared audit history for bulk operations other than file uploads.
CREATE TABLE IF NOT EXISTS crm_bulk_operations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  operation_type ENUM('data_export','stage_change','referral') NOT NULL,
  `status` ENUM('processing','completed','partial','failed') NOT NULL DEFAULT 'processing',
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  total_records INT UNSIGNED NOT NULL DEFAULT 0,
  successful_records INT UNSIGNED NOT NULL DEFAULT 0,
  failed_records INT UNSIGNED NOT NULL DEFAULT 0,
  summary VARCHAR(500),
  details_json JSON,
  error_message VARCHAR(1000),
  started_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  completed_at_utc DATETIME(6),
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_bulk_operation_type_created (operation_type, created_at_utc),
  INDEX idx_bulk_operation_status (`status`),
  INDEX idx_bulk_operation_user (created_by_user_id),
  CONSTRAINT fk_bulk_operation_user
    FOREIGN KEY (created_by_user_id) REFERENCES app_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
