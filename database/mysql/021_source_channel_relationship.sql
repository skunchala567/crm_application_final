SET @has_source_channel = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_lead_sources' AND column_name='channel_id'
);
SET @ddl = IF(
  @has_source_channel=0,
  'ALTER TABLE crm_lead_sources ADD COLUMN channel_id BIGINT UNSIGNED NULL AFTER display_name, ADD KEY ix_crm_lead_sources_channel (channel_id), ADD CONSTRAINT fk_crm_lead_sources_channel FOREIGN KEY (channel_id) REFERENCES crm_lead_channels(id)',
  'SELECT 1'
);
PREPARE statement FROM @ddl;
EXECUTE statement;
DEALLOCATE PREPARE statement;

UPDATE crm_lead_sources s
JOIN (
  SELECT source_id, MIN(channel_id) AS channel_id
  FROM crm_lead_source_history
  GROUP BY source_id
) h ON h.source_id=s.id
SET s.channel_id=h.channel_id
WHERE s.channel_id IS NULL;

UPDATE crm_lead_sources s
JOIN crm_lead_channels ch
  ON LOWER(REPLACE(ch.channel_code,'_',''))=LOWER(REPLACE(s.name,'_',''))
SET s.channel_id=ch.id
WHERE s.channel_id IS NULL;
