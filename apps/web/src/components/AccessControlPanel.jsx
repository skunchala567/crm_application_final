import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Copy, Loader2, Lock,
  Plus, RefreshCw, Save,  Trash2, UserPlus, X,
} from 'lucide-react';
import { api } from '../api';
import { usePermissions } from '../PermissionContext';

/**
 * Access Control: roles, what each may do, and who holds them.
 *
 * The matrix is generated from the server's permission registry rather than a
 * list kept here, so a screen added to the CRM appears without this file
 * changing. Every control is also enforced server-side; disabling a button
 * here is only there to save someone the refusal.
 */

const SCOPE_LABELS = {
  none: 'No access',
  own: 'Own records',
  team: 'Team records',
  department: 'Department records',
  all: 'All records',
};

const PRESETS = [
  { key: 'no_access', label: 'No Access' },
  { key: 'view_only', label: 'View Only' },
  { key: 'full_access', label: 'Full Access' },
];

function Pill({ tone = 'default', children }) {
  const tones = {
    default: 'bg-secondary-100 text-secondary-600',
    green: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export default function AccessControlPanel() {
  const { can, refresh: refreshOwnPermissions } = usePermissions();
  const readOnly = !can('settings.access_control.edit');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [roles, setRoles] = useState([]);
  const [registry, setRegistry] = useState({ modules: [] });

  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [grants, setGrants] = useState({});      // { key: scope }
  const [baseline, setBaseline] = useState({});
  const [expanded, setExpanded] = useState({});
  const [roleUsers, setRoleUsers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [newRoleName, setNewRoleName] = useState('');
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);

  const selectedRole = roles.find((r) => r.id === selectedRoleId) || null;
  const dirty = useMemo(
    () => JSON.stringify(grants) !== JSON.stringify(baseline),
    [grants, baseline],
  );

  const flash = (message) => { setNotice(message); setTimeout(() => setNotice(''), 4000); };

  const loadAll = useCallback(async () => {
    setError('');
    try {
      const [rolesRes, registryRes, usersRes] = await Promise.all([
        api('/rbac/roles'),
        api('/rbac/registry'),
        api('/admin/users').catch(() => ({ data: [] })),
      ]);
      setRoles(rolesRes.data || []);
      setRegistry(registryRes.data || { modules: [] });
      setAllUsers(usersRes.data || []);
      setSelectedRoleId((current) => current ?? (rolesRes.data || []).find((r) => r.isCrmRole)?.id ?? null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Grants and members are per-role, so they reload when the selection moves.
  useEffect(() => {
    if (!selectedRoleId) return;
    let cancelled = false;
    (async () => {
      try {
        const [permissionsRes, usersRes] = await Promise.all([
          api(`/rbac/roles/${selectedRoleId}/permissions`),
          api(`/rbac/roles/${selectedRoleId}/users`),
        ]);
        if (cancelled) return;
        setGrants(permissionsRes.data || {});
        setBaseline(permissionsRes.data || {});
        setRoleUsers(usersRes.data || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedRoleId]);

  /* ---------------- grant helpers ---------------- */

  const isGranted = (key) => Object.prototype.hasOwnProperty.call(grants, key);

  const setGrant = (key, on, scope) => {
    setGrants((current) => {
      const next = { ...current };
      if (on) next[key] = scope ?? next[key] ?? 'all';
      else delete next[key];
      return next;
    });
  };

  /** Every permission key under a node of the tree. */
  const keysUnder = (node) => {
    const keys = [];
    const collect = (screen) => {
      (screen.actions || []).forEach((a) => keys.push(a));
      (screen.tabs || []).forEach((tab) => (tab.actions || []).forEach((a) => keys.push(a)));
    };
    if (node.screens) node.screens.forEach(collect);
    else if (node.tabs || node.actions) collect(node);
    else if (node.actions) node.actions.forEach((a) => keys.push(a));
    return keys;
  };

  const applyPreset = (node, preset) => {
    const entries = keysUnder(node);
    setGrants((current) => {
      const next = { ...current };
      for (const entry of entries) {
        if (preset === 'no_access') delete next[entry.key];
        else if (preset === 'full_access') next[entry.key] = entry.isScoped ? 'all' : 'none';
        else if (preset === 'view_only') {
          if (entry.action === 'view') next[entry.key] = entry.isScoped ? 'all' : 'none';
          else delete next[entry.key];
        }
      }
      return next;
    });
  };

  const applyGlobalPreset = (preset) => {
    registry.modules.forEach((mod) => applyPreset(mod, preset));
  };

  /* ---------------- actions ---------------- */

  async function createRole() {
    const name = newRoleName.trim();
    if (!name) return;
    setCreating(true);
    // A new role deliberately starts empty: nothing is granted until an
    // administrator ticks it, so a role can never be created with more
    // access than was intended.
    await act(
      () => api('/rbac/roles', { method: 'POST', body: JSON.stringify({ name }) }),
      `Role "${name}" created with no permissions`,
    );
    setNewRoleName('');
    setAdding(false);
    setCreating(false);
  }

  async function saveGrants() {
    if (!selectedRole) return;
    setSaving(true);
    setError('');
    try {
      const result = await api(`/rbac/roles/${selectedRole.id}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ permissions: grants }),
      });
      setBaseline(grants);
      flash(`Saved: ${result.data.added} added, ${result.data.removed} removed`);
      await loadAll();
      await refreshOwnPermissions();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function act(fn, successMessage) {
    setError('');
    try {
      await fn();
      flash(successMessage);
      await loadAll();
      await refreshOwnPermissions();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-secondary-500">
        <Loader2 className="animate-spin mr-2" size={18} /> Loading access control…
      </div>
    );
  }

  // Attendance-owned roles are deliberately dropped rather than listed and
  // disabled: this screen configures CRM access and cannot edit them.
  const crmRoles = roles.filter((r) => r.isCrmRole);

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
          <CheckCircle2 size={16} /> {notice}
        </div>
      )}

      {/* Role picker and creation, right-aligned above the matrix.
          The options carry the role name only: user and permission counts
          belong with the role they describe, not repeated down a list you
          are scanning to make one choice. They appear under the role title
          below instead. */}
      <div className="flex items-center justify-end gap-2 flex-wrap">
        {adding ? (
          <>
            <input
              className="input w-[220px]"
              autoFocus
              value={newRoleName}
              placeholder="New role name"
              onChange={(event) => setNewRoleName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') createRole();
                if (event.key === 'Escape') { setAdding(false); setNewRoleName(''); }
              }}
            />
            <span className="text-xs text-secondary-500">Starts with no permissions</span>
            <button className="primary" disabled={!newRoleName.trim() || creating} onClick={createRole}>
              {creating ? <Loader2 size={14} className="animate-spin" /> : 'Create'}
            </button>
            <button className="secondary" onClick={() => { setAdding(false); setNewRoleName(''); }}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <select
              className="input w-[240px]"
              aria-label="Role"
              value={selectedRoleId ?? ''}
              onChange={(event) => setSelectedRoleId(Number(event.target.value) || null)}
            >
              {/* CRM roles only. The Attendance application's roles used to
                  be listed underneath as disabled entries "for context", but
                  a picker exists to be picked from -- four greyed-out lines
                  nobody can choose only made the list longer. */}
              <option value="">Select a role…</option>
              {crmRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}{role.isActive ? '' : ' (inactive)'}
                </option>
              ))}
            </select>

            {!readOnly && can('settings.access_control.create') && (
              <button className="primary inline-flex items-center gap-2" onClick={() => setAdding(true)}>
                <Plus size={15} /> Add new role
              </button>
            )}

            <button
              className="secondary grid place-items-center w-[38px]"
              title="Reload roles and permissions"
              aria-label="Refresh"
              onClick={loadAll}
            >
              <RefreshCw size={14} />
            </button>
          </>
        )}
      </div>

      <div className="grid gap-4 items-start">
        {/* ---------------- matrix ---------------- */}
        <section className="panel card min-w-0">
          {!selectedRole ? (
            <p className="text-sm text-secondary-600">Select a role to configure its access.</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
                <div className="min-w-0">
                  <h3 className="card-title flex items-center gap-2">
                    {selectedRole.name}
                    {selectedRole.isSuperAdmin && <Pill tone="green"><Lock size={10} />Protected</Pill>}
                  </h3>
                  <p className="text-xs text-secondary-500 mt-0.5">
                    {selectedRole.userCount} user{selectedRole.userCount === 1 ? '' : 's'}
                    {' · '}{selectedRole.grantCount} permission{selectedRole.grantCount === 1 ? '' : 's'}
                    {selectedRole.description ? ` · ${selectedRole.description}` : ''}
                  </p>
                </div>
                {!readOnly && !selectedRole.isSuperAdmin && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      className="secondary text-xs"
                      onClick={() => act(
                        () => api(`/rbac/roles/${selectedRole.id}/clone`, {
                          method: 'POST', body: JSON.stringify({ name: `${selectedRole.name} copy` }),
                        }),
                        `Cloned "${selectedRole.name}"`,
                      )}
                    >
                      <Copy size={13} /> Clone
                    </button>
                    <button
                      className="secondary text-xs"
                      onClick={() => act(
                        () => api(`/rbac/roles/${selectedRole.id}`, {
                          method: 'PATCH', body: JSON.stringify({ isActive: !selectedRole.isActive }),
                        }),
                        selectedRole.isActive ? 'Role deactivated' : 'Role activated',
                      )}
                    >
                      {selectedRole.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    {can('settings.access_control.delete') && (
                      <button
                        className="secondary text-xs"
                        onClick={() => {
                          if (!window.confirm(`Delete the role "${selectedRole.name}"? This cannot be undone.`)) return;
                          act(
                            () => api(`/rbac/roles/${selectedRole.id}`, { method: 'DELETE' }),
                            `Deleted "${selectedRole.name}"`,
                          ).then(() => setSelectedRoleId(null));
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {selectedRole.isSuperAdmin ? (
                <div className="mt-4 p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
                  <strong>Super Admin has unrestricted access.</strong> Its permissions are not
                  editable and it cannot be deleted or deactivated, so there is always a way back
                  in if another role is misconfigured.
                </div>
              ) : (
                <>
                  {/* Quick options */}
                  {!readOnly && (
                    <div className="flex items-center gap-2 flex-wrap mt-3 mb-1 pb-3 border-b border-border">
                      <span className="text-xs font-semibold text-secondary-600">Apply to everything:</span>
                      {PRESETS.map((preset) => (
                        <button key={preset.key} className="secondary text-xs" onClick={() => applyGlobalPreset(preset.key)}>
                          {preset.label}
                        </button>
                      ))}
                      <span className="text-xs text-secondary-400">or set each row below (Custom)</span>
                    </div>
                  )}

                  <div className="space-y-2 mt-3">
                    {registry.modules.map((mod) => {
                      const open = expanded[mod.module] !== false;
                      const modKeys = keysUnder(mod);
                      const grantedCount = modKeys.filter((k) => isGranted(k.key)).length;
                      return (
                        <div key={mod.module} className="border border-border rounded-lg overflow-hidden">
                          <div className="flex items-center gap-2 px-3 py-2 bg-surface-3 border-b border-border">
                            <button
                              className="text-secondary-500"
                              onClick={() => setExpanded((e) => ({ ...e, [mod.module]: !open }))}
                              aria-label={open ? 'Collapse' : 'Expand'}
                            >
                              {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                            </button>
                            <span className="font-semibold text-sm flex-1">{mod.label}</span>
                            <span className="text-[11px] text-secondary-500">
                              {grantedCount}/{modKeys.length}
                            </span>
                            {!readOnly && PRESETS.map((preset) => (
                              <button
                                key={preset.key}
                                className="text-[11px] px-1.5 py-0.5 rounded border border-border bg-white hover:bg-primary-50"
                                onClick={() => applyPreset(mod, preset.key)}
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>

                          {open && (
                            <div className="divide-y divide-border">
                              {mod.screens.map((screen) => (
                                <ScreenRow
                                  key={screen.screen}
                                  screen={screen}
                                  grants={grants}
                                  isGranted={isGranted}
                                  setGrant={setGrant}
                                  readOnly={readOnly}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {!readOnly && (
                    <div className="flex items-center gap-3 mt-4 pt-3 border-t border-border">
                      <button className="primary inline-flex items-center gap-2" onClick={saveGrants} disabled={saving || !dirty}>
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        Save permissions
                      </button>
                      {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
                    </div>
                  )}
                </>
              )}

              {/* ---------------- members ---------------- */}
              <div className="mt-6 pt-4 border-t border-border">
                <h4 className="font-semibold text-sm mb-2">
                  Users with this role ({roleUsers.length})
                </h4>
                {roleUsers.length === 0 && (
                  <p className="text-xs text-secondary-500 mb-2">Nobody has this role yet.</p>
                )}
                <div className="flex flex-wrap gap-2 mb-3">
                  {roleUsers.map((user) => (
                    <span key={user.id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-3 border border-border text-xs">
                      {user.name}
                      {!readOnly && can('settings.access_control.assign') && (
                        <button
                          className="text-secondary-400 hover:text-red-600"
                          title={`Remove ${user.name}`}
                          onClick={() => act(
                            () => api(`/rbac/roles/${selectedRole.id}/users/${user.id}`, { method: 'DELETE' }),
                            `Removed ${user.name}`,
                          )}
                        ><X size={12} /></button>
                      )}
                    </span>
                  ))}
                </div>
                {!readOnly && can('settings.access_control.assign') && (
                  <div className="flex gap-2 flex-wrap">
                    <select
                      className="input max-w-xs"
                      defaultValue=""
                      onChange={(e) => {
                        const userId = e.target.value;
                        e.target.value = '';
                        if (!userId) return;
                        act(
                          () => api(`/rbac/roles/${selectedRole.id}/users`, {
                            method: 'POST', body: JSON.stringify({ userId: Number(userId) }),
                          }),
                          'Role assigned',
                        );
                      }}
                    >
                      <option value="">Assign a user…</option>
                      {allUsers
                        .filter((u) => !roleUsers.some((ru) => ru.id === u.id))
                        .map((u) => (
                          <option key={u.id} value={u.id}>{u.name || u.email}</option>
                        ))}
                    </select>
                    <span className="inline-flex items-center gap-1 text-xs text-secondary-500">
                      <UserPlus size={13} /> Assignment takes effect immediately
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** One screen and its tabs, with a checkbox per action and a scope selector. */
function ScreenRow({ screen, grants, isGranted, setGrant, readOnly }) {
  const renderActions = (actions, label) => (
    <div className="flex items-start gap-3 flex-wrap py-1.5">
      <span className="text-xs text-secondary-600 w-40 shrink-0 pt-0.5">{label}</span>
      <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">
        {actions.map((entry) => (
          <label key={entry.key} className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              disabled={readOnly}
              checked={isGranted(entry.key)}
              onChange={(e) => setGrant(entry.key, e.target.checked)}
            />
            <span className="capitalize">{entry.action}</span>
            {entry.isScoped && isGranted(entry.key) && (
              <select
                className="input py-0 text-[11px] h-6 w-[136px]"
                disabled={readOnly}
                value={grants[entry.key] || 'all'}
                onChange={(e) => setGrant(entry.key, true, e.target.value)}
                title="Which records this applies to"
              >
                {Object.entries(SCOPE_LABELS)
                  .filter(([value]) => value !== 'none')
                  .map(([value, text]) => <option key={value} value={value}>{text}</option>)}
              </select>
            )}
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div className="px-3 py-2">
      {screen.actions?.length > 0 && renderActions(screen.actions, screen.label)}
      {screen.tabs?.map((tab) => (
        <div key={tab.tab} className="pl-4 border-l-2 border-border ml-2">
          {renderActions(tab.actions, `${tab.label}`)}
        </div>
      ))}
    </div>
  );
}
