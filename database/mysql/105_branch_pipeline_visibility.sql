SET NAMES utf8mb4;

-- =====================================================================
-- Which lead pipelines a branch appears in.
--
-- A business unit can run pipelines that share almost nothing -- School
-- Admissions runs Leads, Franchise and Eco Bharath -- while every branch
-- picker on every one of those screens offers all twenty branches. Most
-- branches have nothing to do with the franchise business, so the list is
-- long in the one place it needs to be short.
--
-- A branch with no rows here appears in every pipeline, which is what all
-- twenty are today. Nothing changes until somebody narrows a branch, and
-- clearing its rows puts it back everywhere. That default is deliberate:
-- the opposite -- no rows meaning invisible -- would empty every picker
-- in the product the moment this table existed.
--
-- Visibility only. It is not permission: crm_user_branches still decides
-- what a person may see, and this cannot widen that.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

CREATE TABLE IF NOT EXISTS crm_branch_pipelines (
  branch_id BIGINT UNSIGNED NOT NULL,
  pipeline_id BIGINT UNSIGNED NOT NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (branch_id, pipeline_id),
  KEY ix_branch_pipeline_pipeline (pipeline_id),
  CONSTRAINT fk_branch_pipeline_branch FOREIGN KEY (branch_id)
    REFERENCES branches(id) ON DELETE CASCADE,
  -- Deleting a pipeline drops its restrictions rather than stranding them:
  -- a branch left pointing at a pipeline that no longer exists would be
  -- restricted to nothing and vanish from every picker.
  CONSTRAINT fk_branch_pipeline_pipeline FOREIGN KEY (pipeline_id)
    REFERENCES crm_lead_pipelines(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
