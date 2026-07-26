-- Keep legacy AiSensy credential columns synchronized for Smartping crm_integrations
-- created through the consolidated Integration Hub.
UPDATE crm_integrations
SET
  project_id = COALESCE(
    NULLIF(project_id, ''),
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config, '$.projectId')), ''),
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config, '$.project_id')), '')
  ),
  project_api_password = COALESCE(
    NULLIF(project_api_password, ''),
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config, '$.projectApiPassword')), ''),
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config, '$.project_api_password')), '')
  )
WHERE LOWER(COALESCE(provider, '')) = 'smartping'
  AND JSON_VALID(config);
