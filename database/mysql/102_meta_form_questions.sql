SET NAMES utf8mb4;

-- =====================================================================
-- The questions a Meta lead form asks, and every answer a lead gave.
--
-- Two gaps, both the same shape: information Meta already sends that the
-- CRM was reading once and then throwing away.
--
-- 1. crm_meta_forms.questions_json
--    A form's questions were fetched on every sync and used only to build
--    the response, so nothing on screen could offer them. field_mapping
--    could therefore only ever list questions that were already mapped --
--    and with none mapped, there was nothing to map from. Storing the
--    question list is what makes the mapping editor possible.
--
-- 2. Answers on the lead
--    No column is added for this. A form can ask anything, and two forms
--    rarely ask the same thing, so a column per question would mean a
--    schema change for every new campaign. The answers go into the
--    crm_leads.custom_values_json blob the lead already carries, under one
--    key -- one column, any form, no migration when a form changes.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

SET @has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_meta_forms' AND column_name='questions_json');
SET @ddl = IF(@has=0,
  'ALTER TABLE crm_meta_forms ADD COLUMN questions_json JSON NULL AFTER field_mapping',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------
-- Repair the leads imported before answers were kept.
--
-- Their ledger row still holds the full payload Meta sent, so the answers
-- are recoverable rather than lost. Additive only: one key is set inside
-- the JSON the lead already carries, and a lead that already has it is
-- skipped, so a replay cannot overwrite anything.
-- ---------------------------------------------------------------------
UPDATE crm_leads l
  JOIN crm_meta_lead_imports i
    ON i.lead_id = l.id AND i.status = 'imported'
   SET l.custom_values_json = JSON_SET(
         COALESCE(l.custom_values_json, JSON_OBJECT()),
         '$.metaAnswers',
         (SELECT JSON_ARRAYAGG(JSON_OBJECT('question', answers.name, 'answer', answers.value))
            FROM JSON_TABLE(
                   i.raw_payload,
                   '$.field_data[*]' COLUMNS (
                     name  VARCHAR(255)  PATH '$.name',
                     value VARCHAR(1000) PATH '$.values[0]'
                   )
                 ) AS answers))
 WHERE JSON_EXTRACT(l.custom_values_json, '$.metaAnswers') IS NULL
   AND JSON_LENGTH(i.raw_payload, '$.field_data') > 0;
