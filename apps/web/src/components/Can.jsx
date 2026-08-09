import { ShieldOff } from 'lucide-react';
import { usePermissions } from '../PermissionContext';

/**
 * Render children only when the permission is held.
 *
 *   <Can do="leads.list.create"><button>Add lead</button></Can>
 *   <Can any={['reports.list.view','reports.saved.view']}>...</Can>
 *
 * `fallback` renders instead when the permission is missing; without one the
 * children are simply absent.
 */
export function Can({ do: key, any, all, fallback = null, children }) {
  const { can } = usePermissions();

  let allowed = true;
  if (key) allowed = can(key);
  else if (any) allowed = any.some((k) => can(k));
  else if (all) allowed = all.every((k) => can(k));

  if (!allowed) return fallback;
  return typeof children === 'function' ? children() : children;
}

/**
 * Route-level guard. Shows a refusal rather than a blank screen, so a user who
 * follows a stale link understands what happened instead of assuming a bug.
 *
 * The server refuses the underlying API calls regardless; this only avoids
 * rendering a screen that would fill with errors.
 */
export function RequirePermission({ do: key, any, children }) {
  const { can, ready } = usePermissions();
  if (!ready) return null;

  const allowed = key ? can(key) : any ? any.some((k) => can(k)) : true;
  if (allowed) return children;

  return (
    <div className="grid place-items-center py-20 px-6 text-center">
      <span className="grid place-items-center w-14 h-14 rounded-2xl bg-secondary-100 text-secondary-400 mb-4">
        <ShieldOff size={24} />
      </span>
      <h2 className="font-display font-bold text-lg text-foreground mb-1">
        You do not have access to this screen
      </h2>
      <p className="text-sm text-secondary-500 max-w-sm">
        Ask a CRM administrator to grant your role access under
        Settings &rarr; User Management &rarr; Access Control.
      </p>
    </div>
  );
}
