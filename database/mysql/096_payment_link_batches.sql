USE attendance_biometric;
SET NAMES utf8mb4;

-- =====================================================================
-- Payment links raised in bulk from an uploaded list of mobile numbers.
--
-- A single link is created one payer at a time, from a screen, by someone
-- who already knows the payer's name and email. A fee drive is the other
-- shape of the same job: a few hundred numbers, one amount each, and a
-- WhatsApp message carrying the link.
--
-- Two tables because the two questions are different. The batch answers
-- "what was uploaded, by whom, against which branch and template". The rows
-- answer "what happened to this number" -- and they must hold rows that
-- never became a link at all, which is why the outcome lives here and not
-- only on crm_jodo_payment_links.
--
-- Rows are processed by a background cycle rather than in the request: a
-- hundred numbers is a hundred Jodo calls followed by a hundred WhatsApp
-- sends, and no browser should be holding a connection open for that. The
-- status column is what lets the cycle pick up where it left off, including
-- after a restart.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

CREATE TABLE IF NOT EXISTS crm_payment_link_batches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(255) NULL,
  -- The Jodo component every link in the batch books against. Jodo validates
  -- it against the components configured on the collector.
  component_type VARCHAR(120) NOT NULL,
  environment ENUM('production','uat') NOT NULL DEFAULT 'production',
  -- Which WhatsApp account and template carry the link, and which of the
  -- template's {{n}} placeholders the link is substituted into.
  integration_id BIGINT UNSIGNED NULL,
  template_id BIGINT UNSIGNED NULL,
  template_name VARCHAR(255) NULL,
  template_language VARCHAR(20) NULL DEFAULT 'en',
  template_params_json JSON NULL,
  link_param_index TINYINT UNSIGNED NULL,
  expires_at_utc DATETIME NULL,
  total_rows INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('queued','processing','completed','cancelled') NOT NULL DEFAULT 'queued',
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  completed_at_utc DATETIME(6) NULL,
  PRIMARY KEY (id),
  KEY ix_link_batch_unit (business_unit_id, created_at_utc),
  KEY ix_link_batch_branch (branch_id),
  CONSTRAINT fk_link_batch_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS crm_payment_link_batch_rows (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_id BIGINT UNSIGNED NOT NULL,
  row_number_in_file INT UNSIGNED NOT NULL,
  phone VARCHAR(30) NOT NULL,
  normalized_phone VARCHAR(20) NOT NULL,
  -- As uploaded. What is actually sent to Jodo is resolved at send time from
  -- the file first, then the matching lead, then the configured fallback.
  name VARCHAR(200) NULL,
  email VARCHAR(254) NULL,
  amount DECIMAL(12,2) NOT NULL,
  lead_id BIGINT UNSIGNED NULL,
  payment_link_id BIGINT UNSIGNED NULL,
  order_id VARCHAR(120) NULL,
  redirect_url VARCHAR(1000) NULL,
  /*
   * link_created and sent are deliberately separate. A link that was raised
   * but whose WhatsApp failed has still taken a real action at Jodo, and
   * retrying the row must not raise a second one.
   */
  status ENUM('pending','link_created','sent','failed') NOT NULL DEFAULT 'pending',
  error_message VARCHAR(500) NULL,
  whatsapp_message_id VARCHAR(190) NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  processed_at_utc DATETIME(6) NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_link_row_batch (batch_id, status),
  -- The cycle's claim query: oldest pending rows first, across all batches.
  KEY ix_link_row_pending (status, id),
  CONSTRAINT fk_link_row_batch FOREIGN KEY (batch_id) REFERENCES crm_payment_link_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
