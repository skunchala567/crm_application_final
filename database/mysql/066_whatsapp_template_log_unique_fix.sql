USE attendance_biometric;
SET NAMES utf8mb4;

-- =====================================================================
-- Let a template have more than one log entry.
--
-- crm_whatsapp_template_logs carries a UNIQUE index on
-- aisensy_template_id, which allows exactly one row per template for all
-- time. It is a log: a template is created, updated, synced, its status
-- changes and it is eventually deleted, and each of those is an event.
--
-- The effect was that deleting a template failed outright --
--   Duplicate entry '6a76f1df...' for key 'unique_aisensy_template_id'
-- -- because the delete tried to log an event against a template that had
-- already logged its creation.
--
-- A non-unique index on the same column (idx_aisensy_template_id) already
-- exists, so lookups keep their index and nothing else changes.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

SET @has_unique = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='crm_whatsapp_template_logs'
    AND index_name='unique_aisensy_template_id');
SET @ddl = IF(@has_unique>0,
  'ALTER TABLE crm_whatsapp_template_logs DROP INDEX unique_aisensy_template_id',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

-- Keep a plain index for the lookups that used the unique one.
SET @has_plain = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='crm_whatsapp_template_logs'
    AND index_name='idx_aisensy_template_id');
SET @ddl = IF(@has_plain=0,
  'ALTER TABLE crm_whatsapp_template_logs ADD INDEX idx_aisensy_template_id (aisensy_template_id)',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;
