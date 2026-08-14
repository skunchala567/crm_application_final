import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, UserCheck } from 'lucide-react';
import { api } from '../api';

/**
 * What happens when someone messages a WhatsApp account for the first time.
 *
 * The webhook already creates a lead from an unknown number, but with no
 * branch and no owner -- and a lead with no branch is filtered out of every
 * counsellor's list, so those enquiries were only visible to an administrator
 * who went looking. This says which branch they belong to and who picks them
 * up, per connected account.
 */
export default function WhatsAppLeadIntake({ onMessage }) {
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [units, setUnits] = useState([]);
  const [settings, setSettings] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accountResult, meta] = await Promise.all([
        api('/whatsapp/integrations?provider=SMARTPING'),
        api('/leads/meta'),
      ]);
      const live = (accountResult.data || []).filter(account => account.has_credentials);
      setAccounts(live);
      setBranches(meta.branches || []);
      // One entry per person, not per branch they cover.
      const seen = new Set();
      setEmployees((meta.employees || []).filter(person => {
        if (seen.has(String(person.id))) return false;
        seen.add(String(person.id));
        return true;
      }));
      const unitList = await api('/platform/business-units').catch(() => ({ data: [] }));
      setUnits(unitList.data || []);
      const loaded = await Promise.all(live.map(account =>
        api(`/whatsapp/accounts/${account.id}/lead-intake`)
          .then(result => [account.id, { ...result.data, mappedBranches: result.mappedBranches || [] }])
          .catch(() => [account.id, null])));
      setSettings(Object.fromEntries(loaded.filter(([, value]) => value)));
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  }, [onMessage]);

  useEffect(() => { load(); }, [load]);

  const patch = (id, changes) =>
    setSettings(current => ({ ...current, [id]: { ...current[id], ...changes } }));

  async function save(account) {
    const value = settings[account.id];
    setSavingId(account.id);
    try {
      await api(`/whatsapp/accounts/${account.id}/lead-intake`, {
        method: 'PUT',
        body: JSON.stringify({
          autoCreateLead: value.autoCreateLead !== 0 && value.autoCreateLead !== false,
          businessUnitId: value.businessUnitId || null,
          branchId: value.branchId || null,
          assignmentMode: value.assignmentMode || 'unassigned',
          ownerEmployeeId: value.ownerEmployeeId || null,
        }),
      });
      onMessage?.({ type: 'success', text: `${account.name} lead intake saved` });
      await load();
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    } finally {
      setSavingId(null);
    }
  }

  if (loading) return <div className="loading"><span /></div>;

  return (
    <section className="whatsapp-intake">
      <header>
        <div>
          <strong>Lead intake</strong>
          <span>A message from a number with no lead becomes one. Say where it lands and who owns it.</span>
        </div>
      </header>

      {accounts.map(account => {
        const value = settings[account.id] || {};
        const on = value.autoCreateLead !== 0 && value.autoCreateLead !== false;
        const mode = value.assignmentMode || 'unassigned';
        const suggested = (value.mappedBranches || []).map(branch => branch.name).join(', ');
        return (
          <article key={account.id} className="whatsapp-intake-card">
            <div className="whatsapp-intake-head">
              <strong>{account.name}</strong>
              <label className="config-check">
                <input type="checkbox" checked={on} onChange={event => patch(account.id, { autoCreateLead: event.target.checked })} />
                Create a lead from a new number
              </label>
            </div>

            {on && <div className="whatsapp-intake-grid">
              <label>
                Business unit
                <select value={value.businessUnitId || ''} onChange={event => patch(account.id, { businessUnitId: event.target.value })}>
                  <option value="">Default business unit</option>
                  {units.map(unit => <option key={unit.id} value={unit.id}>{unit.displayName || unit.name}</option>)}
                </select>
              </label>

              <label>
                Branch
                <select value={value.branchId || ''} onChange={event => patch(account.id, { branchId: event.target.value })}>
                  <option value="">No branch — only administrators will see these</option>
                  {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
                {suggested && <small>This account already sends from {suggested}.</small>}
              </label>

              <label>
                Assign to
                <select value={mode} onChange={event => patch(account.id, { assignmentMode: event.target.value })}>
                  <option value="rule">Use assignment rules</option>
                  <option value="fixed">A specific counsellor</option>
                  <option value="unassigned">Leave unassigned</option>
                </select>
                {mode === 'rule' && <small>Automations &rarr; Assignment rules, matched on this branch and the WhatsApp source.</small>}
              </label>

              {mode === 'fixed' && <label>
                Counsellor
                <select value={value.ownerEmployeeId || ''} onChange={event => patch(account.id, { ownerEmployeeId: event.target.value })}>
                  <option value="">Select a counsellor</option>
                  {employees.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select>
              </label>}
            </div>}

            <div className="whatsapp-intake-actions">
              {on && !value.branchId && <span className="whatsapp-intake-warning"><UserCheck size={14} /> Without a branch these leads stay hidden from counsellors.</span>}
              <button className="primary" disabled={savingId === account.id} onClick={() => save(account)}>
                {savingId === account.id ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
                {savingId === account.id ? 'Saving…' : 'Save'}
              </button>
            </div>
          </article>
        );
      })}

      {!accounts.length && <div className="empty"><strong>No connected WhatsApp accounts</strong></div>}
    </section>
  );
}
