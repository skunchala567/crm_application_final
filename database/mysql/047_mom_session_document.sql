USE attendance_biometric;
SET NAMES utf8mb4;

SET @sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='crm_mom_sessions'
      AND COLUMN_NAME='mom_notes'
  ),
  'SELECT 1',
  'ALTER TABLE crm_mom_sessions ADD COLUMN mom_notes LONGTEXT NULL AFTER session_number'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
