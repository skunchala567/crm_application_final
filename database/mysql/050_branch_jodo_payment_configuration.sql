USE attendance_biometric;
SET NAMES utf8mb4;

SET @has_payment_enabled=(SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='branches' AND column_name='jodo_payment_enabled');
SET @sql=IF(@has_payment_enabled=0,'ALTER TABLE branches
 ADD COLUMN jodo_payment_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 ADD COLUMN jodo_api_key VARCHAR(255) NULL,
 ADD COLUMN jodo_secret_key VARCHAR(255) NULL,
 ADD COLUMN jodo_collector_code VARCHAR(100) NULL,
 ADD COLUMN application_amount DECIMAL(12,2) NULL,
 ADD COLUMN application_stage_id BIGINT UNSIGNED NULL,
 ADD COLUMN application_payment_component VARCHAR(120) NOT NULL DEFAULT ''Payable Amount'',
 ADD KEY ix_branches_application_stage(application_stage_id),
 ADD CONSTRAINT fk_branches_application_stage FOREIGN KEY(application_stage_id) REFERENCES crm_lead_stages(id) ON DELETE SET NULL', 'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_jodo_order_id=(SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='crm_leads' AND column_name='jodo_order_id');
SET @sql=IF(@has_jodo_order_id=0,'ALTER TABLE crm_leads
 ADD COLUMN jodo_order_id VARCHAR(120) NULL,
 ADD COLUMN application_payment_status VARCHAR(40) NULL,
 ADD COLUMN application_payment_amount DECIMAL(12,2) NULL,
 ADD COLUMN application_payment_at_utc DATETIME(6) NULL,
 ADD KEY ix_crm_leads_jodo_order(jodo_order_id)', 'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
