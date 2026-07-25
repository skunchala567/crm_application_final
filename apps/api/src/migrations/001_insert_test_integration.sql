-- Insert Test Data - Simple Version (No Bash Syntax)

-- 1. Create default organization
INSERT INTO organizations (name, status)
VALUES ('Default Organization', 'ACTIVE')
ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id);

-- 2. Create test Smartping integration
INSERT INTO integrations (organization_id, name, type, status)
VALUES (1, 'Test Smartping', 'SMARTPING', 'ACTIVE');

-- 3. Verify what was created
SELECT 'Organizations Created' as label;
SELECT * FROM organizations;

SELECT 'Integrations Created' as label;
SELECT * FROM integrations;
