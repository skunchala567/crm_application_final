-- Scope shared CRM module history and workflows to a Business Unit.
USE attendance_biometric;
SET NAMES utf8mb4;

SET @default_business_unit_id=(
  SELECT id FROM crm_business_units WHERE unit_code='school_admissions' LIMIT 1
);

SET @has_automation_business_unit=(
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_automation_workflows' AND column_name='business_unit_id'
);
SET @sql=IF(@has_automation_business_unit=0,
  'ALTER TABLE crm_automation_workflows ADD COLUMN business_unit_id BIGINT UNSIGNED NULL AFTER id',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_marketing_campaign_business_unit=(
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_marketing_campaigns' AND column_name='business_unit_id'
);
SET @sql=IF(@has_marketing_campaign_business_unit=0,
  'ALTER TABLE crm_marketing_campaigns ADD COLUMN business_unit_id BIGINT UNSIGNED NULL AFTER id',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
UPDATE crm_marketing_campaigns SET business_unit_id=@default_business_unit_id WHERE business_unit_id IS NULL;

SET @has_marketing_campaign_business_unit_index=(
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='crm_marketing_campaigns' AND index_name='ix_crm_marketing_campaign_business_unit'
);
SET @sql=IF(@has_marketing_campaign_business_unit_index=0,
  'ALTER TABLE crm_marketing_campaigns
   MODIFY business_unit_id BIGINT UNSIGNED NOT NULL,
   ADD KEY ix_crm_marketing_campaign_business_unit (business_unit_id,created_at_utc),
   ADD CONSTRAINT fk_crm_marketing_campaign_business_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
UPDATE crm_automation_workflows SET business_unit_id=@default_business_unit_id WHERE business_unit_id IS NULL;

SET @has_automation_business_unit_index=(
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='crm_automation_workflows' AND index_name='ix_crm_automation_business_unit'
);
SET @sql=IF(@has_automation_business_unit_index=0,
  'ALTER TABLE crm_automation_workflows
   MODIFY business_unit_id BIGINT UNSIGNED NOT NULL,
   ADD KEY ix_crm_automation_business_unit (business_unit_id,created_at_utc),
   ADD CONSTRAINT fk_crm_automation_business_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_bulk_upload_business_unit=(
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_bulk_uploads' AND column_name='business_unit_id'
);
SET @sql=IF(@has_bulk_upload_business_unit=0,
  'ALTER TABLE crm_bulk_uploads ADD COLUMN business_unit_id BIGINT UNSIGNED NULL AFTER id',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
UPDATE crm_bulk_uploads SET business_unit_id=@default_business_unit_id WHERE business_unit_id IS NULL;

SET @has_bulk_upload_business_unit_index=(
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='crm_bulk_uploads' AND index_name='ix_crm_bulk_upload_business_unit'
);
SET @sql=IF(@has_bulk_upload_business_unit_index=0,
  'ALTER TABLE crm_bulk_uploads
   MODIFY business_unit_id BIGINT UNSIGNED NOT NULL,
   ADD KEY ix_crm_bulk_upload_business_unit (business_unit_id,created_at_utc),
   ADD CONSTRAINT fk_crm_bulk_upload_business_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_bulk_operation_business_unit=(
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_bulk_operations' AND column_name='business_unit_id'
);
SET @sql=IF(@has_bulk_operation_business_unit=0,
  'ALTER TABLE crm_bulk_operations ADD COLUMN business_unit_id BIGINT UNSIGNED NULL AFTER id',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
UPDATE crm_bulk_operations SET business_unit_id=@default_business_unit_id WHERE business_unit_id IS NULL;

SET @has_bulk_operation_business_unit_index=(
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='crm_bulk_operations' AND index_name='ix_crm_bulk_operation_business_unit'
);
SET @sql=IF(@has_bulk_operation_business_unit_index=0,
  'ALTER TABLE crm_bulk_operations
   MODIFY business_unit_id BIGINT UNSIGNED NOT NULL,
   ADD KEY ix_crm_bulk_operation_business_unit (business_unit_id,created_at_utc),
   ADD CONSTRAINT fk_crm_bulk_operation_business_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
