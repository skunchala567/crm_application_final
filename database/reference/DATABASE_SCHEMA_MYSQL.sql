-- =====================================================
-- ADMISSIONS CRM - COMPLETE DATABASE SCHEMA
-- MySQL 8.0+
-- =====================================================

SET FOREIGN_KEY_CHECKS=0;
SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';

-- =====================================================
-- 1. CORE ENTITIES
-- =====================================================

-- Organizations (Multi-tenancy support)
CREATE TABLE IF NOT EXISTS crm_organizations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  website VARCHAR(255),
  logo_url VARCHAR(500),
  subscription_plan VARCHAR(50) NOT NULL DEFAULT 'standard',
  subscription_status VARCHAR(50) NOT NULL DEFAULT 'active',
  max_users INT NOT NULL DEFAULT 50,
  max_leads INT NOT NULL DEFAULT 10000,
  max_storage_mb INT NOT NULL DEFAULT 5120,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_id INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  KEY idx_organizations_uuid (uuid),
  KEY idx_organizations_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Branches (Organization locations)
CREATE TABLE IF NOT EXISTS branches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  organization_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  branch_code VARCHAR(50) NOT NULL,
  address VARCHAR(500),
  city VARCHAR(100),
  state VARCHAR(100),
  country VARCHAR(100),
  pincode VARCHAR(20),
  phone VARCHAR(20),
  email VARCHAR(255),
  manager_id INT,
  principal_name VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  UNIQUE KEY uk_organization_branch_code (organization_id, branch_code),
  KEY idx_branches_organization_id (organization_id),
  KEY idx_branches_uuid (uuid),
  CONSTRAINT fk_branches_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Users (Staff members)
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  organization_id INT NOT NULL,
  branch_id INT,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20),
  avatar_url VARCHAR(500),
  role_id INT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  last_login_at TIMESTAMP NULL,
  login_count INT DEFAULT 0,
  failed_login_attempts INT DEFAULT 0,
  locked_until TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  UNIQUE KEY uk_organization_email (organization_id, email),
  KEY idx_users_organization_id (organization_id),
  KEY idx_users_branch_id (branch_id),
  KEY idx_users_uuid (uuid),
  KEY idx_users_email (email),
  KEY idx_users_is_active (is_active),
  CONSTRAINT fk_users_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Roles & Permissions
CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  organization_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  description TEXT,
  permissions JSON DEFAULT '[]',
  is_system_role BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_organization_role_name (organization_id, name),
  KEY idx_roles_organization_id (organization_id),
  KEY idx_roles_uuid (uuid),
  CONSTRAINT fk_roles_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add role_id foreign key to users
ALTER TABLE users ADD CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL;

-- =====================================================
-- 2. LEAD MANAGEMENT
-- =====================================================

-- Lead Stages (Configurable workflow stages)
CREATE TABLE IF NOT EXISTS lead_stages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  organization_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  description TEXT,
  position INT NOT NULL,
  color_code VARCHAR(7) NOT NULL DEFAULT '#3B82F6',
  icon VARCHAR(50),
  is_active BOOLEAN NOT NULL DEFAULT true,
  allow_automation BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_organization_stage_name (organization_id, name),
  KEY idx_lead_stages_organization_id (organization_id),
  CONSTRAINT fk_lead_stages_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lead Sub-Stages
CREATE TABLE IF NOT EXISTS lead_sub_stages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  lead_stage_id INT NOT NULL,
  organization_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  position INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_stage_substage_name (lead_stage_id, name),
  KEY idx_lead_sub_stages_lead_stage_id (lead_stage_id),
  CONSTRAINT fk_lead_sub_stages_stage FOREIGN KEY (lead_stage_id) REFERENCES lead_stages(id) ON DELETE CASCADE,
  CONSTRAINT fk_lead_sub_stages_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lead Sources
CREATE TABLE IF NOT EXISTS lead_sources (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  organization_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  category VARCHAR(50),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_organization_source_name (organization_id, name),
  KEY idx_lead_sources_organization_id (organization_id),
  CONSTRAINT fk_lead_sources_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Leads (Main table)
CREATE TABLE IF NOT EXISTS leads (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  organization_id INT NOT NULL,
  branch_id INT NOT NULL,
  lead_id_display VARCHAR(50) NOT NULL,

  -- Student Information
  student_name VARCHAR(255) NOT NULL,
  student_email VARCHAR(255),
  student_dob DATE,
  student_gender VARCHAR(20),

  -- Parent Information
  father_name VARCHAR(255),
  father_phone VARCHAR(20),
  father_email VARCHAR(255),
  father_occupation VARCHAR(100),
  mother_name VARCHAR(255),
  mother_phone VARCHAR(20),
  mother_email VARCHAR(255),
  mother_occupation VARCHAR(100),
  parent_type VARCHAR(50),
  parent_interested BOOLEAN,
  parent_phone VARCHAR(20),

  -- Contact Information
  phone VARCHAR(20) NOT NULL,
  alternate_phone VARCHAR(20),
  email VARCHAR(255),
  whatsapp_number VARCHAR(20),

  -- Academic Information
  current_class VARCHAR(50),
  applying_class VARCHAR(50),
  academic_year VARCHAR(20),
  curriculum VARCHAR(50),

  -- Location
  city VARCHAR(100),
  district VARCHAR(100),
  state VARCHAR(100),
  country VARCHAR(100),
  pincode VARCHAR(20),

  -- Lead Management
  source_id INT,
  campaign VARCHAR(255),
  medium VARCHAR(100),
  utm_source VARCHAR(100),
  utm_medium VARCHAR(100),
  utm_campaign VARCHAR(100),
  lead_score INT DEFAULT 0,
  lead_owner_id INT,
  previous_owner_id INT,

  -- Status & Stage
  status VARCHAR(50) NOT NULL DEFAULT 'new',
  lead_stage_id INT,
  lead_sub_stage_id INT,
  admission_type VARCHAR(50),

  -- Engagement Tracking
  tags JSON DEFAULT '[]',
  remarks TEXT,
  whatsapp_response VARCHAR(50),
  application_submitted BOOLEAN DEFAULT false,
  documents_uploaded BOOLEAN DEFAULT false,
  payment_status VARCHAR(50),
  admission_status VARCHAR(50),

  -- Dates
  created_by_id INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_followup_at TIMESTAMP NULL,
  next_followup_at TIMESTAMP NULL,
  last_communication_at TIMESTAMP NULL,
  deleted_at TIMESTAMP NULL,

  KEY idx_leads_organization_id (organization_id),
  KEY idx_leads_branch_id (branch_id),
  KEY idx_leads_uuid (uuid),
  KEY idx_leads_phone (phone),
  KEY idx_leads_email (email),
  KEY idx_leads_lead_owner_id (lead_owner_id),
  KEY idx_leads_status (status),
  KEY idx_leads_lead_stage_id (lead_stage_id),
  KEY idx_leads_created_at (created_at),
  KEY idx_leads_next_followup_at (next_followup_at),
  KEY idx_leads_lead_score (lead_score),

  CONSTRAINT fk_leads_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_leads_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_leads_source FOREIGN KEY (source_id) REFERENCES lead_sources(id) ON DELETE SET NULL,
  CONSTRAINT fk_leads_lead_owner FOREIGN KEY (lead_owner_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_leads_previous_owner FOREIGN KEY (previous_owner_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_leads_lead_stage FOREIGN KEY (lead_stage_id) REFERENCES lead_stages(id) ON DELETE SET NULL,
  CONSTRAINT fk_leads_created_by FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lead Activity History
CREATE TABLE IF NOT EXISTS lead_activities (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  lead_id BIGINT NOT NULL,
  organization_id INT NOT NULL,
  activity_type VARCHAR(50) NOT NULL,
  activity_title VARCHAR(255),
  description TEXT,
  outcome VARCHAR(100),
  duration_minutes INT,
  priority VARCHAR(20),
  performed_by_id INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_lead_activities_lead_id (lead_id),
  KEY idx_lead_activities_organization_id (organization_id),
  KEY idx_lead_activities_activity_type (activity_type),
  KEY idx_lead_activities_created_at (created_at),

  CONSTRAINT fk_lead_activities_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_lead_activities_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_lead_activities_performed_by FOREIGN KEY (performed_by_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lead History (Audit trail)
CREATE TABLE IF NOT EXISTS lead_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  lead_id BIGINT NOT NULL,
  organization_id INT NOT NULL,
  changed_by_id INT,
  field_name VARCHAR(100) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_lead_history_lead_id (lead_id),
  KEY idx_lead_history_changed_at (changed_at),

  CONSTRAINT fk_lead_history_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_lead_history_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_lead_history_changed_by FOREIGN KEY (changed_by_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lead Duplicates
CREATE TABLE IF NOT EXISTS lead_duplicates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id_1 BIGINT NOT NULL,
  lead_id_2 BIGINT NOT NULL,
  organization_id INT NOT NULL,
  similarity_score DECIMAL(3,2),
  detection_reason VARCHAR(100),
  status VARCHAR(50) DEFAULT 'unresolved',
  detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  resolved_by_id INT,

  KEY idx_lead_duplicates_lead_id_1 (lead_id_1),
  KEY idx_lead_duplicates_organization (organization_id),

  CONSTRAINT fk_lead_duplicates_lead_1 FOREIGN KEY (lead_id_1) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_lead_duplicates_lead_2 FOREIGN KEY (lead_id_2) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_lead_duplicates_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_lead_duplicates_resolved_by FOREIGN KEY (resolved_by_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 3. FOLLOW-UPS & COMMUNICATIONS
-- =====================================================

-- Follow-ups
CREATE TABLE IF NOT EXISTS followups (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  lead_id BIGINT NOT NULL,
  organization_id INT NOT NULL,
  followup_type VARCHAR(50) NOT NULL,
  scheduled_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP NULL,
  reminder_at TIMESTAMP NULL,
  assigned_to_id INT,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  priority VARCHAR(20) DEFAULT 'medium',
  remarks TEXT,
  outcome VARCHAR(100),
  attachments JSON DEFAULT '[]',
  next_followup_date DATE,
  created_by_id INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,

  KEY idx_followups_lead_id (lead_id),
  KEY idx_followups_organization_id (organization_id),
  KEY idx_followups_assigned_to_id (assigned_to_id),
  KEY idx_followups_scheduled_at (scheduled_at),
  KEY idx_followups_status (status),

  CONSTRAINT fk_followups_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_followups_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_followups_assigned_to FOREIGN KEY (assigned_to_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_followups_created_by FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Communications
CREATE TABLE IF NOT EXISTS communications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  lead_id BIGINT NOT NULL,
  organization_id INT NOT NULL,
  communication_type VARCHAR(50) NOT NULL,
  direction VARCHAR(20) NOT NULL,
  subject VARCHAR(255),
  message TEXT,
  sender_id INT,
  recipient_email VARCHAR(255),
  recipient_phone VARCHAR(20),
  status VARCHAR(50),
  provider VARCHAR(50),
  external_id VARCHAR(255),
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_communications_lead_id (lead_id),
  KEY idx_communications_organization_id (organization_id),
  KEY idx_communications_type (communication_type),
  KEY idx_communications_created_at (created_at),

  CONSTRAINT fk_communications_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_communications_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_communications_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Communication Templates
CREATE TABLE IF NOT EXISTS communication_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  organization_id INT NOT NULL,
  template_type VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  subject VARCHAR(255),
  content TEXT NOT NULL,
  variables JSON DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_id INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_organization_template_name (organization_id, template_type, name),
  KEY idx_communication_templates_organization_id (organization_id),

  CONSTRAINT fk_communication_templates_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_communication_templates_created_by FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 4. DOCUMENTS & FILES
-- =====================================================

CREATE TABLE IF NOT EXISTS documents (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  lead_id BIGINT NOT NULL,
  organization_id INT NOT NULL,
  document_type VARCHAR(100),
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size BIGINT,
  mime_type VARCHAR(100),
  s3_key VARCHAR(500),
  is_verified BOOLEAN DEFAULT false,
  verified_by_id INT,
  verified_at TIMESTAMP NULL,
  uploaded_by_id INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,

  KEY idx_documents_lead_id (lead_id),
  KEY idx_documents_organization_id (organization_id),

  CONSTRAINT fk_documents_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_documents_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_documents_verified_by FOREIGN KEY (verified_by_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_documents_uploaded_by FOREIGN KEY (uploaded_by_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 5. TASKS & REMINDERS
-- =====================================================

CREATE TABLE IF NOT EXISTS tasks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  lead_id BIGINT,
  organization_id INT NOT NULL,
  task_type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  assigned_to_id INT,
  priority VARCHAR(20) DEFAULT 'medium',
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  due_date DATE,
  due_time TIME,
  reminder_time TIMESTAMP NULL,
  is_recurring BOOLEAN DEFAULT false,
  recurrence_pattern VARCHAR(50),
  completed_at TIMESTAMP NULL,
  created_by_id INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,

  KEY idx_tasks_lead_id (lead_id),
  KEY idx_tasks_organization_id (organization_id),
  KEY idx_tasks_assigned_to_id (assigned_to_id),
  KEY idx_tasks_due_date (due_date),

  CONSTRAINT fk_tasks_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_tasks_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_tasks_assigned_to FOREIGN KEY (assigned_to_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_tasks_created_by FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 6. APPLICATIONS & ADMISSIONS
-- =====================================================

CREATE TABLE IF NOT EXISTS applications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  lead_id BIGINT NOT NULL,
  organization_id INT NOT NULL,
  application_number VARCHAR(50) NOT NULL UNIQUE,
  academic_year VARCHAR(20),
  applying_class VARCHAR(50),
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  submitted_at TIMESTAMP NULL,
  decision VARCHAR(50),
  decision_at TIMESTAMP NULL,
  admission_letter_generated BOOLEAN DEFAULT false,
  offer_letter_generated BOOLEAN DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_applications_lead_id (lead_id),
  KEY idx_applications_organization_id (organization_id),
  KEY idx_applications_status (status),

  CONSTRAINT fk_applications_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_applications_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  lead_id BIGINT,
  application_id BIGINT,
  organization_id INT NOT NULL,
  payment_type VARCHAR(50),
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'INR',
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  transaction_id VARCHAR(255),
  payment_method VARCHAR(50),
  receipt_number VARCHAR(50),
  paid_at TIMESTAMP NULL,
  created_by_id INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_payments_lead_id (lead_id),
  KEY idx_payments_organization_id (organization_id),
  KEY idx_payments_status (status),

  CONSTRAINT fk_payments_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_payments_application FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_payments_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_payments_created_by FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 7. WORKFLOWS & AUTOMATION
-- =====================================================

CREATE TABLE IF NOT EXISTS workflows (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  organization_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  workflow_json JSON NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  trigger_type VARCHAR(50),
  execution_count INT DEFAULT 0,
  last_executed_at TIMESTAMP NULL,
  created_by_id INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,

  UNIQUE KEY uk_organization_workflow_name (organization_id, name),
  KEY idx_workflows_organization_id (organization_id),
  KEY idx_workflows_is_active (is_active),

  CONSTRAINT fk_workflows_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_workflows_created_by FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Workflow Executions
CREATE TABLE IF NOT EXISTS workflow_executions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  workflow_id INT NOT NULL,
  lead_id BIGINT,
  organization_id INT NOT NULL,
  status VARCHAR(50) NOT NULL,
  error_message TEXT,
  execution_log JSON,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,

  KEY idx_workflow_executions_workflow_id (workflow_id),
  KEY idx_workflow_executions_lead_id (lead_id),
  KEY idx_workflow_executions_status (status),

  CONSTRAINT fk_workflow_executions_workflow FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
  CONSTRAINT fk_workflow_executions_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_workflow_executions_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 8. INTEGRATIONS
-- =====================================================

CREATE TABLE IF NOT EXISTS crm_integrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  organization_id INT NOT NULL,
  integration_type VARCHAR(50) NOT NULL,
  integration_name VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'inactive',
  config JSON NOT NULL,
  last_synced_at TIMESTAMP NULL,
  sync_status VARCHAR(50),
  sync_error_message TEXT,
  is_webhook_active BOOLEAN DEFAULT false,
  webhook_url VARCHAR(500),
  webhook_secret VARCHAR(255),
  created_by_id INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_organization_integration_type (organization_id, integration_type),
  KEY idx_integrations_organization_id (organization_id),

  CONSTRAINT fk_integrations_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_integrations_created_by FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Integration Sync Logs
CREATE TABLE IF NOT EXISTS crm_integration_sync_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  integration_id INT NOT NULL,
  organization_id INT NOT NULL,
  sync_type VARCHAR(50),
  status VARCHAR(50) NOT NULL,
  records_synced INT,
  records_created INT,
  records_updated INT,
  error_message TEXT,
  sync_details JSON,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,

  KEY idx_integration_sync_logs_integration_id (integration_id),
  KEY idx_integration_sync_logs_started_at (started_at),

  CONSTRAINT fk_integration_sync_logs_integration FOREIGN KEY (integration_id) REFERENCES crm_integrations(id) ON DELETE CASCADE,
  CONSTRAINT fk_integration_sync_logs_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Meta Leads
CREATE TABLE IF NOT EXISTS meta_leads (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  organization_id INT NOT NULL,
  crm_lead_id BIGINT,
  meta_lead_id VARCHAR(255) NOT NULL,
  form_id VARCHAR(255),
  campaign_id VARCHAR(255),
  campaign_name VARCHAR(255),
  adset_id VARCHAR(255),
  adset_name VARCHAR(255),
  ad_id VARCHAR(255),
  creative_id VARCHAR(255),
  platform VARCHAR(50),
  device_type VARCHAR(50),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  email VARCHAR(255),
  phone VARCHAR(20),
  city VARCHAR(100),
  state VARCHAR(100),
  country VARCHAR(100),
  ad_json JSON,
  synced_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_organization_meta_lead_id (organization_id, meta_lead_id),
  KEY idx_meta_leads_organization_id (organization_id),
  KEY idx_meta_leads_crm_lead_id (crm_lead_id),

  CONSTRAINT fk_meta_leads_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_meta_leads_crm_lead FOREIGN KEY (crm_lead_id) REFERENCES leads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 9. AUDIT & SECURITY
-- =====================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  organization_id INT NOT NULL,
  user_id INT,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(255),
  action VARCHAR(50) NOT NULL,
  details JSON,
  ip_address VARCHAR(50),
  user_agent VARCHAR(500),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_audit_logs_organization_id (organization_id),
  KEY idx_audit_logs_user_id (user_id),
  KEY idx_audit_logs_entity_type (entity_type),
  KEY idx_audit_logs_action (action),
  KEY idx_audit_logs_created_at (created_at),

  CONSTRAINT fk_audit_logs_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Login History
CREATE TABLE IF NOT EXISTS login_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  organization_id INT NOT NULL,
  ip_address VARCHAR(50),
  user_agent VARCHAR(500),
  status VARCHAR(50),
  login_method VARCHAR(50),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_login_history_user_id (user_id),
  KEY idx_login_history_created_at (created_at),

  CONSTRAINT fk_login_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_login_history_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 10. REPORTS & ANALYTICS
-- =====================================================

CREATE TABLE IF NOT EXISTS saved_reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  organization_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  report_type VARCHAR(50),
  report_config JSON NOT NULL,
  filters JSON,
  is_public BOOLEAN DEFAULT false,
  created_by_id INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_organization_report_name (organization_id, name),
  KEY idx_saved_reports_organization_id (organization_id),

  CONSTRAINT fk_saved_reports_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_saved_reports_created_by FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Report Snapshots
CREATE TABLE IF NOT EXISTS report_snapshots (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  saved_report_id INT,
  organization_id INT NOT NULL,
  snapshot_data JSON NOT NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_report_snapshots_saved_report_id (saved_report_id),

  CONSTRAINT fk_report_snapshots_saved_report FOREIGN KEY (saved_report_id) REFERENCES saved_reports(id) ON DELETE CASCADE,
  CONSTRAINT fk_report_snapshots_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 11. SYSTEM SETTINGS
-- =====================================================

CREATE TABLE IF NOT EXISTS system_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  organization_id INT NOT NULL,
  setting_key VARCHAR(100) NOT NULL,
  setting_value TEXT,
  data_type VARCHAR(50),
  is_editable BOOLEAN DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_organization_setting_key (organization_id, setting_key),
  KEY idx_system_settings_organization_id (organization_id),

  CONSTRAINT fk_system_settings_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 12. WEBHOOKS & EXTERNAL INTEGRATIONS
-- =====================================================

CREATE TABLE IF NOT EXISTS webhooks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  organization_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  url VARCHAR(500) NOT NULL,
  events JSON NOT NULL,
  headers JSON,
  is_active BOOLEAN NOT NULL DEFAULT true,
  secret_key VARCHAR(255),
  created_by_id INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_webhooks_organization_id (organization_id),

  CONSTRAINT fk_webhooks_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_webhooks_created_by FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Webhook Delivery Logs
CREATE TABLE IF NOT EXISTS webhook_delivery_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  webhook_id INT NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  payload JSON NOT NULL,
  response_status INT,
  response_body TEXT,
  retry_count INT DEFAULT 0,
  status VARCHAR(50) NOT NULL,
  delivered_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_webhook_delivery_logs_webhook_id (webhook_id),

  CONSTRAINT fk_webhook_delivery_logs_webhook FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 13. API & ACCESS TOKENS
-- =====================================================

CREATE TABLE IF NOT EXISTS api_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) UNIQUE NOT NULL DEFAULT (UUID()),
  user_id INT NOT NULL,
  organization_id INT NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255),
  permissions JSON DEFAULT '[]',
  last_used_at TIMESTAMP NULL,
  expires_at TIMESTAMP NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uk_user_token_name (user_id, name),
  KEY idx_api_tokens_user_id (user_id),
  KEY idx_api_tokens_token_hash (token_hash),

  CONSTRAINT fk_api_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_api_tokens_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 14. QUEUE & BACKGROUND JOBS
-- =====================================================

CREATE TABLE IF NOT EXISTS jobs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  organization_id INT NOT NULL,
  job_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  priority INT DEFAULT 0,
  payload JSON NOT NULL,
  result JSON,
  error_message TEXT,
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  next_retry_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,

  KEY idx_jobs_status (status),
  KEY idx_jobs_next_retry_at (next_retry_at),

  CONSTRAINT fk_jobs_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- VIEWS FOR COMMON QUERIES
-- =====================================================

-- Lead Dashboard Summary
CREATE OR REPLACE VIEW lead_dashboard_summary AS
SELECT
  org.id,
  COUNT(DISTINCT l.id) as total_leads,
  COUNT(DISTINCT CASE WHEN l.status = 'new' THEN l.id END) as new_leads,
  COUNT(DISTINCT CASE WHEN l.status = 'active' THEN l.id END) as active_leads,
  COUNT(DISTINCT CASE WHEN l.status = 'lost' THEN l.id END) as lost_leads,
  COUNT(DISTINCT CASE WHEN l.admission_status = 'approved' THEN l.id END) as admitted,
  COUNT(DISTINCT CASE WHEN l.next_followup_at IS NOT NULL AND l.next_followup_at <= CURDATE() THEN l.id END) as pending_followups
FROM crm_organizations org
LEFT JOIN leads l ON org.id = l.organization_id AND l.deleted_at IS NULL
WHERE org.deleted_at IS NULL
GROUP BY org.id;

-- Counsellor Performance
CREATE OR REPLACE VIEW counsellor_performance AS
SELECT
  u.id,
  u.organization_id,
  CONCAT(u.first_name, ' ', u.last_name) as name,
  COUNT(DISTINCT l.id) as assigned_leads,
  COUNT(DISTINCT CASE WHEN l.admission_status = 'approved' THEN l.id END) as admissions,
  COUNT(DISTINCT f.id) as followups_completed,
  AVG(l.lead_score) as avg_lead_score,
  MAX(f.completed_at) as last_activity
FROM users u
LEFT JOIN leads l ON u.id = l.lead_owner_id AND l.deleted_at IS NULL
LEFT JOIN followups f ON u.id = f.assigned_to_id AND f.status = 'completed'
WHERE u.deleted_at IS NULL
GROUP BY u.id, u.organization_id;

-- Lead Conversion Funnel
CREATE OR REPLACE VIEW lead_conversion_funnel AS
SELECT
  leads.organization_id,
  leads.lead_stage_id,
  ls.display_name as stage_name,
  COUNT(DISTINCT leads.id) as lead_count,
  ROUND(100.0 * COUNT(DISTINCT leads.id) /
    SUM(COUNT(DISTINCT leads.id)) OVER (PARTITION BY leads.organization_id), 2) as percentage
FROM leads
LEFT JOIN lead_stages ls ON leads.lead_stage_id = ls.id
WHERE leads.deleted_at IS NULL
GROUP BY leads.organization_id, leads.lead_stage_id, ls.display_name;

-- =====================================================
-- TRIGGERS FOR AUTOMATION
-- =====================================================

DELIMITER $$

-- Update timestamp trigger for crm_organizations
CREATE TRIGGER update_organizations_timestamp
BEFORE UPDATE ON crm_organizations
FOR EACH ROW
SET NEW.updated_at = CURRENT_TIMESTAMP;
$$

-- Update timestamp trigger for branches
CREATE TRIGGER update_branches_timestamp
BEFORE UPDATE ON branches
FOR EACH ROW
SET NEW.updated_at = CURRENT_TIMESTAMP;
$$

-- Update timestamp trigger for users
CREATE TRIGGER update_users_timestamp
BEFORE UPDATE ON users
FOR EACH ROW
SET NEW.updated_at = CURRENT_TIMESTAMP;
$$

-- Update timestamp trigger for leads
CREATE TRIGGER update_leads_timestamp
BEFORE UPDATE ON leads
FOR EACH ROW
SET NEW.updated_at = CURRENT_TIMESTAMP;
$$

-- Update timestamp trigger for followups
CREATE TRIGGER update_followups_timestamp
BEFORE UPDATE ON followups
FOR EACH ROW
SET NEW.updated_at = CURRENT_TIMESTAMP;
$$

-- Update timestamp trigger for communications
CREATE TRIGGER update_communications_timestamp
BEFORE UPDATE ON communications
FOR EACH ROW
SET NEW.updated_at = CURRENT_TIMESTAMP;
$$

-- Update timestamp trigger for tasks
CREATE TRIGGER update_tasks_timestamp
BEFORE UPDATE ON tasks
FOR EACH ROW
SET NEW.updated_at = CURRENT_TIMESTAMP;
$$

-- Update timestamp trigger for applications
CREATE TRIGGER update_applications_timestamp
BEFORE UPDATE ON applications
FOR EACH ROW
SET NEW.updated_at = CURRENT_TIMESTAMP;
$$

-- Update timestamp trigger for payments
CREATE TRIGGER update_payments_timestamp
BEFORE UPDATE ON payments
FOR EACH ROW
SET NEW.updated_at = CURRENT_TIMESTAMP;
$$

-- Update timestamp trigger for documents
CREATE TRIGGER update_documents_timestamp
BEFORE UPDATE ON documents
FOR EACH ROW
SET NEW.updated_at = CURRENT_TIMESTAMP;
$$

-- Update timestamp trigger for workflows
CREATE TRIGGER update_workflows_timestamp
BEFORE UPDATE ON workflows
FOR EACH ROW
SET NEW.updated_at = CURRENT_TIMESTAMP;
$$

-- Update timestamp trigger for crm_integrations
CREATE TRIGGER update_integrations_timestamp
BEFORE UPDATE ON crm_integrations
FOR EACH ROW
SET NEW.updated_at = CURRENT_TIMESTAMP;
$$

DELIMITER ;

-- =====================================================
-- ENABLE FOREIGN KEY CHECKS
-- =====================================================

SET FOREIGN_KEY_CHECKS=1;

-- =====================================================
-- SCHEMA COMPLETE
-- =====================================================

-- Create comment documentation
ALTER TABLE crm_organizations COMMENT='Multi-tenant crm_organizations';
ALTER TABLE branches COMMENT='School branches/locations';
ALTER TABLE users COMMENT='Staff members and users';
ALTER TABLE roles COMMENT='User roles with permissions';
ALTER TABLE leads COMMENT='Main leads table with 50+ fields';
ALTER TABLE lead_stages COMMENT='Configurable workflow stages';
ALTER TABLE followups COMMENT='Follow-up tracking';
ALTER TABLE communications COMMENT='Communication history';
ALTER TABLE workflows COMMENT='Automation workflows';
ALTER TABLE crm_integrations COMMENT='Third-party crm_integrations';
ALTER TABLE audit_logs COMMENT='Complete audit trail';
ALTER TABLE applications COMMENT='Application records';
ALTER TABLE payments COMMENT='Payment tracking';
ALTER TABLE documents COMMENT='Document storage';
ALTER TABLE tasks COMMENT='Task management';
