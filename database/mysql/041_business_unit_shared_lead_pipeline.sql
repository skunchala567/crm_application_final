USE attendance_biometric;
SET NAMES utf8mb4;

SET @default_business_unit_id=(SELECT id FROM crm_business_units WHERE unit_code='school_admissions' LIMIT 1);
SET @sql=IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='crm_lead_stages' AND column_name='business_unit_id'),
  'SELECT 1',
  'ALTER TABLE crm_lead_stages ADD COLUMN business_unit_id BIGINT UNSIGNED NULL AFTER id'
);
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
UPDATE crm_lead_stages SET business_unit_id=@default_business_unit_id WHERE business_unit_id IS NULL;
ALTER TABLE crm_lead_stages MODIFY business_unit_id BIGINT UNSIGNED NOT NULL DEFAULT 1;
SET @sql=IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='crm_lead_stages' AND index_name='uq_crm_lead_stages_name'),
  'ALTER TABLE crm_lead_stages DROP INDEX uq_crm_lead_stages_name',
  'SELECT 1'
);
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
SET @sql=IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='crm_lead_stages' AND index_name='uq_crm_lead_stages_position'),
  'ALTER TABLE crm_lead_stages DROP INDEX uq_crm_lead_stages_position',
  'SELECT 1'
);
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
SET @sql=IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='crm_lead_stages' AND index_name='uq_crm_lead_stage_unit_name'),
  'SELECT 1',
  'ALTER TABLE crm_lead_stages MODIFY business_unit_id BIGINT UNSIGNED NOT NULL DEFAULT 1, ADD UNIQUE KEY uq_crm_lead_stage_unit_name(business_unit_id,name), ADD UNIQUE KEY uq_crm_lead_stage_unit_position(business_unit_id,position), ADD CONSTRAINT fk_crm_lead_stage_unit FOREIGN KEY(business_unit_id) REFERENCES crm_business_units(id)'
);
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

INSERT INTO crm_lead_stages(business_unit_id,name,display_name,position,color_code,is_active)
SELECT p.business_unit_id,CONCAT(bu.unit_code,'__',ps.stage_key),ps.display_name,ps.position,ps.color_code,ps.is_active
FROM crm_metadata_pipeline_stages ps
JOIN crm_metadata_pipelines p ON p.id=ps.pipeline_id
JOIN crm_business_units bu ON bu.id=p.business_unit_id
WHERE bu.unit_code<>'school_admissions'
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),color_code=VALUES(color_code),is_active=VALUES(is_active);

DELETE ss FROM crm_lead_substages ss
JOIN crm_lead_stages s ON s.id=ss.stage_id
JOIN crm_business_units bu ON bu.id=s.business_unit_id
WHERE bu.unit_code<>'school_admissions'
  AND ss.substage_code LIKE '%\\_\\_default'
  AND NOT EXISTS(SELECT 1 FROM crm_leads l WHERE l.substage_id=ss.id);

INSERT INTO crm_lead_substages(stage_id,substage_code,display_name,position,is_active)
SELECT s.id,CONCAT(s.name,'_pending'),CONCAT(s.display_name,' - Pending'),1,s.is_active
FROM crm_lead_stages s
JOIN crm_business_units bu ON bu.id=s.business_unit_id
WHERE bu.unit_code<>'school_admissions'
ON DUPLICATE KEY UPDATE stage_id=VALUES(stage_id),display_name=VALUES(display_name),is_active=VALUES(is_active);
