-- BonVoice branch DID/channel mapping. Credentials remain encrypted in crm_integrations.config.
SET @has_did=(SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='branches' AND column_name='bonvoice_did_number');
SET @sql=IF(@has_did=0,'ALTER TABLE branches ADD COLUMN bonvoice_did_number VARCHAR(30) NULL, ADD COLUMN bonvoice_channel_id VARCHAR(30) NULL, ADD COLUMN bonvoice_inbound_enabled TINYINT(1) NOT NULL DEFAULT 1, ADD COLUMN bonvoice_outbound_enabled TINYINT(1) NOT NULL DEFAULT 1','SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has_agent=(SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='app_users' AND column_name='bonvoice_agent_number');
SET @sql=IF(@has_agent=0,'ALTER TABLE app_users ADD COLUMN bonvoice_agent_number VARCHAR(30) NULL, ADD COLUMN bonvoice_enabled TINYINT(1) NOT NULL DEFAULT 0','SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
