/**
 * Boot-time RBAC setup: sync the registry from code, and give each stock role
 * a starting set of grants.
 *
 * Defaults are seeded ONLY for a role that has no grants at all. Once an
 * administrator has touched a role, this never overwrites their work -- a
 * redeploy must not silently restore permissions someone deliberately removed.
 */
import { buildPermissionRows } from './permission-registry.js';
import { syncPermissionRegistry } from './permission-service.js';

/**
 * What each stock role starts with.
 *
 * Chosen to match how the CRM behaves today, so switching enforcement on does
 * not change what anyone can already do:
 *   - CRM_ADMIN could reach everything, and still can.
 *   - COUNSELLOR worked their own leads; they keep leads and follow-ups, and
 *     lose only the settings screens they were never meant to administer.
 *   - CRM_VIEWER was read-only by intent but not by enforcement; now it is.
 */
const DEFAULTS = {
  /*
   * The superuser role holds every permission the registry defines.
   *
   * It already passes the middleware's admin bypass, so this changes nothing
   * about what it can reach -- but a role showing zero grants in the Access
   * Control matrix while being able to do everything is a screen that lies
   * about who can do what. `alwaysComplete` tops it up on every start so a
   * permission added next month is granted without anyone remembering to.
   */
  SUPER_ADMIN: {
    scope: 'all',
    allow: () => true,
    alwaysComplete: true,
  },
  CRM_ADMIN: {
    scope: 'all',
    allow: () => true,
  },
  ADMISSION_MANAGER: {
    scope: 'department',
    allow: (row) => !row.permissionKey.startsWith('settings.access_control.')
      && !(row.module === 'settings' && ['delete'].includes(row.action))
      && row.module !== 'integrations',
  },
  COUNSELLOR: {
    scope: 'own',
    allow: (row) => ['leads', 'dashboard', 'tracker', 'whatsapp'].includes(row.module)
      && ['view', 'create', 'edit', 'upload', 'download', 'export'].includes(row.action)
      && !row.permissionKey.startsWith('leads.marketing.'),
  },
  CRM_VIEWER: {
    scope: 'all',
    allow: (row) => row.action === 'view'
      && row.module !== 'settings'
      && row.module !== 'integrations',
  },
};

/**
 * Grants held under a key that has since moved.
 *
 * Bulk actions began life as a screen under Leads and became a module of
 * their own. Renaming the keys without carrying the grants across would have
 * quietly stripped every bulk action from CRM Admin -- the permissions would
 * still read as granted in the old rows, while the code asked about keys
 * nobody held.
 *
 * One old key can produce several new ones: leads.bulk_actions.import covered
 * both the Bulk Actions screen and the Bulk Upload tile, which are now
 * separate rows in the matrix.
 */
const MOVED_PERMISSIONS = {
  'leads.bulk_actions.view': ['bulk_actions.workspace.view', 'bulk_actions.toolbar.view'],
  'leads.bulk_actions.import': ['bulk_actions.workspace.import', 'bulk_actions.upload.import'],
  'leads.bulk_actions.export': ['bulk_actions.workspace.export', 'bulk_actions.export.export'],
  'leads.bulk_actions.upload': ['bulk_actions.workspace.upload'],
  'leads.bulk_actions.download': ['bulk_actions.workspace.download'],
  'leads.bulk_actions.edit': ['bulk_actions.change_stage.edit'],
  'leads.bulk_actions.assign': ['bulk_actions.refer.assign'],
  // The two tiles whose capability lives in another module.
  'leads.marketing.create': ['bulk_actions.campaign.create'],
  'whatsapp.inbox.create': ['bulk_actions.whatsapp.create'],
};

/**
 * Copy grants from moved keys onto their replacements.
 *
 * Additive and idempotent: INSERT IGNORE, and the old rows are left alone so
 * a rollback to the previous build still finds them. Retired keys are marked
 * inactive by the registry sync, so they stop appearing in the matrix.
 */
async function migrateMovedPermissions(pool, logger = console) {
  let copied = 0;
  for (const [oldKey, newKeys] of Object.entries(MOVED_PERMISSIONS)) {
    for (const newKey of newKeys) {
      try {
        const [result] = await pool.execute(
          `INSERT IGNORE INTO crm_role_permissions (role_id, permission_key, is_allowed, data_scope, updated_by_user_id)
           SELECT role_id, ?, is_allowed, data_scope, updated_by_user_id
             FROM crm_role_permissions WHERE permission_key = ? AND is_allowed = TRUE`,
          [newKey, oldKey],
        );
        copied += result.affectedRows || 0;
      } catch (error) {
        logger?.warn?.(`[rbac] could not carry ${oldKey} to ${newKey}: ${error.message}`);
      }
    }
  }
  if (copied) logger?.info?.(`[rbac] carried ${copied} grant(s) onto relocated permission keys`);
  return copied;
}

export async function bootstrapRbac(pool, logger = console) {
  try {
    await syncPermissionRegistry(pool, logger);
    await migrateMovedPermissions(pool, logger);
  } catch (error) {
    logger?.warn?.(`[rbac] registry sync skipped: ${error.message}`);
    return;
  }

  const rows = buildPermissionRows();

  for (const [normalizedName, spec] of Object.entries(DEFAULTS)) {
    try {
      const [[role]] = await pool.execute(
        'SELECT id FROM roles WHERE normalized_name = ? LIMIT 1',
        [normalizedName],
      );
      if (!role) continue;

      const [[existing]] = await pool.execute(
        'SELECT COUNT(*) AS n FROM crm_role_permissions WHERE role_id = ?',
        [role.id],
      );
      /*
       * Seeded roles are left alone once an administrator has touched them --
       * their choices are not ours to overwrite. A role marked
       * alwaysComplete is the exception: it is defined as "everything", so
       * having some rows is not a reason to stop granting the rest. The
       * INSERT IGNORE below adds only what is missing either way, so an
       * existing row keeps whatever scope it was given.
       */
      if (Number(existing.n) > 0 && !spec.alwaysComplete) continue;

      const granted = rows.filter(spec.allow);
      if (!granted.length) continue;

      const values = [];
      const params = [];
      for (const row of granted) {
        values.push('(?,?,TRUE,?)');
        params.push(role.id, row.permissionKey, row.isScoped ? spec.scope : 'none');
      }
      await pool.query(
        `INSERT IGNORE INTO crm_role_permissions (role_id, permission_key, is_allowed, data_scope)
         VALUES ${values.join(',')}`,
        params,
      );
      logger?.info?.(`[rbac] ${normalizedName}: ${granted.length} permissions ensured`);
    } catch (error) {
      logger?.warn?.(`[rbac] could not seed ${normalizedName}: ${error.message}`);
    }
  }

  // Whoever administers the CRM today keeps a way in after enforcement starts.
  try {
    await pool.execute(
      `INSERT IGNORE INTO user_roles (user_id, role_id)
       SELECT ur.user_id, (SELECT id FROM roles WHERE normalized_name='SUPER_ADMIN')
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE r.normalized_name IN ('ADMIN','CRM_ADMIN')`,
    );
  } catch (error) {
    logger?.warn?.(`[rbac] could not grant Super Admin: ${error.message}`);
  }
}
