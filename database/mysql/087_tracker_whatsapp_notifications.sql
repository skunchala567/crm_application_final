USE attendance_biometric;
SET NAMES utf8mb4;

-- WhatsApp templates the Tracker sends when an action item is created.
--
-- The Tracker already raises an in-app notification for the owner and for each
-- approver, which is only seen by someone already looking at the CRM. These
-- settings add a WhatsApp message to the number captured on the account in
-- User Management, so an action item reaches the person who has to act on it.
--
-- One row per business unit, because templates belong to a WhatsApp account
-- and each unit runs its own.
--
-- Both templates take the same two variables, in this order:
--   {{1}}  the action item's title
--   {{2}}  its due date
-- so one wording can address the owner and the other the approver without the
-- Tracker needing to know which is which.
CREATE TABLE IF NOT EXISTS crm_tracker_notification_settings (
  business_unit_id BIGINT UNSIGNED NOT NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 0,
  -- Which connected WhatsApp account sends them.
  integration_id INT NULL,
  -- Template names rather than ids: that is what the send API takes, and a
  -- template re-synced from the provider keeps its name but not its id.
  action_item_template VARCHAR(200) NULL,
  approval_template VARCHAR(200) NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (business_unit_id),
  CONSTRAINT fk_crm_tracker_notify_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_tracker_notify_integration FOREIGN KEY (integration_id) REFERENCES crm_integrations(id) ON DELETE SET NULL,
  CONSTRAINT fk_crm_tracker_notify_user FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
