-- Admissions class and curriculum master data.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS crm_classes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    class_code VARCHAR(30) NOT NULL,
    display_name VARCHAR(60) NOT NULL,
    position SMALLINT UNSIGNED NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_crm_classes_code (class_code),
    UNIQUE KEY uq_crm_classes_position (position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_curricula (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    curriculum_code VARCHAR(30) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    position SMALLINT UNSIGNED NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_crm_curricula_code (curriculum_code),
    UNIQUE KEY uq_crm_curricula_position (position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO crm_classes (class_code, display_name, position) VALUES
('EY-1', 'EY - 1', 1), ('EY-2', 'EY - 2', 2), ('EY-3', 'EY - 3', 3),
('I', 'I', 4), ('II', 'II', 5), ('III', 'III', 6), ('IV', 'IV', 7), ('V', 'V', 8),
('VI', 'VI', 9), ('VII', 'VII', 10), ('VIII', 'VIII', 11), ('IX', 'IX', 12), ('X', 'X', 13),
('XI-SCI', 'XI - SCI', 14), ('XI-COM', 'XI - COM', 15),
('XII-SCI', 'XII - SCI', 16), ('XII-COM', 'XII - COM', 17),
('XI-HUM', 'XI - HUM', 18), ('XII-HUM', 'XII - HUM', 19), ('XI', 'XI', 20)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), position = VALUES(position), is_active = TRUE;

INSERT INTO crm_curricula (curriculum_code, display_name, position) VALUES
('CBSE', 'CBSE', 1), ('CAMBRIDGE', 'Cambridge', 2)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), position = VALUES(position), is_active = TRUE;

SET @class_column_exists = (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'crm_leads' AND column_name = 'class_id'
);
SET @sql = IF(@class_column_exists = 0,
    'ALTER TABLE crm_leads ADD COLUMN class_id BIGINT UNSIGNED NULL AFTER applying_class, ADD KEY ix_crm_leads_class (class_id)',
    'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @curriculum_column_exists = (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'crm_leads' AND column_name = 'curriculum_id'
);
SET @sql = IF(@curriculum_column_exists = 0,
    'ALTER TABLE crm_leads ADD COLUMN curriculum_id BIGINT UNSIGNED NULL AFTER class_id, ADD KEY ix_crm_leads_curriculum (curriculum_id)',
    'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @class_fk_exists = (
    SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = 'crm_leads' AND constraint_name = 'fk_crm_leads_class'
);
SET @sql = IF(@class_fk_exists = 0,
    'ALTER TABLE crm_leads ADD CONSTRAINT fk_crm_leads_class FOREIGN KEY (class_id) REFERENCES crm_classes(id)',
    'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @curriculum_fk_exists = (
    SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = 'crm_leads' AND constraint_name = 'fk_crm_leads_curriculum'
);
SET @sql = IF(@curriculum_fk_exists = 0,
    'ALTER TABLE crm_leads ADD CONSTRAINT fk_crm_leads_curriculum FOREIGN KEY (curriculum_id) REFERENCES crm_curricula(id)',
    'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
