SET NAMES utf8mb4;

-- =====================================================================
-- Which columns each person sees on a Leads screen, and in what order.
--
-- The Leads table used to show nine fixed columns for everybody. It now
-- offers every system field and every configured lead field, and the
-- columns can be dragged into whatever order the counsellor works in.
-- That choice was kept in the browser, so it was lost on the next device
-- and unknown to anyone else.
--
-- Keyed by pipeline, not by business unit. Each pipeline has its own Leads
-- screen at /leads/pipeline/:id, and a unit's pipelines can be entirely
-- different businesses -- School Admissions runs Leads, Franchise and Eco
-- Bharath -- so the columns that suit one are the wrong ones for the next.
-- The unit follows from the pipeline (crm_lead_pipelines.business_unit_id),
-- so it is not stored a second time here where it could drift.
--
-- A new business unit, or a new pipeline in an existing one, therefore
-- starts with no rows and everyone gets the default columns on it until
-- they arrange their own. Clearing a person's arrangement means deleting
-- their row, which returns that screen to the defaults.
--
-- columns_json is an ordered array of column ids as the Leads screen names
-- them: "core:student" for the built-in composite columns, "field:email"
-- and "field:custom:<key>" for catalogue and configured lead fields. Ids
-- that no longer exist -- a deleted lead field -- are ignored when the
-- screen loads, so nothing has to be cleaned up here when configuration
-- changes.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

CREATE TABLE IF NOT EXISTS crm_lead_column_preferences (
  user_id BIGINT UNSIGNED NOT NULL,
  pipeline_id BIGINT UNSIGNED NOT NULL,
  columns_json JSON NOT NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id, pipeline_id),
  KEY ix_lead_column_pref_pipeline (pipeline_id),
  CONSTRAINT fk_lead_column_pref_user FOREIGN KEY (user_id)
    REFERENCES app_users(id) ON DELETE CASCADE,
  -- Deleting a pipeline takes its arrangements with it: a row pointing at a
  -- screen that no longer exists can never be read again.
  CONSTRAINT fk_lead_column_pref_pipeline FOREIGN KEY (pipeline_id)
    REFERENCES crm_lead_pipelines(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
