SET NAMES utf8mb4;

-- A lead may arrive before anyone knows which branch it belongs to.
--
-- crm_leads.branch_id was NOT NULL, so an enquiry that could not be attributed
-- to a branch could not be recorded at all. That is the wrong trade: an
-- inbound WhatsApp message from an unknown number, on an account nobody has
-- configured a branch for, was dropped entirely -- the auto-create path failed
-- with "Column 'branch_id' cannot be null" and the enquiry was lost.
--
-- Capturing it with an empty branch is strictly better. It stays out of every
-- branch-scoped counsellor's list, because scopedWhere() filters on
-- `branch_id IN (...)` and NULL matches nothing, and an administrator can see
-- it and assign the branch. The lead list and detail queries LEFT JOIN
-- branches so these rows are not silently filtered out.
--
-- Existing rows are unaffected: every current lead already has a branch.
SET @nullable = (
  SELECT is_nullable FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_leads' AND column_name = 'branch_id'
);
SET @sql = IF(@nullable = 'NO',
  'ALTER TABLE crm_leads MODIFY branch_id BIGINT UNSIGNED NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
