import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Bridges the Leads screen's bulk actions up to the topbar's quick-action menu.
 *
 * The actions themselves have to live on the Leads screen -- they operate on its
 * selection and its filtered rows -- but the button that launches them sits in
 * the header. So the screen registers a description of its actions here and the
 * header renders whatever is currently registered.
 *
 * Registration is the reason the menu is empty away from Leads: nothing else
 * registers, so the header hides the button rather than offering actions that
 * have no rows to act on.
 *
 * Two contexts, not one, on purpose. The producer (Leads) subscribes only to the
 * stable setter, so publishing a new list re-renders the header without
 * re-rendering the screen that just published it -- otherwise updating on every
 * render would loop.
 */
const ActionsContext = createContext([]);
const RegistryContext = createContext(() => {});

/** Compare the parts the header actually paints; handlers are new every render. */
function sameActions(a, b) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((action, index) => {
    const other = b[index];
    return action.key === other.key
      && action.label === other.label
      && action.title === other.title
      && action.icon === other.icon
      && Boolean(action.disabled) === Boolean(other.disabled);
  });
}

export function LeadQuickActionsProvider({ children }) {
  const [actions, setActions] = useState([]);

  // Ignore no-op publishes so a Leads re-render does not re-render the header.
  const publish = useCallback((next) => {
    setActions((current) => (sameActions(current, next) ? current : next));
  }, []);

  return (
    <RegistryContext.Provider value={publish}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </RegistryContext.Provider>
  );
}

/** Read the currently registered actions (used by the header). */
export function useLeadQuickActions() {
  return useContext(ActionsContext);
}

/**
 * Publish this screen's quick actions.
 *
 * `actions`: [{ key, label, icon, title, disabled, onSelect }]
 *
 * Deliberately runs on every render -- `disabled` tracks the live selection, so
 * a stale list would leave actions enabled with nothing selected. The equality
 * check in `publish` keeps that from causing extra work.
 */
export function useRegisterLeadQuickActions(actions) {
  const publish = useContext(RegistryContext);

  useEffect(() => { publish(actions); });

  // Separate effect: clearing belongs to unmount, not to every update.
  useEffect(() => () => publish([]), [publish]);
}
