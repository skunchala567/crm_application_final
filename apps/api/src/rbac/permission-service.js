/**
 * The permission engine.
 *
 * One question this file answers: may this user perform this action, and over
 * which records. Everything else -- middleware, routes, the UI -- is built on
 * `hasPermission` and `resolveScope` rather than on role names, so a new role
 * is a data change and never a code change.
 *
 *   hasPermission(user, 'leads.edit')     yes
 *   user.role === 'Manager'               no
 */
import { SCOPE_RANK, buildPermissionRows } from './permission-registry.js';

const CACHE_TTL_MS = 30_000;

/** userId -> { at, permissions: Map<key, {allowed, scope}>, superAdmin, roles } */
const userCache = new Map();
let settingsCache = { at: 0, mode: 'audit' };

export function invalidatePermissionCache(userId) {
  if (userId == null) userCache.clear();
  else userCache.delete(Number(userId));
}

export function invalidateSettingsCache() {
  settingsCache = { at: 0, mode: settingsCache.mode };
}

/**
 * Permissions always apply.
 *
 * There was a stored mode (off / audit / enforce) to make the first rollout
 * survivable: audit recorded what would be refused without refusing it. That
 * job is done, so enforcement is no longer a setting anyone can turn off --
 * a switch that disables access control is itself a risk once the grants are
 * settled.
 *
 * The one exception is structural: if the RBAC tables are not there, the
 * migration has not run, and denying every request would lock the CRM.
 * That check is cached so it costs one query a minute, not one per request.
 */
export async function getEnforcementMode(pool) {
  if (Date.now() - settingsCache.at < CACHE_TTL_MS) return settingsCache.mode;
  try {
    await pool.execute('SELECT 1 FROM crm_role_permissions LIMIT 1');
    settingsCache = { at: Date.now(), mode: 'enforce' };
  } catch {
    settingsCache = { at: Date.now(), mode: 'off' };
  }
  return settingsCache.mode;
}

/**
 * Everything a user is allowed, flattened across all their active roles.
 *
 * A user with several roles gets the union: the most generous grant wins, and
 * the widest data scope wins. That matches how people expect stacked roles to
 * behave -- adding a role never takes access away.
 */
export async function loadUserPermissions(pool, userId) {
  const id = Number(userId);
  const cached = userCache.get(id);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;

  const empty = { at: Date.now(), permissions: new Map(), superAdmin: false, roles: [] };
  if (!Number.isInteger(id) || id <= 0) return empty;

  let rows = [];
  let roleRows = [];
  try {
    [roleRows] = await pool.execute(
      `SELECT r.id, r.name, r.normalized_name AS normalizedName,
              COALESCE(s.is_active, TRUE) AS isActive,
              COALESCE(s.is_super_admin, FALSE) AS isSuperAdmin
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         LEFT JOIN crm_role_settings s ON s.role_id = r.id
        WHERE ur.user_id = ?`,
      [id],
    );
    // A deactivated role grants nothing, without unlinking any user from it.
    const activeRoleIds = roleRows.filter((r) => Number(r.isActive)).map((r) => Number(r.id));
    if (activeRoleIds.length) {
      const placeholders = activeRoleIds.map(() => '?').join(',');
      [rows] = await pool.execute(
        `SELECT permission_key AS permissionKey, is_allowed AS isAllowed, data_scope AS dataScope
           FROM crm_role_permissions
          WHERE role_id IN (${placeholders}) AND is_allowed = TRUE`,
        activeRoleIds,
      );
    }
  } catch {
    // Schema not present yet -- behave as if nothing is granted. Combined with
    // enforcement defaulting to off, this cannot lock anybody out.
    return empty;
  }

  const permissions = new Map();
  for (const row of rows) {
    const current = permissions.get(row.permissionKey);
    const scope = row.dataScope || 'none';
    if (!current) {
      permissions.set(row.permissionKey, { allowed: true, scope });
    } else if ((SCOPE_RANK[scope] ?? 0) > (SCOPE_RANK[current.scope] ?? 0)) {
      current.scope = scope;
    }
  }

  const entry = {
    at: Date.now(),
    permissions,
    superAdmin: roleRows.some((r) => Number(r.isSuperAdmin) && Number(r.isActive)),
    roles: roleRows.map((r) => ({
      id: Number(r.id), name: r.name, normalizedName: r.normalizedName,
      isActive: Boolean(Number(r.isActive)), isSuperAdmin: Boolean(Number(r.isSuperAdmin)),
    })),
  };
  userCache.set(id, entry);
  return entry;
}

/**
 * May this user do this?
 *
 * `user` may be the request user object or a bare id. Pass the pool so the
 * grants can be loaded; callers inside a request should prefer the version
 * already attached to req by the middleware.
 */
export async function hasPermission(pool, user, permissionKey) {
  const id = Number(user?.id ?? user);
  const state = await loadUserPermissions(pool, id);
  if (state.superAdmin) return true;
  return state.permissions.get(permissionKey)?.allowed === true;
}

/** The widest scope this user holds for a key, or 'none'. */
export async function resolveScope(pool, user, permissionKey) {
  const id = Number(user?.id ?? user);
  const state = await loadUserPermissions(pool, id);
  if (state.superAdmin) return 'all';
  const grant = state.permissions.get(permissionKey);
  if (!grant?.allowed) return 'none';
  return grant.scope || 'none';
}

/** True when the scope the user holds covers the scope an operation needs. */
export function scopeCovers(granted, required) {
  return (SCOPE_RANK[granted] ?? 0) >= (SCOPE_RANK[required] ?? 0);
}

/**
 * Turn a data scope into a SQL predicate over crm_leads.
 *
 * Returns { sql, params }. `sql` is always a complete boolean expression so it
 * can be dropped into a WHERE with AND, including the impossible `1=0` for
 * "no access" -- a caller that forgets to branch still leaks nothing.
 *
 * Team currently means "the branches this user is assigned to". The schema has
 * employees.reporting_manager_employee_id, which would be the better basis,
 * but it is unpopulated for every employee -- using it today would resolve to
 * an empty team for everyone and silently hide every lead.
 */
export async function leadScopePredicate(pool, user, scope, alias = 'l') {
  const userId = Number(user?.id) || 0;
  const employeeId = Number(user?.employeeId) || 0;

  if (scope === 'all') return { sql: '1=1', params: [] };
  if (!scope || scope === 'none') return { sql: '1=0', params: [] };

  if (scope === 'own') {
    return {
      sql: `(${alias}.owner_employee_id = ? OR ${alias}.created_by_user_id = ?)`,
      params: [employeeId, userId],
    };
  }

  if (scope === 'team') {
    const [branches] = await pool.execute(
      'SELECT branch_id FROM crm_user_branches WHERE user_id = ?',
      [userId],
    );
    const ids = branches.map((b) => Number(b.branch_id)).filter(Boolean);
    if (!ids.length) {
      // No branch mapping: fall back to own records rather than to everything.
      return leadScopePredicate(pool, user, 'own', alias);
    }
    return {
      sql: `${alias}.branch_id IN (${ids.map(() => '?').join(',')})`,
      params: ids,
    };
  }

  if (scope === 'department') {
    // employees.department is a free-text column, so match on the department
    // string of this user's own employee record.
    const [[me]] = await pool.execute(
      'SELECT department FROM employees WHERE id = ? LIMIT 1',
      [employeeId],
    );
    if (!me?.department) return leadScopePredicate(pool, user, 'team', alias);
    return {
      sql: `${alias}.owner_employee_id IN (SELECT id FROM employees WHERE department = ?)`,
      params: [me.department],
    };
  }

  return { sql: '1=0', params: [] };
}

/**
 * The same scoping as leadScopePredicate, but without touching the database.
 *
 * The lead queries build their WHERE clause synchronously in sixteen places;
 * making those async to look up a department would be a large, risky change
 * for no gain, so department resolves through a correlated subquery instead.
 * Everything else comes off the token, which already carries employeeId and
 * branchIds.
 */
export function scopeNarrowingSql(user, scope, alias = 'l') {
  const userId = Number(user?.id) || 0;
  const employeeId = Number(user?.employeeId) || 0;

  if (!scope || scope === 'all') return { sql: '1=1', params: [] };
  if (scope === 'none') return { sql: '1=0', params: [] };

  if (scope === 'own') {
    return {
      sql: `(${alias}.owner_employee_id = ? OR ${alias}.created_by_user_id = ?)`,
      params: [employeeId, userId],
    };
  }

  if (scope === 'team') {
    const branchIds = Array.isArray(user?.branchIds)
      ? user.branchIds.map(Number).filter(Number.isFinite) : [];
    // No branch mapping narrows to own records rather than widening to all.
    if (!branchIds.length) return scopeNarrowingSql(user, 'own', alias);
    const placeholders = branchIds.map(() => '?').join(',');
    return {
      sql: `(${alias}.branch_id IN (${placeholders}) OR ${alias}.referred_to_branch_id IN (${placeholders}))`,
      params: [...branchIds, ...branchIds],
    };
  }

  if (scope === 'department') {
    if (!employeeId) return scopeNarrowingSql(user, 'own', alias);
    return {
      sql: `${alias}.owner_employee_id IN (
              SELECT e.id FROM employees e
               WHERE e.department IS NOT NULL
                 AND e.department = (SELECT d.department FROM employees d WHERE d.id = ?))`,
      params: [employeeId],
    };
  }

  return { sql: '1=0', params: [] };
}

/**
 * Sync the registry from code into the database.
 *
 * Runs on boot. Keys no longer in code are marked inactive rather than
 * deleted, so a grant made against a retired key still reads back instead of
 * vanishing from the audit trail.
 */
export async function syncPermissionRegistry(pool, logger = console) {
  const rows = buildPermissionRows();
  if (!rows.length) return 0;

  const values = [];
  const params = [];
  rows.forEach((row, index) => {
    values.push('(?,?,?,?,?,?,?,?,?,?,?,TRUE,?)');
    params.push(
      row.permissionKey, row.module, row.moduleLabel, row.screen, row.screenLabel,
      row.tab, row.tabLabel, row.action, row.label, row.route, row.isScoped, index,
    );
  });

  await pool.query(
    `INSERT INTO crm_permission_registry
       (permission_key, module_code, module_label, screen_code, screen_label,
        tab_code, tab_label, action_code, label, route, is_scoped, is_active, sort_order)
     VALUES ${values.join(',')}
     ON DUPLICATE KEY UPDATE
       module_code=VALUES(module_code), module_label=VALUES(module_label),
       screen_code=VALUES(screen_code), screen_label=VALUES(screen_label),
       tab_code=VALUES(tab_code), tab_label=VALUES(tab_label),
       action_code=VALUES(action_code), label=VALUES(label), route=VALUES(route),
       is_scoped=VALUES(is_scoped), is_active=TRUE, sort_order=VALUES(sort_order)`,
    params,
  );

  const keys = rows.map((r) => r.permissionKey);
  await pool.query(
    `UPDATE crm_permission_registry SET is_active = FALSE
      WHERE permission_key NOT IN (${keys.map(() => '?').join(',')})`,
    keys,
  );

  logger?.info?.(`[rbac] registry synced: ${rows.length} permissions`);
  return rows.length;
}

/** Record an access-control change. Never throws; auditing must not block. */
export async function writeAudit(pool, entry, logger = console) {
  try {
    await pool.execute(
      `INSERT INTO crm_rbac_audit
         (event_type, actor_user_id, actor_email, target_role_id, target_role_name,
          target_user_id, target_user_email, summary, detail_json, ip_address)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        entry.eventType, entry.actorUserId ?? null, entry.actorEmail ?? null,
        entry.targetRoleId ?? null, entry.targetRoleName ?? null,
        entry.targetUserId ?? null, entry.targetUserEmail ?? null,
        String(entry.summary || '').slice(0, 500),
        entry.detail ? JSON.stringify(entry.detail) : null,
        entry.ip ? String(entry.ip).slice(0, 64) : null,
      ],
    );
  } catch (error) {
    logger?.warn?.(`[rbac] audit write failed: ${error.message}`);
  }
}

/** Record a denial for the "what would break" report. Never throws. */
export async function recordDenial(pool, entry, logger = console) {
  try {
    await pool.execute(
      `INSERT INTO crm_rbac_denials
         (user_id, user_email, method, path, permission_key, reason, was_enforced)
       VALUES (?,?,?,?,?,?,?)`,
      [
        entry.userId ?? null, entry.userEmail ?? null, entry.method,
        String(entry.path).slice(0, 400), entry.permissionKey ?? null,
        String(entry.reason).slice(0, 120), Boolean(entry.wasEnforced),
      ],
    );
  } catch (error) {
    logger?.warn?.(`[rbac] denial write failed: ${error.message}`);
  }
}
