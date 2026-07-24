USE attendance_biometric;
SET NAMES utf8mb4;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'crm_lead_stages'
    AND column_name = 'requires_followup'
);
SET @ddl = IF(
  @column_exists = 0,
  'ALTER TABLE crm_lead_stages ADD COLUMN requires_followup TINYINT(1) NOT NULL DEFAULT 0 AFTER color_code',
  'SELECT 1'
);
PREPARE statement FROM @ddl;
EXECUTE statement;
DEALLOCATE PREPARE statement;
