-- Business-unit defaults used only to prefill the authenticated manual Add Lead form.
-- Values remain editable by the user before the lead is saved.
SET @has_manual_lead_defaults = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'crm_business_units'
    AND column_name = 'manual_lead_defaults_json'
);
SET @manual_lead_defaults_sql = IF(
  @has_manual_lead_defaults = 0,
  'ALTER TABLE crm_business_units ADD COLUMN manual_lead_defaults_json JSON NULL AFTER deletion_password_hash',
  'SELECT 1'
);
PREPARE manual_lead_defaults_stmt FROM @manual_lead_defaults_sql;
EXECUTE manual_lead_defaults_stmt;
DEALLOCATE PREPARE manual_lead_defaults_stmt;
