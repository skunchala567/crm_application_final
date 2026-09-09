-- BonVoice DID inventory and many-to-many branch routing.
-- Idempotent because the migration runner replays every numbered file.

CREATE TABLE IF NOT EXISTS crm_bonvoice_dids (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  integration_id INT NOT NULL,
  did_number VARCHAR(30) NOT NULL,
  label VARCHAR(120) NULL,
  channel_id VARCHAR(30) NOT NULL DEFAULT '1',
  inbound_enabled TINYINT(1) NOT NULL DEFAULT 1,
  outbound_enabled TINYINT(1) NOT NULL DEFAULT 1,
  primary_branch_id BIGINT UNSIGNED NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_bonvoice_integration_did (integration_id, did_number),
  KEY ix_bonvoice_did_primary_branch (primary_branch_id),
  CONSTRAINT fk_bonvoice_did_integration FOREIGN KEY (integration_id) REFERENCES crm_integrations(id) ON DELETE CASCADE,
  CONSTRAINT fk_bonvoice_did_primary_branch FOREIGN KEY (primary_branch_id) REFERENCES mse_hrm_branches(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_bonvoice_did_branches (
  did_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NOT NULL,
  is_primary_outbound TINYINT(1) NOT NULL DEFAULT 0,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (did_id, branch_id),
  KEY ix_bonvoice_branch_outbound (branch_id, is_primary_outbound),
  CONSTRAINT fk_bonvoice_mapping_did FOREIGN KEY (did_id) REFERENCES crm_bonvoice_dids(id) ON DELETE CASCADE,
  CONSTRAINT fk_bonvoice_mapping_branch FOREIGN KEY (branch_id) REFERENCES mse_hrm_branches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Preserve the legacy per-branch mappings. INSERT IGNORE makes replays safe.
INSERT IGNORE INTO crm_bonvoice_dids
  (integration_id, did_number, label, channel_id, inbound_enabled, outbound_enabled, primary_branch_id, is_active)
SELECT i.id, b.bonvoice_did_number, CONCAT('Migrated ', MIN(b.branch_name)),
       COALESCE(NULLIF(MIN(b.bonvoice_channel_id), ''), '1'),
       MAX(b.bonvoice_inbound_enabled), MAX(b.bonvoice_outbound_enabled), MIN(b.id), 1
  FROM mse_hrm_branches b
  JOIN crm_integrations i ON LOWER(i.provider)='bonvoice' AND i.deleted_at IS NULL
 WHERE NULLIF(b.bonvoice_did_number, '') IS NOT NULL
 GROUP BY i.id, b.bonvoice_did_number;

INSERT IGNORE INTO crm_bonvoice_did_branches (did_id, branch_id, is_primary_outbound)
SELECT d.id, b.id,
       IF(b.id=(SELECT MIN(b2.id) FROM mse_hrm_branches b2 WHERE b2.bonvoice_did_number=b.bonvoice_did_number),1,0)
  FROM mse_hrm_branches b
  JOIN crm_bonvoice_dids d ON BINARY d.did_number=BINARY b.bonvoice_did_number
  JOIN crm_integrations i ON i.id=d.integration_id AND LOWER(i.provider)='bonvoice'
 WHERE NULLIF(b.bonvoice_did_number, '') IS NOT NULL;

SET @has_call_branch = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_call_activities' AND column_name='branch_id');
SET @ddl = IF(@has_call_branch=0,
  'ALTER TABLE crm_call_activities ADD COLUMN branch_id BIGINT UNSIGNED NULL AFTER business_unit_id, ADD KEY ix_calls_branch_time (branch_id, created_at_utc)',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_routing_reason = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_call_activities' AND column_name='routing_reason');
SET @ddl = IF(@has_routing_reason=0,
  'ALTER TABLE crm_call_activities ADD COLUMN routing_reason VARCHAR(40) NULL AFTER branch_id',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;
