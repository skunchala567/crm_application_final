CREATE TABLE IF NOT EXISTS crm_report_data_sources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_unit_id BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(160) NOT NULL,
  source_name VARCHAR(128) NOT NULL,
  source_type ENUM('TABLE','VIEW') NOT NULL,
  business_unit_column VARCHAR(128) NOT NULL,
  owner_column VARCHAR(128) NULL,
  columns_json JSON NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_report_source_unit_name (business_unit_id, source_name),
  KEY ix_report_source_unit_active (business_unit_id, is_active),
  CONSTRAINT fk_report_source_business_unit FOREIGN KEY (business_unit_id) REFERENCES crm_business_units(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
