SET NAMES utf8mb4;

-- =====================================================================
-- Bring the payment form tables in line with what the API writes.
--
-- 055_payment_forms.sql describes these three tables, but they already
-- existed from an earlier design when it first ran -- and every statement in
-- it is CREATE TABLE IF NOT EXISTS, so it did nothing at all. The tables kept
-- the old shape while the routes were written against the new one, and the
-- mismatch only surfaces when a statement actually names a missing column:
--
--   crm_payment_forms.selection_type
--     Creating a payment form fails outright with
--       Unknown column 'selection_type' in 'field list'
--     The live table instead carries amount_type / fixed_amount /
--     variable_amounts_json from the older per-form amount model. Those are
--     left alone: they are NOT NULL with defaults, so they do not block the
--     insert, and dropping columns is not something to do blind.
--
--   crm_payment_form_submissions.selected_categories_json
--     The same fault one step later. Nobody has hit it because no payment has
--     been submitted yet (the table is empty), but the public submit endpoint
--     names this column, so the first customer to pay would have failed after
--     Jodo had already taken the money.
--
-- Added as NULL rather than the NOT NULL that 055 declares: an environment
-- that already has submission rows cannot take a NOT NULL JSON column (JSON
-- accepts no literal default in MySQL 8), and the API always supplies a value.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

-- 1. crm_payment_forms.selection_type -- one category per form, or several.
SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_payment_forms'
    AND column_name = 'selection_type');
SET @ddl = IF(@has_column = 0,
  "ALTER TABLE crm_payment_forms
     ADD COLUMN selection_type ENUM('single','multiple') NOT NULL DEFAULT 'single'
     AFTER description",
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

-- 2. crm_payment_form_submissions.selected_categories_json -- what the payer
--    actually chose, kept with the submission so a later change to the form's
--    categories cannot rewrite history.
SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_payment_form_submissions'
    AND column_name = 'selected_categories_json');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE crm_payment_form_submissions
     ADD COLUMN selected_categories_json JSON NULL
     AFTER student_name',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;
