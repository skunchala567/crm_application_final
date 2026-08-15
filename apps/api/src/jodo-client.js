/**
 * How the CRM talks to Jodo, in one place.
 *
 * There were two independent clients -- one behind the public enquiry form's
 * payment order, one behind Payment Forms -- and both hard-coded
 * https://ext.jodo.in and rebuilt a Basic credential from the branch's API key
 * and secret. Jodo issues its own Authorization value, so a branch given one
 * could not be made to work through either path: the gateway answered 401 and
 * the enquiry form, which only redirects once it has a payment URL, simply
 * never redirected.
 *
 * Both now read the same per-branch settings, so configuring a branch once
 * fixes every path that charges through it.
 */

/** Columns to select for any Jodo call, aliased the way the clients expect. */
export const JODO_BRANCH_COLUMNS = `jodo_payment_enabled AS paymentEnabled,
  jodo_api_key AS apiKey, jodo_secret_key AS secretKey, jodo_collector_code AS collectorCode,
  jodo_base_url AS baseUrl, jodo_auth_header AS authHeader`;

const DEFAULT_LIVE = 'https://ext.jodo.in';
const DEFAULT_UAT = 'https://ext.devtest1.jodopay.com';

/** The branch's own base URL, or the environment default. */
export function jodoBaseUrl(config, environment) {
  const configured = String(config?.baseUrl || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  return environment === 'uat' ? DEFAULT_UAT : DEFAULT_LIVE;
}

/**
 * The Authorization header to send.
 *
 * A branch that has been given an Authorization value uses it exactly as
 * issued -- deriving one from the key and secret instead is what produced
 * "Invalid credentials, please check!". The "Basic " prefix is added only if
 * the stored value omits it, since it is easy to paste either way. With no
 * stored header the old behaviour stands, so branches configured before this
 * keep working untouched.
 */
export function jodoAuthHeaders(config) {
  const issued = String(config?.authHeader || '').trim();
  if (issued) {
    /*
     * Repair a scheme that arrived mangled rather than compounding it.
     *
     * A stored value of "asic <token>" -- a paste that lost its first
     * character -- used to be treated as scheme-less and prefixed, producing
     * "Basic asic <token>" and Jodo's "Invalid authorization header format".
     * Anything that is a truncation of Basic/Bearer before the token is
     * corrected; a bare token is still prefixed as before.
     */
    const [maybeScheme, ...rest] = issued.split(/\s+/);
    const token = rest.join(' ');
    if (token) {
      if (/^basic$/i.test(maybeScheme)) return { Authorization: `Basic ${token}` };
      if (/^bearer$/i.test(maybeScheme)) return { Authorization: `Bearer ${token}` };
      if ('basic'.endsWith(maybeScheme.toLowerCase())) return { Authorization: `Basic ${token}` };
      if ('bearer'.endsWith(maybeScheme.toLowerCase())) return { Authorization: `Bearer ${token}` };
    }
    return { Authorization: `Basic ${issued}` };
  }
  const apiKey = String(config?.apiKey || '');
  const secretKey = String(config?.secretKey || '');
  if (!apiKey || !secretKey) return {};
  return { Authorization: `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString('base64')}` };
}

/** Headers every Jodo request carries. */
export function jodoHeaders(config, extra = {}) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...jodoAuthHeaders(config),
    ...extra,
  };
}

/** Whether a branch can be charged through at all. */
export function jodoConfigured(config) {
  if (!config) return false;
  if (String(config.authHeader || '').trim()) return true;
  return Boolean(String(config.apiKey || '').trim() && String(config.secretKey || '').trim());
}
