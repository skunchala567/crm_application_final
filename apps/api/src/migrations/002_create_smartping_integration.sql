-- Create Smartping Integration for WhatsApp Templates

-- First ensure organization exists
INSERT INTO organizations (id, name, status)
VALUES (1, 'Default Organization', 'ACTIVE')
ON DUPLICATE KEY UPDATE id=id;

-- Create Smartping integration in integrations table
INSERT INTO integrations (id, organization_id, name, type, status, created_at)
VALUES (1, 1, 'Smartping WhatsApp', 'SMARTPING', 'ACTIVE', NOW())
ON DUPLICATE KEY UPDATE id=id;

-- Verify
SELECT 'Smartping integration created/verified' as status;
SELECT id, organization_id, name, type, status FROM integrations WHERE id = 1;
