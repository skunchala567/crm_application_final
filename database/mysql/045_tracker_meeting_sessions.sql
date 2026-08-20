SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS crm_tracker_guest_owners (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(200) NOT NULL,
  normalized_name VARCHAR(200) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_crm_tracker_guest_owner (business_unit_id, normalized_name),
  KEY ix_crm_tracker_guest_owner_active (business_unit_id, is_active, display_name),
  CONSTRAINT fk_crm_tracker_guest_owner_unit
    FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_tracker_guest_owner_creator
    FOREIGN KEY (created_by_user_id) REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='crm_operation_records'
      AND COLUMN_NAME='guest_owner_id'
  ),
  'SELECT 1',
  'ALTER TABLE crm_operation_records
     ADD COLUMN guest_owner_id BIGINT UNSIGNED NULL AFTER owner_employee_id,
     ADD KEY ix_crm_operation_guest_owner (guest_owner_id),
     ADD CONSTRAINT fk_crm_operation_guest_owner
       FOREIGN KEY (guest_owner_id) REFERENCES crm_tracker_guest_owners(id)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
