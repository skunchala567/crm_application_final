-- =====================================================================
-- Which telephony provider a branch actually calls through.
--
-- Two providers can be configured on one branch -- CallerDesk and Smartflo
-- both have their own DID and enable flags -- so "which one is live" had no
-- answer until this column existed. It is derived once from whichever DID is
-- present, and the flags belonging to the other provider are cleared so a
-- stale enable cannot make a branch dial through a provider it no longer
-- uses.
--
-- Idempotent, and deliberately more careful than a guarded ALTER alone: the
-- backfill runs ONLY on the run that adds the column. The migration runner
-- replays every file on every run, and re-deriving the provider from the DID
-- numbers would silently overwrite a choice an administrator has since made
-- in Branches & payments. @needs_backfill is read before the column exists,
-- which is what makes "first run only" expressible in plain SQL.
--
-- This file was previously a bare ALTER TABLE. It failed with "Duplicate
-- column name" on the second run and stopped the runner, so every migration
-- after it stopped being applied.
-- =====================================================================

SET @needs_backfill = (SELECT COUNT(*) = 0 FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'branches' AND column_name = 'calling_provider');

SET @ddl = IF(@needs_backfill,
  'ALTER TABLE branches ADD COLUMN calling_provider ENUM(''none'',''callerdesk'',''smartflo'') NOT NULL DEFAULT ''none''',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

-- Derived from whichever DID the branch already had. Smartflo wins where both
-- are present: it is the newer integration, and a branch that has been moved
-- to it keeps its old CallerDesk number on file.
SET @ddl = IF(@needs_backfill,
  'UPDATE branches SET calling_provider = CASE
     WHEN smartflo_did_number IS NOT NULL AND smartflo_did_number <> '''' THEN ''smartflo''
     WHEN callerdesk_did_number IS NOT NULL AND callerdesk_did_number <> '''' THEN ''callerdesk''
     ELSE ''none''
   END',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

-- The unselected provider's enable flags default to 1, so without this a
-- branch on Smartflo would still look inbound-enabled on CallerDesk.
SET @ddl = IF(@needs_backfill,
  'UPDATE branches SET
     callerdesk_inbound_enabled  = IF(calling_provider = ''callerdesk'', callerdesk_inbound_enabled, 0),
     callerdesk_outbound_enabled = IF(calling_provider = ''callerdesk'', callerdesk_outbound_enabled, 0),
     smartflo_inbound_enabled    = IF(calling_provider = ''smartflo'', smartflo_inbound_enabled, 0),
     smartflo_outbound_enabled   = IF(calling_provider = ''smartflo'', smartflo_outbound_enabled, 0)',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;
