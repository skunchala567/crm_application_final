-- Business-unit scoped sub-stages for metadata-driven lead pipelines.
-- Existing School Admissions stages/sub-stages stay in their legacy tables so
-- all current lead foreign keys and history remain unchanged.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS crm_metadata_pipeline_substages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  stage_id BIGINT UNSIGNED NOT NULL,
  substage_key VARCHAR(80) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  position SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_crm_metadata_pipeline_substage (stage_id,substage_key),
  KEY ix_crm_metadata_pipeline_substage_order (stage_id,is_active,position),
  CONSTRAINT fk_crm_metadata_pipeline_substage_stage
    FOREIGN KEY (stage_id) REFERENCES crm_metadata_pipeline_stages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO crm_metadata_pipeline_substages
  (stage_id,substage_key,display_name,position,is_active)
SELECT ps.id,'default',ps.display_name,1,TRUE
FROM crm_metadata_pipeline_stages ps
LEFT JOIN crm_metadata_pipeline_substages ss ON ss.stage_id=ps.id
WHERE ss.id IS NULL;
