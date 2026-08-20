SET NAMES utf8mb4;

-- =====================================================================
-- Which business unit a WhatsApp conversation belongs to.
--
-- crm_whatsapp_conversations carried no business unit at all, and the inbox
-- filtered only on organization_id. Switching to a second business unit
-- therefore showed the first one's conversations: a brand-new unit with no
-- leads and no WhatsApp account of its own listed every chat in the system.
--
-- The tie is the lead. A conversation is with a person, and it is the lead
-- that says which business that person belongs to -- accounts and branches
-- do not, since neither carries a business unit.
--
-- Backfilled in two passes:
--   1. conversations already linked to a lead take that lead's unit
--   2. the rest are matched on phone number to a lead, which is how the
--      inbox links them anyway once someone opens them
-- Anything still unattributed -- an inbound from a number nobody has as a
-- lead -- falls to the default unit rather than being shown everywhere or
-- disappearing. It moves to the right unit the moment it is linked to a lead.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_whatsapp_conversations'
    AND column_name = 'business_unit_id');
SET @ddl = IF(@has_column = 0,
  'ALTER TABLE crm_whatsapp_conversations
     ADD COLUMN business_unit_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER organization_id,
     ADD INDEX ix_whatsapp_conversation_unit (business_unit_id, last_message_time)',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

-- 1. Linked conversations follow their lead.
UPDATE crm_whatsapp_conversations c
  JOIN crm_leads l ON l.id = c.lead_id
   SET c.business_unit_id = l.business_unit_id
 WHERE c.business_unit_id IS NULL AND l.business_unit_id IS NOT NULL;

-- 2. Unlinked ones are matched on the phone number. Only when that number
--    identifies exactly one business; if the same number is a lead in two
--    units the choice would be arbitrary, so it is left for pass 3.
--    The COLLATE is required: the two tables were created with different
--    default collations and MySQL refuses to compare them otherwise.
UPDATE crm_whatsapp_conversations c
   SET c.business_unit_id = (
     SELECT MIN(l.business_unit_id) FROM crm_leads l
      WHERE l.deleted_at_utc IS NULL
        AND RIGHT(REGEXP_REPLACE(l.phone, '[^0-9]', ''), 10)
          = RIGHT(REGEXP_REPLACE(c.mobile, '[^0-9]', ''), 10) COLLATE utf8mb4_unicode_ci)
 WHERE c.business_unit_id IS NULL
   AND (SELECT COUNT(DISTINCT l.business_unit_id) FROM crm_leads l
         WHERE l.deleted_at_utc IS NULL
           AND RIGHT(REGEXP_REPLACE(l.phone, '[^0-9]', ''), 10)
          = RIGHT(REGEXP_REPLACE(c.mobile, '[^0-9]', ''), 10) COLLATE utf8mb4_unicode_ci) = 1;

-- 3. Whatever is left belongs to the default unit until a lead claims it.
UPDATE crm_whatsapp_conversations
   SET business_unit_id = (SELECT id FROM crm_business_units WHERE is_default = TRUE ORDER BY id LIMIT 1)
 WHERE business_unit_id IS NULL;
