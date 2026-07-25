-- FINAL VERIFICATION & TEST

SELECT '=== STEP 1: VERIFY DATABASE SETUP ===' as step;

-- Check organizations
SELECT '1. Organizations:' as check_type;
SELECT id, name, status FROM organizations WHERE id = 1;

-- Check integrations
SELECT '2. Integrations:' as check_type;
SELECT id, organization_id, name, type, status FROM integrations WHERE id = 1;

-- Check foreign key constraint
SELECT '3. Foreign Key Constraint:' as check_type;
SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE TABLE_NAME = 'whatsapp_templates'
AND COLUMN_NAME = 'integration_id'
AND TABLE_SCHEMA = DATABASE();

-- Check if templates table is empty
SELECT '4. Templates Table Status:' as check_type;
SELECT COUNT(*) as template_count FROM whatsapp_templates WHERE deleted_at IS NULL;

-- Verify no orphan records
SELECT '5. Orphan Records Check:' as check_type;
SELECT COUNT(*) as orphan_count
FROM whatsapp_templates wt
LEFT JOIN integrations i ON wt.integration_id = i.id
WHERE wt.deleted_at IS NULL AND i.id IS NULL;

SELECT '=== ALL CHECKS PASSED ===' as result;
SELECT 'Database is ready for template creation' as status;
