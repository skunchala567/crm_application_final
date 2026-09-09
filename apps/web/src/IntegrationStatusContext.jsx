import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { useBusinessUnit } from './BusinessUnitContext.jsx';

/**
 * Which integrations the current business unit has switched on.
 *
 * An integration can be switched off in Settings -> Integrations without being
 * deleted: the credentials, the call history and the branch and user mappings
 * all stay, and switching it back on restores it exactly as it was. What
 * changes while it is off is that it stops appearing anywhere else -- the
 * Smartflo DID pickers on a branch, the CallerDesk member mapping on a CRM
 * user, the BonVoice option on a lead's call button.
 *
 * The screens that consume this only *mention* an integration; they have no
 * business loading its credentials to find out whether it is on, so this is
 * one credential-free request for the whole app rather than a /config call per
 * provider on every screen.
 *
 * Hiding a field is a courtesy, not a control. The provider routes refuse to
 * dial, send or sync through an account that is switched off, so a user who
 * reaches one another way is still refused there.
 */
const IntegrationStatusContext = createContext(null);

/** provider (as stored in crm_integrations.provider) -> status, or {} until loaded. */
export function IntegrationStatusProvider({ children }) {
  const { selectedId } = useBusinessUnit();
  const [statuses, setStatuses] = useState({});
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api('/hub/integrations/provider-statuses');
      setStatuses(result?.data || {});
    } catch {
      // Unreachable endpoint must never be the reason a working screen loses
      // its fields: an empty map reads as "nothing is switched off".
      setStatuses({});
    } finally {
      setReady(true);
    }
  }, []);

  // Integrations belong to a business unit, so switching unit reloads them.
  useEffect(() => { load(); }, [load, selectedId]);

  const value = useMemo(() => {
    /** 'active' | 'inactive' | 'error' | 'pending_auth', or undefined when the unit has never configured this provider. */
    const statusOf = (provider) => statuses[String(provider || '').toLowerCase()];

    /*
     * Hide only what was deliberately switched off.
     *
     * A provider that was never configured is left alone -- those screens
     * already say "CallerDesk is not configured" and offer the way to connect
     * it, and swallowing that message would leave an administrator with no
     * clue where the fields went. 'error' stays visible too: it means the
     * account is on but failing, which is exactly when it needs looking at.
     */
    const isOff = (provider) => statusOf(provider) === 'inactive';

    /** Configured and not switched off. */
    const isOn = (provider) => Boolean(statusOf(provider)) && !isOff(provider);

    return { ready, statuses, statusOf, isOff, isOn, refresh: load };
  }, [ready, statuses, load]);

  return <IntegrationStatusContext.Provider value={value}>{children}</IntegrationStatusContext.Provider>;
}

/**
 * Usable outside the provider -- the public enquiry and payment screens render
 * without one -- where it reports every integration as neither on nor off, so
 * nothing is hidden.
 */
export function useIntegrationStatus() {
  return useContext(IntegrationStatusContext) || {
    ready: false,
    statuses: {},
    statusOf: () => undefined,
    isOff: () => false,
    isOn: () => false,
    refresh: () => {},
  };
}
