USE attendance_biometric;
SET NAMES utf8mb4;

-- Per-branch Jodo endpoint and credential.
--
-- A branch carried only an API key, a secret and a collector code, and both
-- Jodo clients hard-coded https://ext.jodo.in while building their own Basic
-- credential from the key and secret. Jodo issues an Authorization value of
-- its own, so a branch holding one had no way to present it -- every call came
-- back "Invalid credentials, please check!", which is also why the public
-- enquiry form never reached the gateway: it only redirects once an order
-- comes back with a payment URL.
--
--   jodo_base_url     - e.g. https://ext.jodo.in, so UAT and live differ per branch
--   jodo_auth_header  - the Authorization value as issued, e.g. "Basic abc...=="
--
-- Both are optional. A branch that leaves them empty keeps the previous
-- behaviour: the environment default URL, and Basic built from key and secret.
SET @has_base = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'branches' AND column_name = 'jodo_base_url'
);
SET @sql = IF(@has_base = 0,
  'ALTER TABLE branches
     ADD COLUMN jodo_base_url VARCHAR(255) NULL AFTER jodo_secret_key,
     ADD COLUMN jodo_auth_header VARCHAR(512) NULL AFTER jodo_base_url',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

-- Branches already charging through Jodo keep pointing at the live endpoint,
-- so nothing changes for them until someone edits the branch.
UPDATE branches
SET jodo_base_url = 'https://ext.jodo.in'
WHERE jodo_base_url IS NULL AND jodo_api_key IS NOT NULL AND jodo_secret_key IS NOT NULL;
