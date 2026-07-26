-- SIMPLE CHECK: What tables exist?

SELECT '=== TABLES IN DATABASE ===' as check_label;
SELECT
  TABLE_NAME,
  TABLE_TYPE,
  TABLE_ROWS
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;

-- Check if crm_integrations table exists
SELECT '=== DOES INTEGRATIONS TABLE EXIST? ===' as check_label;
SELECT
  IF(COUNT(*) > 0, 'YES - Table exists', 'NO - Table missing') as status
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'crm_integrations';

-- Check if crm_whatsapp_templates exists
SELECT '=== DOES WHATSAPP_TEMPLATES TABLE EXIST? ===' as check_label;
SELECT
  IF(COUNT(*) > 0, 'YES - Table exists', 'NO - Table missing') as status
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'crm_whatsapp_templates';

-- If crm_whatsapp_templates exists, show its structure
SELECT '=== WHATSAPP_TEMPLATES STRUCTURE ===' as check_label;
SHOW CREATE TABLE crm_whatsapp_templates \G

-- Count templates
SELECT '=== TEMPLATE COUNT ===' as check_label;
SELECT COUNT(*) as total_templates FROM crm_whatsapp_templates;

SELECT '=== TEMPLATE NAMES ===' as check_label;
SELECT id, integration_id, template_name, status FROM crm_whatsapp_templates LIMIT 10;
