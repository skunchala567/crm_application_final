ALTER TABLE branches
  ADD COLUMN calling_provider ENUM('none','callerdesk','smartflo') NOT NULL DEFAULT 'none';

UPDATE branches
SET calling_provider=CASE
  WHEN smartflo_did_number IS NOT NULL AND smartflo_did_number<>'' THEN 'smartflo'
  WHEN callerdesk_did_number IS NOT NULL AND callerdesk_did_number<>'' THEN 'callerdesk'
  ELSE 'none'
END;

UPDATE branches SET
  callerdesk_inbound_enabled=IF(calling_provider='callerdesk',callerdesk_inbound_enabled,0),
  callerdesk_outbound_enabled=IF(calling_provider='callerdesk',callerdesk_outbound_enabled,0),
  smartflo_inbound_enabled=IF(calling_provider='smartflo',smartflo_inbound_enabled,0),
  smartflo_outbound_enabled=IF(calling_provider='smartflo',smartflo_outbound_enabled,0);
