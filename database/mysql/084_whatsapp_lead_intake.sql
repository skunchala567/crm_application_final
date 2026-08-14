USE attendance_biometric;
SET NAMES utf8mb4;

-- Where a lead created from an inbound WhatsApp message should land.
--
-- The webhook already turns a message from an unknown number into a lead, but
-- with no branch and no owner: it files it under whichever business unit is
-- marked default and leaves branch_id and owner_employee_id NULL. A lead with
-- no branch is invisible to every counsellor -- leadScopedWhere() filters on
-- branch -- so in practice those enquiries sat unseen until an administrator
-- went looking for them.
--
-- One row per connected WhatsApp account, because that is the granularity the
-- CRM already thinks in: crm_branch_whatsapp_accounts maps each account to the
-- branches that use it, and each account belongs to one business.
--
-- assignment_mode:
--   unassigned - leave the owner empty, as today
--   rule       - run Automations > Assignment Rules for the unit, branch and
--                the WhatsApp source, the same engine Meta Lead Ads uses
--   fixed      - always the employee named in owner_employee_id
CREATE TABLE IF NOT EXISTS crm_whatsapp_lead_intake (
  -- Matches crm_integrations.id, which is a plain INT rather than the
  -- BIGINT UNSIGNED used elsewhere; a foreign key needs the exact type.
  integration_id INT NOT NULL,
  auto_create_lead TINYINT(1) NOT NULL DEFAULT 1,
  business_unit_id BIGINT UNSIGNED NULL,
  branch_id BIGINT UNSIGNED NULL,
  assignment_mode ENUM('unassigned','rule','fixed') NOT NULL DEFAULT 'rule',
  owner_employee_id BIGINT NULL,
  stage_id BIGINT UNSIGNED NULL,
  source_id BIGINT UNSIGNED NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (integration_id),
  KEY ix_crm_whatsapp_intake_unit (business_unit_id),
  CONSTRAINT fk_crm_whatsapp_intake_integration FOREIGN KEY (integration_id) REFERENCES crm_integrations(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_whatsapp_intake_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE SET NULL,
  CONSTRAINT fk_crm_whatsapp_intake_updater FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed each connected WhatsApp account with the branch it already sends from,
-- so the behaviour improves the moment this lands rather than only after
-- someone visits the screen. Accounts serving several branches are left blank:
-- picking one of them arbitrarily would misroute enquiries.
INSERT INTO crm_whatsapp_lead_intake (integration_id, auto_create_lead, business_unit_id, branch_id, assignment_mode)
SELECT i.id, 1,
       (SELECT id FROM crm_business_units WHERE is_default = TRUE ORDER BY id LIMIT 1),
       (SELECT bwa.branch_id FROM crm_branch_whatsapp_accounts bwa
         WHERE bwa.integration_id = i.id
         GROUP BY bwa.branch_id
         HAVING COUNT(*) = (SELECT COUNT(DISTINCT branch_id) FROM crm_branch_whatsapp_accounts WHERE integration_id = i.id)
         LIMIT 1),
       'rule'
FROM crm_integrations i
WHERE i.deleted_at IS NULL AND LOWER(COALESCE(i.provider,'')) = 'smartping'
ON DUPLICATE KEY UPDATE integration_id = crm_whatsapp_lead_intake.integration_id;
