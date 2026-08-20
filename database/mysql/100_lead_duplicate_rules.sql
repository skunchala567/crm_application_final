SET NAMES utf8mb4;

-- =====================================================================
-- What makes two leads the same lead.
--
-- Every creation path asked the same hardcoded question: same business
-- unit, same branch, same mobile number. That is the right question for a
-- school taking admissions branch by branch, and the wrong one almost
-- everywhere else -- a unit selling courses cares about the course and the
-- academic year, not the branch, and one operating from a single office has
-- no branch worth comparing.
--
-- The rule becomes a per-unit setting: an ordered list of field keys that
-- are ANDed together. NULL means "behave as before", so a unit that is
-- never configured keeps branch + mobile exactly as it is today.
--
-- Stored as JSON rather than columns because the list is variable-length
-- and its members differ per unit -- a school unit picks from branch and
-- its academic configuration, another unit from branch and whatever
-- configuration sections it has defined.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

SET @has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_business_units' AND column_name='duplicate_rule_json');
SET @ddl = IF(@has=0,
  'ALTER TABLE crm_business_units ADD COLUMN duplicate_rule_json JSON NULL AFTER manual_lead_defaults_json',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
