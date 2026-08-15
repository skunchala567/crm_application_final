USE attendance_biometric;
SET NAMES utf8mb4;

-- Which email account each branch sends from.
--
-- Email was a single organisation-wide SMTP account: EmailService picked the
-- newest `provider='smtp'` row and every branch sent as that address. A group
-- running several schools needs each branch to send from its own mailbox, and
-- a counsellor should only be offered the accounts belonging to the branches
-- they work in -- exactly the arrangement WhatsApp already has in
-- crm_branch_whatsapp_accounts, which this mirrors deliberately so both
-- channels behave the same way.
--
-- A branch may list more than one account (the first is its default), and an
-- account can serve many branches, so this is a join table rather than a
-- column on branches -- which is an Attendance-owned table the CRM should not
-- be altering anyway.
CREATE TABLE IF NOT EXISTS crm_branch_email_accounts (
  branch_id BIGINT UNSIGNED NOT NULL,
  -- Matches crm_integrations.id, which is a plain INT.
  integration_id INT NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (branch_id, integration_id),
  KEY ix_crm_branch_email_account (integration_id),
  CONSTRAINT fk_crm_branch_email_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_branch_email_integration FOREIGN KEY (integration_id) REFERENCES crm_integrations(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_branch_email_creator FOREIGN KEY (created_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- An account that already exists was serving every branch, so map it to all of
-- them. Without this, upgrading would silently stop email working everywhere
-- until someone opened the new screen.
INSERT INTO crm_branch_email_accounts (branch_id, integration_id, is_default)
SELECT b.id, i.id, 1
  FROM branches b
  CROSS JOIN crm_integrations i
 WHERE b.is_active = TRUE
   AND i.deleted_at IS NULL
   AND LOWER(COALESCE(i.provider,'')) = 'smtp'
ON DUPLICATE KEY UPDATE is_default = crm_branch_email_accounts.is_default;
