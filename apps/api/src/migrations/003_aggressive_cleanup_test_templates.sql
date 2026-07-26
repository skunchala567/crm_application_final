-- AGGRESSIVE Cleanup: Remove ALL test/demo templates
-- This identifies and removes templates that are clearly for testing

-- Step 1: Show what will be deleted (for safety review)
SELECT
  wt.id,
  wt.integration_id,
  wt.template_name,
  wt.status,
  wt.created_at,
  'WILL DELETE' as action
FROM crm_whatsapp_templates wt
WHERE deleted_at IS NULL
AND (
  -- Exact matches for known test names
  LOWER(wt.template_name) IN (
    'tesdsdfsd',
    'hbgvfc',
    'swerxdfcghvkhjhggsxdf',
    'welcome',
    'test',
    'sample',
    'demo'
  )
  -- OR pattern-based (obvious test names)
  OR LOWER(wt.template_name) REGEXP '^(test_|demo_|sample_|temp_|tmp_|abc_|xyz_)'
  OR LOWER(wt.template_name) REGEXP '(test|demo|sample|temp|tmp|xyz|abc)$'
  -- Single letter or short random strings (likely test data)
  OR LENGTH(wt.template_name) <= 2
  -- Obviously random strings
  OR wt.template_name REGEXP '^[a-z0-9]{15,}$'
)
ORDER BY wt.integration_id, wt.template_name;

-- Step 2: Delete the test templates (hard delete)
-- Uncomment to execute:

/*
DELETE FROM crm_whatsapp_template_buttons
WHERE template_id IN (
  SELECT wt.id FROM crm_whatsapp_templates wt
  WHERE deleted_at IS NULL
  AND (
    LOWER(wt.template_name) IN ('tesdsdfsd', 'hbgvfc', 'swerxdfcghvkhjhggsxdf', 'welcome', 'test', 'sample', 'demo')
    OR LOWER(wt.template_name) REGEXP '^(test_|demo_|sample_|temp_|tmp_|abc_|xyz_)'
    OR LOWER(wt.template_name) REGEXP '(test|demo|sample|temp|tmp|xyz|abc)$'
    OR LENGTH(wt.template_name) <= 2
    OR wt.template_name REGEXP '^[a-z0-9]{15,}$'
  )
);

DELETE FROM crm_whatsapp_template_media
WHERE template_id IN (
  SELECT wt.id FROM crm_whatsapp_templates wt
  WHERE deleted_at IS NULL
  AND (
    LOWER(wt.template_name) IN ('tesdsdfsd', 'hbgvfc', 'swerxdfcghvkhjhggsxdf', 'welcome', 'test', 'sample', 'demo')
    OR LOWER(wt.template_name) REGEXP '^(test_|demo_|sample_|temp_|tmp_|abc_|xyz_)'
    OR LOWER(wt.template_name) REGEXP '(test|demo|sample|temp|tmp|xyz|abc)$'
    OR LENGTH(wt.template_name) <= 2
    OR wt.template_name REGEXP '^[a-z0-9]{15,}$'
  )
);

DELETE FROM crm_whatsapp_template_sync_logs
WHERE template_id IN (
  SELECT wt.id FROM crm_whatsapp_templates wt
  WHERE deleted_at IS NULL
  AND (
    LOWER(wt.template_name) IN ('tesdsdfsd', 'hbgvfc', 'swerxdfcghvkhjhggsxdf', 'welcome', 'test', 'sample', 'demo')
    OR LOWER(wt.template_name) REGEXP '^(test_|demo_|sample_|temp_|tmp_|abc_|xyz_)'
    OR LOWER(wt.template_name) REGEXP '(test|demo|sample|temp|tmp|xyz|abc)$'
    OR LENGTH(wt.template_name) <= 2
    OR wt.template_name REGEXP '^[a-z0-9]{15,}$'
  )
);

DELETE FROM crm_whatsapp_templates
WHERE deleted_at IS NULL
AND (
  LOWER(template_name) IN ('tesdsdfsd', 'hbgvfc', 'swerxdfcghvkhjhggsxdf', 'welcome', 'test', 'sample', 'demo')
  OR LOWER(template_name) REGEXP '^(test_|demo_|sample_|temp_|tmp_|abc_|xyz_)'
  OR LOWER(template_name) REGEXP '(test|demo|sample|temp|tmp|xyz|abc)$'
  OR LENGTH(template_name) <= 2
  OR template_name REGEXP '^[a-z0-9]{15,}$'
);
*/

-- Step 3: Alternative - Soft delete (safer, keep records)
-- Uncomment to execute:

/*
UPDATE crm_whatsapp_templates
SET deleted_at = NOW()
WHERE deleted_at IS NULL
AND (
  LOWER(template_name) IN ('tesdsdfsd', 'hbgvfc', 'swerxdfcghvkhjhggsxdf', 'welcome', 'test', 'sample', 'demo')
  OR LOWER(template_name) REGEXP '^(test_|demo_|sample_|temp_|tmp_|abc_|xyz_)'
  OR LOWER(template_name) REGEXP '(test|demo|sample|temp|tmp|xyz|abc)$'
  OR LENGTH(template_name) <= 2
  OR template_name REGEXP '^[a-z0-9]{15,}$'
);
*/
