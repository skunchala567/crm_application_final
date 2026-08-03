USE attendance_biometric;
SET NAMES utf8mb4;

SET @sql = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_operation_records' AND COLUMN_NAME='description'),
  'SELECT 1',
  'ALTER TABLE crm_operation_records ADD COLUMN description TEXT NULL AFTER title'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_operation_records' AND COLUMN_NAME='minutes_spent'),
  'SELECT 1',
  'ALTER TABLE crm_operation_records ADD COLUMN minutes_spent INT UNSIGNED NOT NULL DEFAULT 0 AFTER status_key'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_operation_records' AND COLUMN_NAME='approval_required'),
  'SELECT 1',
  'ALTER TABLE crm_operation_records ADD COLUMN approval_required BOOLEAN NOT NULL DEFAULT FALSE AFTER minutes_spent'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_operation_records' AND COLUMN_NAME='approval_status'),
  'SELECT 1',
  'ALTER TABLE crm_operation_records ADD COLUMN approval_status ENUM(''not_required'',''pending'',''approved'',''rejected'') NOT NULL DEFAULT ''not_required'' AFTER approval_required'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS crm_operation_time_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  operation_record_id BIGINT UNSIGNED NOT NULL,
  minutes_spent INT UNSIGNED NOT NULL,
  work_note VARCHAR(1000) NOT NULL,
  logged_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY ix_crm_operation_time_record (operation_record_id,created_at_utc),
  CONSTRAINT fk_crm_operation_time_record FOREIGN KEY (operation_record_id) REFERENCES crm_operation_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_operation_time_user FOREIGN KEY (logged_by_user_id) REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_operation_approvals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  operation_record_id BIGINT UNSIGNED NOT NULL,
  approver_user_id BIGINT UNSIGNED NOT NULL,
  decision ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  decision_remarks TEXT,
  document_references_json JSON,
  requested_by_user_id BIGINT UNSIGNED NOT NULL,
  requested_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  decided_at_utc DATETIME(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_crm_operation_approver (operation_record_id,approver_user_id),
  KEY ix_crm_operation_approval_queue (approver_user_id,decision,requested_at_utc),
  CONSTRAINT fk_crm_operation_approval_record FOREIGN KEY (operation_record_id) REFERENCES crm_operation_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_operation_approval_user FOREIGN KEY (approver_user_id) REFERENCES app_users(id),
  CONSTRAINT fk_crm_operation_approval_requested_by FOREIGN KEY (requested_by_user_id) REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
