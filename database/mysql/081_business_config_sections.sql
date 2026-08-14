USE attendance_biometric;
SET NAMES utf8mb4;

-- Configurable master data for non-school business units.
--
-- School Admissions keeps its four fixed tabs (crm_academic_years,
-- crm_curricula, crm_admission_types, crm_classes) because crm_leads carries
-- real foreign keys into them. Every other unit describes its own master data
-- here instead: a consultancy can define "Courses Offered" and "Service Type"
-- and nothing else, and rename either one later without a schema change.
--
-- A section is one tab. `list` sections hold plain code/name values. A
-- `combination` section is the generic form of the Admission Classes screen:
-- it names the lists it draws from and stores the chosen combinations.
CREATE TABLE IF NOT EXISTS crm_config_sections (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  section_key VARCHAR(80) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  description VARCHAR(500) NULL,
  -- Shown in the value picker for this section wherever it is offered.
  placeholder VARCHAR(200) NULL,
  section_type ENUM('list','combination') NOT NULL DEFAULT 'list',
  position SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_config_section (business_unit_id, section_key),
  KEY ix_crm_config_section_order (business_unit_id, is_active, position),
  CONSTRAINT fk_crm_config_section_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Values belonging to a `list` section.
CREATE TABLE IF NOT EXISTS crm_config_section_values (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  section_id BIGINT UNSIGNED NOT NULL,
  value_code VARCHAR(80) NOT NULL,
  display_name VARCHAR(200) NOT NULL,
  position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_config_section_value (section_id, value_code),
  KEY ix_crm_config_section_value_order (section_id, is_active, position),
  CONSTRAINT fk_crm_config_section_value_section FOREIGN KEY (section_id) REFERENCES crm_config_sections(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One input on a combination section's form. `source_section_id` points at the
-- list it offers; `source_kind='branch'` instead offers the unit's branches,
-- which are not configurable master data but are needed in most combinations.
CREATE TABLE IF NOT EXISTS crm_config_combination_fields (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  section_id BIGINT UNSIGNED NOT NULL,
  source_kind ENUM('section','branch') NOT NULL DEFAULT 'section',
  source_section_id BIGINT UNSIGNED NULL,
  -- Label and placeholder are held per field, so the same list can appear
  -- under different wording in two different combination screens.
  field_label VARCHAR(150) NOT NULL,
  placeholder VARCHAR(200) NULL,
  is_required TINYINT(1) NOT NULL DEFAULT 1,
  -- A field the admin may tick several values on; each is expanded into its
  -- own combination row, matching how Admission Classes behaves today.
  allow_multiple TINYINT(1) NOT NULL DEFAULT 1,
  position SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_crm_config_combination_field_order (section_id, position),
  CONSTRAINT fk_crm_config_combination_field_section FOREIGN KEY (section_id) REFERENCES crm_config_sections(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_config_combination_field_source FOREIGN KEY (source_section_id) REFERENCES crm_config_sections(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One saved combination. values_json maps combination field id -> chosen id
-- (a crm_config_section_values id, or a branches id for a branch field).
-- combination_hash is that map rendered as sorted "field:value" pairs, so the
-- unique key stops the same combination being saved twice; JSON columns
-- cannot be indexed directly.
CREATE TABLE IF NOT EXISTS crm_config_combination_rows (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  section_id BIGINT UNSIGNED NOT NULL,
  values_json JSON NOT NULL,
  combination_hash CHAR(64) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_config_combination_row (section_id, combination_hash),
  KEY ix_crm_config_combination_row_active (section_id, is_active),
  CONSTRAINT fk_crm_config_combination_row_section FOREIGN KEY (section_id) REFERENCES crm_config_sections(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_config_combination_row_creator FOREIGN KEY (created_by) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
