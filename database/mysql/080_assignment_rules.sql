USE attendance_biometric;
SET NAMES utf8mb4;

-- Assignment Rules (Automations > Assignment Rules). Branch, source and
-- assigned-user selections are stored as JSON id arrays rather than join
-- tables: nothing here needs relational querying beyond "does this branch id
-- appear in this rule's list", which JSON_CONTAINS answers directly, and it
-- keeps create/update a single-row write like crm_automation_workflows'
-- definition_json.
CREATE TABLE IF NOT EXISTS crm_assignment_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  branch_ids_json JSON NOT NULL,
  source_ids_json JSON NOT NULL,
  employee_ids_json JSON NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  -- Round-robin cursor over employee_ids_json, advanced each time
  -- resolveAssignmentRuleOwner() hands out this rule's next assignee.
  next_assignee_index INT UNSIGNED NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_crm_assignment_rules_unit (business_unit_id, is_active),
  CONSTRAINT fk_crm_assignment_rules_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_assignment_rules_creator FOREIGN KEY (created_by) REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
