-- Admission Class Configuration Header Table
CREATE TABLE IF NOT EXISTS mse_admission_class_configuration (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    academic_year VARCHAR(20) NOT NULL,
    branch_id BIGINT UNSIGNED NOT NULL,
    curriculum_id BIGINT UNSIGNED NOT NULL,
    admission_type_id BIGINT UNSIGNED NOT NULL,
    is_active TINYINT DEFAULT 1,
    created_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_by BIGINT UNSIGNED NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_academic_branch_curriculum_admission (academic_year, branch_id, curriculum_id, admission_type_id),

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
    FOREIGN KEY (curriculum_id) REFERENCES crm_curricula(id) ON DELETE RESTRICT,
    FOREIGN KEY (admission_type_id) REFERENCES crm_admission_types(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES app_users(id) ON DELETE RESTRICT,
    FOREIGN KEY (updated_by) REFERENCES app_users(id) ON DELETE RESTRICT,

    INDEX idx_academic_year (academic_year),
    INDEX idx_branch (branch_id),
    INDEX idx_curriculum (curriculum_id),
    INDEX idx_admission_type (admission_type_id),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Admission Class Configuration Details Table
CREATE TABLE IF NOT EXISTS mse_admission_class_configuration_details (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    configuration_id BIGINT UNSIGNED NOT NULL,
    class_id BIGINT UNSIGNED NOT NULL,
    is_active TINYINT DEFAULT 1,

    FOREIGN KEY (configuration_id) REFERENCES mse_admission_class_configuration(id) ON DELETE CASCADE,
    FOREIGN KEY (class_id) REFERENCES crm_classes(id) ON DELETE RESTRICT,

    UNIQUE KEY uk_configuration_class (configuration_id, class_id),
    INDEX idx_configuration (configuration_id),
    INDEX idx_class (class_id),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
