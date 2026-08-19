USE attendance_biometric;
SET NAMES utf8mb4;

-- =====================================================================
-- Telling one payment from another.
--
-- Everything the CRM collects reaches Jodo as the branch's single
-- application_payment_component -- "Payable Amount" on both live branches --
-- so a settlement shows a column of identical rows and there is no way to
-- say which link or form credited which amount. Two columns fix the two
-- halves of that:
--
--   crm_payment_forms.jodo_component_type
--     The component this form's payments book against at Jodo, overriding
--     the branch default. Jodo validates this against the components
--     configured on the collector -- it answered "Invalid component type
--     Payment" when sent one that was not -- so it is a chosen name, not
--     free text, and NULL keeps the branch behaviour every existing form
--     has today.
--
--   crm_leads.enquiry_form_id
--     Which public enquiry form produced the lead. The CRM could not answer
--     that at all: the form name was written into the remarks sentence and
--     nowhere else, so a payment taken on an enquiry form could not be
--     traced back to the form in a report.
--
-- No foreign key on enquiry_form_id. A lead outlives the form that created
-- it -- deleting a form must not put the lead's history at risk -- and the
-- column is read for display, never joined on for correctness.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_payment_forms'
    AND column_name = 'jodo_component_type');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE crm_payment_forms
     ADD COLUMN jodo_component_type VARCHAR(120) NULL DEFAULT NULL
     AFTER logo_url',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_leads'
    AND column_name = 'enquiry_form_id');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE crm_leads
     ADD COLUMN enquiry_form_id BIGINT UNSIGNED NULL DEFAULT NULL',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

-- Joined from the collections report, once per row.
SET @has_index = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'crm_leads'
    AND index_name = 'ix_lead_enquiry_form');
SET @ddl = IF(@has_index = 0,
  'ALTER TABLE crm_leads ADD INDEX ix_lead_enquiry_form (enquiry_form_id)',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;
