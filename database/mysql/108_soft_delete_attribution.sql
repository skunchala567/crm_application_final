SET NAMES utf8mb4;

-- =====================================================================
-- Who deleted a record, beside when.
--
-- Deleting a lead has always been a soft delete -- crm_leads.deleted_at_utc
-- is set and every read filters on it -- so the row survives for reference.
-- What it did not record is who did it: updated_by_user_id was overwritten
-- by the delete, which is not the same statement and is lost the moment
-- anything else touches the row.
--
-- The same gap exists on integration accounts: crm_integrations.deleted_at
-- has always been there, but nothing said who disconnected the account, and
-- the product's own "delete" only flipped status without ever setting it.
--
-- Both columns stay NULL for rows deleted before this migration: there is no
-- honest value for them, and inventing the current administrator would be
-- worse than an empty field.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. crm_leads.deleted_by_user_id
-- ---------------------------------------------------------------------
SET @has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_leads' AND column_name='deleted_by_user_id');
SET @ddl = IF(@has=0,
  'ALTER TABLE crm_leads ADD COLUMN deleted_by_user_id BIGINT UNSIGNED NULL AFTER deleted_at_utc',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

-- "What was deleted, and by whom" is the only way this column is read.
SET @has = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='crm_leads' AND index_name='ix_crm_leads_deleted_by');
SET @ddl = IF(@has=0,
  'ALTER TABLE crm_leads ADD INDEX ix_crm_leads_deleted_by (deleted_at_utc, deleted_by_user_id)',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

/*
 * The user record going does not take the deletion history with it.
 *
 * ON DELETE SET NULL, not CASCADE: cascading here would delete the *lead*
 * because one of its columns pointed at a departed user, which is the exact
 * opposite of what a soft delete is for.
 */
SET @has = (SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE table_schema=DATABASE() AND table_name='crm_leads'
    AND constraint_name='fk_crm_leads_deleted_by' AND constraint_type='FOREIGN KEY');
SET @ddl = IF(@has=0,
  'ALTER TABLE crm_leads ADD CONSTRAINT fk_crm_leads_deleted_by
     FOREIGN KEY (deleted_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

-- ---------------------------------------------------------------------
-- 2. crm_integrations.deleted_by
--
-- INT and unconstrained, matching created_by and updated_by on the same
-- legacy table rather than introducing the only foreign key it has.
-- ---------------------------------------------------------------------
SET @has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_integrations' AND column_name='deleted_by');
SET @ddl = IF(@has=0,
  'ALTER TABLE crm_integrations ADD COLUMN deleted_by INT NULL AFTER deleted_at',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;
