USE attendance_biometric;
SET NAMES utf8mb4;

SET @owner_assigned_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'crm_leads'
    AND column_name = 'owner_assigned_at_utc'
);

SET @add_owner_assigned_column = IF(
  @owner_assigned_column_exists = 0,
  'ALTER TABLE crm_leads ADD COLUMN owner_assigned_at_utc DATETIME(6) NULL AFTER owner_employee_id',
  'SELECT 1'
);
PREPARE owner_assigned_statement FROM @add_owner_assigned_column;
EXECUTE owner_assigned_statement;
DEALLOCATE PREPARE owner_assigned_statement;

UPDATE crm_leads
SET owner_assigned_at_utc = COALESCE(referred_at_utc, created_at_utc)
WHERE owner_employee_id IS NOT NULL
  AND owner_assigned_at_utc IS NULL;
