USE attendance_biometric;

SET @has_deletion_password = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'crm_business_units'
    AND column_name = 'deletion_password_hash'
);
SET @sql = IF(
  @has_deletion_password = 0,
  'ALTER TABLE crm_business_units ADD COLUMN deletion_password_hash VARCHAR(255) NULL AFTER color_code',
  'SELECT 1'
);
PREPARE statement FROM @sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;
