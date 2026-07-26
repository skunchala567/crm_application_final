-- DEEP DIAGNOSTIC: Find the actual root cause of duplicate errors

-- 1. Show EXACT query that's being run in the service
-- This mimics: SELECT id FROM crm_whatsapp_templates WHERE integration_id = ? AND LOWER(template_name) = ? AND deleted_at IS NULL

SET @integration_id = 1;  -- CHANGE THIS to the integration ID being tested
SET @template_name = 'thisisastest';  -- CHANGE THIS to the template name

SELECT '=== QUERY THAT SERVICE RUNS ===' as debug_label;
SELECT
  wt.id,
  wt.integration_id,
  wt.organization_id,
  wt.template_name,
  LOWER(wt.template_name) as name_lowercase,
  wt.deleted_at,
  wt.status,
  wt.created_at
FROM crm_whatsapp_templates wt
WHERE wt.integration_id = @integration_id
  AND LOWER(wt.template_name) = LOWER(@template_name)
  AND wt.deleted_at IS NULL;

-- 2. Check if there are ANY templates with this name (across all crm_integrations/orgs)
SELECT '=== CHECKING ALL TEMPLATES WITH THIS NAME ===' as debug_label;
SELECT
  wt.id,
  wt.integration_id,
  wt.organization_id,
  wt.template_name,
  wt.status,
  wt.deleted_at,
  wt.created_at
FROM crm_whatsapp_templates wt
WHERE LOWER(wt.template_name) = LOWER(@template_name);

-- 3. Show all crm_integrations and their template counts
SELECT '=== ALL INTEGRATIONS WITH TEMPLATES ===' as debug_label;
SELECT
  i.id,
  i.name,
  COUNT(wt.id) as template_count,
  GROUP_CONCAT(DISTINCT wt.organization_id) as org_ids,
  GROUP_CONCAT(wt.template_name ORDER BY wt.template_name SEPARATOR ', ') as template_names
FROM crm_integrations i
LEFT JOIN crm_whatsapp_templates wt ON i.id = wt.integration_id AND wt.deleted_at IS NULL
GROUP BY i.id, i.name
ORDER BY i.id;

-- 4. Check for COLLATION issues
SELECT '=== DATABASE COLLATION INFO ===' as debug_label;
SELECT
  TABLE_NAME,
  COLUMN_NAME,
  COLLATION_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'crm_whatsapp_templates'
  AND COLUMN_NAME IN ('template_name', 'template_name')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- 5. Check UNIQUE constraint status
SELECT '=== UNIQUE CONSTRAINT CHECK ===' as debug_label;
SELECT
  TABLE_NAME,
  CONSTRAINT_NAME,
  CONSTRAINT_TYPE,
  COLUMN_NAME
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'crm_whatsapp_templates'
  AND CONSTRAINT_NAME LIKE '%unique%'
ORDER BY TABLE_NAME, CONSTRAINT_NAME;

-- 6. Find any NULL values in deleted_at that might be causing confusion
SELECT '=== TEMPLATES WITH NULL deleted_at ===' as debug_label;
SELECT COUNT(*) as count_with_null_deleted_at
FROM crm_whatsapp_templates
WHERE deleted_at IS NULL;

SELECT '=== TEMPLATES WITH NON-NULL deleted_at ===' as debug_label;
SELECT COUNT(*) as count_with_deleted_at
FROM crm_whatsapp_templates
WHERE deleted_at IS NOT NULL;

-- 7. Show the exact table structure
SELECT '=== TABLE STRUCTURE ===' as debug_label;
SHOW COLUMNS FROM crm_whatsapp_templates;

-- 8. List ALL non-deleted templates (for context)
SELECT '=== ALL ACTIVE TEMPLATES ===' as debug_label;
SELECT
  wt.id,
  wt.integration_id,
  wt.organization_id,
  wt.template_name,
  wt.status,
  wt.created_at,
  wt.deleted_at
FROM crm_whatsapp_templates wt
WHERE wt.deleted_at IS NULL
ORDER BY wt.integration_id, wt.template_name;

-- 9. Check if there are duplicates (multiple rows with same name)
SELECT '=== CHECK FOR DUPLICATES ===' as debug_label;
SELECT
  integration_id,
  LOWER(template_name) as name_normalized,
  COUNT(*) as occurrence_count,
  GROUP_CONCAT(id ORDER BY id) as ids,
  GROUP_CONCAT(deleted_at) as deleted_at_values
FROM crm_whatsapp_templates
WHERE deleted_at IS NULL
GROUP BY integration_id, LOWER(template_name)
HAVING COUNT(*) > 1
ORDER BY integration_id, name_normalized;

-- 10. Check database connection/permissions
SELECT '=== DATABASE INFO ===' as debug_label;
SELECT
  DATABASE() as current_database,
  USER() as current_user,
  VERSION() as mysql_version,
  @@sql_mode as sql_mode;
