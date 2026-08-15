/**
 * Which branches a user may see, in a form any route file can use.
 *
 * The rule already existed as `scopedWhere` inside app.js, but app.js exports
 * nothing, so every route file extracted out of it -- payments, payment forms,
 * enquiry forms -- had no way to reach it and simply filtered by business unit
 * instead. That is how a counsellor at one branch could read another branch's
 * collections. Same rule, in a module, so there is one definition of "your
 * branches" rather than one per file that remembers to write it.
 *
 * Branch grants come from crm_user_branches and are baked into the JWT at
 * login, so `user.branchIds` is what these read.
 */

const UNRESTRICTED_ROLES = ['CRM_ADMIN', 'SUPER_ADMIN'];

/** The caller's branch ids, as clean numbers. */
export function branchIdsOf(user) {
  return Array.isArray(user?.branchIds)
    ? user.branchIds.map(Number).filter(Number.isFinite)
    : [];
}

/**
 * True when this user is not limited to particular branches.
 *
 * An administrator given no branches has not been shut out of all of them --
 * "no branches listed" means "not restricted" for an admin, and "nothing" for
 * everyone else. This is the distinction the whole helper turns on.
 */
export function isUnrestricted(user) {
  return Boolean(user?.roles?.some((role) => UNRESTRICTED_ROLES.includes(role)))
    && branchIdsOf(user).length === 0;
}

/**
 * A WHERE fragment limiting `column` to the caller's branches.
 *
 * Always returns a complete boolean expression, so it can be ANDed without
 * checking whether it applies. `includeNull` also admits rows whose branch is
 * still unset -- WhatsApp intake creates leads with no branch when no
 * assignment rule matches, and an admin should see the money they pay rather
 * than have it disappear from a report.
 */
export function branchScopeSql(user, column, { includeNull = false } = {}) {
  if (isUnrestricted(user)) return { sql: '1=1', params: [] };
  const branchIds = branchIdsOf(user);
  if (!branchIds.length) return { sql: '1=0', params: [] };
  const inList = `${column} IN (${branchIds.map(() => '?').join(',')})`;
  // A restricted user gets only their branches; an unassigned row belongs to
  // nobody in particular, so it stays with the administrators.
  return { sql: includeNull ? `(${inList} OR ${column} IS NULL)` : inList, params: branchIds };
}

/**
 * Scope for a *reference list* -- "which branches exist" -- rather than for
 * records belonging to a branch.
 *
 * Naming a branch is not access to it. An administrator mapping WhatsApp
 * accounts or building an enquiry form needs to see all twenty branches even
 * when only four are assigned to them, or the interface hides options they are
 * entitled to choose; that is a deliberate decision recorded on the branches
 * endpoint in app.js. An end user is a different matter -- for them a branch
 * they do not have should not appear in a picker at all.
 *
 * So: administrators by role see everything here, everyone else sees their own.
 * Use this only for pickers. Anything carrying a branch's own data -- payment
 * credentials, DIDs, collections, submissions -- takes branchScopeSql instead,
 * where an administrator's branch grants do bound what they see.
 */
export function referenceBranchScopeSql(user, column) {
  if (user?.roles?.some((role) => UNRESTRICTED_ROLES.includes(role))) {
    return { sql: '1=1', params: [] };
  }
  return branchScopeSql(user, column);
}

/** Whether this user may act on one particular branch. */
export function canAccessBranch(user, branchId) {
  const id = Number(branchId);
  if (!Number.isFinite(id)) return false;
  if (isUnrestricted(user)) return true;
  return branchIdsOf(user).includes(id);
}

/**
 * Guard for a branch id arriving in a request body.
 *
 * Returns an error message to send back, or null when the branch is allowed.
 * Reads as a sentence at the call site: `const denied = denyBranch(...)`.
 */
export function denyBranch(user, branchId) {
  return canAccessBranch(user, branchId) ? null : 'You do not have access to that branch';
}
