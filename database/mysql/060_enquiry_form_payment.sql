SET NAMES utf8mb4;

-- =====================================================================
-- Move the "should we collect a payment" decision onto the enquiry form.
--
-- Previously a branch-level flag (branches.jodo_payment_enabled) decided
-- both WHETHER to collect and, via branches.application_amount, HOW MUCH.
-- That made every form on a branch behave the same way.
--
-- Now the form owns the decision and the amount; the branch keeps only the
-- Jodo credentials, i.e. whether collection is technically possible.
--
-- payment_amount NULL means "fall back to branches.application_amount", so
-- forms created before this migration keep their current behaviour.
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

SET @has_payment_required = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_public_enquiry_forms' AND column_name='payment_required');
SET @ddl = IF(@has_payment_required=0,
  'ALTER TABLE crm_public_enquiry_forms ADD COLUMN payment_required BOOLEAN NOT NULL DEFAULT FALSE AFTER redirect_url',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_payment_amount = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_public_enquiry_forms' AND column_name='payment_amount');
SET @ddl = IF(@has_payment_amount=0,
  'ALTER TABLE crm_public_enquiry_forms ADD COLUMN payment_amount DECIMAL(10,2) NULL AFTER payment_required',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

-- Carry the existing behaviour forward: forms whose default branch already
-- collects payment start out with payment_required = TRUE, so nothing that
-- works today stops working after the flag leaves the branch UI.
SET @has_branch_flag = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='branches' AND column_name='jodo_payment_enabled');
SET @ddl = IF(@has_branch_flag=1,
  'UPDATE crm_public_enquiry_forms f
      JOIN branches b ON b.id = f.default_branch_id
       SET f.payment_required = TRUE
     WHERE b.jodo_payment_enabled = TRUE
       AND f.payment_required = FALSE',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;
