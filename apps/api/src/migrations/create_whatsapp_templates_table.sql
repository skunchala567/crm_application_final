-- WhatsApp Template Management Tables
SET FOREIGN_KEY_CHECKS=0;

CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id INT PRIMARY KEY AUTO_INCREMENT,
  integration_id INT NOT NULL,
  organization_id INT NOT NULL,
  template_name VARCHAR(255) NOT NULL,
  category ENUM('MARKETING', 'UTILITY', 'AUTHENTICATION') NOT NULL DEFAULT 'MARKETING',
  language VARCHAR(50) NOT NULL DEFAULT 'English',
  template_type ENUM('TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT') NOT NULL DEFAULT 'TEXT',
  header_type ENUM('NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT') NOT NULL DEFAULT 'NONE',
  header_content LONGTEXT,
  body LONGTEXT NOT NULL,
  footer VARCHAR(1024),
  buttons_json JSON,
  sample_values_json JSON,
  variables_list JSON,
  status ENUM('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  rejection_reason LONGTEXT,
  api_response JSON,
  api_template_id VARCHAR(255),
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by INT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  is_archived BOOLEAN DEFAULT FALSE,

  UNIQUE KEY unique_template (integration_id, template_name, deleted_at),
  KEY idx_integration (integration_id),
  KEY idx_organization (organization_id),
  KEY idx_status (status),
  KEY idx_category (category),
  KEY idx_language (language),
  KEY idx_created (created_at)
);

CREATE TABLE IF NOT EXISTS whatsapp_template_buttons (
  id INT PRIMARY KEY AUTO_INCREMENT,
  template_id INT NOT NULL,
  button_type ENUM('CALL_TO_ACTION', 'QUICK_REPLY') NOT NULL,
  cta_type ENUM('VISIT_WEBSITE', 'CALL_PHONE') DEFAULT NULL,
  button_text VARCHAR(255) NOT NULL,
  button_value VARCHAR(2048),
  sequence_order INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  KEY idx_template (template_id),
  CONSTRAINT fk_template FOREIGN KEY (template_id) REFERENCES whatsapp_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS whatsapp_template_media (
  id INT PRIMARY KEY AUTO_INCREMENT,
  template_id INT NOT NULL,
  media_type ENUM('HEADER', 'BODY') NOT NULL,
  file_type ENUM('IMAGE', 'VIDEO', 'DOCUMENT') NOT NULL,
  file_url VARCHAR(2048) NOT NULL,
  file_size INT,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  KEY idx_template (template_id),
  CONSTRAINT fk_template_media FOREIGN KEY (template_id) REFERENCES whatsapp_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS whatsapp_template_sync_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  template_id INT NOT NULL,
  sync_type ENUM('CREATE', 'UPDATE', 'DELETE', 'RESYNC') NOT NULL,
  status ENUM('SUCCESS', 'FAILED', 'PENDING') NOT NULL,
  response_code INT,
  response_message LONGTEXT,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  synced_by INT,

  KEY idx_template (template_id),
  KEY idx_status (status),
  CONSTRAINT fk_sync_log FOREIGN KEY (template_id) REFERENCES whatsapp_templates(id) ON DELETE CASCADE
);

-- Add foreign key constraint to integrations table if it exists
ALTER TABLE whatsapp_templates
  ADD CONSTRAINT fk_integration FOREIGN KEY (integration_id)
  REFERENCES integrations(id) ON DELETE CASCADE;

SET FOREIGN_KEY_CHECKS=1;
