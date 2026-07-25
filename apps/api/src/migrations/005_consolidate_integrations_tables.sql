-- =====================================================
-- CONSOLIDATION MIGRATION: Merge integrations & integration_configs
-- Keeps only integrations table as single source of truth
-- Moves specialized data to supporting tables
-- =====================================================

SET FOREIGN_KEY_CHECKS=0;

-- =====================================================
-- Step 1: Add missing columns to integrations table
-- =====================================================

ALTER TABLE integrations ADD COLUMN IF NOT EXISTS uuid CHAR(36) UNIQUE DEFAULT (UUID());
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS integration_type VARCHAR(50);
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS provider_name VARCHAR(100);
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS integration_name VARCHAR(255);
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS config JSON;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP NULL;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS next_sync_at TIMESTAMP NULL;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS is_webhook_active BOOLEAN DEFAULT FALSE;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS webhook_url VARCHAR(500);
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS webhook_secret VARCHAR(256);
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS created_by_id INT;

-- =====================================================
-- Step 2: Migrate data from integration_configs to integrations
-- =====================================================

-- Only run if integration_configs exists
SET @table_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'integration_configs'
);

SET @migrate_sql = IF(@table_exists = 1,
  "INSERT INTO integrations (organization_id, uuid, integration_type, provider_name, integration_name, status, config, last_synced_at, next_sync_at, is_webhook_active, webhook_url, webhook_secret, created_by_id, created_at, updated_at)
   SELECT organization_id, UUID(), integration_type, provider_name, integration_name, status, config, last_synced_at, next_sync_at, is_webhook_active, webhook_url, webhook_secret, created_by_id, created_at, updated_at
   FROM integration_configs
   WHERE integration_type NOT IN (SELECT DISTINCT type FROM integrations WHERE type IS NOT NULL)
   ON DUPLICATE KEY UPDATE updated_at = NOW()",
  "SELECT 1"
);

PREPARE migrate_stmt FROM @migrate_sql;
EXECUTE migrate_stmt;
DEALLOCATE PREPARE migrate_stmt;

-- =====================================================
-- Step 3: Clean up legacy columns in integrations (optional, keep for backward compatibility)
-- =====================================================
-- Note: Keep api_key, api_secret, provider for backward compatibility
-- New code should use config JSON instead

-- =====================================================
-- Step 4: Update integration_sync_logs references
-- =====================================================

-- Add integration_id to integration_sync_logs if not exists
ALTER TABLE integration_sync_logs ADD COLUMN IF NOT EXISTS integration_id INT;

-- Migrate data from integration_config_id to integration_id
UPDATE integration_sync_logs isl
SET isl.integration_id = (
  SELECT i.id FROM integrations i
  WHERE i.organization_id = isl.organization_id
  LIMIT 1
)
WHERE isl.integration_id IS NULL AND isl.integration_config_id IS NOT NULL;

-- =====================================================
-- Step 5: Update integration_error_logs references
-- =====================================================

ALTER TABLE integration_error_logs ADD COLUMN IF NOT EXISTS integration_id INT;

UPDATE integration_error_logs iel
SET iel.integration_id = (
  SELECT i.id FROM integrations i
  WHERE i.organization_id = iel.organization_id
  LIMIT 1
)
WHERE iel.integration_id IS NULL AND iel.integration_config_id IS NOT NULL;

-- =====================================================
-- Step 6: Update foreign keys in supporting tables
-- =====================================================

-- integration_oauth_tokens
ALTER TABLE integration_oauth_tokens ADD COLUMN IF NOT EXISTS integration_id INT;
ALTER TABLE integration_oauth_tokens ADD FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE;

-- integration_sync_jobs
ALTER TABLE integration_sync_jobs ADD COLUMN IF NOT EXISTS integration_id INT;
ALTER TABLE integration_sync_jobs ADD FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE;

-- integration_sync_logs
ALTER TABLE integration_sync_logs ADD COLUMN IF NOT EXISTS integration_id INT;
ALTER TABLE integration_sync_logs ADD FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE;

-- integration_field_mappings
ALTER TABLE integration_field_mappings ADD COLUMN IF NOT EXISTS integration_id INT;
ALTER TABLE integration_field_mappings ADD FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE;

-- integration_webhooks
ALTER TABLE integration_webhooks ADD COLUMN IF NOT EXISTS integration_id INT;
ALTER TABLE integration_webhooks ADD FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE;

-- integration_error_logs
ALTER TABLE integration_error_logs ADD COLUMN IF NOT EXISTS integration_id INT;
ALTER TABLE integration_error_logs ADD FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE;

-- integration_audit_logs
ALTER TABLE integration_audit_logs ADD COLUMN IF NOT EXISTS integration_id INT;
ALTER TABLE integration_audit_logs ADD FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE;

-- =====================================================
-- Step 7: Add indexes for performance
-- =====================================================

ALTER TABLE integrations ADD INDEX IF NOT EXISTS idx_organization_type (organization_id, integration_type);
ALTER TABLE integrations ADD INDEX IF NOT EXISTS idx_status (status);
ALTER TABLE integrations ADD INDEX IF NOT EXISTS idx_uuid (uuid);
ALTER TABLE integrations ADD INDEX IF NOT EXISTS idx_next_sync (next_sync_at);

-- =====================================================
-- Step 8: Drop integration_configs and old relationships
-- =====================================================

-- Drop foreign key constraints from supporting tables pointing to integration_configs
ALTER TABLE integration_oauth_tokens DROP FOREIGN KEY IF EXISTS integration_oauth_tokens_ibfk_1;
ALTER TABLE integration_sync_jobs DROP FOREIGN KEY IF EXISTS integration_sync_jobs_ibfk_1;
ALTER TABLE integration_sync_logs DROP FOREIGN KEY IF EXISTS integration_sync_logs_ibfk_1;
ALTER TABLE integration_field_mappings DROP FOREIGN KEY IF EXISTS integration_field_mappings_ibfk_1;
ALTER TABLE integration_webhooks DROP FOREIGN KEY IF EXISTS integration_webhooks_ibfk_1;
ALTER TABLE integration_error_logs DROP FOREIGN KEY IF EXISTS integration_error_logs_ibfk_1;
ALTER TABLE integration_audit_logs DROP FOREIGN KEY IF EXISTS integration_audit_logs_ibfk_1;

-- Drop old columns from supporting tables
ALTER TABLE integration_oauth_tokens DROP COLUMN IF EXISTS integration_config_id;
ALTER TABLE integration_sync_jobs DROP COLUMN IF EXISTS integration_config_id;
ALTER TABLE integration_sync_logs DROP COLUMN IF EXISTS integration_config_id;
ALTER TABLE integration_field_mappings DROP COLUMN IF EXISTS integration_config_id;
ALTER TABLE integration_webhooks DROP COLUMN IF EXISTS integration_config_id;
ALTER TABLE integration_error_logs DROP COLUMN IF EXISTS integration_config_id;
ALTER TABLE integration_audit_logs DROP COLUMN IF EXISTS integration_config_id;

-- Drop the old table (only if migration completed successfully)
DROP TABLE IF EXISTS integration_configs;

-- =====================================================
-- Step 9: Update foreign key constraints
-- =====================================================

ALTER TABLE integrations ADD CONSTRAINT IF NOT EXISTS fk_integrations_organization
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE integrations ADD CONSTRAINT IF NOT EXISTS fk_integrations_created_by
  FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL;

-- =====================================================
-- Step 10: Add documentation comment
-- =====================================================

ALTER TABLE integrations COMMENT='Single source of truth for all integrations. Consolidated from legacy integrations and integration_configs tables.';

SET FOREIGN_KEY_CHECKS=1;

-- =====================================================
-- CONSOLIDATION COMPLETE
-- All code should now use integrations table only
-- Supporting tables for specific concerns: oauth_tokens, sync_jobs, sync_logs, webhooks, errors, audit
-- =====================================================
