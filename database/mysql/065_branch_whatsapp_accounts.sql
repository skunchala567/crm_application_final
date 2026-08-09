USE attendance_biometric;
SET NAMES utf8mb4;

-- =====================================================================
-- Which WhatsApp account each branch sends from.
--
-- Three accounts are already connected -- Digital Caampus, Delhi Public
-- School Group and Pallavi School -- and every template already belongs to
-- one of them. What was missing was the link between a branch and the
-- account it should use, so a counsellor had no way to be offered the right
-- one: the send screen expected an account id it could not derive.
--
-- A branch can list more than one account (the first is its default), and an
-- account can serve many branches, so this is a join table rather than a
-- column on branches -- which is an Attendance-owned table this CRM should
-- not be altering anyway.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

CREATE TABLE IF NOT EXISTS crm_branch_whatsapp_accounts (
  branch_id       BIGINT UNSIGNED NOT NULL,
  -- The connected account, from crm_integrations. INT, not BIGINT UNSIGNED:
  -- crm_integrations.id is a plain INT, and a foreign key is rejected unless
  -- the types match exactly.
  integration_id  INT NOT NULL,
  -- The one preselected when a counsellor at this branch opens the composer.
  is_default      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at_utc  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (branch_id, integration_id),
  KEY ix_branch_whatsapp_integration (integration_id),
  CONSTRAINT fk_branch_whatsapp_branch FOREIGN KEY (branch_id)
    REFERENCES branches (id) ON DELETE CASCADE,
  CONSTRAINT fk_branch_whatsapp_integration FOREIGN KEY (integration_id)
    REFERENCES crm_integrations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
