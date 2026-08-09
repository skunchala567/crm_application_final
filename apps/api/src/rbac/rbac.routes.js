/**
 * Access Control API: roles, grants, assignments, audit.
 *
 * Every write here is audited and every write re-checks protection rules on
 * the server. The UI disables the buttons too, but that is cosmetic -- these
 * checks are the ones that matter.
 */
import { Router } from 'express';
import {
  loadUserPermissions, invalidatePermissionCache,
  getEnforcementMode, writeAudit,
} from './permission-service.js';
import { DATA_SCOPES, ACTIONS } from './permission-registry.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const slug = (value) => String(value || '').trim().toUpperCase()
  .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);

export function createRbacRoutes(pool, authenticate, requireCrmAccess, logger = console) {
  const router = Router();
  router.use(authenticate, requireCrmAccess);

  const actor = (req) => ({
    actorUserId: Number(req.user?.id) || null,
    actorEmail: req.user?.email || null,
    ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
  });

  /** Guard the protected-role rules in one place. */
  async function loadRole(roleId) {
    const [[role]] = await pool.execute(
      `SELECT r.id, r.name, r.normalized_name AS normalizedName, r.description,
              COALESCE(s.is_active, TRUE) AS isActive,
              COALESCE(s.is_super_admin, FALSE) AS isSuperAdmin,
              COALESCE(s.is_protected, FALSE) AS isProtected,
              COALESCE(s.is_crm_role, FALSE) AS isCrmRole
         FROM roles r LEFT JOIN crm_role_settings s ON s.role_id = r.id
        WHERE r.id = ? LIMIT 1`,
      [Number(roleId)],
    );
    return role || null;
  }

  // ---------------- Own permissions (drives the whole frontend) ----------
  router.get('/me', wrap(async (req, res) => {
    const state = await loadUserPermissions(pool, req.user.id);
    const mode = await getEnforcementMode(pool);
    res.json({
      success: true,
      data: {
        enforcementMode: mode,
        superAdmin: state.superAdmin,
        roles: state.roles,
        // { key: scope } - scope is 'none' for unscoped grants.
        permissions: Object.fromEntries(
          [...state.permissions.entries()].map(([key, v]) => [key, v.scope || 'none']),
        ),
      },
    });
  }));

  // ---------------- Registry (the matrix tree) ---------------------------
  router.get('/registry', wrap(async (_req, res) => {
    const [rows] = await pool.execute(
      `SELECT permission_key AS permissionKey, module_code AS module, module_label AS moduleLabel,
              screen_code AS screen, screen_label AS screenLabel, tab_code AS tab, tab_label AS tabLabel,
              action_code AS action, label, route, is_scoped AS isScoped
         FROM crm_permission_registry WHERE is_active = TRUE ORDER BY sort_order`,
    );
    // Rebuild the tree the UI renders: module -> screen -> tab -> actions.
    const modules = [];
    for (const row of rows) {
      let mod = modules.find((m) => m.module === row.module);
      if (!mod) { mod = { module: row.module, label: row.moduleLabel, screens: [] }; modules.push(mod); }
      let screen = mod.screens.find((s) => s.screen === row.screen);
      if (!screen) { screen = { screen: row.screen, label: row.screenLabel, route: row.route, tabs: [], actions: [] }; mod.screens.push(screen); }
      if (row.tab) {
        let tab = screen.tabs.find((t) => t.tab === row.tab);
        if (!tab) { tab = { tab: row.tab, label: row.tabLabel, actions: [] }; screen.tabs.push(tab); }
        tab.actions.push({ action: row.action, key: row.permissionKey, isScoped: Boolean(row.isScoped) });
      } else {
        screen.actions.push({ action: row.action, key: row.permissionKey, isScoped: Boolean(row.isScoped) });
      }
    }
    res.json({ success: true, data: { modules, actions: ACTIONS, scopes: DATA_SCOPES } });
  }));

  // ---------------- Roles -------------------------------------------------
  router.get('/roles', wrap(async (_req, res) => {
    const [rows] = await pool.execute(
      `SELECT r.id, r.name, r.normalized_name AS normalizedName, r.description,
              COALESCE(s.is_active, TRUE)      AS isActive,
              COALESCE(s.is_super_admin,FALSE) AS isSuperAdmin,
              COALESCE(s.is_protected, FALSE)  AS isProtected,
              COALESCE(s.is_crm_role, FALSE)   AS isCrmRole,
              (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) AS userCount,
              (SELECT COUNT(*) FROM crm_role_permissions p WHERE p.role_id = r.id AND p.is_allowed) AS grantCount
         FROM roles r LEFT JOIN crm_role_settings s ON s.role_id = r.id
        ORDER BY COALESCE(s.is_super_admin,FALSE) DESC, r.name`,
    );
    res.json({
      success: true,
      data: rows.map((r) => ({
        ...r,
        id: Number(r.id),
        isActive: Boolean(Number(r.isActive)),
        isSuperAdmin: Boolean(Number(r.isSuperAdmin)),
        isProtected: Boolean(Number(r.isProtected)),
        isCrmRole: Boolean(Number(r.isCrmRole)),
        userCount: Number(r.userCount),
        grantCount: Number(r.grantCount),
      })),
    });
  }));

  router.post('/roles', wrap(async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 50);
    if (!name) return res.status(400).json({ success: false, error: 'Role name is required' });
    const normalized = slug(name);
    const [[clash]] = await pool.execute('SELECT id FROM roles WHERE normalized_name = ? LIMIT 1', [normalized]);
    if (clash) return res.status(409).json({ success: false, error: 'A role with that name already exists' });

    const [result] = await pool.execute(
      'INSERT INTO roles (name, normalized_name, description, is_system) VALUES (?,?,?,0)',
      [name, normalized, String(req.body?.description || '').slice(0, 255) || null],
    );
    await pool.execute(
      `INSERT INTO crm_role_settings (role_id, is_active, is_super_admin, is_protected, is_crm_role, description, created_by_user_id)
       VALUES (?,TRUE,FALSE,FALSE,TRUE,?,?)`,
      [result.insertId, String(req.body?.description || '').slice(0, 400) || null, Number(req.user.id) || null],
    );
    await writeAudit(pool, {
      ...actor(req), eventType: 'role_created',
      targetRoleId: result.insertId, targetRoleName: name,
      summary: `Created role "${name}"`,
    }, logger);
    res.status(201).json({ success: true, data: { id: Number(result.insertId), name, normalizedName: normalized } });
  }));

  router.post('/roles/:id/clone', wrap(async (req, res) => {
    const source = await loadRole(req.params.id);
    if (!source) return res.status(404).json({ success: false, error: 'Role not found' });
    const name = String(req.body?.name || `${source.name} copy`).trim().slice(0, 50);
    const normalized = slug(name);
    const [[clash]] = await pool.execute('SELECT id FROM roles WHERE normalized_name = ? LIMIT 1', [normalized]);
    if (clash) return res.status(409).json({ success: false, error: 'A role with that name already exists' });

    const [result] = await pool.execute(
      'INSERT INTO roles (name, normalized_name, description, is_system) VALUES (?,?,?,0)',
      [name, normalized, source.description || null],
    );
    await pool.execute(
      `INSERT INTO crm_role_settings (role_id, is_active, is_super_admin, is_protected, is_crm_role, description, cloned_from_role_id, created_by_user_id)
       VALUES (?,TRUE,FALSE,FALSE,TRUE,?,?,?)`,
      [result.insertId, source.description || null, source.id, Number(req.user.id) || null],
    );
    // Copy the grants, never the super-admin flag: cloning must not mint a
    // second unrestricted role by accident.
    await pool.execute(
      `INSERT INTO crm_role_permissions (role_id, permission_key, is_allowed, data_scope, updated_by_user_id)
       SELECT ?, permission_key, is_allowed, data_scope, ? FROM crm_role_permissions WHERE role_id = ?`,
      [result.insertId, Number(req.user.id) || null, source.id],
    );
    await writeAudit(pool, {
      ...actor(req), eventType: 'role_cloned',
      targetRoleId: result.insertId, targetRoleName: name,
      summary: `Cloned "${source.name}" into "${name}"`,
      detail: { sourceRoleId: Number(source.id), sourceRoleName: source.name },
    }, logger);
    res.status(201).json({ success: true, data: { id: Number(result.insertId), name } });
  }));

  router.patch('/roles/:id', wrap(async (req, res) => {
    const role = await loadRole(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
    if (Number(role.isProtected) && req.body.isActive === false) {
      return res.status(400).json({ success: false, error: `"${role.name}" is protected and cannot be deactivated` });
    }
    if (!Number(role.isCrmRole) && req.body.name) {
      return res.status(400).json({ success: false, error: 'This role belongs to the Attendance system and cannot be renamed here' });
    }

    if (req.body.name || req.body.description !== undefined) {
      await pool.execute(
        'UPDATE roles SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?',
        [req.body.name ? String(req.body.name).slice(0, 50) : null,
          req.body.description !== undefined ? String(req.body.description).slice(0, 255) : null, role.id],
      );
    }
    if (req.body.isActive !== undefined) {
      await pool.execute(
        `INSERT INTO crm_role_settings (role_id, is_active, updated_by_user_id) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE is_active = VALUES(is_active), updated_by_user_id = VALUES(updated_by_user_id)`,
        [role.id, req.body.isActive ? 1 : 0, Number(req.user.id) || null],
      );
    }
    invalidatePermissionCache();
    await writeAudit(pool, {
      ...actor(req),
      eventType: req.body.isActive === false ? 'role_deactivated'
        : req.body.isActive === true ? 'role_activated' : 'role_updated',
      targetRoleId: role.id, targetRoleName: role.name,
      summary: `Updated role "${role.name}"`,
      detail: req.body,
    }, logger);
    res.json({ success: true });
  }));

  router.delete('/roles/:id', wrap(async (req, res) => {
    const role = await loadRole(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
    if (Number(role.isProtected)) {
      return res.status(400).json({ success: false, error: `"${role.name}" is protected and cannot be deleted` });
    }
    const [[assigned]] = await pool.execute('SELECT COUNT(*) n FROM user_roles WHERE role_id = ?', [role.id]);
    if (Number(assigned.n) > 0) {
      return res.status(409).json({
        success: false,
        error: `"${role.name}" is assigned to ${assigned.n} user(s). Remove them first, or deactivate the role instead.`,
      });
    }
    await pool.execute('DELETE FROM roles WHERE id = ?', [role.id]);
    invalidatePermissionCache();
    await writeAudit(pool, {
      ...actor(req), eventType: 'role_deleted',
      targetRoleId: role.id, targetRoleName: role.name,
      summary: `Deleted role "${role.name}"`,
    }, logger);
    res.json({ success: true });
  }));

  // ---------------- Grants ------------------------------------------------
  router.get('/roles/:id/permissions', wrap(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT permission_key AS permissionKey, is_allowed AS isAllowed, data_scope AS dataScope
         FROM crm_role_permissions WHERE role_id = ?`,
      [Number(req.params.id)],
    );
    res.json({
      success: true,
      data: Object.fromEntries(rows
        .filter((r) => Number(r.isAllowed))
        .map((r) => [r.permissionKey, r.dataScope || 'none'])),
    });
  }));

  router.put('/roles/:id/permissions', wrap(async (req, res) => {
    const role = await loadRole(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
    if (Number(role.isSuperAdmin)) {
      return res.status(400).json({ success: false, error: 'Super Admin always has full access; its permissions cannot be edited' });
    }
    if (!Number(role.isCrmRole)) {
      return res.status(400).json({ success: false, error: 'This role belongs to the Attendance system and cannot be edited here' });
    }

    const grants = req.body?.permissions && typeof req.body.permissions === 'object' ? req.body.permissions : {};
    const [valid] = await pool.execute(
      'SELECT permission_key AS k, is_scoped AS scoped FROM crm_permission_registry WHERE is_active = TRUE',
    );
    const validMap = new Map(valid.map((v) => [v.k, Boolean(Number(v.scoped))]));

    const [before] = await pool.execute(
      'SELECT permission_key AS k, data_scope AS s FROM crm_role_permissions WHERE role_id = ? AND is_allowed = TRUE',
      [role.id],
    );

    const rows = [];
    for (const [key, scope] of Object.entries(grants)) {
      if (!validMap.has(key)) continue;               // ignore unknown keys
      const isScoped = validMap.get(key);
      const value = String(scope || 'all');
      if (isScoped && !DATA_SCOPES.includes(value)) continue;
      rows.push([role.id, key, 1, isScoped ? value : 'none', Number(req.user.id) || null]);
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('DELETE FROM crm_role_permissions WHERE role_id = ?', [role.id]);
      if (rows.length) {
        await connection.query(
          `INSERT INTO crm_role_permissions (role_id, permission_key, is_allowed, data_scope, updated_by_user_id) VALUES ?`,
          [rows],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    invalidatePermissionCache();

    const beforeSet = new Set(before.map((b) => b.k));
    const afterSet = new Set(rows.map((r) => r[1]));
    const added = [...afterSet].filter((k) => !beforeSet.has(k));
    const removed = [...beforeSet].filter((k) => !afterSet.has(k));
    await writeAudit(pool, {
      ...actor(req), eventType: 'permissions_changed',
      targetRoleId: role.id, targetRoleName: role.name,
      summary: `Changed permissions for "${role.name}": ${added.length} added, ${removed.length} removed`,
      detail: { added, removed, total: rows.length },
    }, logger);

    res.json({ success: true, data: { granted: rows.length, added: added.length, removed: removed.length } });
  }));

  // ---------------- Assignment -------------------------------------------
  router.get('/roles/:id/users', wrap(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT u.id, u.email, COALESCE(e.employee_name, u.email) AS name
         FROM user_roles ur JOIN app_users u ON u.id = ur.user_id
         LEFT JOIN employees e ON e.id = u.employee_id
        WHERE ur.role_id = ? ORDER BY name`,
      [Number(req.params.id)],
    );
    res.json({ success: true, data: rows.map((r) => ({ ...r, id: Number(r.id) })) });
  }));

  router.post('/roles/:id/users', wrap(async (req, res) => {
    const role = await loadRole(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
    const userId = Number(req.body?.userId);
    const [[user]] = await pool.execute('SELECT id, email FROM app_users WHERE id = ? LIMIT 1', [userId]);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    await pool.execute('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?,?)', [userId, role.id]);
    invalidatePermissionCache(userId);
    await writeAudit(pool, {
      ...actor(req), eventType: 'user_role_assigned',
      targetRoleId: role.id, targetRoleName: role.name,
      targetUserId: userId, targetUserEmail: user.email,
      summary: `Assigned "${role.name}" to ${user.email}`,
    }, logger);
    res.json({ success: true });
  }));

  router.delete('/roles/:id/users/:userId', wrap(async (req, res) => {
    const role = await loadRole(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
    const userId = Number(req.params.userId);

    // Removing the last Super Admin would leave nobody able to grant it back.
    if (Number(role.isSuperAdmin)) {
      const [[count]] = await pool.execute('SELECT COUNT(*) n FROM user_roles WHERE role_id = ?', [role.id]);
      if (Number(count.n) <= 1) {
        return res.status(400).json({ success: false, error: 'At least one user must keep the Super Admin role' });
      }
    }
    const [[user]] = await pool.execute('SELECT email FROM app_users WHERE id = ? LIMIT 1', [userId]);
    await pool.execute('DELETE FROM user_roles WHERE role_id = ? AND user_id = ?', [role.id, userId]);
    invalidatePermissionCache(userId);
    await writeAudit(pool, {
      ...actor(req), eventType: 'user_role_removed',
      targetRoleId: role.id, targetRoleName: role.name,
      targetUserId: userId, targetUserEmail: user?.email || null,
      summary: `Removed "${role.name}" from ${user?.email || `user ${userId}`}`,
    }, logger);
    res.json({ success: true });
  }));

  // ---------------- Enforcement mode + evidence ---------------------------
  router.get('/settings', wrap(async (_req, res) => {
    const [[row]] = await pool.execute('SELECT enforcement_mode AS mode, updated_at_utc AS updatedAt FROM crm_rbac_settings WHERE id = 1');
    const [[denials]] = await pool.execute(
      'SELECT COUNT(*) n FROM crm_rbac_denials WHERE occurred_at_utc > DATE_SUB(NOW(), INTERVAL 7 DAY)',
    );
    res.json({ success: true, data: { mode: row?.mode || 'audit', updatedAt: row?.updatedAt, denialsLast7Days: Number(denials.n) } });
  }));

  /*
   * Enforcement is no longer switchable.
   *
   * The endpoint stays so an older client calling it gets a clear answer
   * rather than a 404 it might read as a routing fault, but it changes
   * nothing: permissions always apply.
   */
  router.put('/settings', wrap(async (_req, res) => {
    res.status(409).json({
      success: false,
      error: 'Access control is always enforced and can no longer be switched off',
    });
  }));

  /** What would have been blocked. The evidence for switching to enforce. */
  router.get('/denials', wrap(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const [rows] = await pool.query(
      `SELECT user_email AS userEmail, method, path, permission_key AS permissionKey,
              reason, was_enforced AS wasEnforced, COUNT(*) AS hits, MAX(occurred_at_utc) AS lastSeen
         FROM crm_rbac_denials
        WHERE occurred_at_utc > DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY user_email, method, path, permission_key, reason, was_enforced
        ORDER BY hits DESC LIMIT ?`,
      [limit],
    );
    res.json({ success: true, data: rows });
  }));

  router.get('/audit', wrap(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const [rows] = await pool.query(
      `SELECT id, event_type AS eventType, actor_email AS actorEmail, target_role_name AS roleName,
              target_user_email AS userEmail, summary, detail_json AS detail, created_at_utc AS createdAt
         FROM crm_rbac_audit ORDER BY id DESC LIMIT ?`,
      [limit],
    );
    res.json({ success: true, data: rows });
  }));

  return router;
}
