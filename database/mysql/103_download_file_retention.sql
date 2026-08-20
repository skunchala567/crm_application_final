SET NAMES utf8mb4;

-- =====================================================================
-- Keep the file that was downloaded, so it can be downloaded again.
--
-- Bulk Actions records who downloaded what, but only as facts about the
-- file -- dataset, row count, column list. Re-creating a download from
-- those facts would produce today's data under yesterday's filename, which
-- is a different file wearing the same name: a lead that has since changed
-- stage, been reassigned or deleted would come back different or not at
-- all. The only way to hand back the same file is to have kept it.
--
-- Stored beside the operation rather than inside it. crm_bulk_operations is
-- read in full to draw every list on that screen, and a blob column would
-- be dragged through each of those reads for a payload almost none of them
-- want.
--
-- Content is gzipped: a CSV is highly compressible, so this makes the size
-- ceiling reach perhaps ten times as many rows for the same storage.
--
-- Idempotent: the migration runner replays every file on every run.
-- =====================================================================

CREATE TABLE IF NOT EXISTS crm_bulk_operation_files (
  operation_id BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(100) NOT NULL DEFAULT 'text/csv;charset=utf-8',
  -- Bytes as stored (gzipped) and as the person receives them, so the
  -- screen can show a real size without decompressing anything.
  stored_bytes INT UNSIGNED NOT NULL,
  original_bytes INT UNSIGNED NOT NULL,
  content_encoding VARCHAR(20) NOT NULL DEFAULT 'gzip',
  content LONGBLOB NOT NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_bulk_file_operation FOREIGN KEY (operation_id)
    REFERENCES crm_bulk_operations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
