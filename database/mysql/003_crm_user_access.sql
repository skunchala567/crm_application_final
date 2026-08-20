-- CRM-specific branch assignments. These do not change Attendance user_branches.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS crm_user_branches (
    user_id BIGINT UNSIGNED NOT NULL,
    branch_id BIGINT UNSIGNED NOT NULL,
    created_by_user_id BIGINT UNSIGNED NULL,
    created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id, branch_id),
    KEY ix_crm_user_branches_branch (branch_id),
    CONSTRAINT fk_crm_user_branches_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
    CONSTRAINT fk_crm_user_branches_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    CONSTRAINT fk_crm_user_branches_created_user FOREIGN KEY (created_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO role_permissions (role_id, permission_key, is_allowed, updated_at_utc)
SELECT id, 'crm.users.manage', TRUE, UTC_TIMESTAMP(6)
FROM roles WHERE normalized_name IN ('ADMIN', 'CRM_ADMIN')
ON DUPLICATE KEY UPDATE is_allowed = VALUES(is_allowed), updated_at_utc = VALUES(updated_at_utc);

INSERT INTO role_screen_access (role_id, screen_key, access_level)
SELECT id, 'crm.users', 'Full' FROM roles WHERE normalized_name IN ('ADMIN', 'CRM_ADMIN')
ON DUPLICATE KEY UPDATE access_level = VALUES(access_level);
