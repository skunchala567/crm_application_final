USE attendance_biometric;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS crm_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  notification_type VARCHAR(40) NOT NULL,
  title VARCHAR(160) NOT NULL,
  message VARCHAR(500) NOT NULL,
  link_url VARCHAR(500) NULL,
  entity_type VARCHAR(40) NULL,
  entity_id BIGINT UNSIGNED NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  read_at_utc DATETIME(6) NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_crm_notifications_user_recent (business_unit_id,user_id,created_at_utc),
  KEY ix_crm_notifications_user_unread (business_unit_id,user_id,read_at_utc),
  CONSTRAINT fk_crm_notifications_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_notifications_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_notifications_actor FOREIGN KEY (actor_user_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
