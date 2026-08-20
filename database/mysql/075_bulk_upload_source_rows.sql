SET NAMES utf8mb4;

-- Retain the exact uploaded values so audit exports can reproduce the input
-- file and append processing status without reconstructing rows from leads.
SET @has_source_data = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE()
    AND table_name='crm_bulk_upload_records'
    AND column_name='source_data_json'
);
SET @sql = IF(@has_source_data=0,
  'ALTER TABLE crm_bulk_upload_records ADD COLUMN source_data_json JSON NULL AFTER created_lead_number',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
