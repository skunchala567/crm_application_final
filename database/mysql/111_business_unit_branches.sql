SET NAMES utf8mb4;

-- =====================================================================
-- Which branches belong to which business unit.
--
-- Branches lived in the shared master table with nothing saying which
-- business they were part of, so every unit saw every branch. A new
-- business unit was therefore born holding the whole of School
-- Admissions' branch list -- twenty entries it has no connection to --
-- and the branch pickers on its enquiry forms, payment forms and user
-- access screens offered all of them.
--
-- A branch now belongs to the units listed here and to no others. A new
-- unit starts with none, which is the point: its branches are its own.
--
-- Membership, not permission. crm_user_branches still decides what a
-- person may see; this only decides which branches a unit is made of,
-- and so which ones can be offered when granting that access.
--
-- No foreign key on branch_id: the branch master is owned by the
-- attendance side and is named `branches` in the older migrations here
-- and `mse_hrm_branches` everywhere the application reads it, so a
-- constraint would fail on whichever deployment has the other name.
-- Every read joins the branch table anyway, so a row left behind by a
-- deleted branch simply never appears.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

CREATE TABLE IF NOT EXISTS crm_business_unit_branches (
  business_unit_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NOT NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (business_unit_id, branch_id),
  KEY ix_business_unit_branches_branch (branch_id),
  CONSTRAINT fk_business_unit_branches_unit FOREIGN KEY (business_unit_id)
    REFERENCES crm_business_units(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Backfill, once, from what the data already says.
--
-- Guarded on the table being empty rather than on row-by-row existence:
-- after the first run an administrator's decisions live here, and a
-- replay must not undo an unlink by putting the branch back.
--
-- A branch that has taken a lead, carried an enquiry form, a payment
-- form or a payment link for a unit demonstrably belongs to it.
-- ---------------------------------------------------------------------
SET @crm_bu_branches_seeded = (SELECT COUNT(*) FROM crm_business_unit_branches);

INSERT IGNORE INTO crm_business_unit_branches (business_unit_id, branch_id)
SELECT DISTINCT l.business_unit_id, l.branch_id
  FROM crm_leads l
  JOIN crm_business_units bu ON bu.id = l.business_unit_id
 WHERE @crm_bu_branches_seeded = 0 AND l.branch_id IS NOT NULL;

INSERT IGNORE INTO crm_business_unit_branches (business_unit_id, branch_id)
SELECT DISTINCT f.business_unit_id, f.default_branch_id
  FROM crm_public_enquiry_forms f
  JOIN crm_business_units bu ON bu.id = f.business_unit_id
 WHERE @crm_bu_branches_seeded = 0 AND f.default_branch_id IS NOT NULL;

INSERT IGNORE INTO crm_business_unit_branches (business_unit_id, branch_id)
SELECT DISTINCT p.business_unit_id, p.branch_id
  FROM crm_payment_forms p
  JOIN crm_business_units bu ON bu.id = p.business_unit_id
 WHERE @crm_bu_branches_seeded = 0 AND p.branch_id IS NOT NULL;

INSERT IGNORE INTO crm_business_unit_branches (business_unit_id, branch_id)
SELECT DISTINCT j.business_unit_id, j.branch_id
  FROM crm_jodo_payment_links j
  JOIN crm_business_units bu ON bu.id = j.business_unit_id
 WHERE @crm_bu_branches_seeded = 0 AND j.branch_id IS NOT NULL;

-- Everything else goes to the default unit, which is the one that has
-- been showing all of them until now. Anything genuinely shared can be
-- added to a second unit from its Branches screen; anything the default
-- unit never used can be removed there. Starting from what is on screen
-- today means nobody loses a branch the morning this ships.
INSERT IGNORE INTO crm_business_unit_branches (business_unit_id, branch_id)
SELECT bu.id, b.id
  FROM crm_business_units bu
  JOIN mse_hrm_branches b
 WHERE @crm_bu_branches_seeded = 0
   AND bu.is_default = TRUE
   -- Wrapped in a derived table: MySQL refuses to read the table an
   -- INSERT ... SELECT is writing to unless it is materialised first.
   AND NOT EXISTS (
     SELECT 1 FROM (SELECT branch_id FROM crm_business_unit_branches) x
      WHERE x.branch_id = b.id
   );
