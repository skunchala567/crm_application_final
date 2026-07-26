SET @has_aisensy_base_url = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_integrations' AND COLUMN_NAME = 'aisensy_base_url'
);
SET @sql = IF(
  @has_aisensy_base_url = 0,
  'ALTER TABLE crm_integrations ADD COLUMN aisensy_base_url VARCHAR(500) NULL AFTER project_api_password',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_aisensy_api_key = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_integrations' AND COLUMN_NAME = 'aisensy_api_key'
);
SET @sql = IF(
  @has_aisensy_api_key = 0,
  'ALTER TABLE crm_integrations ADD COLUMN aisensy_api_key VARCHAR(500) NULL AFTER aisensy_base_url',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_media_public_base_url = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_integrations' AND COLUMN_NAME = 'media_public_base_url'
);
SET @sql = IF(
  @has_media_public_base_url = 0,
  'ALTER TABLE crm_integrations ADD COLUMN media_public_base_url VARCHAR(500) NULL AFTER aisensy_api_key',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE crm_integrations
SET
  aisensy_base_url = COALESCE(
    NULLIF(aisensy_base_url, ''),
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config, '$.baseUrl')), ''),
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config, '$.aisensyBaseUrl')), '')
  ),
  aisensy_api_key = COALESCE(
    NULLIF(aisensy_api_key, ''),
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config, '$.apiKey')), ''),
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config, '$.aisensyApiKey')), '')
  ),
  media_public_base_url = COALESCE(
    NULLIF(media_public_base_url, ''),
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config, '$.mediaPublicBaseUrl')), '')
  )
WHERE LOWER(COALESCE(provider, '')) = 'smartping'
  AND JSON_VALID(config);

UPDATE crm_integrations
SET config = JSON_REMOVE(
  config,
  '$.projectId',
  '$.project_id',
  '$.projectApiPassword',
  '$.project_api_password',
  '$.baseUrl',
  '$.aisensyBaseUrl',
  '$.apiKey',
  '$.aisensyApiKey',
  '$.mediaPublicBaseUrl'
)
WHERE LOWER(COALESCE(provider, '')) = 'smartping'
  AND JSON_VALID(config);
