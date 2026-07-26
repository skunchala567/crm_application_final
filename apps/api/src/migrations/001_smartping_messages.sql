-- Smartping Messages Table
-- Stores all incoming and outgoing WhatsApp messages from Smartping

CREATE TABLE IF NOT EXISTS crm_smartping_messages (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(100) NOT NULL,
  phone_number VARCHAR(20) NOT NULL,
  contact_id VARCHAR(100),

  -- Message content
  sender VARCHAR(50) NOT NULL COMMENT 'CONTACT, AGENT, or CHATBOT',
  message_type VARCHAR(20) NOT NULL COMMENT 'TEXT, IMAGE, VIDEO, DOCUMENT, AUDIO, etc',
  message_content JSON,

  -- Campaign info
  campaign_name VARCHAR(255),
  campaign_sent_at BIGINT,

  -- Message status
  status VARCHAR(50) NOT NULL COMMENT 'SENT, DELIVERED, READ, FAILED',
  is_hsm BOOLEAN DEFAULT FALSE,

  -- Timestamps (in milliseconds from Smartping, converted to standard datetime)
  sent_at DATETIME,
  delivered_at DATETIME,
  read_at DATETIME,
  failed_at DATETIME,

  -- Agent info
  agent_id VARCHAR(100),

  -- Chatbot response
  chatbot_query_text VARCHAR(1000),
  chatbot_intent VARCHAR(255),

  -- Failure info
  failure_code INT,
  failure_reason VARCHAR(500),

  -- Message ID from Smartping
  message_id VARCHAR(100) UNIQUE,

  -- System fields
  integration_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_project_id (project_id),
  KEY idx_phone_number (phone_number),
  KEY idx_contact_id (contact_id),
  KEY idx_status (status),
  KEY idx_sent_at (sent_at),
  KEY idx_sender (sender),
  KEY idx_integration_id (integration_id),
  KEY idx_created_at (created_at)
);

-- Conversation threads (for grouping related messages)
CREATE TABLE IF NOT EXISTS crm_smartping_conversations (
  id VARCHAR(36) PRIMARY KEY,
  integration_id INT NOT NULL,
  phone_number VARCHAR(20) NOT NULL,
  contact_name VARCHAR(255),
  contact_id VARCHAR(100),

  -- Last message info
  last_message TEXT,
  last_message_sender VARCHAR(50),
  last_message_at DATETIME,

  -- Conversation status
  status VARCHAR(50) DEFAULT 'ACTIVE' COMMENT 'ACTIVE, ARCHIVED, CLOSED',
  unread_count INT DEFAULT 0,

  -- System fields
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_integration_id (integration_id),
  KEY idx_phone_number (phone_number),
  KEY idx_status (status),
  KEY idx_updated_at (updated_at)
);

-- Message attachments (for images, documents, etc)
CREATE TABLE IF NOT EXISTS crm_smartping_attachments (
  id VARCHAR(36) PRIMARY KEY,
  message_id VARCHAR(100) NOT NULL,
  file_url VARCHAR(500),
  file_type VARCHAR(50),
  file_name VARCHAR(255),
  file_size INT,
  mime_type VARCHAR(100),

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  KEY idx_message_id (message_id),
  FOREIGN KEY (message_id) REFERENCES crm_smartping_messages(message_id) ON DELETE CASCADE
);
