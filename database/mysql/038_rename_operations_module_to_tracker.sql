-- Rename the user-facing Operations module while preserving internal keys,
-- routes, tables, and relationships for backward compatibility.
UPDATE crm_business_modules
SET display_name = 'Tracker',
    description = 'Business-specific tracker workflows'
WHERE module_key = 'operations';

UPDATE crm_operation_workflows
SET display_name = REPLACE(display_name, 'Operations', 'Tracker'),
    entity_label = CASE
      WHEN entity_label = 'Operation' THEN 'Tracker record'
      ELSE entity_label
    END
WHERE display_name LIKE '%Operations%'
   OR entity_label = 'Operation';
