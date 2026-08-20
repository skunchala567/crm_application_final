SET NAMES utf8mb4;

-- Sub-values belong to a parent value, the way a sub-stage belongs to a stage.
--
-- 081 modelled the second section type as a cartesian combination of separate
-- lists, in the shape of the Admission Classes screen. That is not what these
-- sections are for: "Courses Offered" wants a course to own its own
-- specialisations, not to be crossed with a shared list. This replaces that
-- with two named levels and a parent link on each value, mirroring
-- crm_lead_stages / crm_lead_substages.
--
-- Guarded throughout so it is safe to re-run: `npm run migrate` replays every
-- file, and a bare ALTER would fail on the second pass.

-- 1. section_type: 'combination' becomes 'hierarchy'.
SET @enum_has_hierarchy = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_config_sections'
    AND column_name = 'section_type' AND column_type LIKE '%hierarchy%'
);
SET @sql = IF(@enum_has_hierarchy = 0,
  "ALTER TABLE crm_config_sections MODIFY section_type ENUM('list','combination','hierarchy') NOT NULL DEFAULT 'list'",
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

UPDATE crm_config_sections SET section_type = 'hierarchy' WHERE section_type = 'combination';

SET @enum_has_combination = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_config_sections'
    AND column_name = 'section_type' AND column_type LIKE '%combination%'
);
SET @sql = IF(@enum_has_combination = 1,
  "ALTER TABLE crm_config_sections MODIFY section_type ENUM('list','hierarchy') NOT NULL DEFAULT 'list'",
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

-- 2. What the second level is called. One pair of columns is enough because
--    the nesting is exactly two deep.
SET @has_child_label = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_config_sections' AND column_name = 'child_label'
);
SET @sql = IF(@has_child_label = 0,
  'ALTER TABLE crm_config_sections
     ADD COLUMN child_label VARCHAR(150) NULL AFTER placeholder,
     ADD COLUMN child_placeholder VARCHAR(200) NULL AFTER child_label',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

-- 3. Each value may hang off another value in the same section.
--    parent_key exists only so the unique key below can work: MySQL allows
--    any number of NULLs in a unique index, so two top-level values sharing a
--    code would otherwise slip past it.
SET @has_parent = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'crm_config_section_values' AND column_name = 'parent_value_id'
);
SET @sql = IF(@has_parent = 0,
  'ALTER TABLE crm_config_section_values
     ADD COLUMN parent_value_id BIGINT UNSIGNED NULL AFTER section_id,
     ADD COLUMN parent_key BIGINT UNSIGNED AS (COALESCE(parent_value_id,0)) STORED AFTER parent_value_id',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

-- 4. Re-key on (section, parent, code) so the same sub-value name may repeat
--    under different parents -- "Semester 1" belongs to every course.
SET @old_unique = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'crm_config_section_values'
    AND index_name = 'uq_crm_config_section_value'
    AND column_name = 'value_code' AND seq_in_index = 2
);
SET @sql = IF(@old_unique = 1,
  'ALTER TABLE crm_config_section_values DROP INDEX uq_crm_config_section_value',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @new_unique = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'crm_config_section_values'
    AND index_name = 'uq_crm_config_section_value'
);
SET @sql = IF(@new_unique = 0,
  'ALTER TABLE crm_config_section_values
     ADD UNIQUE KEY uq_crm_config_section_value (section_id, parent_key, value_code)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_parent_fk = (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE table_schema = DATABASE() AND table_name = 'crm_config_section_values'
    AND constraint_name = 'fk_crm_config_section_value_parent'
);
-- No ON DELETE CASCADE here. MySQL refuses a cascading referential action on
-- the base column of a stored generated column, and parent_value_id is what
-- parent_key is generated from. The constraint therefore restricts, and
-- deleting a parent removes its sub-values in the route, inside one
-- transaction -- see DELETE /values/:id in business-config.routes.js.
SET @sql = IF(@has_parent_fk = 0,
  'ALTER TABLE crm_config_section_values
     ADD KEY ix_crm_config_section_value_parent (parent_value_id, position),
     ADD CONSTRAINT fk_crm_config_section_value_parent
       FOREIGN KEY (parent_value_id) REFERENCES crm_config_section_values(id)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

-- 5. A section converted from the old model has no sub-level name yet, and the
--    API refuses to save a hierarchy without one. Give it a placeholder name
--    so the section stays editable; renaming it is a normal edit.
UPDATE crm_config_sections
SET child_label = 'Sub-value'
WHERE section_type = 'hierarchy' AND (child_label IS NULL OR child_label = '');

-- 6. The cartesian tables have no meaning under this model.
DROP TABLE IF EXISTS crm_config_combination_rows;
DROP TABLE IF EXISTS crm_config_combination_fields;
