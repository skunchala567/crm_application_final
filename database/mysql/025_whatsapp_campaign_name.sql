SET @has_whatsapp_campaign_name = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'crm_whatsapp_messages'
    AND COLUMN_NAME = 'campaign_name'
);
SET @add_whatsapp_campaign_name_sql = IF(
  @has_whatsapp_campaign_name > 0,
  'SELECT 1',
  'ALTER TABLE crm_whatsapp_messages ADD COLUMN campaign_name VARCHAR(255) NULL AFTER template_name'
);
PREPARE add_whatsapp_campaign_name_statement FROM @add_whatsapp_campaign_name_sql;
EXECUTE add_whatsapp_campaign_name_statement;
DEALLOCATE PREPARE add_whatsapp_campaign_name_statement;
