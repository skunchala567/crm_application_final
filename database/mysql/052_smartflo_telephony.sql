-- Smartflo uses the existing integrations, branches, users, call activity and dialler tables.
ALTER TABLE branches
  ADD COLUMN smartflo_did_id VARCHAR(100) NULL,
  ADD COLUMN smartflo_did_number VARCHAR(30) NULL,
  ADD COLUMN smartflo_department_id VARCHAR(100) NULL,
  ADD COLUMN smartflo_inbound_enabled TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN smartflo_outbound_enabled TINYINT(1) NOT NULL DEFAULT 1;

ALTER TABLE app_users
  ADD COLUMN smartflo_user_id VARCHAR(100) NULL,
  ADD COLUMN smartflo_agent_id VARCHAR(100) NULL,
  ADD COLUMN smartflo_agent_name VARCHAR(150) NULL,
  ADD COLUMN smartflo_agent_number VARCHAR(30) NULL,
  ADD COLUMN smartflo_department_id VARCHAR(100) NULL,
  ADD COLUMN smartflo_enabled TINYINT(1) NOT NULL DEFAULT 0;
