-- DIAGNOSTIC: Audit all templates and find duplicates/issues
-- Run this to understand the current state of your templates

-- 1. Count all templates (including deleted)
SELECT
  'TOTAL TEMPLATES' as metric,
  COUNT(*) as count
FROM crm_whatsapp_templates;

-- 2. Count non-deleted templates
SELECT
  'NON-DELETED TEMPLATES' as metric,
  COUNT(*) as count
FROM crm_whatsapp_templates
WHERE deleted_at IS NULL;

-- 3. Show all templates by integration
SELECT
  i.id as integration_id,
  i.name as integration_name,
  COUNT(wt.id) as template_count,
  GROUP_CONCAT(wt.template_name ORDER BY wt.template_name) as template_names
FROM crm_integrations i
LEFT JOIN crm_whatsapp_templates wt ON i.id = wt.integration_id AND wt.deleted_at IS NULL
GROUP BY i.id, i.name
ORDER BY i.id;

-- 4. Find duplicate template names within same integration
SELECT
  integration_id,
  LOWER(template_name) as name_normalized,
  COUNT(*) as duplicate_count,
  GROUP_CONCAT(id ORDER BY id) as template_ids,
  GROUP_CONCAT(template_name) as actual_names
FROM crm_whatsapp_templates
WHERE deleted_at IS NULL
GROUP BY integration_id, LOWER(template_name)
HAVING COUNT(*) > 1
ORDER BY integration_id, duplicate_count DESC;

-- 5. Show all templates (non-deleted) with details
SELECT
  wt.id,
  wt.integration_id,
  wt.organization_id,
  wt.template_name,
  wt.status,
  wt.category,
  wt.language,
  wt.created_at,
  wt.updated_at,
  wt.deleted_at
FROM crm_whatsapp_templates wt
WHERE deleted_at IS NULL
ORDER BY wt.integration_id, wt.template_name;

-- 6. Show test/demo templates (likely for cleanup)
SELECT
  wt.id,
  wt.integration_id,
  wt.template_name,
  wt.status,
  wt.created_at,
  wt.deleted_at
FROM crm_whatsapp_templates wt
WHERE deleted_at IS NULL
AND LOWER(template_name) REGEXP '^(test|demo|sample|welcome|temp|tmp|abc|xyz|swerxdfcghvkhjhggsxdf|hbgvfc|tesdsdfsd)'
ORDER BY wt.integration_id, wt.created_at;

-- 7. Count by organization
SELECT
  organization_id,
  COUNT(*) as template_count
FROM crm_whatsapp_templates
WHERE deleted_at IS NULL
GROUP BY organization_id
ORDER BY template_count DESC;
