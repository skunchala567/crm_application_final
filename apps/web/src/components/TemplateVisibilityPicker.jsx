import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Search, Users } from 'lucide-react';
import { api } from '../api';

/**
 * Who may use a template.
 *
 * A template with nobody selected is visible to administrators only -- that
 * is how the visibility gate has always behaved, but until now there was no
 * field to select anyone, so every template created was invisible to the
 * counsellors meant to send it.
 *
 * Used on create and on edit; `value` is an array of user ids.
 */
export default function TemplateVisibilityPicker({ value = [], onChange, disabled = false }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    // The Meta lookup already returns exactly the CRM-active users, which is
    // the same set that can log in and send.
    api('/meta/lookups')
      .then((result) => { if (!cancelled) setUsers(result.data?.users || []); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((user) =>
      `${user.name} ${user.email}`.toLowerCase().includes(term));
  }, [users, search]);

  const toggle = (id) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  return (
    <section className="panel card">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h3 className="card-title inline-flex items-center gap-2">
          <Users size={16} className="text-primary-600" /> Who can use this template
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="secondary text-xs"
            disabled={disabled || !users.length}
            onClick={() => onChange(users.map((user) => user.id))}
          >
            Select all
          </button>
          <button
            type="button"
            className="secondary text-xs"
            disabled={disabled || !value.length}
            onClick={() => onChange([])}
          >
            Clear
          </button>
        </div>
      </div>

      <p className="text-xs text-secondary-500 mb-3">
        Counsellors only see templates selected here. Administrators always see
        every template.
      </p>

      {error && (
        <p className="text-xs text-red-600 mb-2">{error}</p>
      )}

      {value.length === 0 && !loading && (
        <div className="flex items-start gap-2 p-2.5 mb-3 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Nobody selected. This template will be usable by administrators only —
            counsellors will not see it in the send screen.
          </span>
        </div>
      )}

      {users.length > 6 && (
        <div className="relative mb-2">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary-400" />
          <input
            className="input pl-8"
            placeholder="Search users…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-secondary-500 py-3">Loading users…</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((user) => (
            <label
              key={user.id}
              className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                value.includes(user.id)
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-border hover:bg-surface-3'
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5"
                disabled={disabled}
                checked={value.includes(user.id)}
                onChange={() => toggle(user.id)}
              />
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold text-foreground truncate">{user.name}</span>
                <span className="block text-[11px] text-secondary-500 truncate">{user.email}</span>
              </span>
            </label>
          ))}
          {!visible.length && (
            <p className="text-sm text-secondary-500 py-2">No users match “{search}”.</p>
          )}
        </div>
      )}

      <p className="text-[11px] text-secondary-400 mt-3">
        {value.length} of {users.length} users selected
      </p>
    </section>
  );
}
