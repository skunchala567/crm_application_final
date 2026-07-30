USE attendance_biometric;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS crm_mom_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  session_number VARCHAR(60) NOT NULL,
  action_item_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  started_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  ended_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_crm_mom_session_number (session_number),
  KEY ix_crm_mom_session_unit (business_unit_id, ended_at_utc),
  CONSTRAINT fk_crm_mom_session_unit
    FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_mom_session_creator
    FOREIGN KEY (created_by_user_id) REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_mom_session_points (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  position INT UNSIGNED NOT NULL,
  mom_notes TEXT NOT NULL,
  operation_record_id BIGINT UNSIGNED NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_crm_mom_session_point_position (session_id, position),
  KEY ix_crm_mom_point_operation (operation_record_id),
  CONSTRAINT fk_crm_mom_point_session
    FOREIGN KEY (session_id) REFERENCES crm_mom_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_mom_point_operation
    FOREIGN KEY (operation_record_id) REFERENCES crm_operation_records(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
