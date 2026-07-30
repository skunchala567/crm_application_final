USE attendance_biometric;
SET NAMES utf8mb4;

SET @sql = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_metadata_fields' AND COLUMN_NAME='is_importable'),
  'SELECT 1',
  'ALTER TABLE crm_metadata_fields ADD COLUMN is_importable BOOLEAN NOT NULL DEFAULT TRUE AFTER is_searchable'
);
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
SET @sql = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_metadata_fields' AND COLUMN_NAME='is_import_required'),
  'SELECT 1',
  'ALTER TABLE crm_metadata_fields ADD COLUMN is_import_required BOOLEAN NOT NULL DEFAULT FALSE AFTER is_importable'
);
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
SET @sql = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_metadata_fields' AND COLUMN_NAME='import_header'),
  'SELECT 1',
  'ALTER TABLE crm_metadata_fields ADD COLUMN import_header VARCHAR(160) NULL AFTER is_importable'
);
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
SET @sql = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_metadata_fields' AND COLUMN_NAME='import_sample_value'),
  'SELECT 1',
  'ALTER TABLE crm_metadata_fields ADD COLUMN import_sample_value VARCHAR(255) NULL AFTER import_header'
);
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

UPDATE crm_metadata_fields f
JOIN crm_business_units bu ON bu.id=f.business_unit_id AND bu.unit_code='school_admissions'
SET
  f.is_importable = CASE f.field_key
    WHEN 'student_name' THEN TRUE WHEN 'phone' THEN TRUE WHEN 'class_id' THEN TRUE
    WHEN 'campaign_id' THEN TRUE WHEN 'substage_id' THEN TRUE
    WHEN 'owner_employee_id' THEN TRUE WHEN 'source_id' THEN TRUE
    WHEN 'remarks' THEN TRUE ELSE FALSE END,
  f.is_import_required = CASE f.field_key
    WHEN 'student_name' THEN TRUE WHEN 'phone' THEN TRUE WHEN 'class_id' THEN TRUE
    WHEN 'campaign_id' THEN TRUE WHEN 'substage_id' THEN TRUE
    WHEN 'owner_employee_id' THEN TRUE WHEN 'source_id' THEN TRUE
    ELSE FALSE END,
  f.import_header = CASE f.field_key
    WHEN 'student_name' THEN 'Student Name'
    WHEN 'phone' THEN 'Phone'
    WHEN 'class_id' THEN 'Class ID'
    WHEN 'campaign_id' THEN 'Campaign Name'
    WHEN 'substage_id' THEN 'Sub-stage ID'
    WHEN 'owner_employee_id' THEN 'Assign To'
    WHEN 'source_id' THEN 'Source ID'
    WHEN 'remarks' THEN 'Remarks'
    ELSE f.display_name END,
  f.import_sample_value = CASE f.field_key
    WHEN 'student_name' THEN 'Rahul Kumar'
    WHEN 'phone' THEN '9876543210'
    WHEN 'remarks' THEN 'Sample lead'
    ELSE NULL END
WHERE f.module_key='leads';
