USE attendance_biometric;
SET NAMES utf8mb4;

-- A lead field may take its options from a configuration section.
--
-- Select fields could only carry a comma-separated list typed into the field
-- dialog, so the master data configured for a business unit -- Course Type,
-- Courses Offered and anything else added later -- could not be used on the
-- lead form, in filters, in reports or in import templates. The values had to
-- be retyped, and then drifted the moment the section changed.
--
-- The binding is stored rather than the values themselves: options are read
-- from the section every time the field is served, so adding a course shows
-- up on the lead form without touching the field.
--
-- options_section_level says which half of a two-level section to offer:
--   parent - the top-level values (a Course Type)
--   child  - the sub-values (a Course, across every Course Type)
-- It is ignored for a plain list section, which has one level.
--
-- Guarded so `npm run migrate`, which replays every file, stays safe.
SET @has_source = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_metadata_fields'
    AND column_name = 'options_section_id'
);
SET @sql = IF(@has_source = 0,
  "ALTER TABLE crm_metadata_fields
     ADD COLUMN options_section_id BIGINT UNSIGNED NULL AFTER options_json,
     ADD COLUMN options_section_level ENUM('parent','child') NOT NULL DEFAULT 'parent' AFTER options_section_id",
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

-- ON DELETE SET NULL: removing a section must not take the lead field with it.
-- The field falls back to its stored options_json list instead.
SET @has_fk = (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE table_schema = DATABASE() AND table_name = 'crm_metadata_fields'
    AND constraint_name = 'fk_crm_metadata_field_option_section'
);
SET @sql = IF(@has_fk = 0,
  'ALTER TABLE crm_metadata_fields
     ADD KEY ix_crm_metadata_field_option_section (options_section_id),
     ADD CONSTRAINT fk_crm_metadata_field_option_section
       FOREIGN KEY (options_section_id) REFERENCES crm_config_sections(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
