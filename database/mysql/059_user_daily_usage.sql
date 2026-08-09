USE attendance_biometric;
SET NAMES utf8mb4;

-- =====================================================================
-- Per-user, per-calendar-day application usage.
--
-- One row per (user, day) holding the cumulative ACTIVE seconds spent in
-- the CRM. The client accumulates seconds only while the user is not idle
-- and flushes deltas periodically, so this is a running total rather than
-- a session log -- reloads, extra tabs and re-logins all add to the same
-- row for that day.
--
-- usage_date is the user's local calendar date supplied by the client;
-- storing it as DATE keeps "today" meaningful regardless of server TZ.
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

CREATE TABLE IF NOT EXISTS crm_user_daily_usage (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  usage_date DATE NOT NULL,
  -- Cumulative active seconds for the day. Capped by the API at 24h.
  active_seconds INT UNSIGNED NOT NULL DEFAULT 0,
  -- Number of accepted heartbeats; useful for spotting client issues.
  heartbeat_count INT UNSIGNED NOT NULL DEFAULT 0,
  first_activity_at_utc DATETIME(6) NULL,
  last_activity_at_utc DATETIME(6) NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  -- Makes the heartbeat a single idempotent upsert.
  UNIQUE KEY uq_crm_user_daily_usage (user_id, usage_date),
  KEY ix_crm_user_daily_usage_date (usage_date),
  CONSTRAINT fk_crm_user_daily_usage_user FOREIGN KEY (user_id)
    REFERENCES app_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
