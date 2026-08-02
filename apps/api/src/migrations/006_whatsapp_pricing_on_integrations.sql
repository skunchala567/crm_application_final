SET @has_utility_price = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'crm_integrations'
    AND column_name = 'whatsapp_utility_message_price'
);

SET @sql = IF(
  @has_utility_price = 0,
  'ALTER TABLE crm_integrations ADD COLUMN whatsapp_utility_message_price DECIMAL(10,4) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_marketing_price = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'crm_integrations'
    AND column_name = 'whatsapp_marketing_message_price'
);

SET @sql = IF(
  @has_marketing_price = 0,
  'ALTER TABLE crm_integrations ADD COLUMN whatsapp_marketing_message_price DECIMAL(10,4) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
