USE attendance_biometric;
SET NAMES utf8mb4;

-- Saved filters/views are private to both the active business unit and creator.
-- The migration runner replays files, so every schema change is conditional.
SET @has_unit_column = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_saved_filters' AND column_name = 'business_unit_id'
);
SET @sql = IF(@has_unit_column = 0,
  'ALTER TABLE crm_saved_filters ADD COLUMN business_unit_id BIGINT UNSIGNED NULL AFTER id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE crm_saved_filters sf
JOIN (
  SELECT user_id, SUBSTRING_INDEX(
    GROUP_CONCAT(business_unit_id ORDER BY is_default DESC, business_unit_id), ',', 1
  ) AS business_unit_id
  FROM crm_user_business_units
  GROUP BY user_id
) ubu ON ubu.user_id = sf.user_id
SET sf.business_unit_id = ubu.business_unit_id
WHERE sf.business_unit_id IS NULL;

SET @unit_nullable = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_saved_filters'
    AND column_name = 'business_unit_id' AND is_nullable = 'YES'
);
SET @unassigned_rows = (SELECT COUNT(*) FROM crm_saved_filters WHERE business_unit_id IS NULL);
-- Preserve any anomalous legacy rows instead of deleting user data. They remain
-- invisible to scoped API queries until their user is assigned a business unit.
SET @sql = IF(@unit_nullable = 1 AND @unassigned_rows = 0,
  'ALTER TABLE crm_saved_filters MODIFY business_unit_id BIGINT UNSIGNED NOT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @old_unique = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'crm_saved_filters' AND index_name = 'uq_crm_saved_filters_user_name'
);
SET @sql = IF(@old_unique > 0,
  'ALTER TABLE crm_saved_filters DROP INDEX uq_crm_saved_filters_user_name',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @new_unique = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'crm_saved_filters' AND index_name = 'uq_crm_saved_filters_unit_user_name'
);
SET @sql = IF(@new_unique = 0,
  'ALTER TABLE crm_saved_filters ADD UNIQUE KEY uq_crm_saved_filters_unit_user_name (business_unit_id, user_id, name)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @new_lookup = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'crm_saved_filters' AND index_name = 'ix_crm_saved_filters_unit_user_type'
);
SET @sql = IF(@new_lookup = 0,
  'ALTER TABLE crm_saved_filters ADD KEY ix_crm_saved_filters_unit_user_type (business_unit_id, user_id, filter_type)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @unit_fk = (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE() AND table_name = 'crm_saved_filters' AND constraint_name = 'fk_crm_saved_filters_unit'
);
SET @sql = IF(@unit_fk = 0,
  'ALTER TABLE crm_saved_filters ADD CONSTRAINT fk_crm_saved_filters_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
