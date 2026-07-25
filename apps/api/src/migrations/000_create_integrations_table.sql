-- Create Organizations Table (Minimal - if missing)
CREATE TABLE IF NOT EXISTS organizations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,

  KEY idx_status (status),
  KEY idx_created (created_at)
);

-- Create Integrations Table
CREATE TABLE IF NOT EXISTS integrations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  organization_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  type ENUM('SMARTPING', 'WHATSAPP', 'EMAIL', 'SMS', 'SLACK') NOT NULL,
  description LONGTEXT,
  provider VARCHAR(100),
  api_key VARCHAR(500),
  api_secret VARCHAR(500),
  config JSON,
  status ENUM('ACTIVE', 'INACTIVE', 'CONNECTED', 'DISCONNECTED', 'ERROR') NOT NULL DEFAULT 'ACTIVE',
  connected_at TIMESTAMP NULL,
  last_sync_at TIMESTAMP NULL,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by INT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,

  KEY idx_organization (organization_id),
  KEY idx_type (type),
  KEY idx_status (status),
  KEY idx_created (created_at)
);

-- Add foreign key to organizations (with error handling)
SET @exists_fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_NAME = 'integrations'
  AND COLUMN_NAME = 'organization_id'
  AND CONSTRAINT_NAME = 'fk_org'
);

-- Only add if not already exists
SET @sql = IF(@exists_fk = 0,
  'ALTER TABLE integrations ADD CONSTRAINT fk_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add foreign key from whatsapp_templates to integrations (if constraint doesn't exist)
SET @exists_wt_fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_NAME = 'whatsapp_templates'
  AND COLUMN_NAME = 'integration_id'
  AND CONSTRAINT_NAME = 'fk_integration'
);

-- Only add if not already exists
SET @sql2 = IF(@exists_wt_fk = 0,
  'ALTER TABLE whatsapp_templates ADD CONSTRAINT fk_integration FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;
