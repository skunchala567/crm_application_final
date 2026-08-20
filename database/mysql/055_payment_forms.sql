-- Payment Forms (Public payment collection templates)
CREATE TABLE IF NOT EXISTS crm_payment_forms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NOT NULL,
  form_key VARCHAR(120) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  selection_type ENUM('single','multiple') NOT NULL DEFAULT 'single',
  success_message TEXT,
  redirect_url VARCHAR(1000),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_form_key (form_key),
  KEY ix_payment_form_bu (business_unit_id),
  KEY ix_payment_form_branch (branch_id),
  CONSTRAINT fk_payment_form_bu FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE,
  CONSTRAINT fk_payment_form_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_payment_form_user FOREIGN KEY (created_by_user_id) REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Payment Form Categories (Payment components/categories that customers can select from)
CREATE TABLE IF NOT EXISTS crm_payment_form_categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payment_form_id BIGINT UNSIGNED NOT NULL,
  category_name VARCHAR(255) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  display_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_category_form (payment_form_id),
  CONSTRAINT fk_category_form FOREIGN KEY (payment_form_id) REFERENCES crm_payment_forms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Payment Form Submissions (Track all payment attempts)
CREATE TABLE IF NOT EXISTS crm_payment_form_submissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  payment_form_id BIGINT UNSIGNED NOT NULL,
  jodo_order_id VARCHAR(120),
  jodo_payment_url VARCHAR(1000),
  payer_name VARCHAR(200) NOT NULL,
  payer_email VARCHAR(254) NOT NULL,
  payer_phone VARCHAR(30) NOT NULL,
  student_name VARCHAR(200),
  selected_categories_json JSON NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'pending',
  transaction_id VARCHAR(150),
  paid_at_utc DATETIME(6),
  settled_at_utc DATETIME(6),
  settlement_utr VARCHAR(150),
  raw_response JSON,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_submission_form (payment_form_id, created_at_utc),
  KEY ix_submission_bu (business_unit_id, status),
  KEY ix_submission_email (payer_email),
  KEY ix_submission_jodo (jodo_order_id),
  CONSTRAINT fk_submission_bu FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE,
  CONSTRAINT fk_submission_form FOREIGN KEY (payment_form_id) REFERENCES crm_payment_forms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
