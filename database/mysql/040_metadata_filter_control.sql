USE attendance_biometric;
SET NAMES utf8mb4;

SET @sql = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_metadata_fields' AND COLUMN_NAME='filter_control'),
  'SELECT 1',
  'ALTER TABLE crm_metadata_fields ADD COLUMN filter_control VARCHAR(40) NULL AFTER is_filterable'
);
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

UPDATE crm_metadata_fields
SET filter_control = CASE
  WHEN field_type IN ('single_select','user') THEN 'single_select'
  WHEN field_type='multi_select' THEN 'multi_select'
  WHEN field_type='boolean' THEN 'boolean'
  WHEN field_type='date' THEN 'date_range'
  WHEN field_type='datetime' THEN 'date_range'
  WHEN field_type IN ('number','decimal') THEN 'number_range'
  ELSE 'contains'
END
WHERE filter_control IS NULL;
