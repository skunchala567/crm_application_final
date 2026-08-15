/**
 * Global permission enforcement.
 *
 * Mounted once, after authentication, in front of every /api route. Because it
 * is global rather than per-endpoint, a direct API call or a pasted URL goes
 * through exactly the same check as a button click -- hiding a control in the
 * UI is a convenience, never the control itself.
 *
 * Three modes, read from crm_rbac_settings:
 *   off     - skip entirely (the state before the migration has run)
 *   audit   - evaluate and record what WOULD be denied, then allow
 *   enforce - evaluate and deny
 *
 * `audit` is the default because flipping 262 endpoints from "any CRM role may
 * do anything" to "deny unless granted" in one step, on a live system, locks
 * people out of their own CRM. Audit first, correct the grants against real
 * traffic, then enforce.
 */
import {
  getEnforcementMode, loadUserPermissions, recordDenial,
} from './permission-service.js';
import { permissionForRequest, openRouteReason } from './route-permissions.js';

export function createRbacMiddleware(pool, logger = console) {
  return async function rbacGuard(req, res, next) {
    // Unauthenticated requests are the authentication layer's problem.
    if (!req.user?.id) return next();

    let mode;
    try {
      mode = await getEnforcementMode(pool);
    } catch {
      return next();
    }
    if (mode === 'off') return next();

    const pathname = req.baseUrl ? `${req.baseUrl}${req.path}` : req.path;
    if (openRouteReason(pathname)) return next();

    const key = permissionForRequest(req.method, pathname);
    if (key === null) return next();

    let allowed = false;
    let reason = 'unmapped_route';

    try {
      const state = await loadUserPermissions(pool, req.user.id);

      // Stash the record scope on the user so the query builders can narrow
      // rows without each of them having to await a permission lookup.
      // Only in enforce mode: in off/audit the queries must return exactly
      // what they returned before, or "audit changes nothing" would be false.
      req.user.rbacEnforced = mode === 'enforce';
      req.user.rbacScope = state.superAdmin
        ? 'all'
        : (state.permissions.get('leads.list.view')?.scope || 'none');
      // Search carries its own scope so an administrator can let someone look
      // a lead up by phone without giving them the whole list to browse --
      // the case a counsellor taking a call needs.
      req.user.rbacSearchScope = state.superAdmin
        ? 'all'
        : (state.permissions.get('leads.search.view')?.scope || 'none');

      if (state.superAdmin) {
        req.rbac = { superAdmin: true, key, scope: 'all' };
        return next();
      }
      if (key !== undefined) {
        const grant = state.permissions.get(key);
        allowed = grant?.allowed === true;
        reason = allowed ? 'allowed' : 'not_granted';
        req.rbac = { superAdmin: false, key, scope: grant?.scope || 'none' };
      }
    } catch (error) {
      logger?.warn?.(`[rbac] check failed for ${pathname}: ${error.message}`);
      // A broken check must not become an outage; audit it and let it through.
      return next();
    }

    if (allowed) return next();

    await recordDenial(pool, {
      userId: req.user.id,
      userEmail: req.user.email,
      method: req.method,
      path: pathname,
      permissionKey: key ?? null,
      reason,
      wasEnforced: mode === 'enforce',
    }, logger);

    if (mode !== 'enforce') return next();

    return res.status(403).json({
      success: false,
      error: 'You do not have permission to perform this action',
      details: key
        ? `Missing permission: ${key}`
        : 'This endpoint is not covered by any access rule',
    });
  };
}

/**
 * Per-route check, for the handful of places a single endpoint serves several
 * actions and the table cannot tell them apart.
 *
 *   router.post('/x', requirePermission(pool, 'leads.list.create'), handler)
 */
/**
 * Admins, or anyone explicitly granted this permission.
 *
 * For screens that used to be administrator-only and are now something an
 * administrator can hand to an end user -- Payments is the first. A plain role
 * check cannot express that, and `requirePermission` alone cannot replace the
 * role check yet, because the global mode defaults to `audit` and audit lets
 * everything through: swapping one for the other would quietly open the screen
 * to every CRM role until someone switches to enforce.
 *
 * So this enforces in every mode. That is safe to do here precisely because
 * these routes are admin-only today -- an admin keeps their access, and a
 * non-admin goes from "always denied" to "denied unless granted". Nothing gets
 * looser than an administrator has explicitly made it.
 */
export function requireAdminOrPermission(pool, permissionKey, logger = console) {
  const adminRoles = ['CRM_ADMIN', 'SUPER_ADMIN'];
  return async function adminOrPermissionGuard(req, res, next) {
    if (!req.user?.id) return res.status(401).json({ success: false, error: 'Not signed in' });
    if (req.user.roles?.some((role) => adminRoles.includes(role))) return next();

    try {
      const state = await loadUserPermissions(pool, req.user.id);
      if (state.superAdmin || state.permissions.get(permissionKey)?.allowed === true) {
        req.rbac = {
          superAdmin: state.superAdmin,
          key: permissionKey,
          scope: state.superAdmin ? 'all' : (state.permissions.get(permissionKey)?.scope || 'none'),
        };
        return next();
      }
    } catch (error) {
      // A lookup that fails falls back to the role check this replaced, which
      // has already said no. Denying is the safe direction here: the caller is
      // not an administrator and nothing has said they may proceed.
      logger?.warn?.(`[rbac] ${permissionKey} lookup failed: ${error.message}`);
    }

    return res.status(403).json({
      success: false,
      error: 'You do not have permission to perform this action',
      details: `Missing permission: ${permissionKey}`,
    });
  };
}

export function requirePermission(pool, permissionKey) {
  return async function permissionGuard(req, res, next) {
    if (!req.user?.id) return res.status(401).json({ success: false, error: 'Not signed in' });
    const mode = await getEnforcementMode(pool);
    if (mode === 'off') return next();

    const state = await loadUserPermissions(pool, req.user.id);
    if (state.superAdmin || state.permissions.get(permissionKey)?.allowed === true) {
      req.rbac = {
        superAdmin: state.superAdmin,
        key: permissionKey,
        scope: state.superAdmin ? 'all' : (state.permissions.get(permissionKey)?.scope || 'none'),
      };
      return next();
    }

    await recordDenial(pool, {
      userId: req.user.id, userEmail: req.user.email, method: req.method,
      path: req.originalUrl, permissionKey, reason: 'not_granted',
      wasEnforced: mode === 'enforce',
    });

    if (mode !== 'enforce') return next();
    return res.status(403).json({
      success: false,
      error: 'You do not have permission to perform this action',
      details: `Missing permission: ${permissionKey}`,
    });
  };
}
