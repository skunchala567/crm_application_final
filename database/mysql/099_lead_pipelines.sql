SET NAMES utf8mb4;

-- =====================================================================
-- More than one lead pipeline per business unit.
--
-- crm_lead_stages hung directly off a business unit, ordered by position,
-- so a unit had exactly one ladder of stages. The settings screen already
-- spoke of "pipelines" -- but for a CRM unit it invented a single synthetic
-- one with id 0 and stamped every stage with it. This turns that fiction
-- into rows.
--
-- A stage now belongs to a pipeline, and a pipeline belongs to a business
-- unit. A lead is NOT given a pipeline column: crm_leads.stage_id is NOT
-- NULL, so the stage already answers "which pipeline is this lead on", and
-- a second copy of that answer could only ever drift out of step with the
-- first. Every read joins through the stage instead.
--
-- Nothing changes for anyone on the first run: each unit's existing stages
-- are gathered into one pipeline marked as its default, in their existing
-- order, and every lead's pipeline follows from the stage it already has.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The pipeline itself.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_lead_pipelines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  -- Stable identifier for a pipeline within its unit; the display name can
  -- be renamed freely without breaking anything that stored the key.
  pipeline_key VARCHAR(100) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  description VARCHAR(500) NULL,
  -- Where a lead goes when nothing names a pipeline: manual adds, imports,
  -- enquiry forms, Meta leads. Exactly one per unit, enforced in the API.
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  position INT NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pipeline_key (business_unit_id, pipeline_key),
  KEY ix_pipeline_unit (business_unit_id, is_active, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------
-- 2. Stages belong to a pipeline.
--
-- Nullable on purpose: the column has to exist before there is anything to
-- point it at, and a stage whose pipeline was deleted is better left
-- orphaned than cascaded away.
-- ---------------------------------------------------------------------
SET @has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_lead_stages' AND column_name='pipeline_id');
SET @ddl = IF(@has=0,
  'ALTER TABLE crm_lead_stages ADD COLUMN pipeline_id BIGINT UNSIGNED NULL AFTER business_unit_id',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Every stage list is "this pipeline, in order".
SET @has = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='crm_lead_stages' AND index_name='ix_stage_pipeline');
SET @ddl = IF(@has=0,
  'ALTER TABLE crm_lead_stages ADD INDEX ix_stage_pipeline (pipeline_id, position)',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------
-- 2b. Position is unique within a pipeline, not within the unit.
--
-- uq_crm_lead_stage_unit_position was (business_unit_id, position): the
-- one-ladder-per-unit rule written into the schema. With more than one
-- pipeline both would start at position 1 and collide, so the key moves to
-- (pipeline_id, position) -- each pipeline numbers its own stages from 1.
-- ---------------------------------------------------------------------
SET @has = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='crm_lead_stages' AND index_name='uq_crm_lead_stage_unit_position');
SET @ddl = IF(@has>0, 'ALTER TABLE crm_lead_stages DROP INDEX uq_crm_lead_stage_unit_position', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @has = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='crm_lead_stages' AND index_name='uq_crm_lead_stage_pipeline_position');
SET @ddl = IF(@has=0,
  'ALTER TABLE crm_lead_stages ADD UNIQUE KEY uq_crm_lead_stage_pipeline_position (pipeline_id, position)',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------
-- 3. Remove the lead-level pipeline column.
--
-- An earlier revision of this file added crm_leads.pipeline_id before it
-- was clear the stage already carries the answer. Dropped here so a
-- database that ran that revision ends up identical to a fresh one.
-- ---------------------------------------------------------------------
SET @has = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='crm_leads' AND index_name='ix_lead_pipeline');
SET @ddl = IF(@has>0, 'ALTER TABLE crm_leads DROP INDEX ix_lead_pipeline', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_leads' AND column_name='pipeline_id');
SET @ddl = IF(@has>0, 'ALTER TABLE crm_leads DROP COLUMN pipeline_id', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------
-- 4. Gather what already exists into one pipeline per unit.
--
-- Guarded on "this unit has no pipeline yet", so a replay cannot create a
-- second one, and cannot undo a split an administrator has since made.
-- ---------------------------------------------------------------------
INSERT INTO crm_lead_pipelines (business_unit_id, pipeline_key, display_name, description, is_default, position)
SELECT s.business_unit_id, 'main', 'Main pipeline',
       'The stages this business unit already had, before pipelines could be split.',
       TRUE, 1
  FROM crm_lead_stages s
 WHERE NOT EXISTS (SELECT 1 FROM crm_lead_pipelines p WHERE p.business_unit_id = s.business_unit_id)
 GROUP BY s.business_unit_id;

-- Only stages that have not been placed: an administrator who has already
-- moved a stage to another pipeline keeps that choice on the next replay.
--
-- Positions are reassigned as the stages are adopted. Position is unique
-- within a pipeline now, and a stage arriving later may carry a number the
-- pipeline is already using -- so each one is appended after whatever the
-- pipeline already holds, in the order it had before.
--
-- On a database migrating for the first time the pipeline is empty, so the
-- offset is zero and every stage keeps exactly the position it had.
UPDATE crm_lead_stages s
  JOIN (
    SELECT x.id,
           p.id AS pipeline_id,
           COALESCE((SELECT MAX(y.position) FROM crm_lead_stages y WHERE y.pipeline_id = p.id), 0)
             + ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY x.position, x.id) AS new_position
      FROM crm_lead_stages x
      JOIN crm_lead_pipelines p
        ON p.business_unit_id = x.business_unit_id AND p.is_default = TRUE
     WHERE x.pipeline_id IS NULL
  ) placement ON placement.id = s.id
   SET s.pipeline_id = placement.pipeline_id,
       s.position = placement.new_position;
