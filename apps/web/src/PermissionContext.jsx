import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';

/**
 * What the signed-in user may do, loaded once per session from /rbac/me.
 *
 * The server decides; this only mirrors the decision so the interface can stop
 * offering actions that would be refused. Hiding a button is a courtesy, not a
 * control -- the same check runs again on every request, so a user who reaches
 * a route by typing its URL is refused there.
 */
const PermissionContext = createContext({
  ready: false,
  superAdmin: false,
  enforcementMode: 'audit',
  permissions: {},
  roles: [],
  can: () => true,
  scopeOf: () => 'none',
  refresh: () => {},
});

export function PermissionProvider({ children }) {
  const [state, setState] = useState({
    ready: false, superAdmin: false, enforcementMode: 'audit', permissions: {}, roles: [],
  });

  const load = useCallback(async () => {
    try {
      const result = await api('/rbac/me');
      const data = result?.data || {};
      setState({
        ready: true,
        superAdmin: Boolean(data.superAdmin),
        enforcementMode: data.enforcementMode || 'audit',
        permissions: data.permissions || {},
        roles: data.roles || [],
      });
    } catch {
      // The endpoint is unreachable, or the migration has not run. Fall back to
      // permissive: this layer must never be the reason a working CRM goes
      // blank, and the server is still the thing that actually decides.
      setState((prev) => ({ ...prev, ready: true, enforcementMode: 'off' }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const value = useMemo(() => {
    const { permissions, superAdmin, enforcementMode, ready, roles } = state;

    /** hasPermission(user, 'leads.edit') -- never a role-name comparison. */
    const can = (key) => {
      if (!key) return true;
      if (superAdmin) return true;
      // In off/audit the server is not refusing anything, so the UI should not
      // either; hiding controls that still work would only confuse people.
      if (enforcementMode !== 'enforce') return true;
      return Object.prototype.hasOwnProperty.call(permissions, key);
    };

    const scopeOf = (key) => (superAdmin ? 'all' : permissions[key] || 'none');

    /** True when any listed permission is held. Useful for "show this screen". */
    const canAny = (...keys) => keys.flat().some((key) => can(key));

    return { ready, superAdmin, enforcementMode, permissions, roles, can, canAny, scopeOf, refresh: load };
  }, [state, load]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissions() {
  return useContext(PermissionContext);
}

/** Convenience for the common single-key case. */
export function useCan(key) {
  return usePermissions().can(key);
}
