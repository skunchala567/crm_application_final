import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Save, Search, Smartphone } from 'lucide-react';
import { api } from '../api';

/**
 * Which WhatsApp account each branch sends from.
 *
 * Laid out branch by branch, because that is the question being answered:
 * "this branch sends from which number". Listing accounts and ticking
 * branches under each meant reading three lists to work out one branch, and
 * repeated all twenty branches three times.
 *
 * A branch may carry more than one account; the first selected is its
 * default, which is what a counsellor there gets preselected.
 */
export default function WhatsAppBranchMapping({ onMessage }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [search, setSearch] = useState('');
  // { [branchId]: [integrationId, ...] } -- order matters, first is default.
  const [mapping, setMapping] = useState({});
  const [baseline, setBaseline] = useState({});

  const load = useCallback(async () => {
    setError('');
    try {
      const [accountRes, branchRes, mappingRes] = await Promise.all([
        api('/whatsapp/accounts'),
        api('/branches'),
        api('/whatsapp/branch-accounts'),
      ]);
      setAccounts(accountRes.data || []);
      setBranches(branchRes.data || []);

      const next = {};
      for (const row of mappingRes.data || []) {
        (next[row.branchId] ||= []).push(row.integrationId);
      }
      setMapping(next);
      setBaseline(JSON.parse(JSON.stringify(next)));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Appending rather than inserting keeps the first choice as the default. */
  const toggle = (branchId, integrationId) => {
    setMapping((current) => {
      const list = current[branchId] || [];
      return {
        ...current,
        [branchId]: list.includes(integrationId)
          ? list.filter((id) => id !== integrationId)
          : [...list, integrationId],
      };
    });
  };

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api('/whatsapp/branch-accounts', {
        method: 'PUT',
        body: JSON.stringify({
          branches: branches.map((branch) => ({
            branchId: Number(branch.id),
            integrationIds: mapping[Number(branch.id)] || [],
          })),
        }),
      });
      setBaseline(JSON.parse(JSON.stringify(mapping)));
      onMessage?.({ type: 'success', text: 'Branch mapping saved' });
      await load();
    } catch (err) {
      setError(err.message);
      onMessage?.({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return branches;
    return branches.filter((branch) =>
      String(branch.branch_name || branch.name || '').toLowerCase().includes(term));
  }, [branches, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-secondary-500">
        <Loader2 className="animate-spin mr-2" size={18} /> Loading branches and accounts…
      </div>
    );
  }

  const dirty = JSON.stringify(mapping) !== JSON.stringify(baseline);
  const unmapped = branches.filter((b) => !(mapping[Number(b.id)] || []).length);

  return (
    <div className="space-y-4 py-4">
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-secondary-600 max-w-2xl">
          Choose the WhatsApp account each branch sends from. Counsellors at a branch
          are offered its accounts, and templates are filtered to that account.
          Where a branch has more than one, the first is its default.
        </p>
        <div className="flex items-center gap-2 flex-none">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary-400" />
            <input
              className="input pl-8 w-[220px]"
              placeholder="Search branches…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <button className="primary inline-flex items-center gap-2" disabled={!dirty || saving} onClick={save}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
        </div>
      </div>

      {unmapped.length > 0 && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>{unmapped.length} branch{unmapped.length === 1 ? '' : 'es'} have no WhatsApp account.</strong>{' '}
            Counsellors there cannot send messages: {unmapped.map((b) => b.branch_name || b.name).join(', ')}
          </span>
        </div>
      )}

      {accounts.length === 0 ? (
        <p className="text-sm text-secondary-600">No WhatsApp accounts are connected yet.</p>
      ) : (
        <section className="panel card p-0 overflow-hidden">
          <div className="hidden sm:flex items-center gap-3 px-4 py-2.5 bg-surface-3 border-b border-border text-[11px] font-bold uppercase tracking-wide text-secondary-500">
            <span className="w-[220px] flex-none">Branch</span>
            <span>WhatsApp accounts</span>
          </div>

          <div className="divide-y divide-border">
            {visible.map((branch) => {
              const id = Number(branch.id);
              const selected = mapping[id] || [];
              return (
                <div key={id} className="flex items-start gap-3 px-4 py-2.5 flex-wrap sm:flex-nowrap">
                  <div className="w-[220px] flex-none min-w-0">
                    <div className="text-[13px] font-semibold text-foreground truncate">
                      {branch.branch_name || branch.name}
                    </div>
                    {selected.length === 0 && (
                      <div className="text-[11px] text-amber-700">No account</div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                    {accounts.map((account) => {
                      const on = selected.includes(account.id);
                      const isDefault = on && selected[0] === account.id;
                      return (
                        <button
                          key={account.id}
                          type="button"
                          onClick={() => toggle(id, account.id)}
                          aria-pressed={on}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11.5px] font-semibold transition-colors ${
                            on
                              ? 'border-primary-500 bg-primary-50 text-primary-700'
                              : 'border-border text-secondary-500 hover:bg-surface-3'
                          }`}
                        >
                          <Smartphone size={12} />
                          {account.name}
                          {/* Only meaningful when a branch carries more than one. */}
                          {isDefault && selected.length > 1 && (
                            <span className="text-[9.5px] font-bold uppercase text-primary-600">default</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {!visible.length && (
              <p className="px-4 py-6 text-sm text-secondary-500 text-center">No branches match “{search}”.</p>
            )}
          </div>
        </section>
      )}

      <div className="flex items-center gap-3">
        {dirty
          ? <span className="text-xs text-amber-700">Unsaved changes</span>
          : <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 size={13} /> Saved</span>}
        <span className="text-xs text-secondary-500 ml-auto">
          {branches.length - unmapped.length} of {branches.length} branches mapped
        </span>
      </div>
    </div>
  );
}
