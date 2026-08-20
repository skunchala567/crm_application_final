SET NAMES utf8mb4;

SET @sql=IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_leads' AND COLUMN_NAME='custom_values_json'
  ),
  'SELECT 1',
  'ALTER TABLE crm_leads ADD COLUMN custom_values_json JSON NULL AFTER remarks'
);
PREPARE statement FROM @sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;
