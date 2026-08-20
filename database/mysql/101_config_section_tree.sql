SET NAMES utf8mb4;

-- =====================================================================
-- Configuration sections become a tree.
--
-- A section could previously carry one extra level inside itself: the
-- 'hierarchy' type named a sub-level, and each of its values could hold
-- sub-values. That makes exactly two levels, decided when the section is
-- created, and it gives no way to hang a second child section off an
-- existing one later -- the sub-level belongs to its parent section and
-- cannot be shared or re-pointed.
--
-- A section now names its parent instead. Nesting is unbounded, a parent
-- may have any number of children, and an existing section can be moved
-- under another one at any time by changing this single column.
--
-- NULL means a top-level section, which is what every existing row is, so
-- nothing moves on the first run. section_type is deliberately left alone:
-- it still describes how the values inside one section behave, which is a
-- different question from where the section sits, and units already using
-- it keep working.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

SET @has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_config_sections' AND column_name='parent_section_id');
SET @ddl = IF(@has=0,
  'ALTER TABLE crm_config_sections ADD COLUMN parent_section_id BIGINT UNSIGNED NULL AFTER business_unit_id',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Every read walks children-of-a-parent within one unit.
SET @has = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='crm_config_sections' AND index_name='ix_section_parent');
SET @ddl = IF(@has=0,
  'ALTER TABLE crm_config_sections ADD INDEX ix_section_parent (business_unit_id, parent_section_id, position)',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

/*
 * A section whose parent was deleted is orphaned rather than destroyed.
 *
 * ON DELETE SET NULL, not CASCADE: deleting a parent must never silently
 * take a subtree of configuration -- and the values inside it -- with it.
 * The API refuses to delete a section that still has children; this is the
 * backstop for anything that reaches the table another way.
 */
SET @has = (SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE table_schema=DATABASE() AND table_name='crm_config_sections'
    AND constraint_name='fk_section_parent' AND constraint_type='FOREIGN KEY');
SET @ddl = IF(@has=0,
  'ALTER TABLE crm_config_sections ADD CONSTRAINT fk_section_parent
     FOREIGN KEY (parent_section_id) REFERENCES crm_config_sections(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
