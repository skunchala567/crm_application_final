CREATE TABLE IF NOT EXISTS crm_jodo_webhook_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(120) NOT NULL,
  event_name VARCHAR(100) NOT NULL,
  order_id VARCHAR(120) NULL,
  status VARCHAR(40) NULL,
  payload_json JSON NOT NULL,
  processed_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_jodo_webhook_event (event_id),
  KEY ix_jodo_webhook_order (order_id,processed_at_utc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

