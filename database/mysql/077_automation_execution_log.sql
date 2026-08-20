-- Automation run history.
--
-- `crm_automation_executions` is a work queue, not a history: PUT /api/automations/:id
-- deletes every row for a workflow whenever its conditions, actions or start time
-- change, so each lead can be re-evaluated against the new rules (the table's
-- unique key on (workflow_id, lead_id, action_index) would otherwise block it).
--
-- The Automations list read its run counts from that queue, so a workflow that had
-- genuinely executed reported "Not run / 0 completed" the moment anyone edited it.
-- This table is append-only and is what those counts are read from.
--
-- No foreign key on lead_id: deleting a lead must not erase the record of what a
-- workflow did. The workflow FK does cascade -- history without its workflow is
-- meaningless.

CREATE TABLE IF NOT EXISTS crm_automation_execution_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workflow_id BIGINT UNSIGNED NOT NULL,
  lead_id BIGINT UNSIGNED NULL,
  action_index SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('completed','skipped','failed') NOT NULL,
  error_message VARCHAR(1000) NULL,
  executed_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_crm_automation_log_workflow (workflow_id, executed_at_utc),
  CONSTRAINT fk_crm_automation_log_workflow FOREIGN KEY (workflow_id)
    REFERENCES crm_automation_workflows(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill 1: terminal rows still sitting in the queue.
INSERT INTO crm_automation_execution_log
  (workflow_id, lead_id, action_index, status, error_message, executed_at_utc)
SELECT e.workflow_id, e.lead_id, e.action_index, e.status, e.error_message,
       COALESCE(e.executed_at_utc, e.created_at_utc)
FROM crm_automation_executions e
WHERE e.status IN ('completed','skipped','failed')
  AND NOT EXISTS (
    SELECT 1 FROM crm_automation_execution_log l
    WHERE l.workflow_id = e.workflow_id
      AND l.lead_id = e.lead_id
      AND l.action_index = e.action_index
      AND l.executed_at_utc = COALESCE(e.executed_at_utc, e.created_at_utc)
  );

-- Backfill 2: runs the queue already lost to rule edits. The engine writes a
-- lead activity for every successful action, so that trail can rebuild them.
-- Guarded by NOT EXISTS so re-running this file cannot double-count.
INSERT INTO crm_automation_execution_log
  (workflow_id, lead_id, action_index, status, executed_at_utc)
SELECT w.id, a.lead_id, 0, 'completed', a.occurred_at_utc
FROM crm_lead_activities a
JOIN crm_automation_workflows w
  ON w.id = CAST(JSON_UNQUOTE(JSON_EXTRACT(a.details_json, '$.workflowId')) AS UNSIGNED)
WHERE a.activity_type = 'Automation'
  AND JSON_EXTRACT(a.details_json, '$.workflowId') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM crm_automation_execution_log l
    WHERE l.workflow_id = w.id
      AND l.lead_id = a.lead_id
      AND l.executed_at_utc = a.occurred_at_utc
  );
