SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS crm_automation_executions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workflow_id BIGINT UNSIGNED NOT NULL,
  lead_id BIGINT UNSIGNED NOT NULL,
  action_index SMALLINT UNSIGNED NOT NULL,
  action_json JSON NOT NULL,
  scheduled_for DATETIME(6) NOT NULL,
  status ENUM('pending','running','completed','skipped','failed') NOT NULL DEFAULT 'pending',
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  result_json JSON NULL,
  error_message VARCHAR(1000) NULL,
  executed_at_utc DATETIME(6) NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_automation_execution (workflow_id, lead_id, action_index),
  KEY ix_crm_automation_execution_due (status, scheduled_for),
  KEY ix_crm_automation_execution_lead (lead_id),
  CONSTRAINT fk_crm_automation_execution_workflow FOREIGN KEY (workflow_id)
    REFERENCES crm_automation_workflows(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_automation_execution_lead FOREIGN KEY (lead_id)
    REFERENCES crm_leads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
