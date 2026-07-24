-- Migration: Create Academic Years Master Table
-- Purpose: Centralized management of academic years for the CRM system

CREATE TABLE IF NOT EXISTS `crm_academic_years` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `academic_year` VARCHAR(20) NOT NULL UNIQUE,
    `display_name` VARCHAR(100),
    `is_active` TINYINT DEFAULT 1,
    `created_by_user_id` BIGINT UNSIGNED,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_by_user_id` BIGINT UNSIGNED,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_academic_year (academic_year),
    INDEX idx_is_active (is_active),
    FOREIGN KEY (created_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
    FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert initial academic years (customize as needed)
INSERT INTO crm_academic_years (academic_year, display_name, is_active)
VALUES
    ('2024-25', '2024-2025', 0),
    ('2025-26', '2025-2026', 1),
    ('2026-27', '2026-2027', 1),
    ('2027-28', '2027-2028', 1)
ON DUPLICATE KEY UPDATE academic_year=VALUES(academic_year);
