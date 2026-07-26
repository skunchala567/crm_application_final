-- Cleanup test template data
-- This removes test templates created during development

DELETE FROM crm_whatsapp_template_buttons
WHERE template_id IN (
  SELECT id FROM crm_whatsapp_templates
  WHERE template_name IN ('tesdsdfsd', 'hbgvfc', 'welcome', 'test', 'sample', 'demo')
  AND deleted_at IS NULL
);

DELETE FROM crm_whatsapp_template_media
WHERE template_id IN (
  SELECT id FROM crm_whatsapp_templates
  WHERE template_name IN ('tesdsdfsd', 'hbgvfc', 'welcome', 'test', 'sample', 'demo')
  AND deleted_at IS NULL
);

DELETE FROM crm_whatsapp_template_sync_logs
WHERE template_id IN (
  SELECT id FROM crm_whatsapp_templates
  WHERE template_name IN ('tesdsdfsd', 'hbgvfc', 'welcome', 'test', 'sample', 'demo')
  AND deleted_at IS NULL
);

DELETE FROM crm_whatsapp_templates
WHERE template_name IN ('tesdsdfsd', 'hbgvfc', 'welcome', 'test', 'sample', 'demo')
AND deleted_at IS NULL;

-- Optional: You can also soft-delete instead of hard-delete
-- UPDATE crm_whatsapp_templates
-- SET deleted_at = NOW()
-- WHERE template_name IN ('tesdsdfsd', 'hbgvfc', 'welcome', 'test', 'sample', 'demo')
-- AND deleted_at IS NULL;
