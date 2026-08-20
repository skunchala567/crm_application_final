SET NAMES utf8mb4;

-- Payments becomes its own permission module.
--
-- The three Payments tabs -- Collections, Payment Forms, Enquiry Forms -- were
-- all gated by `settings.payment_forms.*`, with enquiry forms additionally on
-- `settings.enquiry_forms.*`. One key for three screens meant a branch manager
-- could not be shown what their branch collected without also being handed the
-- public form builder. The registry now has payments.collections, payments.forms,
-- payments.enquiry_forms and payments.links, each grantable on its own.
--
-- syncPermissionRegistry() on boot inserts the new keys and marks the retired
-- ones inactive; it does not move the grants, and a grant is what a role
-- actually holds. Without this, every role that had Payments loses it the
-- moment the new code starts. So carry them across, preserving is_allowed and
-- data_scope rather than assuming everyone was fully allowed.

-- Collections is new: nobody was ever granted it, so it follows whoever could
-- already see payment forms -- that is who has been reading collections.
INSERT INTO crm_role_permissions (role_id, permission_key, is_allowed, data_scope, updated_by_user_id)
SELECT role_id, 'payments.collections.view', is_allowed, data_scope, updated_by_user_id
  FROM crm_role_permissions WHERE permission_key = 'settings.payment_forms.view'
ON DUPLICATE KEY UPDATE is_allowed = VALUES(is_allowed), data_scope = VALUES(data_scope);

INSERT INTO crm_role_permissions (role_id, permission_key, is_allowed, data_scope, updated_by_user_id)
SELECT role_id, 'payments.collections.export', is_allowed, data_scope, updated_by_user_id
  FROM crm_role_permissions WHERE permission_key = 'settings.payment_forms.view'
ON DUPLICATE KEY UPDATE is_allowed = VALUES(is_allowed), data_scope = VALUES(data_scope);

-- Payment links were part of the same screen and the same key.
INSERT INTO crm_role_permissions (role_id, permission_key, is_allowed, data_scope, updated_by_user_id)
SELECT role_id, REPLACE(permission_key, 'settings.payment_forms.', 'payments.links.'), is_allowed, data_scope, updated_by_user_id
  FROM crm_role_permissions
 WHERE permission_key IN ('settings.payment_forms.view', 'settings.payment_forms.create', 'settings.payment_forms.delete')
ON DUPLICATE KEY UPDATE is_allowed = VALUES(is_allowed), data_scope = VALUES(data_scope);

-- Payment forms and enquiry forms map action for action.
INSERT INTO crm_role_permissions (role_id, permission_key, is_allowed, data_scope, updated_by_user_id)
SELECT role_id, REPLACE(permission_key, 'settings.payment_forms.', 'payments.forms.'), is_allowed, data_scope, updated_by_user_id
  FROM crm_role_permissions WHERE permission_key LIKE 'settings.payment_forms.%'
ON DUPLICATE KEY UPDATE is_allowed = VALUES(is_allowed), data_scope = VALUES(data_scope);

INSERT INTO crm_role_permissions (role_id, permission_key, is_allowed, data_scope, updated_by_user_id)
SELECT role_id, REPLACE(permission_key, 'settings.enquiry_forms.', 'payments.enquiry_forms.'), is_allowed, data_scope, updated_by_user_id
  FROM crm_role_permissions WHERE permission_key LIKE 'settings.enquiry_forms.%'
ON DUPLICATE KEY UPDATE is_allowed = VALUES(is_allowed), data_scope = VALUES(data_scope);

-- The old rows are left in place. They are inert once the registry marks the
-- keys inactive, and keeping them means this file can be re-run and an
-- administrator can still see in the audit trail what a role used to hold.
