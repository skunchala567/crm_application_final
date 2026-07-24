USE attendance_biometric;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS crm_saved_filters (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(150) NOT NULL,
    filter_type VARCHAR(20) NOT NULL DEFAULT 'filter',
    filters_json JSON NOT NULL,
    created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_crm_saved_filters_user_name (user_id, name),
    KEY ix_crm_saved_filters_user_type (user_id, filter_type),
    CONSTRAINT chk_crm_saved_filters_type CHECK (filter_type IN ('filter','funnel')),
    CONSTRAINT fk_crm_saved_filters_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
