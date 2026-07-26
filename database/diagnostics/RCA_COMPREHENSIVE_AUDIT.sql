-- ====================================================================
-- ROOT CAUSE ANALYSIS - COMPLETE DATABASE AUDIT
-- ====================================================================

-- ====================================================================
-- STEP 1: DATABASE STRUCTURE INVENTORY
-- ====================================================================

SELECT '=============== TABLE EXISTENCE CHECK ===============' as audit_step;

SELECT
  'crm_integrations' as table_name,
  IF(COUNT(*) > 0, 'EXISTS', 'MISSING') as status
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_integrations'
UNION ALL
SELECT
  'crm_whatsapp_templates',
  IF(COUNT(*) > 0, 'EXISTS', 'MISSING')
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_whatsapp_templates'
UNION ALL
SELECT
  'crm_whatsapp_template_buttons',
  IF(COUNT(*) > 0, 'EXISTS', 'MISSING')
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_whatsapp_template_buttons'
UNION ALL
SELECT
  'crm_whatsapp_template_media',
  IF(COUNT(*) > 0, 'EXISTS', 'MISSING')
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_whatsapp_template_media'
UNION ALL
SELECT
  'crm_whatsapp_template_sync_logs',
  IF(COUNT(*) > 0, 'EXISTS', 'MISSING')
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_whatsapp_template_sync_logs'
UNION ALL
SELECT
  'crm_organizations',
  IF(COUNT(*) > 0, 'EXISTS', 'MISSING')
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_organizations';

-- ====================================================================
-- STEP 2: FOREIGN KEY VALIDATION
-- ====================================================================

SELECT '=============== ALL FOREIGN KEYS ===============' as audit_step;

SELECT
  TABLE_NAME,
  CONSTRAINT_NAME,
  COLUMN_NAME,
  REFERENCED_TABLE_NAME,
  REFERENCED_COLUMN_NAME
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY TABLE_NAME, CONSTRAINT_NAME;

-- ====================================================================
-- STEP 3: INTEGRATIONS TABLE INSPECTION
-- ====================================================================

SELECT '=============== INTEGRATIONS TABLE SCHEMA ===============' as audit_step;
SHOW COLUMNS FROM crm_integrations;

SELECT '=============== INTEGRATIONS TABLE DATA ===============' as audit_step;
SELECT
  id,
  organization_id,
  name,
  type,
  status,
  created_at,
  deleted_at
FROM crm_integrations
ORDER BY id;

-- ====================================================================
-- STEP 4: WHATSAPP_TEMPLATES TABLE INSPECTION
-- ====================================================================

SELECT '=============== WHATSAPP_TEMPLATES TABLE SCHEMA ===============' as audit_step;
SHOW COLUMNS FROM crm_whatsapp_templates;

SELECT '=============== WHATSAPP_TEMPLATES TABLE DATA ===============' as audit_step;
SELECT
  id,
  integration_id,
  organization_id,
  template_name,
  status,
  created_by,
  created_at,
  deleted_at
FROM crm_whatsapp_templates
ORDER BY id;

-- ====================================================================
-- STEP 5: ORPHAN RECORD CHECK
-- ====================================================================

SELECT '=============== ORPHAN RECORDS IN WHATSAPP_TEMPLATES ===============' as audit_step;

-- Check if any templates reference non-existent crm_integrations
SELECT
  wt.id as template_id,
  wt.integration_id,
  wt.template_name,
  wt.status,
  i.id as integration_exists,
  IF(i.id IS NULL, 'ORPHAN - INTEGRATION MISSING', 'OK') as status_check
FROM crm_whatsapp_templates wt
LEFT JOIN crm_integrations i ON wt.integration_id = i.id
WHERE wt.deleted_at IS NULL
ORDER BY wt.integration_id;

-- ====================================================================
-- STEP 6: INTEGRATION VALIDATION
-- ====================================================================

SELECT '=============== INTEGRATION STATUS CHECK ===============' as audit_step;

SELECT
  i.id,
  i.name,
  i.type,
  i.status,
  i.deleted_at,
  COUNT(wt.id) as template_count
FROM crm_integrations i
LEFT JOIN crm_whatsapp_templates wt ON i.id = wt.integration_id AND wt.deleted_at IS NULL
GROUP BY i.id, i.name, i.type, i.status, i.deleted_at;

-- ====================================================================
-- STEP 7: CONSTRAINT INSPECTION
-- ====================================================================

SELECT '=============== CONSTRAINT DETAILS ===============' as audit_step;

SELECT
  CONSTRAINT_NAME,
  TABLE_NAME,
  COLUMN_NAME,
  REFERENCED_TABLE_NAME,
  REFERENCED_COLUMN_NAME,
  UPDATE_RULE,
  DELETE_RULE
FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE()
ORDER BY TABLE_NAME, CONSTRAINT_NAME;

-- ====================================================================
-- STEP 8: DATATYPE MISMATCH CHECK
-- ====================================================================

SELECT '=============== DATATYPE COMPARISON ===============' as audit_step;

SELECT
  'crm_integrations.id' as field,
  COLUMN_TYPE as datatype,
  IS_NULLABLE as nullable,
  COLUMN_KEY as key_type
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_integrations' AND COLUMN_NAME = 'id'
UNION ALL
SELECT
  'crm_whatsapp_templates.integration_id',
  COLUMN_TYPE,
  IS_NULLABLE,
  COLUMN_KEY
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_whatsapp_templates' AND COLUMN_NAME = 'integration_id';

-- ====================================================================
-- STEP 9: ORGANIZATIONS TABLE CHECK
-- ====================================================================

SELECT '=============== ORGANIZATIONS TABLE ===============' as audit_step;

SELECT
  id,
  name,
  status,
  created_at
FROM crm_organizations
ORDER BY id;

-- ====================================================================
-- STEP 10: INTEGRATION ORGANIZATION RELATIONSHIP
-- ====================================================================

SELECT '=============== INTEGRATION -> ORGANIZATION VALIDATION ===============' as audit_step;

SELECT
  i.id as integration_id,
  i.organization_id,
  i.name,
  i.status,
  o.id as org_exists,
  IF(o.id IS NULL, 'ORPHAN - ORG MISSING', 'OK') as status_check
FROM crm_integrations i
LEFT JOIN crm_organizations o ON i.organization_id = o.id
ORDER BY i.id;

-- ====================================================================
-- STEP 11: MISSING DATA DIAGNOSIS
-- ====================================================================

SELECT '=============== WHY MIGHT INSERT FAIL? ===============' as audit_step;

SELECT
  CASE
    WHEN COUNT(DISTINCT integration_id) = 0 THEN 'NO INTEGRATIONS EXIST'
    WHEN COUNT(DISTINCT i.id) = 0 THEN 'REFERENCED INTEGRATION MISSING'
    WHEN COUNT(DISTINCT o.id) = 0 THEN 'REFERENCED ORG MISSING'
    ELSE 'DATA EXISTS - CHECK FK CONSTRAINT'
  END as potential_issue,
  COUNT(*) as count
FROM (
  SELECT DISTINCT 3 as integration_id
) needed_integration
LEFT JOIN crm_integrations i ON needed_integration.integration_id = i.id
LEFT JOIN crm_organizations o ON i.organization_id = o.id;

-- ====================================================================
-- STEP 12: EXACT ISSUE DIAGNOSIS
-- ====================================================================

SELECT '=============== TRYING TO INSERT WITH ID 3 ===============' as audit_step;

SELECT
  3 as attempting_integration_id,
  EXISTS(SELECT 1 FROM crm_integrations WHERE id = 3) as integration_exists,
  CASE
    WHEN EXISTS(SELECT 1 FROM crm_integrations WHERE id = 3) THEN 'WILL SUCCEED'
    ELSE 'WILL FAIL - FK CONSTRAINT'
  END as insert_result;

-- ====================================================================
-- SUMMARY
-- ====================================================================

SELECT '=============== SUMMARY ===============' as audit_step;

SELECT
  (SELECT COUNT(*) FROM crm_integrations) as total_integrations,
  (SELECT COUNT(*) FROM crm_organizations) as total_organizations,
  (SELECT COUNT(*) FROM crm_whatsapp_templates WHERE deleted_at IS NULL) as active_templates,
  (SELECT COUNT(*) FROM crm_integrations WHERE id = 3) as integration_3_exists,
  (SELECT COUNT(*) FROM crm_integrations WHERE id = 1) as integration_1_exists;
