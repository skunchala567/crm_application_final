-- =====================================================
-- Migration: Create WhatsApp Template Logs Table
-- Purpose: Audit trail for template lifecycle
-- Created: 2026-07-25
-- =====================================================

-- Drop if exists (for fresh setup)
DROP TABLE IF EXISTS crm_whatsapp_template_logs;

-- Create logs table
CREATE TABLE crm_whatsapp_template_logs (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  integration_id INT NOT NULL,
  aisensy_template_id VARCHAR(255) NOT NULL,
  action VARCHAR(50) NOT NULL,
  status VARCHAR(50),
  previous_status VARCHAR(50),
  rejection_reason LONGTEXT,
  rejection_category VARCHAR(100),
  api_request JSON,
  api_response JSON,
  last_synced_at TIMESTAMP NULL,
  webhook_received_at TIMESTAMP NULL,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY unique_aisensy_template_id (aisensy_template_id),
  CONSTRAINT fk_template_logs_template
    FOREIGN KEY (template_id)
    REFERENCES crm_whatsapp_templates(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_template_logs_integration
    FOREIGN KEY (integration_id)
    REFERENCES crm_integrations(id)
    ON DELETE CASCADE,

  KEY idx_aisensy_template_id (aisensy_template_id),
  KEY idx_template_id_synced (template_id, last_synced_at),
  KEY idx_action_created (action, created_at),
  KEY idx_status_created (status, created_at),
  KEY idx_integration_synced (integration_id, last_synced_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
