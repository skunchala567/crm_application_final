SET @has_lead_source_unique = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE()
    AND table_name='crm_lead_source_history'
    AND index_name='uk_crm_lead_source'
);
SET @ddl = IF(
  @has_lead_source_unique=0,
  'ALTER TABLE crm_lead_source_history ADD UNIQUE KEY uk_crm_lead_source (lead_id,source_id)',
  'SELECT 1'
);
PREPARE statement FROM @ddl;
EXECUTE statement;
DEALLOCATE PREPARE statement;
