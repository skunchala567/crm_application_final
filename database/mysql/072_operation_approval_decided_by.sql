SET @has_column = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='crm_operation_approvals'
    AND column_name='decided_by_user_id');
SET @ddl = IF(@has_column=0,
  'ALTER TABLE crm_operation_approvals ADD COLUMN decided_by_user_id BIGINT UNSIGNED NULL AFTER requested_by_user_id',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_index = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='crm_operation_approvals'
    AND index_name='ix_crm_operation_approval_decided_by');
SET @ddl = IF(@has_index=0,
  'ALTER TABLE crm_operation_approvals ADD KEY ix_crm_operation_approval_decided_by (decided_by_user_id)',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @has_fk = (SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema=DATABASE() AND table_name='crm_operation_approvals'
    AND constraint_name='fk_crm_operation_approval_decided_by');
SET @ddl = IF(@has_fk=0,
  'ALTER TABLE crm_operation_approvals ADD CONSTRAINT fk_crm_operation_approval_decided_by FOREIGN KEY (decided_by_user_id) REFERENCES app_users(id)',
  'SELECT 1');
PREPARE statement FROM @ddl; EXECUTE statement; DEALLOCATE PREPARE statement;

UPDATE crm_operation_approvals
SET decided_by_user_id=approver_user_id
WHERE decision IN ('approved','rejected') AND decided_by_user_id IS NULL;
