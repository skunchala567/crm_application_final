/**
 * Which integration account a request may use.
 *
 * crm_integrations.business_unit_id names the unit an account belongs to, and
 * every lookup that picks an account for a screen has to respect it: a unit
 * must never reach the Smartflo, WhatsApp or SMTP credentials another unit
 * configured. Accounts are looked up by (organization, unit, provider) rather
 * than by (organization, provider) as they once were.
 *
 * NULL business_unit_id means an account deliberately shared with every unit.
 * Nothing creates one now, but rows predating this column can carry it, so a
 * lookup accepts a shared account and prefers the unit's own when both exist.
 *
 * Not every query needs this. A lookup by integration id -- a webhook, a
 * scheduled sync, a call activity already stamped with its account -- is
 * already talking about one specific account, and the unit follows from the
 * record rather than from whoever is signed in.
 */

/** The unit a request is working in, or null outside a unit-scoped route. */
export function requestUnitId(req) {
  const id = Number(req?.businessUnit?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * `AND (business_unit_id = ? OR business_unit_id IS NULL)`, with its parameter.
 *
 * With no unit on the request -- a background job, or a route mounted outside
 * the business-unit middleware -- nothing is added, leaving the old
 * organization-wide behaviour rather than silently matching nothing.
 */
export function unitScopeFilter(unitId, alias = '') {
  const column = `${alias ? `${alias}.` : ''}business_unit_id`;
  if (!unitId) return { sql: '', params: [] };
  return { sql: ` AND (${column} = ? OR ${column} IS NULL)`, params: [Number(unitId)] };
}

/**
 * Order fragment putting the unit's own account ahead of a shared one, so a
 * unit that has configured its own is never handed the shared fallback.
 */
export function unitPreferenceOrder(unitId, alias = '') {
  const column = `${alias ? `${alias}.` : ''}business_unit_id`;
  return unitId ? `${column} IS NULL, ` : '';
}
