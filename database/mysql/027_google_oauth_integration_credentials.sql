SET @has_google_client_id = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_integrations' AND COLUMN_NAME = 'google_client_id'
);
SET @sql = IF(
  @has_google_client_id = 0,
  'ALTER TABLE crm_integrations ADD COLUMN google_client_id VARCHAR(500) NULL AFTER media_public_base_url',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_google_client_secret = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_integrations' AND COLUMN_NAME = 'google_client_secret'
);
SET @sql = IF(
  @has_google_client_secret = 0,
  'ALTER TABLE crm_integrations ADD COLUMN google_client_secret VARCHAR(500) NULL AFTER google_client_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_google_redirect_uri = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_integrations' AND COLUMN_NAME = 'google_redirect_uri'
);
SET @sql = IF(
  @has_google_redirect_uri = 0,
  'ALTER TABLE crm_integrations ADD COLUMN google_redirect_uri VARCHAR(1000) NULL AFTER google_client_secret',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE crm_integrations
SET
  google_client_id = COALESCE(
    NULLIF(google_client_id, ''),
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config, '$.clientId')), '')
  ),
  google_client_secret = COALESCE(
    NULLIF(google_client_secret, ''),
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config, '$.clientSecret')), '')
  ),
  google_redirect_uri = COALESCE(
    NULLIF(google_redirect_uri, ''),
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config, '$.redirectUrl')), '')
  )
WHERE LOWER(COALESCE(provider, '')) = 'google_sheets'
  AND JSON_VALID(config);

UPDATE crm_integrations
SET config = JSON_REMOVE(config, '$.clientId', '$.clientSecret', '$.redirectUrl')
WHERE LOWER(COALESCE(provider, '')) = 'google_sheets'
  AND JSON_VALID(config);
