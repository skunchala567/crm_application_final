import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from '../api';

/**
 * A branch's WhatsApp settings, inside the branch dialog.
 *
 * Two questions used to live on screens of their own under Templates: which
 * accounts a branch sends from, and what happens when an unknown number
 * messages one of them. The first is genuinely a property of the branch, so
 * it belongs here beside its calling and payment credentials.
 *
 * The second is not. crm_whatsapp_lead_intake is keyed by account, and an
 * account commonly serves many branches, so the settings shown here for the
 * branch's default account are the account's -- and they say so. Nothing is
 * written unless it is edited, precisely because a save from one branch's
 * dialog would otherwise reach every other branch on the same account.
 */
export default function BranchWhatsAppSettings({ branchId, value, onChange, meta }) {
  const [accounts, setAccounts] = useState([]);
  const [reach, setReach] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const selected = value?.accountIds || [];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [accountResult, mappingResult] = await Promise.all([
          api('/whatsapp/accounts'),
          api('/whatsapp/branch-accounts'),
        ]);
        if (cancelled) return;
        setAccounts(accountResult.data || []);

        /* How many branches each account already serves, so the intake
           settings below can say how far a change would reach. */
        const counts = {};
        for (const row of mappingResult.data || []) {
          (counts[row.integrationId] ||= new Set()).add(Number(row.branchId));
        }
        setReach(Object.fromEntries(Object.entries(counts).map(([id, set]) => [id, set.size])));

        // An existing branch starts from what it already has; the default
        // account is first, because that ordering is what the save writes back.
        const mine = branchId
          ? (mappingResult.data || [])
            .filter((row) => Number(row.branchId) === Number(branchId))
            .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0))
            .map((row) => Number(row.integrationId))
          : [];
        onChange((prev) => ({ ...(prev || {}), accountIds: mine, original: mine, loaded: true }));
      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Reloading on `onChange`/`value` would fight the edits being made here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  const defaultId = selected[0];

  /* The account's own intake settings, fetched only once a default exists and
     only to show what is already there -- never to re-save it unchanged. */
  useEffect(() => {
    if (!defaultId || value?.intake?.integrationId === defaultId) return;
    let cancelled = false;
    api(`/whatsapp/accounts/${defaultId}/lead-intake`)
      .then((result) => {
        if (cancelled) return;
        onChange((prev) => ({ ...(prev || {}), loaded: true, intake: { ...result.data, integrationId: defaultId, dirty: false } }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultId]);

  /* Order carries meaning: the first account is the branch's default, and it
     is what a counsellor here gets preselected. */
  const toggle = (id) => onChange((prev) => ({
    ...(prev || {}),
    loaded: true,
    accountIds: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id],
  }));
  const makeDefault = (id) => onChange((prev) => ({
    ...(prev || {}), loaded: true, accountIds: [id, ...selected.filter((x) => x !== id)],
  }));
  const patchIntake = (patch) => onChange((prev) => ({
    ...(prev || {}),
    loaded: true,
    intake: { ...(prev?.intake || {}), integrationId: defaultId, ...patch, dirty: true },
  }));

  if (loading) return <p className="config-hint">Loading WhatsApp accounts…</p>;
  if (error) return <p className="config-hint warning"><AlertTriangle size={13}/> {error}</p>;
  if (!accounts.length) {
    return (
      <p className="config-hint">
        No WhatsApp accounts are connected yet. Connect one under Settings → Integrations, then choose it here.
      </p>
    );
  }

  const intake = value?.intake || {};
  const mode = intake.assignmentMode || 'unassigned';
  const defaultAccount = accounts.find((a) => Number(a.id) === Number(defaultId));
  const otherBranches = defaultId ? Math.max(0, (reach[defaultId] || 0) - (selected.length ? 1 : 0)) : 0;

  // One entry per person, not one per branch they cover.
  const seen = new Set();
  const employees = (meta?.employees || []).filter((person) => {
    if (seen.has(String(person.id))) return false;
    seen.add(String(person.id));
    return true;
  });

  return (
    <>
      <p className="config-hint">
        The connected numbers this branch sends from. The first is its default — the one a counsellor
        here gets preselected.
      </p>
      <div className="branch-whatsapp-accounts">
        {accounts.map((account) => {
          const on = selected.includes(Number(account.id));
          const isDefault = Number(defaultId) === Number(account.id);
          return (
            <label key={account.id} className={`branch-whatsapp-account${on ? ' is-on' : ''}`}>
              <input type="checkbox" checked={on} onChange={() => toggle(Number(account.id))}/>
              <span>{account.name || `Account ${account.id}`}</span>
              {on && (isDefault
                ? <em className="is-default">Default</em>
                : (
                  <button type="button" className="link-btn"
                    onClick={(event) => { event.preventDefault(); makeDefault(Number(account.id)); }}>
                    Make default
                  </button>
                ))}
            </label>
          );
        })}
      </div>

      {defaultAccount && branchId && (
        <div className="branch-whatsapp-intake">
          <strong>When an unknown number messages {defaultAccount.name}</strong>
          {otherBranches > 0 && (
            <p className="config-hint warning">
              <AlertTriangle size={13}/>
              These settings belong to the account, not to this branch, and this account also serves
              {' '}{otherBranches} other branch{otherBranches === 1 ? '' : 'es'}. Changing them here changes
              them everywhere it is used.
            </p>
          )}
          <label className="branch-whatsapp-toggle">
            <input type="checkbox" checked={intake.autoCreateLead !== 0 && intake.autoCreateLead !== false}
              onChange={(event) => patchIntake({ autoCreateLead: event.target.checked })}/>
            Create a lead automatically
          </label>
          <div className="branch-field-grid">
            <label>Leads go to
              <select value={mode} onChange={(event) => patchIntake({ assignmentMode: event.target.value })}>
                <option value="unassigned">Nobody — leave unassigned</option>
                <option value="rule">Whoever the assignment rule picks</option>
                <option value="fixed">One counsellor</option>
              </select>
            </label>
            {mode === 'fixed' && (
              <label>Counsellor
                <select value={intake.ownerEmployeeId || ''}
                  onChange={(event) => patchIntake({ ownerEmployeeId: event.target.value })}>
                  <option value="">Select…</option>
                  {employees.map((person) => (
                    <option key={person.id} value={person.id}>{person.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {/* Whether a branch is fixed at all is its own question. Every
              account here currently leaves it open, and quietly closing it
              from a branch dialog would re-point the account's leads. */}
          <label className="branch-whatsapp-toggle">
            <input type="checkbox" checked={Number(intake.branchId) === Number(branchId)}
              onChange={(event) => patchIntake({ branchId: event.target.checked ? Number(branchId) : null })}/>
            Send these leads to this branch
          </label>
          {!intake.branchId && (
            <p className="config-hint">
              No branch is fixed, so a lead lands wherever the assignment rule sends it.
            </p>
          )}
          {intake.branchId && Number(intake.branchId) !== Number(branchId) && (
            <p className="config-hint warning">
              <AlertTriangle size={13}/>
              These leads are currently sent to a different branch. Tick the box above to move them here.
            </p>
          )}
        </div>
      )}
      {!branchId && selected.length > 0 && (
        <p className="config-hint">
          Save the branch to set what happens when an unknown number messages it.
        </p>
      )}
    </>
  );
}

/**
 * Persist what the section collected.
 *
 * Runs after the branch itself is saved, because a new branch has no id until
 * then. Each half is written only when it actually changed: the mapping call
 * is administrator-only, and the intake call reaches every branch sharing the
 * account, so an untouched section must stay silent rather than re-assert
 * what it happened to read.
 */
export async function saveBranchWhatsApp(branchId, businessUnitId, value) {
  if (!branchId || !value?.loaded) return;

  const before = (value.original || []).join(',');
  const after = (value.accountIds || []).join(',');
  if (before !== after) {
    await api('/whatsapp/branch-accounts', {
      method: 'PUT',
      body: JSON.stringify({ branches: [{ branchId: Number(branchId), integrationIds: value.accountIds || [] }] }),
    });
  }

  const intake = value.intake;
  if (intake?.dirty && intake.integrationId) {
    await api(`/whatsapp/accounts/${intake.integrationId}/lead-intake`, {
      method: 'PUT',
      body: JSON.stringify({
        autoCreateLead: intake.autoCreateLead !== false && intake.autoCreateLead !== 0,
        businessUnitId: Number(intake.businessUnitId) || Number(businessUnitId) || null,
        branchId: Number(intake.branchId) || null,
        assignmentMode: intake.assignmentMode || 'unassigned',
        ownerEmployeeId: intake.ownerEmployeeId ? Number(intake.ownerEmployeeId) : null,
      }),
    });
  }
}
