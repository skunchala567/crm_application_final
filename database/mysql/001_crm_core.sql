-- Admissions CRM extension for the existing attendance_biometric database.
-- Non-destructive: creates crm_* tables only and references existing master data.
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS crm_lead_stages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(60) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    position SMALLINT UNSIGNED NOT NULL,
    color_code CHAR(7) NOT NULL DEFAULT '#5B63D3',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_crm_lead_stages_name (name),
    UNIQUE KEY uq_crm_lead_stages_position (position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_lead_sources (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(60) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_crm_lead_sources_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_leads (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    lead_number VARCHAR(50) NOT NULL,
    branch_id BIGINT UNSIGNED NOT NULL,
    student_name VARCHAR(200) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    alternate_phone VARCHAR(30) NULL,
    email VARCHAR(254) NULL,
    applying_class VARCHAR(50) NULL,
    academic_year VARCHAR(20) NULL,
    parent_name VARCHAR(200) NULL,
    city VARCHAR(100) NULL,
    stage_id BIGINT UNSIGNED NOT NULL,
    source_id BIGINT UNSIGNED NULL,
    owner_employee_id BIGINT NULL,
    lead_score SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'Active',
    remarks TEXT NULL,
    next_followup_at_utc DATETIME(6) NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
    deleted_at_utc DATETIME(6) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_crm_leads_number (lead_number),
    KEY ix_crm_leads_branch_created (branch_id, created_at_utc),
    KEY ix_crm_leads_owner_stage (owner_employee_id, stage_id),
    KEY ix_crm_leads_phone (phone),
    KEY ix_crm_leads_next_followup (next_followup_at_utc),
    CONSTRAINT chk_crm_leads_score CHECK (lead_score BETWEEN 0 AND 100),
    CONSTRAINT fk_crm_leads_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
    CONSTRAINT fk_crm_leads_stage FOREIGN KEY (stage_id) REFERENCES crm_lead_stages(id),
    CONSTRAINT fk_crm_leads_source FOREIGN KEY (source_id) REFERENCES crm_lead_sources(id),
    CONSTRAINT fk_crm_leads_owner FOREIGN KEY (owner_employee_id) REFERENCES employees(id),
    CONSTRAINT fk_crm_leads_created_user FOREIGN KEY (created_by_user_id) REFERENCES app_users(id),
    CONSTRAINT fk_crm_leads_updated_user FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_followups (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    lead_id BIGINT UNSIGNED NOT NULL,
    assigned_employee_id BIGINT NULL,
    followup_type VARCHAR(30) NOT NULL DEFAULT 'Call',
    due_at_utc DATETIME(6) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'Pending',
    outcome VARCHAR(100) NULL,
    notes TEXT NULL,
    completed_at_utc DATETIME(6) NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY ix_crm_followups_assignee_due (assigned_employee_id, status, due_at_utc),
    KEY ix_crm_followups_lead (lead_id),
    CONSTRAINT fk_crm_followups_lead FOREIGN KEY (lead_id) REFERENCES crm_leads(id) ON DELETE CASCADE,
    CONSTRAINT fk_crm_followups_employee FOREIGN KEY (assigned_employee_id) REFERENCES employees(id),
    CONSTRAINT fk_crm_followups_user FOREIGN KEY (created_by_user_id) REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_lead_activities (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    lead_id BIGINT UNSIGNED NOT NULL,
    activity_type VARCHAR(50) NOT NULL,
    summary VARCHAR(500) NOT NULL,
    details_json JSON NULL,
    actor_user_id BIGINT UNSIGNED NULL,
    occurred_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY ix_crm_activities_lead_time (lead_id, occurred_at_utc),
    CONSTRAINT fk_crm_activities_lead FOREIGN KEY (lead_id) REFERENCES crm_leads(id) ON DELETE CASCADE,
    CONSTRAINT fk_crm_activities_user FOREIGN KEY (actor_user_id) REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO crm_lead_stages (name, display_name, position, color_code) VALUES
('new', 'New', 1, '#5B63D3'), ('contacted', 'Contacted', 2, '#6D8BE8'),
('counselling', 'Counselling', 3, '#D88D4B'), ('campus_visit', 'Campus Visit', 4, '#A36BC1'),
('application', 'Application', 5, '#44A987'), ('admitted', 'Admitted', 6, '#23866B'),
('lost', 'Lost', 7, '#9A9CAB')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), color_code = VALUES(color_code);

INSERT INTO crm_lead_sources (name, display_name) VALUES
('website', 'Website'), ('walk_in', 'Walk-in'), ('referral', 'Referral'),
('meta_ads', 'Meta Ads'), ('google_ads', 'Google Ads'), ('school_event', 'School Event')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

INSERT INTO roles (name, normalized_name, description, is_system, created_at_utc) VALUES
('CRM Admin', 'CRM_ADMIN', 'Full administration access to Admissions CRM', TRUE, UTC_TIMESTAMP(6)),
('Admission Manager', 'ADMISSION_MANAGER', 'Manage admission teams, leads, applications, and reports', TRUE, UTC_TIMESTAMP(6)),
('Counsellor', 'COUNSELLOR', 'Manage assigned leads, follow-ups, and applications', TRUE, UTC_TIMESTAMP(6)),
('CRM Viewer', 'CRM_VIEWER', 'Read-only Admissions CRM access', TRUE, UTC_TIMESTAMP(6))
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), is_system = VALUES(is_system);

INSERT INTO role_screen_access (role_id, screen_key, access_level)
SELECT r.id, s.screen_key, 'Full'
FROM roles r
CROSS JOIN (
    SELECT 'crm.dashboard' screen_key UNION ALL SELECT 'crm.leads' UNION ALL
    SELECT 'crm.followups' UNION ALL SELECT 'crm.applications' UNION ALL SELECT 'crm.reports'
) s
WHERE r.normalized_name = 'ADMIN'
ON DUPLICATE KEY UPDATE access_level = VALUES(access_level);

INSERT INTO role_screen_access (role_id, screen_key, access_level)
SELECT r.id, access.screen_key, access.access_level
FROM roles r
JOIN (
    SELECT 'CRM_ADMIN' role_name, 'crm.dashboard' screen_key, 'Full' access_level UNION ALL
    SELECT 'CRM_ADMIN', 'crm.leads', 'Full' UNION ALL SELECT 'CRM_ADMIN', 'crm.followups', 'Full' UNION ALL
    SELECT 'CRM_ADMIN', 'crm.applications', 'Full' UNION ALL SELECT 'CRM_ADMIN', 'crm.reports', 'Full' UNION ALL
    SELECT 'ADMISSION_MANAGER', 'crm.dashboard', 'Full' UNION ALL SELECT 'ADMISSION_MANAGER', 'crm.leads', 'Full' UNION ALL
    SELECT 'ADMISSION_MANAGER', 'crm.followups', 'Full' UNION ALL SELECT 'ADMISSION_MANAGER', 'crm.applications', 'Full' UNION ALL
    SELECT 'ADMISSION_MANAGER', 'crm.reports', 'Full' UNION ALL
    SELECT 'COUNSELLOR', 'crm.dashboard', 'ReadOnly' UNION ALL SELECT 'COUNSELLOR', 'crm.leads', 'Full' UNION ALL
    SELECT 'COUNSELLOR', 'crm.followups', 'Full' UNION ALL SELECT 'COUNSELLOR', 'crm.applications', 'ReadOnly' UNION ALL
    SELECT 'COUNSELLOR', 'crm.reports', 'Hidden' UNION ALL
    SELECT 'CRM_VIEWER', 'crm.dashboard', 'ReadOnly' UNION ALL SELECT 'CRM_VIEWER', 'crm.leads', 'ReadOnly' UNION ALL
    SELECT 'CRM_VIEWER', 'crm.followups', 'ReadOnly' UNION ALL SELECT 'CRM_VIEWER', 'crm.applications', 'ReadOnly' UNION ALL
    SELECT 'CRM_VIEWER', 'crm.reports', 'ReadOnly'
) access ON access.role_name = r.normalized_name
ON DUPLICATE KEY UPDATE access_level = VALUES(access_level);

INSERT INTO role_permissions (role_id, permission_key, is_allowed, updated_at_utc)
SELECT r.id, p.permission_key, TRUE, UTC_TIMESTAMP(6)
FROM roles r
CROSS JOIN (
    SELECT 'crm.dashboard.view' permission_key UNION ALL SELECT 'crm.leads.view' UNION ALL
    SELECT 'crm.leads.add' UNION ALL SELECT 'crm.leads.edit' UNION ALL SELECT 'crm.leads.delete' UNION ALL
    SELECT 'crm.followups.view' UNION ALL SELECT 'crm.followups.add' UNION ALL SELECT 'crm.followups.edit' UNION ALL
    SELECT 'crm.applications.view' UNION ALL SELECT 'crm.reports.view' UNION ALL SELECT 'crm.reports.export'
) p
WHERE r.normalized_name = 'ADMIN'
ON DUPLICATE KEY UPDATE is_allowed = VALUES(is_allowed), updated_at_utc = VALUES(updated_at_utc);

INSERT INTO role_permissions (role_id, permission_key, is_allowed, updated_at_utc)
SELECT rsa.role_id, CONCAT(rsa.screen_key, '.', operations.operation_key),
       CASE
         WHEN rsa.access_level = 'Full' THEN TRUE
         WHEN rsa.access_level = 'ReadOnly' AND operations.operation_key IN ('view', 'export', 'print') THEN TRUE
         ELSE FALSE
       END,
       UTC_TIMESTAMP(6)
FROM role_screen_access rsa
CROSS JOIN (
    SELECT 'view' operation_key UNION ALL SELECT 'add' UNION ALL SELECT 'edit' UNION ALL
    SELECT 'delete' UNION ALL SELECT 'assign' UNION ALL SELECT 'export' UNION ALL SELECT 'print'
) operations
WHERE rsa.screen_key LIKE 'crm.%'
ON DUPLICATE KEY UPDATE is_allowed = VALUES(is_allowed), updated_at_utc = VALUES(updated_at_utc);
