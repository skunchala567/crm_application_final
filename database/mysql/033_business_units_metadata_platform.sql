-- Metadata-driven multi-business CRM foundation.
-- School Admissions remains the default legacy compatibility profile.
USE attendance_biometric;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS crm_business_units (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  unit_code VARCHAR(60) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  industry_type VARCHAR(80) NOT NULL DEFAULT 'General',
  description VARCHAR(500),
  icon_key VARCHAR(50) NOT NULL DEFAULT 'building',
  color_code CHAR(7) NOT NULL DEFAULT '#4A4FB1',
  compatibility_mode ENUM('legacy_school','metadata') NOT NULL DEFAULT 'metadata',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id BIGINT UNSIGNED,
  updated_by_user_id BIGINT UNSIGNED,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_crm_business_unit_code (unit_code),
  KEY ix_crm_business_unit_active (is_active, display_name),
  CONSTRAINT fk_crm_business_unit_created_by FOREIGN KEY (created_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_crm_business_unit_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO crm_business_units
  (unit_code,display_name,industry_type,description,icon_key,color_code,compatibility_mode,is_default,is_active)
VALUES
  ('school_admissions','School Admissions','Education','Existing school admissions CRM and academic configuration.','graduation-cap','#4A4FB1','legacy_school',TRUE,TRUE)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),compatibility_mode='legacy_school',is_default=TRUE,is_active=TRUE;

CREATE TABLE IF NOT EXISTS crm_user_business_units (
  user_id BIGINT UNSIGNED NOT NULL,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  access_level ENUM('admin','manage','contribute','view') NOT NULL DEFAULT 'view',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id,business_unit_id),
  KEY ix_crm_user_business_unit (business_unit_id,user_id),
  CONSTRAINT fk_crm_user_business_unit_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_user_business_unit_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO crm_user_business_units (user_id,business_unit_id,access_level,is_default)
SELECT u.id,bu.id,
       CASE WHEN EXISTS (
         SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
         WHERE ur.user_id=u.id AND r.normalized_name IN ('ADMIN','CRM_ADMIN')
       ) THEN 'admin' ELSE 'contribute' END,
       TRUE
FROM app_users u
JOIN crm_business_units bu ON bu.unit_code='school_admissions';

SET @has_lead_business_unit=(
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_leads' AND column_name='business_unit_id'
);
SET @sql=IF(@has_lead_business_unit=0,
  'ALTER TABLE crm_leads ADD COLUMN business_unit_id BIGINT UNSIGNED NULL AFTER id',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

UPDATE crm_leads
SET business_unit_id=(SELECT id FROM crm_business_units WHERE unit_code='school_admissions' LIMIT 1)
WHERE business_unit_id IS NULL;

SET @has_lead_business_unit_index=(
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='crm_leads' AND index_name='ix_crm_leads_business_unit'
);
SET @sql=IF(@has_lead_business_unit_index=0,
  'ALTER TABLE crm_leads MODIFY business_unit_id BIGINT UNSIGNED NOT NULL DEFAULT 1,
   ADD KEY ix_crm_leads_business_unit (business_unit_id,created_at_utc),
   ADD CONSTRAINT fk_crm_leads_business_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

CREATE TABLE IF NOT EXISTS crm_business_modules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  module_key VARCHAR(60) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  module_type ENUM('leads','operations','tasks','communications','documents','reports','custom') NOT NULL,
  description VARCHAR(500),
  layout_json JSON,
  settings_json JSON,
  position SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_crm_business_module (business_unit_id,module_key),
  CONSTRAINT fk_crm_business_module_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_metadata_fields (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  module_key VARCHAR(60) NOT NULL DEFAULT 'leads',
  field_key VARCHAR(80) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  field_type ENUM('text','textarea','number','decimal','date','datetime','email','phone','boolean','single_select','multi_select','user','file') NOT NULL DEFAULT 'text',
  placeholder VARCHAR(200),
  help_text VARCHAR(500),
  options_json JSON,
  validation_json JSON,
  default_value_json JSON,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  is_filterable BOOLEAN NOT NULL DEFAULT TRUE,
  is_searchable BOOLEAN NOT NULL DEFAULT FALSE,
  show_in_list BOOLEAN NOT NULL DEFAULT TRUE,
  position SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  column_width SMALLINT UNSIGNED NOT NULL DEFAULT 180,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_crm_metadata_field (business_unit_id,module_key,field_key),
  KEY ix_crm_metadata_field_layout (business_unit_id,module_key,is_active,position),
  CONSTRAINT fk_crm_metadata_field_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_metadata_forms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  module_key VARCHAR(60) NOT NULL DEFAULT 'leads',
  form_key VARCHAR(80) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  form_type ENUM('create','edit','view','quick_create') NOT NULL DEFAULT 'create',
  sections_json JSON NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_crm_metadata_form (business_unit_id,module_key,form_key),
  CONSTRAINT fk_crm_metadata_form_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_metadata_pipelines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  pipeline_key VARCHAR(80) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  description VARCHAR(500),
  entity_label_singular VARCHAR(80) NOT NULL DEFAULT 'Lead',
  entity_label_plural VARCHAR(80) NOT NULL DEFAULT 'Leads',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_crm_metadata_pipeline (business_unit_id,pipeline_key),
  CONSTRAINT fk_crm_metadata_pipeline_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_metadata_pipeline_stages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pipeline_id BIGINT UNSIGNED NOT NULL,
  stage_key VARCHAR(80) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  stage_type ENUM('open','won','lost','on_hold') NOT NULL DEFAULT 'open',
  color_code CHAR(7) NOT NULL DEFAULT '#4A4FB1',
  position SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  entry_rules_json JSON,
  exit_rules_json JSON,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_crm_metadata_pipeline_stage (pipeline_id,stage_key),
  KEY ix_crm_metadata_pipeline_stage_order (pipeline_id,is_active,position),
  CONSTRAINT fk_crm_metadata_pipeline_stage_pipeline FOREIGN KEY (pipeline_id) REFERENCES crm_metadata_pipelines(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_metadata_stage_transitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pipeline_id BIGINT UNSIGNED NOT NULL,
  from_stage_id BIGINT UNSIGNED,
  to_stage_id BIGINT UNSIGNED NOT NULL,
  transition_name VARCHAR(150) NOT NULL,
  conditions_json JSON,
  actions_json JSON,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_crm_metadata_stage_transition (pipeline_id,from_stage_id,to_stage_id),
  CONSTRAINT fk_crm_metadata_transition_pipeline FOREIGN KEY (pipeline_id) REFERENCES crm_metadata_pipelines(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_metadata_transition_from FOREIGN KEY (from_stage_id) REFERENCES crm_metadata_pipeline_stages(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_metadata_transition_to FOREIGN KEY (to_stage_id) REFERENCES crm_metadata_pipeline_stages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_dynamic_leads (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  pipeline_id BIGINT UNSIGNED NOT NULL,
  stage_id BIGINT UNSIGNED NOT NULL,
  lead_number VARCHAR(60) NOT NULL,
  display_name VARCHAR(200) NOT NULL,
  primary_phone VARCHAR(30),
  primary_email VARCHAR(254),
  source_key VARCHAR(80),
  status_key VARCHAR(80) NOT NULL DEFAULT 'active',
  owner_employee_id BIGINT,
  custom_values_json JSON,
  next_followup_at_utc DATETIME(6),
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  updated_by_user_id BIGINT UNSIGNED,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at_utc DATETIME(6),
  UNIQUE KEY uq_crm_dynamic_lead_number (business_unit_id,lead_number),
  KEY ix_crm_dynamic_lead_pipeline (business_unit_id,pipeline_id,stage_id),
  KEY ix_crm_dynamic_lead_phone (business_unit_id,primary_phone),
  CONSTRAINT fk_crm_dynamic_lead_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id),
  CONSTRAINT fk_crm_dynamic_lead_pipeline FOREIGN KEY (pipeline_id) REFERENCES crm_metadata_pipelines(id),
  CONSTRAINT fk_crm_dynamic_lead_stage FOREIGN KEY (stage_id) REFERENCES crm_metadata_pipeline_stages(id),
  CONSTRAINT fk_crm_dynamic_lead_owner FOREIGN KEY (owner_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  CONSTRAINT fk_crm_dynamic_lead_created_by FOREIGN KEY (created_by_user_id) REFERENCES app_users(id),
  CONSTRAINT fk_crm_dynamic_lead_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_operation_workflows (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  workflow_key VARCHAR(80) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  entity_label VARCHAR(80) NOT NULL DEFAULT 'Operation',
  description VARCHAR(500),
  form_schema_json JSON,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_crm_operation_workflow (business_unit_id,workflow_key),
  CONSTRAINT fk_crm_operation_workflow_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_operation_stages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workflow_id BIGINT UNSIGNED NOT NULL,
  stage_key VARCHAR(80) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  color_code CHAR(7) NOT NULL DEFAULT '#4A4FB1',
  position SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  stage_type ENUM('open','completed','cancelled','on_hold') NOT NULL DEFAULT 'open',
  checklist_json JSON,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_crm_operation_stage (workflow_id,stage_key),
  CONSTRAINT fk_crm_operation_stage_workflow FOREIGN KEY (workflow_id) REFERENCES crm_operation_workflows(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_operation_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  workflow_id BIGINT UNSIGNED NOT NULL,
  stage_id BIGINT UNSIGNED NOT NULL,
  dynamic_lead_id BIGINT UNSIGNED,
  legacy_lead_id BIGINT UNSIGNED,
  record_number VARCHAR(60) NOT NULL,
  title VARCHAR(200) NOT NULL,
  owner_employee_id BIGINT,
  values_json JSON,
  status_key VARCHAR(50) NOT NULL DEFAULT 'active',
  due_at_utc DATETIME(6),
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  updated_by_user_id BIGINT UNSIGNED,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_crm_operation_record_number (business_unit_id,record_number),
  KEY ix_crm_operation_record_stage (business_unit_id,workflow_id,stage_id),
  CONSTRAINT fk_crm_operation_record_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id),
  CONSTRAINT fk_crm_operation_record_workflow FOREIGN KEY (workflow_id) REFERENCES crm_operation_workflows(id),
  CONSTRAINT fk_crm_operation_record_stage FOREIGN KEY (stage_id) REFERENCES crm_operation_stages(id),
  CONSTRAINT fk_crm_operation_record_dynamic_lead FOREIGN KEY (dynamic_lead_id) REFERENCES crm_dynamic_leads(id) ON DELETE SET NULL,
  CONSTRAINT fk_crm_operation_record_legacy_lead FOREIGN KEY (legacy_lead_id) REFERENCES crm_leads(id) ON DELETE SET NULL,
  CONSTRAINT fk_crm_operation_record_owner FOREIGN KEY (owner_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  CONSTRAINT fk_crm_operation_record_created_by FOREIGN KEY (created_by_user_id) REFERENCES app_users(id),
  CONSTRAINT fk_crm_operation_record_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO crm_business_modules (business_unit_id,module_key,display_name,module_type,description,position,is_active)
SELECT id,'leads','Admission Leads','leads','Existing school admission lead tracking',1,TRUE
FROM crm_business_units WHERE unit_code='school_admissions'
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),is_active=TRUE;

INSERT INTO crm_business_modules (business_unit_id,module_key,display_name,module_type,description,position,is_active)
SELECT id,'operations','Admission Operations','operations','Configurable post-enquiry admission operations',2,TRUE
FROM crm_business_units WHERE unit_code='school_admissions'
ON DUPLICATE KEY UPDATE module_key=VALUES(module_key);

INSERT INTO crm_operation_workflows (business_unit_id,workflow_key,display_name,entity_label,description,is_default)
SELECT id,'admission','Admission Operations','Application','Application, verification, and admission workflow',TRUE
FROM crm_business_units WHERE unit_code='school_admissions'
ON DUPLICATE KEY UPDATE workflow_key=VALUES(workflow_key);

INSERT INTO crm_operation_stages (workflow_id,stage_key,display_name,stage_type,color_code,position)
SELECT ow.id,seed.stage_key,seed.display_name,seed.stage_type,seed.color_code,seed.position
FROM crm_operation_workflows ow
JOIN crm_business_units bu ON bu.id=ow.business_unit_id AND bu.unit_code='school_admissions'
JOIN (
  SELECT 'application' stage_key,'Application' display_name,'open' stage_type,'#555AB1' color_code,1 position
  UNION ALL SELECT 'verification','Verification','open','#3B82F6',2
  UNION ALL SELECT 'admission','Admission','completed','#258268',3
) seed
WHERE ow.workflow_key='admission'
ON DUPLICATE KEY UPDATE stage_key=VALUES(stage_key);
