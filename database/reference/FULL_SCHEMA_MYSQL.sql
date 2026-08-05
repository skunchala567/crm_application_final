-- ==========================================================================
-- ADMISSIONS CRM  |  COMPLETE SCHEMA  |  CREATE TABLE IF NOT EXISTS
-- ==========================================================================
--
-- Generated from the live schema, so it reflects every migration in
-- database/mysql/ (000-056) including their ALTER TABLE statements.
--
--   Source database : attendance_biometric
--   Server version  : MySQL 8.0.42-0ubuntu0.20.04.1
--   Base tables     : 123  (CRM 98 / shared 7 / attendance-only 18)
--   Views           : 1
--   Triggers 0   Routines 0   Events 0
--
-- SAFE TO RE-RUN. Every statement is IF NOT EXISTS / OR REPLACE, so running
-- this against a populated database creates only what is missing and never
-- drops or alters anything that already exists.
--
-- CAVEAT: because IF NOT EXISTS skips tables that already exist, this file
-- cannot upgrade a table whose columns are out of date. It provisions a NEW
-- database; use the database/mysql/ migrations to evolve an existing one.
--
-- SECTIONS
--   1. Shared identity & master tables  (7)  - required by the CRM
--   2. CRM tables                       (98)  - crm_* namespace
--   3. Attendance-only tables           (18)  - NOT required by the CRM
--   4. Views                            (1)
--
-- Tables are emitted in foreign-key dependency order within each section.
-- ==========================================================================

-- Point this at the target database before running:
-- CREATE DATABASE IF NOT EXISTS `your_new_database`
--   DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
-- USE `your_new_database`;

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;
SET @OLD_SQL_MODE = @@SQL_MODE;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';


-- ==========================================================================
-- SECTION 1 - SHARED IDENTITY & MASTER TABLES (7)
-- ==========================================================================
-- Owned by the Attendance system, but the CRM reads them and has foreign keys
-- into them. REQUIRED for the CRM to run.
-- ==========================================================================

-- ------------------------------------------------------------
-- branches
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `branches` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `branch_name` varchar(150) NOT NULL,
  `short_name` varchar(20) NOT NULL,
  `time_zone_id` varchar(100) NOT NULL DEFAULT 'Asia/Kolkata',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  `jodo_payment_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `jodo_api_key` varchar(255) DEFAULT NULL,
  `jodo_secret_key` varchar(255) DEFAULT NULL,
  `jodo_collector_code` varchar(100) DEFAULT NULL,
  `application_amount` decimal(12,2) DEFAULT NULL,
  `application_stage_id` bigint unsigned DEFAULT NULL,
  `application_payment_component` varchar(120) NOT NULL DEFAULT 'Payable Amount',
  `callerdesk_did_id` varchar(100) DEFAULT NULL,
  `callerdesk_did_number` varchar(30) DEFAULT NULL,
  `callerdesk_call_group` varchar(120) DEFAULT NULL,
  `callerdesk_inbound_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `callerdesk_outbound_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `smartflo_did_id` varchar(100) DEFAULT NULL,
  `smartflo_did_number` varchar(30) DEFAULT NULL,
  `smartflo_department_id` varchar(100) DEFAULT NULL,
  `smartflo_inbound_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `smartflo_outbound_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `smartflo_ivr_id` varchar(100) DEFAULT NULL,
  `smartflo_ivr_name` varchar(150) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_branches_name` (`branch_name`),
  KEY `ix_branches_short_name` (`short_name`),
  KEY `ix_branches_application_stage` (`application_stage_id`),
  CONSTRAINT `fk_branches_application_stage` FOREIGN KEY (`application_stage_id`) REFERENCES `crm_lead_stages` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- employees
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `employees` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `employee_number` varchar(50) NOT NULL COMMENT 'Imported Employee_id',
  `employee_code` varchar(50) NOT NULL,
  `employee_name` varchar(200) NOT NULL,
  `biometric_id` varchar(100) NOT NULL COMMENT 'Matches EmpCode in the local biometric punch table',
  `department` varchar(150) DEFAULT NULL,
  `designation` varchar(150) DEFAULT NULL,
  `category` varchar(100) DEFAULT NULL,
  `is_reporting_manager` tinyint(1) NOT NULL DEFAULT '0',
  `reporting_manager_employee_id` bigint unsigned DEFAULT NULL,
  `branch_id` bigint unsigned DEFAULT NULL,
  `email` varchar(254) DEFAULT NULL,
  `mobile_number` varchar(30) DEFAULT NULL,
  `photo_url` varchar(1000) DEFAULT NULL,
  `status` varchar(30) NOT NULL DEFAULT 'Active',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_employees_employee_number` (`employee_number`),
  UNIQUE KEY `uq_employees_employee_code` (`employee_code`),
  UNIQUE KEY `uq_employees_biometric_id` (`biometric_id`),
  KEY `ix_employees_name` (`employee_name`),
  KEY `ix_employees_branch_status` (`branch_id`,`status`),
  KEY `ix_employees_reporting_manager` (`reporting_manager_employee_id`),
  CONSTRAINT `fk_employees_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`),
  CONSTRAINT `chk_employees_status` CHECK ((`status` in (_utf8mb4'Active',_utf8mb4'Resigned')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- app_users
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `app_users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `employee_id` bigint DEFAULT NULL,
  `branch_id` bigint unsigned DEFAULT NULL,
  `email` varchar(254) NOT NULL,
  `normalized_email` varchar(254) NOT NULL,
  `password_hash` varchar(500) NOT NULL,
  `security_stamp` char(36) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `failed_login_count` int NOT NULL DEFAULT '0',
  `lockout_end_utc` datetime(6) DEFAULT NULL,
  `last_login_at_utc` datetime(6) DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  `callerdesk_member_id` varchar(100) DEFAULT NULL,
  `callerdesk_member_name` varchar(150) DEFAULT NULL,
  `callerdesk_member_number` varchar(30) DEFAULT NULL,
  `callerdesk_call_group` varchar(120) DEFAULT NULL,
  `callerdesk_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `smartflo_user_id` varchar(100) DEFAULT NULL,
  `smartflo_agent_id` varchar(100) DEFAULT NULL,
  `smartflo_agent_name` varchar(150) DEFAULT NULL,
  `smartflo_agent_number` varchar(30) DEFAULT NULL,
  `smartflo_department_id` varchar(100) DEFAULT NULL,
  `smartflo_enabled` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_app_users_email` (`normalized_email`),
  UNIQUE KEY `uq_app_users_employee` (`employee_id`),
  CONSTRAINT `fk_app_users_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- roles
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `roles` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `normalized_name` varchar(50) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `is_system` tinyint(1) NOT NULL DEFAULT '0',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_roles_normalized_name` (`normalized_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- role_permissions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `role_permissions` (
  `role_id` bigint unsigned NOT NULL,
  `permission_key` varchar(150) NOT NULL,
  `is_allowed` tinyint(1) NOT NULL DEFAULT '0',
  `updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`role_id`,`permission_key`),
  CONSTRAINT `fk_role_permissions_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- user_branches
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_branches` (
  `user_id` bigint unsigned NOT NULL,
  `branch_id` bigint unsigned NOT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`user_id`,`branch_id`),
  KEY `ix_user_branches_branch` (`branch_id`),
  CONSTRAINT `fk_user_branches_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_branches_user` FOREIGN KEY (`user_id`) REFERENCES `app_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- user_roles
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_roles` (
  `user_id` bigint unsigned NOT NULL,
  `role_id` bigint unsigned NOT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`user_id`,`role_id`),
  KEY `fk_user_roles_role` (`role_id`),
  CONSTRAINT `fk_user_roles_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_roles_user` FOREIGN KEY (`user_id`) REFERENCES `app_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ==========================================================================
-- SECTION 2 - CRM TABLES (98)
-- ==========================================================================
-- Every table owned by this CRM. All use the crm_ prefix because the app shares
-- its database with the Attendance system (see migration 000).
-- ==========================================================================

-- ------------------------------------------------------------
-- crm_academic_years
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_academic_years` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `academic_year` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint DEFAULT '1',
  `created_by_user_id` bigint unsigned DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_by_user_id` bigint unsigned DEFAULT NULL,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `academic_year` (`academic_year`),
  KEY `idx_academic_year` (`academic_year`),
  KEY `idx_is_active` (`is_active`),
  KEY `created_by_user_id` (`created_by_user_id`),
  KEY `updated_by_user_id` (`updated_by_user_id`),
  CONSTRAINT `crm_academic_years_ibfk_1` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `crm_academic_years_ibfk_2` FOREIGN KEY (`updated_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_curricula
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_curricula` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `curriculum_code` varchar(30) NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `position` smallint unsigned NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_curricula_code` (`curriculum_code`),
  UNIQUE KEY `uq_crm_curricula_position` (`position`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_admission_types
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_admission_types` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `type_code` varchar(50) NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_admission_type_code` (`type_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_admission_class_configurations
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_admission_class_configurations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `academic_year` varchar(20) NOT NULL,
  `branch_id` bigint unsigned NOT NULL,
  `curriculum_id` bigint unsigned NOT NULL,
  `admission_type_id` bigint unsigned NOT NULL,
  `is_active` tinyint DEFAULT '1',
  `created_by` bigint unsigned NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_by` bigint unsigned NOT NULL,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_academic_branch_curriculum_admission` (`academic_year`,`branch_id`,`curriculum_id`,`admission_type_id`),
  KEY `created_by` (`created_by`),
  KEY `updated_by` (`updated_by`),
  KEY `idx_academic_year` (`academic_year`),
  KEY `idx_branch` (`branch_id`),
  KEY `idx_curriculum` (`curriculum_id`),
  KEY `idx_admission_type` (`admission_type_id`),
  KEY `idx_is_active` (`is_active`),
  CONSTRAINT `crm_admission_class_configurations_ibfk_1` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `crm_admission_class_configurations_ibfk_2` FOREIGN KEY (`curriculum_id`) REFERENCES `crm_curricula` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `crm_admission_class_configurations_ibfk_3` FOREIGN KEY (`admission_type_id`) REFERENCES `crm_admission_types` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `crm_admission_class_configurations_ibfk_4` FOREIGN KEY (`created_by`) REFERENCES `app_users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `crm_admission_class_configurations_ibfk_5` FOREIGN KEY (`updated_by`) REFERENCES `app_users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_classes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_classes` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `class_code` varchar(30) NOT NULL,
  `display_name` varchar(60) NOT NULL,
  `position` smallint unsigned NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_classes_code` (`class_code`),
  UNIQUE KEY `uq_crm_classes_position` (`position`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_admission_class_configuration_details
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_admission_class_configuration_details` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `configuration_id` bigint unsigned NOT NULL,
  `class_id` bigint unsigned NOT NULL,
  `is_active` tinyint DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_configuration_class` (`configuration_id`,`class_id`),
  KEY `idx_configuration` (`configuration_id`),
  KEY `idx_class` (`class_id`),
  KEY `idx_is_active` (`is_active`),
  CONSTRAINT `crm_admission_class_configuration_details_ibfk_1` FOREIGN KEY (`configuration_id`) REFERENCES `crm_admission_class_configurations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `crm_admission_class_configuration_details_ibfk_2` FOREIGN KEY (`class_id`) REFERENCES `crm_classes` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_business_units
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_business_units` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `unit_code` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `industry_type` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'General',
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `icon_key` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'building',
  `color_code` char(7) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '#4A4FB1',
  `compatibility_mode` enum('legacy_school','metadata') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'metadata',
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by_user_id` bigint unsigned DEFAULT NULL,
  `updated_by_user_id` bigint unsigned DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_business_unit_code` (`unit_code`),
  KEY `ix_crm_business_unit_active` (`is_active`,`display_name`),
  KEY `fk_crm_business_unit_created_by` (`created_by_user_id`),
  KEY `fk_crm_business_unit_updated_by` (`updated_by_user_id`),
  CONSTRAINT `fk_crm_business_unit_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_crm_business_unit_updated_by` FOREIGN KEY (`updated_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_campaign_categories
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_campaign_categories` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `category_code` varchar(80) NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_campaign_category_code` (`category_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_campaigns
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_campaigns` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `campaign_code` varchar(80) NOT NULL,
  `display_name` varchar(150) NOT NULL,
  `category` varchar(80) NOT NULL DEFAULT 'General',
  `category_id` bigint unsigned DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_campaign_code` (`campaign_code`),
  KEY `ix_crm_campaign_category` (`category_id`),
  CONSTRAINT `fk_crm_campaign_category` FOREIGN KEY (`category_id`) REFERENCES `crm_campaign_categories` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_channel_categories
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_channel_categories` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `category_code` varchar(80) NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_channel_category_code` (`category_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_lead_channels
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_lead_channels` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `channel_code` varchar(50) NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `category` varchar(100) NOT NULL DEFAULT 'Primary',
  `category_id` bigint unsigned DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_channel_code` (`channel_code`),
  KEY `ix_crm_channel_category` (`category_id`),
  CONSTRAINT `fk_crm_channel_category` FOREIGN KEY (`category_id`) REFERENCES `crm_channel_categories` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_lead_sources
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_lead_sources` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(60) NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `channel_id` bigint unsigned DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_lead_sources_name` (`name`),
  KEY `ix_crm_lead_sources_channel` (`channel_id`),
  CONSTRAINT `fk_crm_lead_sources_channel` FOREIGN KEY (`channel_id`) REFERENCES `crm_lead_channels` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_lead_stages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_lead_stages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL DEFAULT '1',
  `name` varchar(60) NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `position` smallint unsigned NOT NULL,
  `color_code` char(7) NOT NULL DEFAULT '#5B63D3',
  `requires_followup` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_lead_stage_unit_name` (`business_unit_id`,`name`),
  UNIQUE KEY `uq_crm_lead_stage_unit_position` (`business_unit_id`,`position`),
  CONSTRAINT `fk_crm_lead_stage_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_lead_substages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_lead_substages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `stage_id` bigint unsigned NOT NULL,
  `substage_code` varchar(60) NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `position` smallint unsigned NOT NULL DEFAULT '1',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_substage_code` (`substage_code`),
  KEY `ix_crm_substage_stage` (`stage_id`),
  CONSTRAINT `fk_crm_substage_stage` FOREIGN KEY (`stage_id`) REFERENCES `crm_lead_stages` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_leads
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_leads` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL DEFAULT '1',
  `lead_number` varchar(50) NOT NULL,
  `branch_id` bigint unsigned NOT NULL,
  `student_name` varchar(200) NOT NULL,
  `phone` varchar(30) NOT NULL,
  `normalized_phone` varchar(30) DEFAULT NULL,
  `alternate_phone` varchar(30) DEFAULT NULL,
  `email` varchar(254) DEFAULT NULL,
  `applying_class` varchar(50) DEFAULT NULL,
  `class_id` bigint unsigned DEFAULT NULL,
  `curriculum_id` bigint unsigned DEFAULT NULL,
  `academic_year` varchar(20) DEFAULT NULL,
  `parent_name` varchar(200) DEFAULT NULL,
  `is_parent` tinyint(1) DEFAULT NULL,
  `looking_for_admission` tinyint(1) DEFAULT NULL,
  `whatsapp_response` enum('Responded','Not Responded','Opted Out') DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `stage_id` bigint unsigned NOT NULL,
  `substage_id` bigint unsigned DEFAULT NULL,
  `source_id` bigint unsigned DEFAULT NULL,
  `channel_id` bigint unsigned DEFAULT NULL,
  `campaign_id` bigint unsigned DEFAULT NULL,
  `admission_type_id` bigint unsigned DEFAULT NULL,
  `owner_employee_id` bigint DEFAULT NULL,
  `owner_assigned_at_utc` datetime(6) DEFAULT NULL,
  `referred_to_branch_id` bigint unsigned DEFAULT NULL,
  `referred_to_branch_name` varchar(200) DEFAULT NULL,
  `referred_at_utc` datetime(6) DEFAULT NULL,
  `re_enquired_at_utc` datetime(6) DEFAULT NULL COMMENT 'Timestamp of re-enquiry',
  `referred_by_employee_id` bigint DEFAULT NULL,
  `lead_score` smallint unsigned NOT NULL DEFAULT '0',
  `status` varchar(30) NOT NULL DEFAULT 'Active',
  `remarks` text,
  `custom_values_json` json DEFAULT NULL,
  `next_followup_at_utc` datetime(6) DEFAULT NULL,
  `touched_at_utc` datetime(6) DEFAULT NULL,
  `created_by_user_id` bigint unsigned NOT NULL,
  `updated_by_user_id` bigint unsigned DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  `deleted_at_utc` datetime(6) DEFAULT NULL,
  `jodo_order_id` varchar(120) DEFAULT NULL,
  `application_payment_status` varchar(40) DEFAULT NULL,
  `application_payment_amount` decimal(12,2) DEFAULT NULL,
  `application_payment_at_utc` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_leads_number` (`lead_number`),
  KEY `ix_crm_leads_branch_created` (`branch_id`,`created_at_utc`),
  KEY `ix_crm_leads_owner_stage` (`owner_employee_id`,`stage_id`),
  KEY `ix_crm_leads_phone` (`phone`),
  KEY `ix_crm_leads_next_followup` (`next_followup_at_utc`),
  KEY `fk_crm_leads_stage` (`stage_id`),
  KEY `fk_crm_leads_source` (`source_id`),
  KEY `fk_crm_leads_created_user` (`created_by_user_id`),
  KEY `fk_crm_leads_updated_user` (`updated_by_user_id`),
  KEY `ix_crm_leads_class` (`class_id`),
  KEY `ix_crm_leads_curriculum` (`curriculum_id`),
  KEY `ix_crm_leads_channel` (`channel_id`),
  KEY `ix_crm_leads_campaign` (`campaign_id`),
  KEY `ix_crm_leads_admission_type` (`admission_type_id`),
  KEY `ix_crm_leads_substage` (`substage_id`),
  KEY `ix_crm_leads_referrer` (`referred_by_employee_id`),
  KEY `idx_crm_leads_branch_phone` (`branch_id`,`normalized_phone`),
  KEY `ix_crm_leads_re_enquired` (`re_enquired_at_utc`),
  KEY `fk_crm_leads_referred_branch` (`referred_to_branch_id`),
  KEY `ix_crm_leads_business_unit` (`business_unit_id`,`created_at_utc`),
  KEY `ix_crm_leads_jodo_order` (`jodo_order_id`),
  CONSTRAINT `fk_crm_leads_admission_type` FOREIGN KEY (`admission_type_id`) REFERENCES `crm_admission_types` (`id`),
  CONSTRAINT `fk_crm_leads_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`),
  CONSTRAINT `fk_crm_leads_business_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`),
  CONSTRAINT `fk_crm_leads_campaign` FOREIGN KEY (`campaign_id`) REFERENCES `crm_campaigns` (`id`),
  CONSTRAINT `fk_crm_leads_channel` FOREIGN KEY (`channel_id`) REFERENCES `crm_lead_channels` (`id`),
  CONSTRAINT `fk_crm_leads_class` FOREIGN KEY (`class_id`) REFERENCES `crm_classes` (`id`),
  CONSTRAINT `fk_crm_leads_created_user` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users` (`id`),
  CONSTRAINT `fk_crm_leads_curriculum` FOREIGN KEY (`curriculum_id`) REFERENCES `crm_curricula` (`id`),
  CONSTRAINT `fk_crm_leads_owner` FOREIGN KEY (`owner_employee_id`) REFERENCES `employees` (`id`),
  CONSTRAINT `fk_crm_leads_referred_branch` FOREIGN KEY (`referred_to_branch_id`) REFERENCES `branches` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_crm_leads_referrer` FOREIGN KEY (`referred_by_employee_id`) REFERENCES `employees` (`id`),
  CONSTRAINT `fk_crm_leads_source` FOREIGN KEY (`source_id`) REFERENCES `crm_lead_sources` (`id`),
  CONSTRAINT `fk_crm_leads_stage` FOREIGN KEY (`stage_id`) REFERENCES `crm_lead_stages` (`id`),
  CONSTRAINT `fk_crm_leads_substage` FOREIGN KEY (`substage_id`) REFERENCES `crm_lead_substages` (`id`),
  CONSTRAINT `fk_crm_leads_updated_user` FOREIGN KEY (`updated_by_user_id`) REFERENCES `app_users` (`id`),
  CONSTRAINT `chk_crm_leads_score` CHECK ((`lead_score` between 0 and 100))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_automation_workflows
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_automation_workflows` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `name` varchar(180) NOT NULL,
  `category` varchar(40) NOT NULL,
  `start_at` datetime DEFAULT NULL,
  `definition_json` json NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '0',
  `created_by` bigint unsigned NOT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `ix_crm_automation_status` (`is_active`,`start_at`),
  KEY `ix_crm_automation_creator` (`created_by`),
  KEY `ix_crm_automation_business_unit` (`business_unit_id`,`created_at_utc`),
  CONSTRAINT `fk_crm_automation_business_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`),
  CONSTRAINT `fk_crm_automation_creator` FOREIGN KEY (`created_by`) REFERENCES `app_users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_automation_executions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_automation_executions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `workflow_id` bigint unsigned NOT NULL,
  `lead_id` bigint unsigned NOT NULL,
  `action_index` smallint unsigned NOT NULL,
  `action_json` json NOT NULL,
  `scheduled_for` datetime(6) NOT NULL,
  `status` enum('pending','running','completed','skipped','failed') NOT NULL DEFAULT 'pending',
  `attempts` smallint unsigned NOT NULL DEFAULT '0',
  `result_json` json DEFAULT NULL,
  `error_message` varchar(1000) DEFAULT NULL,
  `executed_at_utc` datetime(6) DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_automation_execution` (`workflow_id`,`lead_id`,`action_index`),
  KEY `ix_crm_automation_execution_due` (`status`,`scheduled_for`),
  KEY `ix_crm_automation_execution_lead` (`lead_id`),
  CONSTRAINT `fk_crm_automation_execution_lead` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_crm_automation_execution_workflow` FOREIGN KEY (`workflow_id`) REFERENCES `crm_automation_workflows` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_bulk_operations
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_bulk_operations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `operation_type` enum('data_export','stage_change','referral') COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('processing','completed','partial','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'processing',
  `created_by_user_id` bigint unsigned NOT NULL,
  `total_records` int unsigned NOT NULL DEFAULT '0',
  `successful_records` int unsigned NOT NULL DEFAULT '0',
  `failed_records` int unsigned NOT NULL DEFAULT '0',
  `summary` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `details_json` json DEFAULT NULL,
  `error_message` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `started_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `completed_at_utc` datetime(6) DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_bulk_operation_type_created` (`operation_type`,`created_at_utc`),
  KEY `idx_bulk_operation_status` (`status`),
  KEY `idx_bulk_operation_user` (`created_by_user_id`),
  KEY `ix_crm_bulk_operation_business_unit` (`business_unit_id`,`created_at_utc`),
  CONSTRAINT `fk_bulk_operation_user` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_crm_bulk_operation_business_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_bulk_uploads
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_bulk_uploads` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `branch_id` bigint unsigned NOT NULL,
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_size_bytes` int DEFAULT NULL,
  `uploaded_by_user_id` bigint unsigned NOT NULL,
  `status` enum('Queued','Validating','In Progress','Completed','Completed with Errors','Failed','Cancelled') COLLATE utf8mb4_unicode_ci DEFAULT 'Queued',
  `total_records` int DEFAULT '0',
  `processed_records` int DEFAULT '0',
  `successful_records` int DEFAULT '0',
  `failed_records` int DEFAULT '0',
  `duplicate_records` int DEFAULT '0',
  `skipped_records` int DEFAULT '0',
  `processing_started_at_utc` datetime(6) DEFAULT NULL,
  `processing_completed_at_utc` datetime(6) DEFAULT NULL,
  `created_at_utc` datetime(6) DEFAULT CURRENT_TIMESTAMP(6),
  `error_summary` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_branch_user` (`branch_id`,`uploaded_by_user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at_utc`),
  KEY `uploaded_by_user_id` (`uploaded_by_user_id`),
  KEY `ix_crm_bulk_upload_business_unit` (`business_unit_id`,`created_at_utc`),
  CONSTRAINT `crm_bulk_uploads_ibfk_1` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `crm_bulk_uploads_ibfk_2` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_crm_bulk_upload_business_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_bulk_upload_events
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_bulk_upload_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `bulk_upload_id` bigint unsigned NOT NULL,
  `event_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `message` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at_utc` datetime(6) DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_bulk_upload` (`bulk_upload_id`),
  CONSTRAINT `crm_bulk_upload_events_ibfk_1` FOREIGN KEY (`bulk_upload_id`) REFERENCES `crm_bulk_uploads` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_bulk_upload_records
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_bulk_upload_records` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `bulk_upload_id` bigint unsigned NOT NULL,
  `row_number` int NOT NULL,
  `status` enum('Pending','Success','Failed','Duplicate','Skipped') COLLATE utf8mb4_unicode_ci DEFAULT 'Pending',
  `lead_id` bigint unsigned DEFAULT NULL,
  `created_lead_number` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `validation_errors` json DEFAULT NULL,
  `processed_at_utc` datetime(6) DEFAULT NULL,
  `created_at_utc` datetime(6) DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_bulk_upload` (`bulk_upload_id`),
  KEY `idx_lead` (`lead_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `crm_bulk_upload_records_ibfk_1` FOREIGN KEY (`bulk_upload_id`) REFERENCES `crm_bulk_uploads` (`id`) ON DELETE CASCADE,
  CONSTRAINT `crm_bulk_upload_records_ibfk_2` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_business_campaign_categories
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_business_campaign_categories` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `category_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_business_campaign_category` (`business_unit_id`,`category_key`),
  CONSTRAINT `fk_crm_business_campaign_category_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_business_campaigns
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_business_campaigns` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `category_id` bigint unsigned NOT NULL,
  `campaign_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_business_campaign` (`business_unit_id`,`campaign_key`),
  KEY `ix_crm_business_campaign_category` (`category_id`),
  CONSTRAINT `fk_crm_business_campaign_category` FOREIGN KEY (`category_id`) REFERENCES `crm_business_campaign_categories` (`id`),
  CONSTRAINT `fk_crm_business_campaign_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_business_channel_categories
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_business_channel_categories` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `category_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_business_channel_category` (`business_unit_id`,`category_key`),
  CONSTRAINT `fk_crm_business_channel_category_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_business_channels
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_business_channels` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `category_id` bigint unsigned NOT NULL,
  `channel_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_business_channel` (`business_unit_id`,`channel_key`),
  KEY `ix_crm_business_channel_category` (`category_id`),
  CONSTRAINT `fk_crm_business_channel_category` FOREIGN KEY (`category_id`) REFERENCES `crm_business_channel_categories` (`id`),
  CONSTRAINT `fk_crm_business_channel_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_business_modules
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_business_modules` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `module_key` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `module_type` enum('leads','operations','tasks','communications','documents','reports','custom') COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `layout_json` json DEFAULT NULL,
  `settings_json` json DEFAULT NULL,
  `position` smallint unsigned NOT NULL DEFAULT '1',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_business_module` (`business_unit_id`,`module_key`),
  CONSTRAINT `fk_crm_business_module_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_business_sources
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_business_sources` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `channel_id` bigint unsigned NOT NULL,
  `source_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_business_source` (`business_unit_id`,`source_key`),
  KEY `ix_crm_business_source_channel` (`channel_id`),
  CONSTRAINT `fk_crm_business_source_channel` FOREIGN KEY (`channel_id`) REFERENCES `crm_business_channels` (`id`),
  CONSTRAINT `fk_crm_business_source_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_callerdesk_configs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_callerdesk_configs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `account_name` varchar(120) NOT NULL DEFAULT 'CallerDesk',
  `authcode_encrypted` text NOT NULL,
  `default_deskphone` varchar(30) DEFAULT NULL,
  `default_group_name` varchar(120) DEFAULT NULL,
  `webhook_secret` varchar(128) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by_user_id` bigint unsigned NOT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_callerdesk_business_unit` (`business_unit_id`),
  KEY `fk_callerdesk_config_user` (`created_by_user_id`),
  CONSTRAINT `fk_callerdesk_config_bu` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_callerdesk_config_user` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_call_activities
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_call_activities` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `config_id` bigint unsigned NOT NULL,
  `business_unit_id` bigint unsigned NOT NULL,
  `lead_id` bigint unsigned DEFAULT NULL,
  `agent_user_id` bigint unsigned DEFAULT NULL,
  `callerdesk_sid` varchar(120) DEFAULT NULL,
  `campaign_reference` varchar(120) DEFAULT NULL,
  `direction` varchar(20) DEFAULT NULL,
  `source_number` varchar(30) DEFAULT NULL,
  `destination_number` varchar(30) DEFAULT NULL,
  `agent_number` varchar(30) DEFAULT NULL,
  `status` varchar(80) NOT NULL DEFAULT 'initiated',
  `call_result` varchar(100) DEFAULT NULL,
  `started_at_utc` datetime(6) DEFAULT NULL,
  `ended_at_utc` datetime(6) DEFAULT NULL,
  `duration_seconds` int unsigned NOT NULL DEFAULT '0',
  `talk_seconds` int unsigned NOT NULL DEFAULT '0',
  `recording_url` varchar(1000) DEFAULT NULL,
  `coins` decimal(12,4) DEFAULT NULL,
  `call_group` varchar(120) DEFAULT NULL,
  `disposition` varchar(80) DEFAULT NULL,
  `notes` text,
  `followup_at_utc` datetime(6) DEFAULT NULL,
  `raw_payload` json DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_callerdesk_sid` (`config_id`,`callerdesk_sid`),
  KEY `ix_calls_lead_time` (`lead_id`,`created_at_utc`),
  KEY `ix_calls_bu_time` (`business_unit_id`,`created_at_utc`),
  KEY `fk_call_user` (`agent_user_id`),
  CONSTRAINT `fk_call_bu` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_call_config` FOREIGN KEY (`config_id`) REFERENCES `crm_callerdesk_configs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_call_lead` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_call_user` FOREIGN KEY (`agent_user_id`) REFERENCES `app_users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_callerdesk_agents
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_callerdesk_agents` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `config_id` bigint unsigned NOT NULL,
  `user_id` bigint unsigned DEFAULT NULL,
  `employee_id` bigint DEFAULT NULL,
  `member_id` varchar(100) DEFAULT NULL,
  `member_name` varchar(150) NOT NULL,
  `member_number` varchar(30) NOT NULL,
  `call_group` varchar(120) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_callerdesk_config_number` (`config_id`,`member_number`),
  KEY `ix_callerdesk_agent_user` (`config_id`,`user_id`),
  KEY `fk_callerdesk_agent_user` (`user_id`),
  KEY `fk_callerdesk_agent_employee` (`employee_id`),
  CONSTRAINT `fk_callerdesk_agent_config` FOREIGN KEY (`config_id`) REFERENCES `crm_callerdesk_configs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_callerdesk_agent_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_callerdesk_agent_user` FOREIGN KEY (`user_id`) REFERENCES `app_users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_dialer_campaigns
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_dialer_campaigns` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `config_id` bigint unsigned NOT NULL,
  `business_unit_id` bigint unsigned NOT NULL,
  `name` varchar(160) NOT NULL,
  `mode` enum('manual','preview','progressive') NOT NULL DEFAULT 'preview',
  `status` enum('draft','running','paused','completed','cancelled') NOT NULL DEFAULT 'draft',
  `agent_id` bigint unsigned DEFAULT NULL,
  `deskphone` varchar(30) DEFAULT NULL,
  `call_group` varchar(120) DEFAULT NULL,
  `max_attempts` tinyint unsigned NOT NULL DEFAULT '2',
  `retry_delay_minutes` smallint unsigned NOT NULL DEFAULT '30',
  `created_by_user_id` bigint unsigned NOT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `ix_dialer_campaign_bu` (`business_unit_id`,`status`),
  KEY `fk_dialer_campaign_config` (`config_id`),
  KEY `fk_dialer_campaign_agent` (`agent_id`),
  KEY `fk_dialer_campaign_user` (`created_by_user_id`),
  CONSTRAINT `fk_dialer_campaign_agent` FOREIGN KEY (`agent_id`) REFERENCES `crm_callerdesk_agents` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_dialer_campaign_bu` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_dialer_campaign_config` FOREIGN KEY (`config_id`) REFERENCES `crm_callerdesk_configs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_dialer_campaign_user` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_dialer_queue
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_dialer_queue` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `campaign_id` bigint unsigned NOT NULL,
  `lead_id` bigint unsigned NOT NULL,
  `status` enum('queued','dialling','connected','completed','retry','skipped','failed') NOT NULL DEFAULT 'queued',
  `attempts` tinyint unsigned NOT NULL DEFAULT '0',
  `next_attempt_at_utc` datetime(6) DEFAULT NULL,
  `last_call_activity_id` bigint unsigned DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dialer_campaign_lead` (`campaign_id`,`lead_id`),
  KEY `ix_dialer_next` (`campaign_id`,`status`,`next_attempt_at_utc`),
  KEY `fk_dialer_queue_lead` (`lead_id`),
  KEY `fk_dialer_queue_call` (`last_call_activity_id`),
  CONSTRAINT `fk_dialer_queue_call` FOREIGN KEY (`last_call_activity_id`) REFERENCES `crm_call_activities` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_dialer_queue_campaign` FOREIGN KEY (`campaign_id`) REFERENCES `crm_dialer_campaigns` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_dialer_queue_lead` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_metadata_pipelines
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_metadata_pipelines` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `pipeline_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `entity_label_singular` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Lead',
  `entity_label_plural` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Leads',
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_metadata_pipeline` (`business_unit_id`,`pipeline_key`),
  CONSTRAINT `fk_crm_metadata_pipeline_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_metadata_pipeline_stages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_metadata_pipeline_stages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `pipeline_id` bigint unsigned NOT NULL,
  `stage_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `stage_type` enum('open','won','lost','on_hold') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  `color_code` char(7) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '#4A4FB1',
  `position` smallint unsigned NOT NULL DEFAULT '1',
  `entry_rules_json` json DEFAULT NULL,
  `exit_rules_json` json DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_metadata_pipeline_stage` (`pipeline_id`,`stage_key`),
  KEY `ix_crm_metadata_pipeline_stage_order` (`pipeline_id`,`is_active`,`position`),
  CONSTRAINT `fk_crm_metadata_pipeline_stage_pipeline` FOREIGN KEY (`pipeline_id`) REFERENCES `crm_metadata_pipelines` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_dynamic_leads
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_dynamic_leads` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `pipeline_id` bigint unsigned NOT NULL,
  `stage_id` bigint unsigned NOT NULL,
  `lead_number` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `primary_phone` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `primary_email` varchar(254) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_key` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `owner_employee_id` bigint DEFAULT NULL,
  `custom_values_json` json DEFAULT NULL,
  `next_followup_at_utc` datetime(6) DEFAULT NULL,
  `created_by_user_id` bigint unsigned NOT NULL,
  `updated_by_user_id` bigint unsigned DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  `deleted_at_utc` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_dynamic_lead_number` (`business_unit_id`,`lead_number`),
  KEY `ix_crm_dynamic_lead_pipeline` (`business_unit_id`,`pipeline_id`,`stage_id`),
  KEY `ix_crm_dynamic_lead_phone` (`business_unit_id`,`primary_phone`),
  KEY `fk_crm_dynamic_lead_pipeline` (`pipeline_id`),
  KEY `fk_crm_dynamic_lead_stage` (`stage_id`),
  KEY `fk_crm_dynamic_lead_owner` (`owner_employee_id`),
  KEY `fk_crm_dynamic_lead_created_by` (`created_by_user_id`),
  KEY `fk_crm_dynamic_lead_updated_by` (`updated_by_user_id`),
  CONSTRAINT `fk_crm_dynamic_lead_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users` (`id`),
  CONSTRAINT `fk_crm_dynamic_lead_owner` FOREIGN KEY (`owner_employee_id`) REFERENCES `employees` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_crm_dynamic_lead_pipeline` FOREIGN KEY (`pipeline_id`) REFERENCES `crm_metadata_pipelines` (`id`),
  CONSTRAINT `fk_crm_dynamic_lead_stage` FOREIGN KEY (`stage_id`) REFERENCES `crm_metadata_pipeline_stages` (`id`),
  CONSTRAINT `fk_crm_dynamic_lead_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`),
  CONSTRAINT `fk_crm_dynamic_lead_updated_by` FOREIGN KEY (`updated_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_followups
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_followups` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `lead_id` bigint unsigned NOT NULL,
  `assigned_employee_id` bigint DEFAULT NULL,
  `followup_type` varchar(30) NOT NULL DEFAULT 'Call',
  `due_at_utc` datetime(6) NOT NULL,
  `status` varchar(30) NOT NULL DEFAULT 'Pending',
  `outcome` varchar(100) DEFAULT NULL,
  `notes` text,
  `completed_at_utc` datetime(6) DEFAULT NULL,
  `created_by_user_id` bigint unsigned NOT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `ix_crm_followups_assignee_due` (`assigned_employee_id`,`status`,`due_at_utc`),
  KEY `ix_crm_followups_lead` (`lead_id`),
  KEY `fk_crm_followups_user` (`created_by_user_id`),
  CONSTRAINT `fk_crm_followups_employee` FOREIGN KEY (`assigned_employee_id`) REFERENCES `employees` (`id`),
  CONSTRAINT `fk_crm_followups_lead` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_crm_followups_user` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_organizations
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_organizations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `status` enum('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_integrations
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_integrations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `organization_id` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `type` varchar(50) NOT NULL,
  `description` longtext,
  `provider` varchar(100) DEFAULT NULL,
  `api_key` varchar(500) DEFAULT NULL,
  `api_secret` varchar(500) DEFAULT NULL,
  `config` json DEFAULT NULL,
  `status` enum('ACTIVE','INACTIVE','CONNECTED','DISCONNECTED','ERROR') NOT NULL DEFAULT 'ACTIVE',
  `connected_at` timestamp NULL DEFAULT NULL,
  `last_sync_at` timestamp NULL DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` int DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `project_id` varchar(255) DEFAULT NULL COMMENT 'AiSensy Project ID',
  `project_api_password` varchar(500) DEFAULT NULL COMMENT 'AiSensy API Password',
  `aisensy_base_url` varchar(500) DEFAULT NULL,
  `aisensy_api_key` varchar(500) DEFAULT NULL,
  `media_public_base_url` varchar(500) DEFAULT NULL,
  `google_client_id` varchar(500) DEFAULT NULL,
  `google_client_secret` varchar(500) DEFAULT NULL,
  `google_redirect_uri` varchar(1000) DEFAULT NULL,
  `last_template_sync_at` timestamp NULL DEFAULT NULL COMMENT 'Last template sync from AiSensy',
  `whatsapp_utility_message_price` decimal(10,4) DEFAULT NULL,
  `whatsapp_marketing_message_price` decimal(10,4) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_organization` (`organization_id`),
  KEY `idx_type` (`type`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`),
  KEY `idx_project_id` (`project_id`),
  CONSTRAINT `fk_org` FOREIGN KEY (`organization_id`) REFERENCES `crm_organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_integration_audit_logs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_integration_audit_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `integration_id` int DEFAULT NULL,
  `integration_config_id` int DEFAULT NULL,
  `action` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_integration` (`integration_config_id`),
  KEY `idx_action` (`action`),
  KEY `idx_created` (`created_at`),
  KEY `fk_integration_audit_integration` (`integration_id`),
  CONSTRAINT `fk_integration_audit_integration` FOREIGN KEY (`integration_id`) REFERENCES `crm_integrations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_integration_configs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_integration_configs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `organization_id` int NOT NULL,
  `integration_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `integration_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `provider_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `config_json` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending_auth',
  `last_error_message` text COLLATE utf8mb4_unicode_ci,
  `last_synced_at` datetime DEFAULT NULL,
  `next_sync_at` datetime DEFAULT NULL,
  `sync_enabled` tinyint(1) DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_name_per_org` (`organization_id`,`integration_name`),
  KEY `idx_org_id` (`organization_id`),
  KEY `idx_provider` (`provider_name`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_integration_error_logs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_integration_error_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `integration_config_id` int NOT NULL,
  `error_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'auth_failure, rate_limit, invalid_data, etc.',
  `error_message` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `error_details` json DEFAULT NULL,
  `affected_records` int DEFAULT '0',
  `is_resolved` tinyint(1) DEFAULT '0',
  `resolved_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_config` (`integration_config_id`),
  KEY `idx_type` (`error_type`),
  KEY `idx_created` (`created_at`),
  CONSTRAINT `fk_error_log_integration` FOREIGN KEY (`integration_config_id`) REFERENCES `crm_integrations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_integration_errors
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_integration_errors` (
  `id` int NOT NULL AUTO_INCREMENT,
  `integration_config_id` int NOT NULL,
  `error_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `error_details` json DEFAULT NULL,
  `resolution_notes` text COLLATE utf8mb4_unicode_ci,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'open',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `resolved_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_integration` (`integration_config_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`),
  CONSTRAINT `crm_integration_errors_ibfk_1` FOREIGN KEY (`integration_config_id`) REFERENCES `crm_integration_configs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_integration_field_mappings
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_integration_field_mappings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `integration_config_id` int NOT NULL,
  `external_field` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `crm_field` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `field_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_required` tinyint(1) DEFAULT '0',
  `transform_rule` json DEFAULT NULL,
  `active` tinyint(1) DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_mapping` (`integration_config_id`,`external_field`,`crm_field`),
  KEY `idx_integration` (`integration_config_id`),
  CONSTRAINT `fk_field_mapping_integration` FOREIGN KEY (`integration_config_id`) REFERENCES `crm_integrations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_integration_hub_configs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_integration_hub_configs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `organization_id` int NOT NULL,
  `integration_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'meta, google_sheets, whatsapp, sms, google_ads, email, erp',
  `provider_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Meta Cloud API, SmartPing, 360Dialog, etc.',
  `integration_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('active','inactive','error','pending_auth') COLLATE utf8mb4_unicode_ci DEFAULT 'pending_auth',
  `config` longtext COLLATE utf8mb4_unicode_ci,
  `last_synced_at` timestamp NULL DEFAULT NULL,
  `next_sync_at` timestamp NULL DEFAULT NULL,
  `last_error_message` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_webhook_active` tinyint(1) DEFAULT '0',
  `webhook_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `webhook_secret` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'For HMAC signature verification',
  `api_quota_limit` int DEFAULT NULL,
  `api_quota_remaining` int DEFAULT NULL,
  `api_quota_reset_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_org_type` (`organization_id`,`integration_type`),
  KEY `idx_status` (`status`),
  KEY `idx_sync_schedule` (`next_sync_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_integration_oauth_tokens
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_integration_oauth_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `integration_config_id` int NOT NULL,
  `provider_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `access_token` longtext COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Encrypted token',
  `refresh_token` longtext COLLATE utf8mb4_unicode_ci COMMENT 'Encrypted refresh token',
  `token_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `expires_at` timestamp NULL DEFAULT NULL,
  `scope` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `obtained_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_config_oauth` (`integration_config_id`),
  KEY `idx_config` (`integration_config_id`),
  CONSTRAINT `fk_oauth_token_integration` FOREIGN KEY (`integration_config_id`) REFERENCES `crm_integrations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_integration_skipped_leads
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_integration_skipped_leads` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `integration_id` int NOT NULL,
  `source_id` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sheet_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch_id` bigint unsigned DEFAULT NULL,
  `branch_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sheet_row_number` int unsigned NOT NULL,
  `student_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reason` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `existing_lead_id` bigint unsigned DEFAULT NULL,
  `existing_lead_number` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `row_fingerprint` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `occurrence_count` int unsigned NOT NULL DEFAULT '1',
  `first_seen_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `last_seen_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sheet_skipped_source_row` (`integration_id`,`source_id`,`row_fingerprint`),
  KEY `ix_sheet_skipped_recent` (`integration_id`,`last_seen_at`),
  KEY `ix_sheet_skipped_branch` (`branch_id`),
  KEY `fk_skipped_leads_existing_lead` (`existing_lead_id`),
  CONSTRAINT `fk_skipped_leads_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_skipped_leads_existing_lead` FOREIGN KEY (`existing_lead_id`) REFERENCES `crm_leads` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_skipped_leads_integration` FOREIGN KEY (`integration_id`) REFERENCES `crm_integrations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_integration_sync_jobs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_integration_sync_jobs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `integration_config_id` int NOT NULL,
  `sync_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `started_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_integration` (`integration_config_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`),
  CONSTRAINT `fk_sync_job_integration` FOREIGN KEY (`integration_config_id`) REFERENCES `crm_integrations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_integration_sync_logs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_integration_sync_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `integration_config_id` int NOT NULL,
  `sync_job_id` int DEFAULT NULL,
  `sync_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `records_processed` int DEFAULT '0',
  `records_created` int DEFAULT '0',
  `records_updated` int DEFAULT '0',
  `records_failed` int DEFAULT '0',
  `stats` json DEFAULT NULL,
  `error_summary` text COLLATE utf8mb4_unicode_ci,
  `duration_seconds` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_integration` (`integration_config_id`),
  KEY `idx_job` (`sync_job_id`),
  KEY `idx_created` (`created_at`),
  KEY `idx_status` (`status`),
  CONSTRAINT `crm_integration_sync_logs_ibfk_2` FOREIGN KEY (`sync_job_id`) REFERENCES `crm_integration_sync_jobs` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_sync_log_integration` FOREIGN KEY (`integration_config_id`) REFERENCES `crm_integrations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_integration_webhooks
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_integration_webhooks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `integration_config_id` int NOT NULL,
  `webhook_event` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'lead_received, message_status_update, etc.',
  `webhook_url` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `signature_algorithm` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'hmac_sha256, hmac_sha512, etc.',
  `retry_policy` json DEFAULT NULL COMMENT '{"max_retries": 5, "backoff_multiplier": 2}',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_config` (`integration_config_id`),
  CONSTRAINT `fk_webhook_integration` FOREIGN KEY (`integration_config_id`) REFERENCES `crm_integrations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_integration_webhook_logs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_integration_webhook_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `webhook_id` int NOT NULL,
  `event_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payload_hash` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `http_status_code` int DEFAULT NULL,
  `response_body` text COLLATE utf8mb4_unicode_ci,
  `attempt_number` int DEFAULT '1',
  `next_retry_at` timestamp NULL DEFAULT NULL,
  `delivered_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_webhook` (`webhook_id`),
  KEY `idx_delivery_status` (`delivered_at`),
  CONSTRAINT `crm_integration_webhook_logs_ibfk_1` FOREIGN KEY (`webhook_id`) REFERENCES `crm_integration_webhooks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_jodo_payment_links
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_jodo_payment_links` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `branch_id` bigint unsigned NOT NULL,
  `lead_id` bigint unsigned DEFAULT NULL,
  `environment` enum('production','uat') NOT NULL DEFAULT 'production',
  `order_id` varchar(120) NOT NULL,
  `redirect_url` varchar(1000) NOT NULL,
  `payer_name` varchar(200) NOT NULL,
  `payer_phone` varchar(30) NOT NULL,
  `payer_email` varchar(254) NOT NULL,
  `student_name` varchar(200) DEFAULT NULL,
  `identifier` varchar(120) DEFAULT NULL,
  `custom_identifier` varchar(120) DEFAULT NULL,
  `grade` varchar(120) DEFAULT NULL,
  `academic_year_start` smallint unsigned DEFAULT NULL,
  `academic_year_end` smallint unsigned DEFAULT NULL,
  `expires_at_utc` datetime(6) DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `details_json` json NOT NULL,
  `notes_json` json DEFAULT NULL,
  `status` varchar(40) NOT NULL DEFAULT 'unpaid',
  `transaction_id` varchar(150) DEFAULT NULL,
  `paid_at_utc` datetime(6) DEFAULT NULL,
  `settled_at_utc` datetime(6) DEFAULT NULL,
  `settlement_utr` varchar(150) DEFAULT NULL,
  `raw_response` json DEFAULT NULL,
  `created_by_user_id` bigint unsigned NOT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_jodo_payment_link_order` (`environment`,`order_id`),
  KEY `ix_jodo_link_bu_status` (`business_unit_id`,`status`,`created_at_utc`),
  KEY `ix_jodo_link_branch` (`branch_id`,`created_at_utc`),
  KEY `ix_jodo_link_lead` (`lead_id`,`created_at_utc`),
  KEY `fk_jodo_link_user` (`created_by_user_id`),
  CONSTRAINT `fk_jodo_link_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`),
  CONSTRAINT `fk_jodo_link_bu` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_jodo_link_lead` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_jodo_link_user` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_lead_activities
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_lead_activities` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `lead_id` bigint unsigned NOT NULL,
  `activity_type` varchar(50) NOT NULL,
  `summary` varchar(500) NOT NULL,
  `details_json` json DEFAULT NULL,
  `actor_user_id` bigint unsigned DEFAULT NULL,
  `occurred_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `ix_crm_activities_lead_time` (`lead_id`,`occurred_at_utc`),
  KEY `fk_crm_activities_user` (`actor_user_id`),
  CONSTRAINT `fk_crm_activities_lead` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_crm_activities_user` FOREIGN KEY (`actor_user_id`) REFERENCES `app_users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_lead_comments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_lead_comments` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `lead_id` bigint unsigned NOT NULL,
  `comment_text` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_by_user_id` bigint unsigned NOT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_crm_lead_comments_lead_created` (`lead_id`,`created_at_utc`),
  KEY `fk_crm_lead_comments_user` (`created_by_user_id`),
  CONSTRAINT `fk_crm_lead_comments_lead` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads` (`id`),
  CONSTRAINT `fk_crm_lead_comments_user` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_lead_source_history
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_lead_source_history` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `lead_id` bigint unsigned NOT NULL,
  `academic_year` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_id` bigint unsigned NOT NULL,
  `channel_id` bigint unsigned NOT NULL,
  `campaign_id` bigint unsigned NOT NULL,
  `is_primary` tinyint(1) NOT NULL DEFAULT '0',
  `intake_method` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `created_by_user_id` bigint unsigned DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_crm_lead_source` (`lead_id`,`source_id`),
  KEY `idx_crm_source_history_lead` (`lead_id`,`created_at_utc`),
  KEY `fk_crm_source_history_source` (`source_id`),
  KEY `fk_crm_source_history_channel` (`channel_id`),
  KEY `fk_crm_source_history_campaign` (`campaign_id`),
  KEY `fk_crm_source_history_user` (`created_by_user_id`),
  CONSTRAINT `fk_crm_source_history_campaign` FOREIGN KEY (`campaign_id`) REFERENCES `crm_campaigns` (`id`),
  CONSTRAINT `fk_crm_source_history_channel` FOREIGN KEY (`channel_id`) REFERENCES `crm_lead_channels` (`id`),
  CONSTRAINT `fk_crm_source_history_lead` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads` (`id`),
  CONSTRAINT `fk_crm_source_history_source` FOREIGN KEY (`source_id`) REFERENCES `crm_lead_sources` (`id`),
  CONSTRAINT `fk_crm_source_history_user` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_lead_stage_history
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_lead_stage_history` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `lead_id` bigint unsigned NOT NULL,
  `from_stage_id` bigint unsigned DEFAULT NULL,
  `to_stage_id` bigint unsigned NOT NULL,
  `from_substage_id` bigint unsigned DEFAULT NULL,
  `to_substage_id` bigint unsigned NOT NULL,
  `changed_by_user_id` bigint unsigned NOT NULL,
  `changed_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_lead_id` (`lead_id`),
  KEY `idx_to_stage_id` (`to_stage_id`),
  KEY `idx_changed_at_utc` (`changed_at_utc`),
  KEY `idx_stage_history_lead_date` (`lead_id`,`changed_at_utc`),
  KEY `idx_stage_history_user` (`changed_by_user_id`,`changed_at_utc`),
  KEY `from_stage_id` (`from_stage_id`),
  KEY `from_substage_id` (`from_substage_id`),
  KEY `to_substage_id` (`to_substage_id`),
  CONSTRAINT `crm_lead_stage_history_ibfk_1` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `crm_lead_stage_history_ibfk_2` FOREIGN KEY (`from_stage_id`) REFERENCES `crm_lead_stages` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `crm_lead_stage_history_ibfk_3` FOREIGN KEY (`to_stage_id`) REFERENCES `crm_lead_stages` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `crm_lead_stage_history_ibfk_4` FOREIGN KEY (`from_substage_id`) REFERENCES `crm_lead_substages` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `crm_lead_stage_history_ibfk_5` FOREIGN KEY (`to_substage_id`) REFERENCES `crm_lead_substages` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `crm_lead_stage_history_ibfk_6` FOREIGN KEY (`changed_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_marketing_campaigns
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_marketing_campaigns` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `organization_id` bigint unsigned NOT NULL,
  `name` varchar(180) NOT NULL,
  `rule_type` enum('days_gap','calendar_dates','weekdays') NOT NULL,
  `communication_count` smallint unsigned NOT NULL,
  `first_communication_at` datetime(6) NOT NULL,
  `gap_days` smallint unsigned DEFAULT NULL,
  `weekdays_json` json DEFAULT NULL,
  `calendar_dates_json` json DEFAULT NULL,
  `audience_filters_json` json NOT NULL,
  `integration_id` int NOT NULL,
  `response_owner` enum('sender','lead_owner') NOT NULL DEFAULT 'sender',
  `retry_attempts` smallint unsigned NOT NULL DEFAULT '0',
  `status` enum('ACTIVE','PAUSED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  `created_by` bigint unsigned NOT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `ix_crm_marketing_campaign_status` (`status`,`first_communication_at`),
  KEY `ix_crm_marketing_campaign_org` (`organization_id`,`created_at_utc`),
  KEY `fk_crm_marketing_campaign_creator` (`created_by`),
  KEY `fk_crm_marketing_campaign_integration` (`integration_id`),
  KEY `ix_crm_marketing_campaign_business_unit` (`business_unit_id`,`created_at_utc`),
  CONSTRAINT `fk_crm_marketing_campaign_business_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`),
  CONSTRAINT `fk_crm_marketing_campaign_creator` FOREIGN KEY (`created_by`) REFERENCES `app_users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_crm_marketing_campaign_integration` FOREIGN KEY (`integration_id`) REFERENCES `crm_integrations` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_marketing_campaign_recipients
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_marketing_campaign_recipients` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `campaign_id` bigint unsigned NOT NULL,
  `lead_id` bigint unsigned NOT NULL,
  `phone` varchar(30) NOT NULL,
  `phone_type` enum('primary','alternate') NOT NULL DEFAULT 'primary',
  `status` enum('PENDING','IN_PROGRESS','COMPLETED','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_marketing_recipient` (`campaign_id`,`lead_id`,`phone_type`),
  KEY `ix_crm_marketing_recipient_lead` (`lead_id`),
  CONSTRAINT `fk_crm_marketing_recipient_campaign` FOREIGN KEY (`campaign_id`) REFERENCES `crm_marketing_campaigns` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_crm_marketing_recipient_lead` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_whatsapp_templates
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_whatsapp_templates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `integration_id` int NOT NULL,
  `organization_id` int NOT NULL,
  `template_name` varchar(255) NOT NULL,
  `category` enum('MARKETING','TRANSACTIONAL','OTP','UTILITY','AUTHENTICATION') NOT NULL,
  `language` varchar(50) NOT NULL DEFAULT 'English',
  `template_type` enum('TEXT','IMAGE','VIDEO','FILE','LOCATION','CAROUSEL','ORDER_DETAILS') NOT NULL,
  `header_type` enum('NONE','TEXT','IMAGE','VIDEO','DOCUMENT') NOT NULL DEFAULT 'NONE',
  `header_content` longtext,
  `body` longtext NOT NULL,
  `footer` varchar(1024) DEFAULT NULL,
  `buttons_json` json DEFAULT NULL,
  `sample_values_json` json DEFAULT NULL,
  `variables_list` json DEFAULT NULL,
  `status` enum('DRAFT','PENDING','APPROVED','REJECTED','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  `rejection_reason` longtext,
  `api_response` json DEFAULT NULL,
  `api_template_id` varchar(255) DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` int DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `is_archived` tinyint(1) DEFAULT '0',
  `aisensy_template_id` varchar(255) DEFAULT NULL COMMENT 'AiSensy Template ID',
  `message_action_type` varchar(50) DEFAULT NULL COMMENT 'QuickReplies or CTA',
  `total_parameters` int DEFAULT '0' COMMENT 'Count of {{n}} parameters',
  `last_synced_at` timestamp NULL DEFAULT NULL COMMENT 'Last sync with AiSensy',
  `call_to_action` json DEFAULT NULL COMMENT 'CTA buttons from AiSensy',
  `quick_replies` json DEFAULT NULL COMMENT 'Quick reply options',
  `media_url` longtext,
  `video_url` longtext,
  `document_url` longtext,
  `file_name` varchar(255) DEFAULT NULL,
  `file_size` int DEFAULT NULL,
  `mime_type` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_template` (`integration_id`,`template_name`,`deleted_at`),
  UNIQUE KEY `aisensy_template_id` (`aisensy_template_id`),
  KEY `idx_integration` (`integration_id`),
  KEY `idx_organization` (`organization_id`),
  KEY `idx_status` (`status`),
  KEY `idx_category` (`category`),
  KEY `idx_language` (`language`),
  KEY `idx_created` (`created_at`),
  KEY `idx_aisensy_template_id` (`aisensy_template_id`),
  KEY `idx_last_synced` (`integration_id`,`last_synced_at`),
  KEY `idx_template_type` (`template_type`),
  CONSTRAINT `fk_integration` FOREIGN KEY (`integration_id`) REFERENCES `crm_integrations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_whatsapp_template_organization` FOREIGN KEY (`organization_id`) REFERENCES `crm_organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_marketing_campaign_touches
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_marketing_campaign_touches` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `campaign_id` bigint unsigned NOT NULL,
  `sequence_number` smallint unsigned NOT NULL,
  `template_id` int NOT NULL,
  `template_name` varchar(180) NOT NULL,
  `template_body` text NOT NULL,
  `template_language` varchar(30) DEFAULT NULL,
  `template_params_json` json DEFAULT NULL,
  `media_url` varchar(1000) DEFAULT NULL,
  `media_filename` varchar(255) DEFAULT NULL,
  `scheduled_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_marketing_campaign_touch` (`campaign_id`,`sequence_number`),
  KEY `fk_crm_marketing_touch_template` (`template_id`),
  CONSTRAINT `fk_crm_marketing_touch_campaign` FOREIGN KEY (`campaign_id`) REFERENCES `crm_marketing_campaigns` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_crm_marketing_touch_template` FOREIGN KEY (`template_id`) REFERENCES `crm_whatsapp_templates` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_marketing_campaign_deliveries
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_marketing_campaign_deliveries` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `campaign_id` bigint unsigned NOT NULL,
  `recipient_id` bigint unsigned NOT NULL,
  `touch_id` bigint unsigned NOT NULL,
  `sequence_number` smallint unsigned NOT NULL,
  `scheduled_for` datetime(6) NOT NULL,
  `status` enum('PENDING','RUNNING','QUEUED','SENT','DELIVERED','READ','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `attempts` smallint unsigned NOT NULL DEFAULT '0',
  `whatsapp_message_id` varchar(255) DEFAULT NULL,
  `error_message` varchar(1000) DEFAULT NULL,
  `sent_at_utc` datetime(6) DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_marketing_delivery` (`recipient_id`,`touch_id`),
  KEY `ix_crm_marketing_delivery_due` (`status`,`scheduled_for`),
  KEY `ix_crm_marketing_delivery_campaign` (`campaign_id`,`status`),
  KEY `fk_crm_marketing_delivery_touch` (`touch_id`),
  CONSTRAINT `fk_crm_marketing_delivery_campaign` FOREIGN KEY (`campaign_id`) REFERENCES `crm_marketing_campaigns` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_crm_marketing_delivery_recipient` FOREIGN KEY (`recipient_id`) REFERENCES `crm_marketing_campaign_recipients` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_crm_marketing_delivery_touch` FOREIGN KEY (`touch_id`) REFERENCES `crm_marketing_campaign_touches` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_meta_forms
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_meta_forms` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `page_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `form_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `form_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `form_status` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `field_mapping` json DEFAULT NULL,
  `business_unit_id` bigint unsigned DEFAULT NULL,
  `branch_id` bigint unsigned DEFAULT NULL,
  `source_id` bigint unsigned DEFAULT NULL,
  `channel_id` bigint unsigned DEFAULT NULL,
  `campaign_id` bigint unsigned DEFAULT NULL,
  `stage_id` bigint unsigned DEFAULT NULL,
  `substage_id` bigint unsigned DEFAULT NULL,
  `owner_employee_id` bigint DEFAULT NULL,
  `academic_year` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `class_id` bigint unsigned DEFAULT NULL,
  `curriculum_id` bigint unsigned DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `last_backfill_time` bigint unsigned DEFAULT NULL,
  `last_synced_at_utc` datetime(6) DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_meta_forms_form` (`form_id`),
  KEY `ix_crm_meta_forms_page` (`page_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_meta_lead_imports
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_meta_lead_imports` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `leadgen_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `form_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `page_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ad_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `adgroup_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `campaign_meta_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lead_id` bigint unsigned DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `intake_source` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'webhook',
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `raw_payload` json DEFAULT NULL,
  `attempts` int NOT NULL DEFAULT '0',
  `meta_created_time` bigint unsigned DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_meta_lead_imports_leadgen` (`leadgen_id`),
  KEY `ix_crm_meta_lead_imports_form` (`form_id`,`created_at_utc`),
  KEY `ix_crm_meta_lead_imports_status` (`status`),
  KEY `ix_crm_meta_lead_imports_lead` (`lead_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_meta_pages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_meta_pages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `integration_id` int NOT NULL,
  `page_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `page_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `access_token_encrypted` text COLLATE utf8mb4_unicode_ci,
  `is_subscribed` tinyint(1) NOT NULL DEFAULT '0',
  `subscribed_at_utc` datetime(6) DEFAULT NULL,
  `subscribe_error` text COLLATE utf8mb4_unicode_ci,
  `business_unit_id` bigint unsigned DEFAULT NULL,
  `branch_id` bigint unsigned DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_meta_pages_page` (`page_id`),
  KEY `ix_crm_meta_pages_integration` (`integration_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_metadata_fields
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_metadata_fields` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `module_key` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'leads',
  `field_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `field_type` enum('text','textarea','number','decimal','date','datetime','email','phone','boolean','single_select','multi_select','user','file') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'text',
  `placeholder` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `help_text` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `options_json` json DEFAULT NULL,
  `validation_json` json DEFAULT NULL,
  `default_value_json` json DEFAULT NULL,
  `is_system` tinyint(1) NOT NULL DEFAULT '0',
  `is_required` tinyint(1) NOT NULL DEFAULT '0',
  `is_filterable` tinyint(1) NOT NULL DEFAULT '1',
  `filter_control` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_searchable` tinyint(1) NOT NULL DEFAULT '0',
  `is_importable` tinyint(1) NOT NULL DEFAULT '1',
  `is_import_required` tinyint(1) NOT NULL DEFAULT '0',
  `import_header` varchar(160) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `import_sample_value` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `show_in_list` tinyint(1) NOT NULL DEFAULT '1',
  `position` smallint unsigned NOT NULL DEFAULT '1',
  `column_width` smallint unsigned NOT NULL DEFAULT '180',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_metadata_field` (`business_unit_id`,`module_key`,`field_key`),
  KEY `ix_crm_metadata_field_layout` (`business_unit_id`,`module_key`,`is_active`,`position`),
  CONSTRAINT `fk_crm_metadata_field_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_metadata_forms
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_metadata_forms` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `module_key` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'leads',
  `form_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `form_type` enum('create','edit','view','quick_create') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'create',
  `sections_json` json NOT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_metadata_form` (`business_unit_id`,`module_key`,`form_key`),
  CONSTRAINT `fk_crm_metadata_form_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_metadata_pipeline_substages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_metadata_pipeline_substages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `stage_id` bigint unsigned NOT NULL,
  `substage_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `position` smallint unsigned NOT NULL DEFAULT '1',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_metadata_pipeline_substage` (`stage_id`,`substage_key`),
  KEY `ix_crm_metadata_pipeline_substage_order` (`stage_id`,`is_active`,`position`),
  CONSTRAINT `fk_crm_metadata_pipeline_substage_stage` FOREIGN KEY (`stage_id`) REFERENCES `crm_metadata_pipeline_stages` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_metadata_stage_transitions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_metadata_stage_transitions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `pipeline_id` bigint unsigned NOT NULL,
  `from_stage_id` bigint unsigned DEFAULT NULL,
  `to_stage_id` bigint unsigned NOT NULL,
  `transition_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `conditions_json` json DEFAULT NULL,
  `actions_json` json DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_metadata_stage_transition` (`pipeline_id`,`from_stage_id`,`to_stage_id`),
  KEY `fk_crm_metadata_transition_from` (`from_stage_id`),
  KEY `fk_crm_metadata_transition_to` (`to_stage_id`),
  CONSTRAINT `fk_crm_metadata_transition_from` FOREIGN KEY (`from_stage_id`) REFERENCES `crm_metadata_pipeline_stages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_crm_metadata_transition_pipeline` FOREIGN KEY (`pipeline_id`) REFERENCES `crm_metadata_pipelines` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_crm_metadata_transition_to` FOREIGN KEY (`to_stage_id`) REFERENCES `crm_metadata_pipeline_stages` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_tracker_guest_owners
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_tracker_guest_owners` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `display_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `normalized_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by_user_id` bigint unsigned NOT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_tracker_guest_owner` (`business_unit_id`,`normalized_name`),
  KEY `ix_crm_tracker_guest_owner_active` (`business_unit_id`,`is_active`,`display_name`),
  KEY `fk_crm_tracker_guest_owner_creator` (`created_by_user_id`),
  CONSTRAINT `fk_crm_tracker_guest_owner_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users` (`id`),
  CONSTRAINT `fk_crm_tracker_guest_owner_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_operation_workflows
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_operation_workflows` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `workflow_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_label` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Operation',
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `form_schema_json` json DEFAULT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_operation_workflow` (`business_unit_id`,`workflow_key`),
  CONSTRAINT `fk_crm_operation_workflow_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_operation_stages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_operation_stages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `workflow_id` bigint unsigned NOT NULL,
  `stage_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `color_code` char(7) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '#4A4FB1',
  `position` smallint unsigned NOT NULL DEFAULT '1',
  `stage_type` enum('open','completed','cancelled','on_hold') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  `checklist_json` json DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_operation_stage` (`workflow_id`,`stage_key`),
  CONSTRAINT `fk_crm_operation_stage_workflow` FOREIGN KEY (`workflow_id`) REFERENCES `crm_operation_workflows` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_operation_records
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_operation_records` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `workflow_id` bigint unsigned NOT NULL,
  `stage_id` bigint unsigned NOT NULL,
  `dynamic_lead_id` bigint unsigned DEFAULT NULL,
  `legacy_lead_id` bigint unsigned DEFAULT NULL,
  `record_number` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `owner_employee_id` bigint DEFAULT NULL,
  `guest_owner_id` bigint unsigned DEFAULT NULL,
  `values_json` json DEFAULT NULL,
  `status_key` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `minutes_spent` int unsigned NOT NULL DEFAULT '0',
  `approval_required` tinyint(1) NOT NULL DEFAULT '0',
  `approval_status` enum('not_required','pending','approved','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'not_required',
  `due_at_utc` datetime(6) DEFAULT NULL,
  `created_by_user_id` bigint unsigned NOT NULL,
  `updated_by_user_id` bigint unsigned DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_operation_record_number` (`business_unit_id`,`record_number`),
  KEY `ix_crm_operation_record_stage` (`business_unit_id`,`workflow_id`,`stage_id`),
  KEY `fk_crm_operation_record_workflow` (`workflow_id`),
  KEY `fk_crm_operation_record_stage` (`stage_id`),
  KEY `fk_crm_operation_record_dynamic_lead` (`dynamic_lead_id`),
  KEY `fk_crm_operation_record_legacy_lead` (`legacy_lead_id`),
  KEY `fk_crm_operation_record_owner` (`owner_employee_id`),
  KEY `fk_crm_operation_record_created_by` (`created_by_user_id`),
  KEY `fk_crm_operation_record_updated_by` (`updated_by_user_id`),
  KEY `ix_crm_operation_guest_owner` (`guest_owner_id`),
  CONSTRAINT `fk_crm_operation_guest_owner` FOREIGN KEY (`guest_owner_id`) REFERENCES `crm_tracker_guest_owners` (`id`),
  CONSTRAINT `fk_crm_operation_record_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users` (`id`),
  CONSTRAINT `fk_crm_operation_record_dynamic_lead` FOREIGN KEY (`dynamic_lead_id`) REFERENCES `crm_dynamic_leads` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_crm_operation_record_legacy_lead` FOREIGN KEY (`legacy_lead_id`) REFERENCES `crm_leads` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_crm_operation_record_owner` FOREIGN KEY (`owner_employee_id`) REFERENCES `employees` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_crm_operation_record_stage` FOREIGN KEY (`stage_id`) REFERENCES `crm_operation_stages` (`id`),
  CONSTRAINT `fk_crm_operation_record_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`),
  CONSTRAINT `fk_crm_operation_record_updated_by` FOREIGN KEY (`updated_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_crm_operation_record_workflow` FOREIGN KEY (`workflow_id`) REFERENCES `crm_operation_workflows` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_mom_sessions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_mom_sessions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `session_number` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mom_notes` longtext COLLATE utf8mb4_unicode_ci,
  `action_item_count` int unsigned NOT NULL DEFAULT '0',
  `created_by_user_id` bigint unsigned NOT NULL,
  `started_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `ended_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_mom_session_number` (`session_number`),
  KEY `ix_crm_mom_session_unit` (`business_unit_id`,`ended_at_utc`),
  KEY `fk_crm_mom_session_creator` (`created_by_user_id`),
  CONSTRAINT `fk_crm_mom_session_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users` (`id`),
  CONSTRAINT `fk_crm_mom_session_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_mom_session_points
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_mom_session_points` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `session_id` bigint unsigned NOT NULL,
  `position` int unsigned NOT NULL,
  `mom_notes` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `operation_record_id` bigint unsigned DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_mom_session_point_position` (`session_id`,`position`),
  KEY `ix_crm_mom_point_operation` (`operation_record_id`),
  CONSTRAINT `fk_crm_mom_point_operation` FOREIGN KEY (`operation_record_id`) REFERENCES `crm_operation_records` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_crm_mom_point_session` FOREIGN KEY (`session_id`) REFERENCES `crm_mom_sessions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_oauth_state_tokens
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_oauth_state_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `state` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `integration_id` int DEFAULT NULL,
  `organization_id` int DEFAULT NULL,
  `data` json DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `used` tinyint(1) DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `state` (`state`),
  KEY `idx_state` (`state`),
  KEY `idx_expires` (`expires_at`),
  KEY `fk_oauth_state_integration` (`integration_id`),
  KEY `fk_oauth_state_organization` (`organization_id`),
  CONSTRAINT `fk_oauth_state_integration` FOREIGN KEY (`integration_id`) REFERENCES `crm_integrations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_oauth_state_organization` FOREIGN KEY (`organization_id`) REFERENCES `crm_organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_oauth_tokens
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_oauth_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `integration_config_id` int NOT NULL,
  `access_token` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `refresh_token` longtext COLLATE utf8mb4_unicode_ci,
  `token_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  `scope` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_token_per_integration` (`integration_config_id`),
  KEY `idx_integration` (`integration_config_id`),
  CONSTRAINT `crm_oauth_tokens_ibfk_1` FOREIGN KEY (`integration_config_id`) REFERENCES `crm_integration_configs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_operation_approvals
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_operation_approvals` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `operation_record_id` bigint unsigned NOT NULL,
  `approver_user_id` bigint unsigned NOT NULL,
  `decision` enum('pending','approved','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `decision_remarks` text COLLATE utf8mb4_unicode_ci,
  `document_references_json` json DEFAULT NULL,
  `requested_by_user_id` bigint unsigned NOT NULL,
  `requested_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `decided_at_utc` datetime(6) DEFAULT NULL,
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_operation_approver` (`operation_record_id`,`approver_user_id`),
  KEY `ix_crm_operation_approval_queue` (`approver_user_id`,`decision`,`requested_at_utc`),
  KEY `fk_crm_operation_approval_requested_by` (`requested_by_user_id`),
  CONSTRAINT `fk_crm_operation_approval_record` FOREIGN KEY (`operation_record_id`) REFERENCES `crm_operation_records` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_crm_operation_approval_requested_by` FOREIGN KEY (`requested_by_user_id`) REFERENCES `app_users` (`id`),
  CONSTRAINT `fk_crm_operation_approval_user` FOREIGN KEY (`approver_user_id`) REFERENCES `app_users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_operation_time_logs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_operation_time_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `operation_record_id` bigint unsigned NOT NULL,
  `minutes_spent` int unsigned NOT NULL,
  `work_note` varchar(1000) COLLATE utf8mb4_unicode_ci NOT NULL,
  `logged_by_user_id` bigint unsigned NOT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `ix_crm_operation_time_record` (`operation_record_id`,`created_at_utc`),
  KEY `fk_crm_operation_time_user` (`logged_by_user_id`),
  CONSTRAINT `fk_crm_operation_time_record` FOREIGN KEY (`operation_record_id`) REFERENCES `crm_operation_records` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_crm_operation_time_user` FOREIGN KEY (`logged_by_user_id`) REFERENCES `app_users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_payment_forms
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_payment_forms` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `branch_id` bigint unsigned NOT NULL,
  `form_key` varchar(120) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text,
  `amount_type` enum('fixed','variable_list','variable_free') NOT NULL DEFAULT 'fixed',
  `fixed_amount` decimal(12,2) DEFAULT NULL,
  `variable_amounts_json` json DEFAULT NULL,
  `additional_fields_json` json DEFAULT NULL,
  `success_message` text,
  `redirect_url` varchar(1000) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by_user_id` bigint unsigned NOT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `form_key` (`form_key`),
  UNIQUE KEY `uq_payment_form_key` (`form_key`),
  KEY `ix_payment_form_bu` (`business_unit_id`),
  KEY `ix_payment_form_branch` (`branch_id`),
  KEY `fk_payment_form_user` (`created_by_user_id`),
  CONSTRAINT `fk_payment_form_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`),
  CONSTRAINT `fk_payment_form_bu` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_payment_form_user` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_payment_form_categories
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_payment_form_categories` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `payment_form_id` bigint unsigned NOT NULL,
  `category_name` varchar(255) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `selection_type` enum('single','multiple') NOT NULL DEFAULT 'single',
  `display_order` tinyint unsigned NOT NULL DEFAULT '0',
  `is_required` tinyint(1) NOT NULL DEFAULT '0',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `ix_category_form` (`payment_form_id`),
  CONSTRAINT `fk_category_form` FOREIGN KEY (`payment_form_id`) REFERENCES `crm_payment_forms` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_payment_form_submissions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_payment_form_submissions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `payment_form_id` bigint unsigned NOT NULL,
  `jodo_order_id` varchar(120) DEFAULT NULL,
  `jodo_payment_url` varchar(1000) DEFAULT NULL,
  `payer_name` varchar(200) NOT NULL,
  `payer_email` varchar(254) NOT NULL,
  `payer_phone` varchar(30) NOT NULL,
  `student_name` varchar(200) DEFAULT NULL,
  `custom_fields_json` json DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `status` varchar(40) NOT NULL DEFAULT 'pending',
  `transaction_id` varchar(150) DEFAULT NULL,
  `paid_at_utc` datetime(6) DEFAULT NULL,
  `settled_at_utc` datetime(6) DEFAULT NULL,
  `settlement_utr` varchar(150) DEFAULT NULL,
  `raw_response` json DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `ix_submission_form` (`payment_form_id`,`created_at_utc`),
  KEY `ix_submission_bu` (`business_unit_id`,`status`),
  KEY `ix_submission_email` (`payer_email`),
  KEY `ix_submission_jodo` (`jodo_order_id`),
  CONSTRAINT `fk_submission_bu` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_submission_form` FOREIGN KEY (`payment_form_id`) REFERENCES `crm_payment_forms` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_public_enquiry_forms
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_public_enquiry_forms` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `business_unit_id` bigint unsigned NOT NULL,
  `form_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `default_branch_id` bigint DEFAULT NULL,
  `default_stage_id` bigint unsigned DEFAULT NULL,
  `default_substage_id` bigint unsigned DEFAULT NULL,
  `default_source_id` bigint unsigned DEFAULT NULL,
  `default_channel_id` bigint unsigned DEFAULT NULL,
  `default_campaign_id` bigint unsigned DEFAULT NULL,
  `default_owner_employee_id` bigint DEFAULT NULL,
  `field_schema_json` json NOT NULL,
  `settings_json` json DEFAULT NULL,
  `success_message` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `redirect_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by_user_id` bigint unsigned DEFAULT NULL,
  `updated_by_user_id` bigint unsigned DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_public_enquiry_form_key` (`form_key`),
  KEY `ix_crm_public_enquiry_form_unit` (`business_unit_id`,`is_active`,`display_name`),
  KEY `fk_crm_public_enquiry_form_created_by` (`created_by_user_id`),
  KEY `fk_crm_public_enquiry_form_updated_by` (`updated_by_user_id`),
  CONSTRAINT `fk_crm_public_enquiry_form_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_crm_public_enquiry_form_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_crm_public_enquiry_form_updated_by` FOREIGN KEY (`updated_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_saved_filters
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_saved_filters` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `name` varchar(150) NOT NULL,
  `filter_type` varchar(20) NOT NULL DEFAULT 'filter',
  `filters_json` json NOT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_saved_filters_user_name` (`user_id`,`name`),
  KEY `ix_crm_saved_filters_user_type` (`user_id`,`filter_type`),
  CONSTRAINT `fk_crm_saved_filters_user` FOREIGN KEY (`user_id`) REFERENCES `app_users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_crm_saved_filters_type` CHECK ((`filter_type` in (_utf8mb4'filter',_utf8mb4'funnel')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_smartping_messages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_smartping_messages` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(100) NOT NULL,
  `phone_number` varchar(20) NOT NULL,
  `contact_id` varchar(100) DEFAULT NULL,
  `sender` varchar(50) NOT NULL COMMENT 'CONTACT, AGENT, or CHATBOT',
  `message_type` varchar(20) NOT NULL COMMENT 'TEXT, IMAGE, VIDEO, DOCUMENT, AUDIO, etc',
  `message_content` json DEFAULT NULL,
  `campaign_name` varchar(255) DEFAULT NULL,
  `campaign_sent_at` bigint DEFAULT NULL,
  `status` varchar(50) NOT NULL COMMENT 'SENT, DELIVERED, READ, FAILED',
  `is_hsm` tinyint(1) DEFAULT '0',
  `sent_at` datetime DEFAULT NULL,
  `delivered_at` datetime DEFAULT NULL,
  `read_at` datetime DEFAULT NULL,
  `failed_at` datetime DEFAULT NULL,
  `agent_id` varchar(100) DEFAULT NULL,
  `chatbot_query_text` varchar(1000) DEFAULT NULL,
  `chatbot_intent` varchar(255) DEFAULT NULL,
  `failure_code` int DEFAULT NULL,
  `failure_reason` varchar(500) DEFAULT NULL,
  `message_id` varchar(100) DEFAULT NULL,
  `integration_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `message_id` (`message_id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_phone_number` (`phone_number`),
  KEY `idx_contact_id` (`contact_id`),
  KEY `idx_status` (`status`),
  KEY `idx_sent_at` (`sent_at`),
  KEY `idx_sender` (`sender`),
  KEY `idx_integration_id` (`integration_id`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `fk_smartping_message_integration` FOREIGN KEY (`integration_id`) REFERENCES `crm_integrations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_smartping_attachments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_smartping_attachments` (
  `id` varchar(36) NOT NULL,
  `message_id` varchar(100) NOT NULL,
  `file_url` varchar(500) DEFAULT NULL,
  `file_type` varchar(50) DEFAULT NULL,
  `file_name` varchar(255) DEFAULT NULL,
  `file_size` int DEFAULT NULL,
  `mime_type` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_message_id` (`message_id`),
  CONSTRAINT `crm_smartping_attachments_ibfk_1` FOREIGN KEY (`message_id`) REFERENCES `crm_smartping_messages` (`message_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_smartping_conversations
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_smartping_conversations` (
  `id` varchar(36) NOT NULL,
  `integration_id` int NOT NULL,
  `phone_number` varchar(20) NOT NULL,
  `contact_name` varchar(255) DEFAULT NULL,
  `contact_id` varchar(100) DEFAULT NULL,
  `last_message` text,
  `last_message_sender` varchar(50) DEFAULT NULL,
  `last_message_at` datetime DEFAULT NULL,
  `status` varchar(50) DEFAULT 'ACTIVE' COMMENT 'ACTIVE, ARCHIVED, CLOSED',
  `unread_count` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_integration_id` (`integration_id`),
  KEY `idx_phone_number` (`phone_number`),
  KEY `idx_status` (`status`),
  KEY `idx_updated_at` (`updated_at`),
  CONSTRAINT `fk_smartping_conversation_integration` FOREIGN KEY (`integration_id`) REFERENCES `crm_integrations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_user_access_status
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_user_access_status` (
  `user_id` bigint unsigned NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `updated_by_user_id` bigint unsigned DEFAULT NULL,
  `updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`user_id`),
  KEY `fk_crm_status_updated_by` (`updated_by_user_id`),
  CONSTRAINT `fk_crm_status_updated_by` FOREIGN KEY (`updated_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_crm_status_user` FOREIGN KEY (`user_id`) REFERENCES `app_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_user_branches
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_user_branches` (
  `user_id` bigint unsigned NOT NULL,
  `branch_id` bigint unsigned NOT NULL,
  `created_by_user_id` bigint unsigned DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`user_id`,`branch_id`),
  KEY `ix_crm_user_branches_branch` (`branch_id`),
  KEY `fk_crm_user_branches_created_user` (`created_by_user_id`),
  CONSTRAINT `fk_crm_user_branches_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_crm_user_branches_created_user` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_crm_user_branches_user` FOREIGN KEY (`user_id`) REFERENCES `app_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_user_business_units
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_user_business_units` (
  `user_id` bigint unsigned NOT NULL,
  `business_unit_id` bigint unsigned NOT NULL,
  `access_level` enum('admin','manage','contribute','view') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'view',
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`user_id`,`business_unit_id`),
  KEY `ix_crm_user_business_unit` (`business_unit_id`,`user_id`),
  CONSTRAINT `fk_crm_user_business_unit_unit` FOREIGN KEY (`business_unit_id`) REFERENCES `crm_business_units` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_crm_user_business_unit_user` FOREIGN KEY (`user_id`) REFERENCES `app_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_user_profiles
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_user_profiles` (
  `user_id` bigint unsigned NOT NULL,
  `first_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_crm_user_profile_user` FOREIGN KEY (`user_id`) REFERENCES `app_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_whatsapp_conversations
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_whatsapp_conversations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `organization_id` int NOT NULL,
  `integration_id` int NOT NULL,
  `mobile` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `contact_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lead_id` bigint unsigned DEFAULT NULL,
  `last_message` text COLLATE utf8mb4_unicode_ci,
  `last_message_time` datetime DEFAULT NULL,
  `unread_count` int NOT NULL DEFAULT '0',
  `status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_whatsapp_conversation` (`integration_id`,`mobile`),
  KEY `idx_whatsapp_conversations_org_time` (`organization_id`,`last_message_time`),
  KEY `fk_whatsapp_conversation_lead` (`lead_id`),
  CONSTRAINT `fk_whatsapp_conversation_integration` FOREIGN KEY (`integration_id`) REFERENCES `crm_integrations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_whatsapp_conversation_lead` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_whatsapp_conversation_organization` FOREIGN KEY (`organization_id`) REFERENCES `crm_organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_whatsapp_messages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_whatsapp_messages` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `conversation_id` bigint NOT NULL,
  `integration_id` int NOT NULL,
  `lead_id` bigint unsigned DEFAULT NULL,
  `message_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `client_request_id` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `template_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `campaign_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `direction` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'text',
  `message` text COLLATE utf8mb4_unicode_ci,
  `media_url` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `caption` text COLLATE utf8mb4_unicode_ci,
  `status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `api_response` json DEFAULT NULL,
  `http_status` int DEFAULT NULL,
  `retry_count` int NOT NULL DEFAULT '0',
  `failed_reason` text COLLATE utf8mb4_unicode_ci,
  `sent_at` datetime DEFAULT NULL,
  `delivered_at` datetime DEFAULT NULL,
  `read_at` datetime DEFAULT NULL,
  `failed_at` datetime DEFAULT NULL,
  `provider_timestamp` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_whatsapp_client_request` (`client_request_id`),
  UNIQUE KEY `uq_whatsapp_provider_message` (`message_id`),
  KEY `idx_whatsapp_messages_conversation` (`conversation_id`,`created_at`),
  KEY `idx_whatsapp_messages_status` (`status`,`updated_at`),
  KEY `fk_whatsapp_message_integration` (`integration_id`),
  KEY `fk_whatsapp_message_lead` (`lead_id`),
  CONSTRAINT `fk_whatsapp_message_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `crm_whatsapp_conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_whatsapp_message_integration` FOREIGN KEY (`integration_id`) REFERENCES `crm_integrations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_whatsapp_message_lead` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_whatsapp_api_logs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_whatsapp_api_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `integration_id` int DEFAULT NULL,
  `message_id` bigint DEFAULT NULL,
  `operation` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `request_url` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `request_headers` json DEFAULT NULL,
  `request_payload` json DEFAULT NULL,
  `response_status` int DEFAULT NULL,
  `response_body` json DEFAULT NULL,
  `response_time_ms` int DEFAULT NULL,
  `retry_count` int NOT NULL DEFAULT '0',
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `exception_stack` mediumtext COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_whatsapp_api_logs_message` (`message_id`,`created_at`),
  KEY `idx_whatsapp_api_logs_integration` (`integration_id`,`created_at`),
  CONSTRAINT `fk_whatsapp_api_log_integration` FOREIGN KEY (`integration_id`) REFERENCES `crm_integrations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_whatsapp_api_log_message` FOREIGN KEY (`message_id`) REFERENCES `crm_whatsapp_messages` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_whatsapp_attachments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_whatsapp_attachments` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `message_id` bigint NOT NULL,
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mime_type` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `url` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `thumbnail` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `size` bigint DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_whatsapp_attachment_message` (`message_id`),
  CONSTRAINT `fk_whatsapp_attachment_message` FOREIGN KEY (`message_id`) REFERENCES `crm_whatsapp_messages` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- crm_whatsapp_template_buttons
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_whatsapp_template_buttons` (
  `id` int NOT NULL AUTO_INCREMENT,
  `template_id` int NOT NULL,
  `button_type` enum('CALL_TO_ACTION','QUICK_REPLY') NOT NULL,
  `cta_type` enum('VISIT_WEBSITE','CALL_PHONE') DEFAULT NULL,
  `button_text` varchar(255) NOT NULL,
  `button_value` varchar(2048) DEFAULT NULL,
  `sequence_order` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_template` (`template_id`),
  CONSTRAINT `fk_template` FOREIGN KEY (`template_id`) REFERENCES `crm_whatsapp_templates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_whatsapp_template_logs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_whatsapp_template_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `template_id` int NOT NULL,
  `integration_id` int NOT NULL,
  `aisensy_template_id` varchar(255) NOT NULL,
  `action` varchar(50) NOT NULL,
  `status` varchar(50) DEFAULT NULL,
  `previous_status` varchar(50) DEFAULT NULL,
  `rejection_reason` longtext,
  `rejection_category` varchar(100) DEFAULT NULL,
  `api_request` json DEFAULT NULL,
  `api_response` json DEFAULT NULL,
  `last_synced_at` timestamp NULL DEFAULT NULL,
  `webhook_received_at` timestamp NULL DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_aisensy_template_id` (`aisensy_template_id`),
  KEY `idx_aisensy_template_id` (`aisensy_template_id`),
  KEY `idx_template_id_synced` (`template_id`,`last_synced_at`),
  KEY `idx_action_created` (`action`,`created_at`),
  KEY `idx_status_created` (`status`,`created_at`),
  KEY `idx_integration_synced` (`integration_id`,`last_synced_at`),
  CONSTRAINT `fk_template_logs_integration` FOREIGN KEY (`integration_id`) REFERENCES `crm_integrations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_template_logs_template` FOREIGN KEY (`template_id`) REFERENCES `crm_whatsapp_templates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_whatsapp_template_media
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_whatsapp_template_media` (
  `id` int NOT NULL AUTO_INCREMENT,
  `template_id` int NOT NULL,
  `media_type` enum('HEADER','BODY') NOT NULL,
  `file_type` enum('IMAGE','VIDEO','DOCUMENT') NOT NULL,
  `file_url` varchar(2048) NOT NULL,
  `file_size` int DEFAULT NULL,
  `uploaded_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_template` (`template_id`),
  CONSTRAINT `fk_template_media` FOREIGN KEY (`template_id`) REFERENCES `crm_whatsapp_templates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_whatsapp_template_sync_logs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_whatsapp_template_sync_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `template_id` int NOT NULL,
  `sync_type` enum('CREATE','UPDATE','DELETE','RESYNC') NOT NULL,
  `status` enum('SUCCESS','FAILED','PENDING') NOT NULL,
  `response_code` int DEFAULT NULL,
  `response_message` longtext,
  `synced_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `synced_by` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_template` (`template_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_sync_log` FOREIGN KEY (`template_id`) REFERENCES `crm_whatsapp_templates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- crm_whatsapp_template_user_visibility
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `crm_whatsapp_template_user_visibility` (
  `template_id` int NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`template_id`,`user_id`),
  KEY `ix_whatsapp_template_visibility_user` (`user_id`),
  CONSTRAINT `fk_whatsapp_template_visibility_template` FOREIGN KEY (`template_id`) REFERENCES `crm_whatsapp_templates` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_whatsapp_template_visibility_user` FOREIGN KEY (`user_id`) REFERENCES `app_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ==========================================================================
-- SECTION 3 - ATTENDANCE-ONLY TABLES (18)
-- ==========================================================================
-- Not referenced by any CRM foreign key and not queried by the CRM API.
-- Included so this file is a complete snapshot. Safe to delete this section if
-- the target database is for the CRM alone.
-- ==========================================================================

-- ------------------------------------------------------------
-- api_logs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `api_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `correlation_id` char(36) NOT NULL,
  `method` varchar(10) NOT NULL,
  `path` varchar(500) NOT NULL,
  `status_code` smallint unsigned NOT NULL,
  `duration_ms` int unsigned NOT NULL,
  `user_id` bigint unsigned DEFAULT NULL,
  `source_system_id` varchar(100) DEFAULT NULL,
  `client_ip` varchar(45) DEFAULT NULL,
  `user_agent` varchar(500) DEFAULT NULL,
  `error_code` varchar(100) DEFAULT NULL,
  `occurred_at_utc` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_api_logs_occurred` (`occurred_at_utc`),
  KEY `ix_api_logs_correlation` (`correlation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- attendance_daily
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `attendance_daily` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `employee_id` bigint NOT NULL,
  `attendance_date` date NOT NULL,
  `branch_id` bigint unsigned DEFAULT NULL,
  `shift_id` bigint unsigned DEFAULT NULL,
  `first_in_utc` datetime(6) DEFAULT NULL,
  `last_out_utc` datetime(6) DEFAULT NULL,
  `working_minutes` int NOT NULL DEFAULT '0',
  `break_minutes` int NOT NULL DEFAULT '0',
  `late_minutes` int NOT NULL DEFAULT '0',
  `early_leaving_minutes` int NOT NULL DEFAULT '0',
  `overtime_minutes` int NOT NULL DEFAULT '0',
  `punch_count` smallint unsigned NOT NULL DEFAULT '0',
  `status` varchar(30) NOT NULL DEFAULT 'Unknown',
  `has_missing_punch` tinyint(1) NOT NULL DEFAULT '0',
  `calculation_version` int NOT NULL DEFAULT '1',
  `calculated_at_utc` datetime(6) NOT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attendance_daily_employee_date` (`employee_id`,`attendance_date`),
  KEY `ix_attendance_daily_date_status` (`attendance_date`,`status`),
  KEY `ix_attendance_daily_branch_date` (`branch_id`,`attendance_date`),
  CONSTRAINT `fk_attendance_daily_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`),
  CONSTRAINT `fk_attendance_daily_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- biometric_sources
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `biometric_sources` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `source_system_id` varchar(100) NOT NULL,
  `display_name` varchar(150) NOT NULL,
  `api_key_hash` varbinary(64) NOT NULL,
  `api_key_salt` varbinary(32) NOT NULL,
  `last_seen_at_utc` datetime(6) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_biometric_sources_system` (`source_system_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- attendance_logs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `attendance_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `source_system_id` varchar(100) NOT NULL,
  `source_punch_id` bigint NOT NULL,
  `employee_id` bigint DEFAULT NULL,
  `branch_id` bigint unsigned DEFAULT NULL,
  `biometric_id` varchar(100) NOT NULL,
  `punch_time_utc` datetime(6) NOT NULL,
  `source_punch_time` datetime(6) NOT NULL,
  `verify_mode` smallint DEFAULT NULL,
  `sensor_id` varchar(100) DEFAULT NULL,
  `work_code` varchar(100) DEFAULT NULL,
  `raw_payload_json` json DEFAULT NULL,
  `received_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attendance_logs_source_punch` (`source_system_id`,`source_punch_id`),
  KEY `ix_attendance_logs_employee_time` (`employee_id`,`punch_time_utc`),
  KEY `ix_attendance_logs_branch_time` (`branch_id`,`punch_time_utc`),
  KEY `ix_attendance_logs_biometric_time` (`biometric_id`,`punch_time_utc`),
  KEY `ix_attendance_logs_punch_time` (`punch_time_utc`),
  CONSTRAINT `fk_attendance_logs_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`),
  CONSTRAINT `fk_attendance_logs_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`),
  CONSTRAINT `fk_attendance_logs_source` FOREIGN KEY (`source_system_id`) REFERENCES `biometric_sources` (`source_system_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- attendance_monthly
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `attendance_monthly` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `employee_id` bigint NOT NULL,
  `year` smallint unsigned NOT NULL,
  `month` tinyint unsigned NOT NULL,
  `present_days` decimal(5,2) NOT NULL DEFAULT '0.00',
  `absent_days` decimal(5,2) NOT NULL DEFAULT '0.00',
  `leave_days` decimal(5,2) NOT NULL DEFAULT '0.00',
  `holiday_days` decimal(5,2) NOT NULL DEFAULT '0.00',
  `week_off_days` decimal(5,2) NOT NULL DEFAULT '0.00',
  `total_working_minutes` int NOT NULL DEFAULT '0',
  `total_late_minutes` int NOT NULL DEFAULT '0',
  `total_overtime_minutes` int NOT NULL DEFAULT '0',
  `late_occurrences` smallint unsigned NOT NULL DEFAULT '0',
  `missing_punch_days` smallint unsigned NOT NULL DEFAULT '0',
  `calculation_version` int NOT NULL DEFAULT '1',
  `calculated_at_utc` datetime(6) NOT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attendance_monthly_employee_period` (`employee_id`,`year`,`month`),
  CONSTRAINT `fk_attendance_monthly_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`),
  CONSTRAINT `chk_attendance_monthly_month` CHECK ((`month` between 1 and 12))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- audit_logs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `actor_user_id` bigint unsigned DEFAULT NULL,
  `actor_type` varchar(30) NOT NULL,
  `action` varchar(100) NOT NULL,
  `entity_type` varchar(100) NOT NULL,
  `entity_id` varchar(100) DEFAULT NULL,
  `before_json` json DEFAULT NULL,
  `after_json` json DEFAULT NULL,
  `correlation_id` char(36) DEFAULT NULL,
  `client_ip` varchar(45) DEFAULT NULL,
  `occurred_at_utc` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_audit_logs_entity` (`entity_type`,`entity_id`),
  KEY `ix_audit_logs_actor_time` (`actor_user_id`,`occurred_at_utc`),
  KEY `ix_audit_logs_occurred` (`occurred_at_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- shift_definitions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `shift_definitions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `description` varchar(500) DEFAULT NULL,
  `code` varchar(30) NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `earliest_punch_time` time DEFAULT NULL,
  `latest_punch_time` time DEFAULT NULL,
  `grace_minutes` int NOT NULL DEFAULT '0',
  `early_exit_grace_minutes` int NOT NULL DEFAULT '0',
  `minimum_work_minutes` int NOT NULL DEFAULT '480',
  `half_day_minutes` int NOT NULL DEFAULT '240',
  `overtime_after_minutes` int NOT NULL DEFAULT '540',
  `maximum_shift_minutes` int NOT NULL DEFAULT '960',
  `auto_close_minutes` int NOT NULL DEFAULT '1080',
  `allow_multiple_punches` tinyint(1) NOT NULL DEFAULT '1',
  `use_first_in_last_out` tinyint(1) NOT NULL DEFAULT '1',
  `duplicate_punch_window_minutes` int NOT NULL DEFAULT '2',
  `is_cross_day` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_utc` datetime(6) NOT NULL,
  `updated_at_utc` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_shift_definitions_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- employee_shift_assignments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `employee_shift_assignments` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `employee_id` bigint NOT NULL,
  `shift_id` bigint unsigned NOT NULL,
  `effective_from` date NOT NULL,
  `effective_to` date DEFAULT NULL,
  `assignment_source` varchar(30) NOT NULL DEFAULT 'Manual',
  `created_by_user_id` bigint unsigned DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_employee_shift_assignment` (`employee_id`,`shift_id`,`effective_from`),
  KEY `ix_employee_shift_effective` (`employee_id`,`effective_from`,`effective_to`),
  KEY `ix_shift_assignment_effective` (`shift_id`,`effective_from`,`effective_to`),
  KEY `fk_employee_shift_creator` (`created_by_user_id`),
  CONSTRAINT `fk_employee_shift_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_employee_shift_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_employee_shift_shift` FOREIGN KEY (`shift_id`) REFERENCES `shift_definitions` (`id`),
  CONSTRAINT `chk_employee_shift_dates` CHECK (((`effective_to` is null) or (`effective_to` >= `effective_from`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- holiday_definitions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `holiday_definitions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(150) NOT NULL,
  `holiday_date` date NOT NULL,
  `holiday_end_date` date NOT NULL,
  `branch_id` bigint unsigned DEFAULT NULL,
  `department_names_json` json DEFAULT NULL,
  `is_optional` tinyint(1) NOT NULL DEFAULT '0',
  `created_at_utc` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_holiday_date_branch` (`holiday_date`,`branch_id`),
  KEY `fk_holiday_branch` (`branch_id`),
  CONSTRAINT `fk_holiday_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- master_data_items
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `master_data_items` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `category` varchar(50) NOT NULL,
  `name` varchar(150) NOT NULL,
  `code` varchar(50) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_utc` datetime(6) NOT NULL,
  `updated_at_utc` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_master_data_category_name` (`category`,`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- password_reset_tokens
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `password_reset_tokens` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `token_hash` binary(32) NOT NULL,
  `expires_at_utc` datetime(6) NOT NULL,
  `created_at_utc` datetime(6) NOT NULL,
  `used_at_utc` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_password_reset_tokens_hash` (`token_hash`),
  KEY `ix_password_reset_tokens_user` (`user_id`,`expires_at_utc`),
  CONSTRAINT `fk_password_reset_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `app_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- refresh_tokens
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `refresh_tokens` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `token_hash` binary(32) NOT NULL,
  `family_id` char(36) NOT NULL,
  `expires_at_utc` datetime(6) NOT NULL,
  `created_at_utc` datetime(6) NOT NULL,
  `created_by_ip` varchar(45) DEFAULT NULL,
  `revoked_at_utc` datetime(6) DEFAULT NULL,
  `revoked_by_ip` varchar(45) DEFAULT NULL,
  `replaced_by_token_hash` binary(32) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_refresh_tokens_hash` (`token_hash`),
  KEY `ix_refresh_tokens_user_family` (`user_id`,`family_id`),
  CONSTRAINT `fk_refresh_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `app_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- role_screen_access
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `role_screen_access` (
  `role_id` bigint unsigned NOT NULL,
  `screen_key` varchar(120) NOT NULL,
  `access_level` varchar(20) NOT NULL DEFAULT 'Hidden',
  `updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`role_id`,`screen_key`),
  CONSTRAINT `fk_role_screen_access_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_role_screen_access_level` CHECK ((`access_level` in (_utf8mb4'Hidden',_utf8mb4'Disabled',_utf8mb4'ReadOnly',_utf8mb4'Full')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- sync_logs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sync_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `source_system_id` varchar(100) NOT NULL,
  `batch_id` char(36) NOT NULL,
  `received_count` int unsigned NOT NULL,
  `inserted_count` int unsigned NOT NULL DEFAULT '0',
  `duplicate_count` int unsigned NOT NULL DEFAULT '0',
  `unmapped_count` int unsigned NOT NULL DEFAULT '0',
  `rejected_count` int unsigned NOT NULL DEFAULT '0',
  `first_source_punch_id` bigint DEFAULT NULL,
  `last_source_punch_id` bigint DEFAULT NULL,
  `status` varchar(30) NOT NULL,
  `error_summary` varchar(1000) DEFAULT NULL,
  `duration_ms` int unsigned DEFAULT NULL,
  `started_at_utc` datetime(6) NOT NULL,
  `completed_at_utc` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sync_logs_batch` (`source_system_id`,`batch_id`),
  KEY `ix_sync_logs_source_started` (`source_system_id`,`started_at_utc`),
  CONSTRAINT `fk_sync_logs_source` FOREIGN KEY (`source_system_id`) REFERENCES `biometric_sources` (`source_system_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- system_settings
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `system_settings` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(150) NOT NULL,
  `scope_type` varchar(30) NOT NULL DEFAULT 'Global',
  `scope_id` varchar(100) NOT NULL DEFAULT '',
  `value_json` json NOT NULL,
  `is_secret` tinyint(1) NOT NULL DEFAULT '0',
  `version` int unsigned NOT NULL DEFAULT '1',
  `updated_by_user_id` bigint unsigned DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_settings_key_scope` (`setting_key`,`scope_type`,`scope_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- unmapped_attendance
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `unmapped_attendance` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `source_system_id` varchar(100) NOT NULL,
  `source_punch_id` bigint NOT NULL,
  `biometric_id` varchar(100) NOT NULL,
  `source_punch_time` datetime(6) NOT NULL,
  `reason` varchar(200) NOT NULL,
  `raw_payload_json` json NOT NULL,
  `resolved_at_utc` datetime(6) DEFAULT NULL,
  `resolved_employee_id` bigint DEFAULT NULL,
  `created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at_utc` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unmapped_source_punch` (`source_system_id`,`source_punch_id`),
  KEY `ix_unmapped_biometric_resolved` (`biometric_id`,`resolved_at_utc`),
  KEY `fk_unmapped_resolved_employee` (`resolved_employee_id`),
  CONSTRAINT `fk_unmapped_resolved_employee` FOREIGN KEY (`resolved_employee_id`) REFERENCES `employees` (`id`),
  CONSTRAINT `fk_unmapped_source` FOREIGN KEY (`source_system_id`) REFERENCES `biometric_sources` (`source_system_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- user_permission_overrides
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_permission_overrides` (
  `user_id` bigint unsigned NOT NULL,
  `permission_key` varchar(150) NOT NULL,
  `is_allowed` tinyint(1) NOT NULL,
  `updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`user_id`,`permission_key`),
  CONSTRAINT `fk_user_permission_overrides_user` FOREIGN KEY (`user_id`) REFERENCES `app_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- user_screen_access_overrides
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_screen_access_overrides` (
  `user_id` bigint unsigned NOT NULL,
  `screen_key` varchar(120) NOT NULL,
  `access_level` varchar(20) NOT NULL,
  `updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`user_id`,`screen_key`),
  CONSTRAINT `fk_user_screen_access_user` FOREIGN KEY (`user_id`) REFERENCES `app_users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_user_screen_access_level` CHECK ((`access_level` in (_utf8mb4'Hidden',_utf8mb4'Disabled',_utf8mb4'ReadOnly',_utf8mb4'Full')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ==========================================================================
-- SECTION 4 - VIEWS (1)
-- ==========================================================================
-- DEFINER clauses stripped so the view is created as the executing user.
-- ==========================================================================

-- ------------------------------------------------------------
-- substaff_attendance
-- ------------------------------------------------------------
CREATE OR REPLACE ALGORITHM=UNDEFINED VIEW `substaff_attendance` AS select `a`.`biometric_id` AS `biometric_id`,`b`.`employee_name` AS `employee_name`,`a`.`source_punch_time` AS `source_punch_time` from (`attendance_logs` `a` left join `employees` `b` on((`a`.`biometric_id` = `b`.`biometric_id`))) where (`a`.`biometric_id` like 'T%');


SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;
SET SQL_MODE = @OLD_SQL_MODE;

-- ==========================================================================
-- END OF SCHEMA - 124 objects
-- ==========================================================================