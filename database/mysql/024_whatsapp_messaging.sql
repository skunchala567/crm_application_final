CREATE TABLE IF NOT EXISTS crm_whatsapp_conversations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT NOT NULL,
  integration_id INT NOT NULL,
  mobile VARCHAR(20) NOT NULL,
  contact_name VARCHAR(255),
  lead_id BIGINT NULL,
  last_message TEXT,
  last_message_time DATETIME NULL,
  unread_count INT NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_whatsapp_conversation (integration_id, mobile),
  KEY idx_whatsapp_conversations_org_time (organization_id, last_message_time),
  CONSTRAINT fk_whatsapp_conversation_integration
    FOREIGN KEY (integration_id) REFERENCES crm_integrations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_whatsapp_messages (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  conversation_id BIGINT NOT NULL,
  integration_id INT NOT NULL,
  lead_id BIGINT NULL,
  message_id VARCHAR(255),
  client_request_id VARCHAR(100) NOT NULL,
  template_name VARCHAR(255),
  direction VARCHAR(20) NOT NULL,
  type VARCHAR(30) NOT NULL DEFAULT 'text',
  message TEXT,
  media_url VARCHAR(1000),
  caption TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  api_response JSON,
  http_status INT NULL,
  retry_count INT NOT NULL DEFAULT 0,
  failed_reason TEXT,
  sent_at DATETIME NULL,
  delivered_at DATETIME NULL,
  read_at DATETIME NULL,
  failed_at DATETIME NULL,
  provider_timestamp DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_whatsapp_client_request (client_request_id),
  UNIQUE KEY uq_whatsapp_provider_message (message_id),
  KEY idx_whatsapp_messages_conversation (conversation_id, created_at),
  KEY idx_whatsapp_messages_status (status, updated_at),
  CONSTRAINT fk_whatsapp_message_conversation
    FOREIGN KEY (conversation_id) REFERENCES crm_whatsapp_conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_whatsapp_message_integration
    FOREIGN KEY (integration_id) REFERENCES crm_integrations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_whatsapp_attachments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  message_id BIGINT NOT NULL,
  file_name VARCHAR(255),
  mime_type VARCHAR(150),
  url VARCHAR(1000),
  thumbnail VARCHAR(1000),
  size BIGINT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_whatsapp_attachment_message
    FOREIGN KEY (message_id) REFERENCES crm_whatsapp_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_whatsapp_api_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  integration_id INT NULL,
  message_id BIGINT NULL,
  operation VARCHAR(60) NOT NULL,
  request_url VARCHAR(1000),
  request_headers JSON,
  request_payload JSON,
  response_status INT NULL,
  response_body JSON,
  response_time_ms INT NULL,
  retry_count INT NOT NULL DEFAULT 0,
  error_message TEXT,
  exception_stack MEDIUMTEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_whatsapp_api_logs_message (message_id, created_at),
  KEY idx_whatsapp_api_logs_integration (integration_id, created_at),
  CONSTRAINT fk_whatsapp_api_log_integration
    FOREIGN KEY (integration_id) REFERENCES crm_integrations(id) ON DELETE SET NULL,
  CONSTRAINT fk_whatsapp_api_log_message
    FOREIGN KEY (message_id) REFERENCES crm_whatsapp_messages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
