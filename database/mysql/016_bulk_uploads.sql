-- Bulk upload tracking and processing
CREATE TABLE IF NOT EXISTS crm_bulk_uploads (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  branch_id BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size_bytes INT,
  uploaded_by_user_id BIGINT UNSIGNED NOT NULL,
  `status` ENUM('Queued','Validating','In Progress','Completed','Completed with Errors','Failed','Cancelled') DEFAULT 'Queued',
  total_records INT DEFAULT 0,
  processed_records INT DEFAULT 0,
  successful_records INT DEFAULT 0,
  failed_records INT DEFAULT 0,
  duplicate_records INT DEFAULT 0,
  skipped_records INT DEFAULT 0,
  processing_started_at_utc DATETIME(6),
  processing_completed_at_utc DATETIME(6),
  created_at_utc DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  error_summary VARCHAR(1000),
  INDEX idx_branch_user (branch_id, uploaded_by_user_id),
  INDEX idx_status (`status`),
  INDEX idx_created (created_at_utc),
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  FOREIGN KEY (uploaded_by_user_id) REFERENCES app_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bulk upload processing log for individual records
CREATE TABLE IF NOT EXISTS crm_bulk_upload_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bulk_upload_id BIGINT UNSIGNED NOT NULL,
  `row_number` INT NOT NULL,
  `status` ENUM('Pending','Success','Failed','Duplicate','Skipped') DEFAULT 'Pending',
  lead_id BIGINT UNSIGNED,
  created_lead_number VARCHAR(50),
  validation_errors JSON,
  processed_at_utc DATETIME(6),
  created_at_utc DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_bulk_upload (bulk_upload_id),
  INDEX idx_lead (lead_id),
  INDEX idx_status (`status`),
  FOREIGN KEY (bulk_upload_id) REFERENCES crm_bulk_uploads(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES crm_leads(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Processing event log
CREATE TABLE IF NOT EXISTS crm_bulk_upload_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bulk_upload_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(50),
  message VARCHAR(500),
  created_at_utc DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_bulk_upload (bulk_upload_id),
  FOREIGN KEY (bulk_upload_id) REFERENCES crm_bulk_uploads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
