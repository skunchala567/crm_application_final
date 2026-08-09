USE attendance_biometric;
SET NAMES utf8mb4;

-- =====================================================================
-- Role-based access control for the CRM.
--
-- The database already had the bones of this: `roles`, `user_roles`,
-- `role_permissions` and `role_screen_access` exist and carry 43 CRM
-- permission keys. Nothing ever read them -- requireCrmAccess only checked
-- that the user held *some* CRM role. So the gap was enforcement and
-- granularity, not the idea.
--
-- Those four tables are shared with the Attendance system (they also hold
-- attendance.*, leave.*, payroll.* keys and the HR/Manager/Employee roles),
-- so this migration does not touch them. Role identity keeps living in the
-- shared `roles`/`user_roles` tables -- that is where CRM_ADMIN and
-- COUNSELLOR already are, and user_roles is how a user is linked to a role.
-- Everything CRM-specific hangs off them in the crm_ tables below.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The catalogue of what can be permitted.
--
-- Synced from apps/api/src/rbac/permission-registry.js on boot, so code is
-- the source of truth and this table is the queryable projection the
-- Access Control screen reads.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_permission_registry (
  permission_key  VARCHAR(160) NOT NULL,
  module_code     VARCHAR(60)  NOT NULL,
  module_label    VARCHAR(120) NOT NULL,
  screen_code     VARCHAR(60)  NOT NULL,
  screen_label    VARCHAR(120) NOT NULL,
  tab_code        VARCHAR(60)  NULL,
  tab_label       VARCHAR(120) NULL,
  action_code     VARCHAR(30)  NOT NULL,
  label           VARCHAR(180) NOT NULL,
  -- The frontend route this permission gates, where it gates one.
  route           VARCHAR(160) NULL,
  -- TRUE when the action honours a data scope (own/team/department/all).
  is_scoped       BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Cleared and re-set by the sync; a key that disappears from the registry
  -- is marked retired rather than deleted, so historical grants still read.
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order      INT          NOT NULL DEFAULT 0,
  updated_at_utc  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (permission_key),
  KEY ix_perm_tree (module_code, screen_code, tab_code),
  KEY ix_perm_route (route)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- What each role may do.
--
-- Separate from the shared role_permissions table on purpose: this one
-- carries a data scope per grant, and writing a new column onto a table the
-- Attendance system also reads is not a risk worth taking for a feature it
-- has no use for.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_role_permissions (
  role_id         BIGINT UNSIGNED NOT NULL,
  permission_key  VARCHAR(160) NOT NULL,
  is_allowed      BOOLEAN      NOT NULL DEFAULT FALSE,
  -- none | own | team | department | all. Ignored for unscoped keys.
  data_scope      VARCHAR(20)  NOT NULL DEFAULT 'none',
  updated_by_user_id BIGINT UNSIGNED NULL,
  updated_at_utc  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (role_id, permission_key),
  KEY ix_crp_key (permission_key),
  CONSTRAINT fk_crp_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- CRM-side attributes of a role.
--
-- The shared `roles` table has no is_active and no notion of protection, and
-- adding those columns would change a table the Attendance system owns.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_role_settings (
  role_id            BIGINT UNSIGNED NOT NULL,
  -- Deactivating a role denies everything it grants without deleting it or
  -- disturbing the user_roles rows that reference it.
  is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
  -- Super Admin passes every check without consulting the grant table.
  is_super_admin     BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Protected roles cannot be deleted, deactivated, or stripped of their
  -- access-control permissions, so the last way in cannot be closed.
  is_protected       BOOLEAN     NOT NULL DEFAULT FALSE,
  -- TRUE for roles this CRM created, to tell them apart from the Attendance
  -- roles that share the table.
  is_crm_role        BOOLEAN     NOT NULL DEFAULT TRUE,
  description        VARCHAR(400) NULL,
  cloned_from_role_id BIGINT UNSIGNED NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  created_at_utc     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (role_id),
  CONSTRAINT fk_crs_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Audit: who changed access, and to what.
--
-- Deliberately not the shared `audit_logs` table, which belongs to the
-- Attendance system and has its own shape and retention.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_rbac_audit (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- role_created | role_updated | role_cloned | role_deleted |
  -- role_activated | role_deactivated | permissions_changed |
  -- user_role_assigned | user_role_removed | enforcement_changed
  event_type        VARCHAR(60)  NOT NULL,
  actor_user_id     BIGINT UNSIGNED NULL,
  actor_email       VARCHAR(254) NULL,
  target_role_id    BIGINT UNSIGNED NULL,
  target_role_name  VARCHAR(120) NULL,
  target_user_id    BIGINT UNSIGNED NULL,
  target_user_email VARCHAR(254) NULL,
  summary           VARCHAR(500) NOT NULL,
  -- Before/after for permission edits, so a change can be explained later.
  detail_json       JSON         NULL,
  ip_address        VARCHAR(64)  NULL,
  created_at_utc    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_rbac_audit_time (created_at_utc),
  KEY ix_rbac_audit_role (target_role_id, created_at_utc),
  KEY ix_rbac_audit_event (event_type, created_at_utc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Runtime settings. One row.
--
-- enforcement_mode exists because switching 262 endpoints from "any CRM role
-- may do anything" to "deny unless granted" in one step, on a live system, is
-- how people get locked out of their own CRM. In `audit` the checks run and
-- record what they WOULD have blocked without blocking it, so the grants can
-- be corrected against real traffic before `enforce` is switched on.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_rbac_settings (
  id               TINYINT UNSIGNED NOT NULL DEFAULT 1,
  -- off | audit | enforce
  enforcement_mode VARCHAR(20) NOT NULL DEFAULT 'audit',
  updated_by_user_id BIGINT UNSIGNED NULL,
  updated_at_utc   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT ck_rbac_mode CHECK (enforcement_mode IN ('off','audit','enforce'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO crm_rbac_settings (id, enforcement_mode) VALUES (1, 'audit');

-- ---------------------------------------------------------------------
-- Denials seen while running. Feeds the "what would break" view so the
-- switch to enforce is made on evidence.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_rbac_denials (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NULL,
  user_email      VARCHAR(254) NULL,
  method          VARCHAR(10)  NOT NULL,
  path            VARCHAR(400) NOT NULL,
  permission_key  VARCHAR(160) NULL,
  reason          VARCHAR(120) NOT NULL,
  was_enforced    BOOLEAN      NOT NULL DEFAULT FALSE,
  occurred_at_utc DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_denial_time (occurred_at_utc),
  KEY ix_denial_key (permission_key, occurred_at_utc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- The Super Admin role. Created here rather than by the seeder so it exists
-- even if the application never boots successfully.
-- ---------------------------------------------------------------------
INSERT IGNORE INTO roles (name, normalized_name, description, is_system)
VALUES ('Super Admin', 'SUPER_ADMIN', 'Unrestricted access to every CRM module, screen and action', 1);

INSERT IGNORE INTO crm_role_settings
  (role_id, is_active, is_super_admin, is_protected, is_crm_role, description)
SELECT id, TRUE, TRUE, TRUE, TRUE, 'Unrestricted access. Cannot be deleted or deactivated.'
  FROM roles WHERE normalized_name = 'SUPER_ADMIN';

-- Existing CRM roles get their settings row; permissions are seeded from the
-- registry on boot so the defaults stay in step with the code.
INSERT IGNORE INTO crm_role_settings (role_id, is_active, is_super_admin, is_protected, is_crm_role, description)
SELECT id, TRUE, FALSE, FALSE, TRUE, description
  FROM roles WHERE normalized_name IN ('CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR','CRM_VIEWER');

-- Attendance's roles are recorded as non-CRM so the Access Control screen can
-- leave them alone rather than offering to edit another system's roles.
INSERT IGNORE INTO crm_role_settings (role_id, is_active, is_super_admin, is_protected, is_crm_role, description)
SELECT id, TRUE, FALSE, TRUE, FALSE, CONCAT('Managed by the Attendance system: ', COALESCE(description,''))
  FROM roles WHERE normalized_name IN ('ADMIN','HR','MANAGER','EMPLOYEE');
