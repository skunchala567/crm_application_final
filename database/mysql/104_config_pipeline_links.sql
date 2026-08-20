SET NAMES utf8mb4;

-- =====================================================================
-- Configuration that varies by pipeline, and sections that link to
-- each other the way admission classes link to a branch.
--
-- Two gaps, both visible in School Admissions. That unit runs three
-- pipelines -- Leads, Franchise, Eco Bharath -- through one set of
-- configuration, so a franchise lead is offered a curriculum and a class.
-- And the generic section model (crm_config_sections) can only list
-- values; it has no way to say "at this branch, for this year, these are
-- the classes on offer", which is the one thing the fixed Academic
-- configuration does that actually shapes lead capture.
--
-- 1. crm_config_sections.pipeline_id
--    NULL means the section belongs to every pipeline in the unit, which
--    is what every existing row is, so nothing moves on the first run.
--
-- 2. A link rule and its rows
--    crm_admission_class_configurations generalised. That table fixes its
--    key at four columns -- year, branch, curriculum, admission type --
--    and its result at classes. A rule instead names which sections form
--    the key and which section supplies the result, so a unit can build
--    the same shape out of whatever sections it has, and a different
--    shape for each pipeline.
--
-- The fixed academic tables are deliberately left alone. crm_leads holds
-- real foreign keys into crm_classes, crm_curricula and crm_admission_types,
-- and the enquiry form filters and validates against them, so that path
-- keeps working exactly as it does now.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A section can belong to one pipeline.
-- ---------------------------------------------------------------------
SET @has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_config_sections' AND column_name='pipeline_id');
SET @ddl = IF(@has=0,
  'ALTER TABLE crm_config_sections ADD COLUMN pipeline_id BIGINT UNSIGNED NULL AFTER business_unit_id',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

/*
 * A section outlives the pipeline it was scoped to.
 *
 * ON DELETE SET NULL, not CASCADE: removing a pipeline must not take a
 * unit's master data with it. The section falls back to serving every
 * pipeline, which is visible and correctable, rather than vanishing.
 */
SET @has = (SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE table_schema=DATABASE() AND table_name='crm_config_sections'
    AND constraint_name='fk_section_pipeline' AND constraint_type='FOREIGN KEY');
SET @ddl = IF(@has=0,
  'ALTER TABLE crm_config_sections ADD CONSTRAINT fk_section_pipeline
     FOREIGN KEY (pipeline_id) REFERENCES crm_lead_pipelines(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Every read asks for one unit's sections, for one pipeline or for all.
SET @has = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='crm_config_sections' AND index_name='ix_section_pipeline');
SET @ddl = IF(@has=0,
  'ALTER TABLE crm_config_sections ADD INDEX ix_section_pipeline (business_unit_id, pipeline_id, position)',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------
-- 2. The rule: which sections form the key, which supplies the result.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_config_link_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  -- NULL means the rule applies to every pipeline in the unit.
  pipeline_id BIGINT UNSIGNED NULL,
  rule_key VARCHAR(80) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  description VARCHAR(500) NULL,
  -- The section whose values the rule hands back, as classes are handed
  -- back by the admission class configuration.
  result_section_id BIGINT UNSIGNED NOT NULL,
  -- Whether a branch forms part of the key. Branch is not a config
  -- section -- it is a real table every unit shares -- so it is a flag
  -- here rather than another row in crm_config_link_rule_sections.
  includes_branch TINYINT(1) NOT NULL DEFAULT 1,
  position SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_config_link_rule (business_unit_id, rule_key),
  KEY ix_link_rule_pipeline (business_unit_id, pipeline_id, position),
  CONSTRAINT fk_link_rule_result_section FOREIGN KEY (result_section_id)
    REFERENCES crm_config_sections(id) ON DELETE CASCADE,
  CONSTRAINT fk_link_rule_pipeline FOREIGN KEY (pipeline_id)
    REFERENCES crm_lead_pipelines(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The key sections, in the order the form should ask for them.
CREATE TABLE IF NOT EXISTS crm_config_link_rule_sections (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  rule_id BIGINT UNSIGNED NOT NULL,
  section_id BIGINT UNSIGNED NOT NULL,
  position SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_link_rule_section (rule_id, section_id),
  KEY ix_link_rule_section_order (rule_id, position),
  CONSTRAINT fk_link_rule_section_rule FOREIGN KEY (rule_id)
    REFERENCES crm_config_link_rules(id) ON DELETE CASCADE,
  CONSTRAINT fk_link_rule_section_section FOREIGN KEY (section_id)
    REFERENCES crm_config_sections(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 3. The rows: one saved combination, and what it allows.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_config_link_rows (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  rule_id BIGINT UNSIGNED NOT NULL,
  -- NULL when the rule does not key on branch.
  branch_id BIGINT UNSIGNED NULL,
  /*
   * The key values, flattened and sorted, as "branch:5|12:88|13:91".
   *
   * The legacy table could declare UNIQUE(year, branch, curriculum,
   * admission_type) because its key was always those four columns. A rule
   * chooses its own sections, so there is no fixed set of columns to
   * constrain -- this signature is what keeps two rows from claiming the
   * same combination, and it is written by the API, never by hand.
   */
  key_signature VARCHAR(500) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by_user_id BIGINT UNSIGNED NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_config_link_row (rule_id, key_signature),
  KEY ix_link_row_branch (rule_id, branch_id, is_active),
  CONSTRAINT fk_link_row_rule FOREIGN KEY (rule_id)
    REFERENCES crm_config_link_rules(id) ON DELETE CASCADE,
  CONSTRAINT fk_link_row_branch FOREIGN KEY (branch_id)
    REFERENCES branches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*
 * Both halves of a row live here, told apart by `role`.
 *
 * A key value and a result value are the same thing -- a section value
 * attached to a row -- and splitting them into two near-identical tables
 * would double every read and every write for no gain.
 */
CREATE TABLE IF NOT EXISTS crm_config_link_row_values (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  row_id BIGINT UNSIGNED NOT NULL,
  section_id BIGINT UNSIGNED NOT NULL,
  value_id BIGINT UNSIGNED NOT NULL,
  role ENUM('key','result') NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_link_row_value (row_id, role, value_id),
  KEY ix_link_row_value_lookup (row_id, role),
  KEY ix_link_row_value_section (section_id, value_id),
  CONSTRAINT fk_link_row_value_row FOREIGN KEY (row_id)
    REFERENCES crm_config_link_rows(id) ON DELETE CASCADE,
  CONSTRAINT fk_link_row_value_section FOREIGN KEY (section_id)
    REFERENCES crm_config_sections(id) ON DELETE CASCADE,
  CONSTRAINT fk_link_row_value_value FOREIGN KEY (value_id)
    REFERENCES crm_config_section_values(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
