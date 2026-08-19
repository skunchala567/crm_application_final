import axios from 'axios';

/**
 * Meta Graph API client for Lead Ads.
 *
 * Follows the house conventions: axios, retry-with-backoff modelled on
 * SmartpingProvider.requestWithRetry, and errors thrown as
 * Object.assign(new Error(msg), { status }) for the global error handler.
 *
 * Access tokens are never logged -- redactToken() scrubs them from URLs
 * before anything reaches the console.
 */

export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const DEFAULT_TIMEOUT = Number(process.env.META_TIMEOUT_MS || 20000);
const MAX_RETRIES = Number(process.env.META_MAX_RETRIES || 3);

// Meta error codes worth retrying: throttling and transient platform faults.
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);
// Token is dead -- retrying cannot help, surface immediately.
const AUTH_CODES = new Set([102, 190, 200, 10, 803]);

function redactToken(value) {
  return String(value ?? '').replace(/access_token=[^&\s]+/gi, 'access_token=***');
}

function describeError(error) {
  const meta = error.response?.data?.error;
  if (meta) {
    const parts = [meta.message || 'Meta API error'];
    if (meta.code != null) parts.push(`(code ${meta.code}${meta.error_subcode ? `/${meta.error_subcode}` : ''})`);
    return parts.join(' ');
  }
  return redactToken(error.message || 'Meta API request failed');
}

function isRetryable(error) {
  const status = error.response?.status;
  const code = error.response?.data?.error?.code;
  if (AUTH_CODES.has(code)) return false;
  if (RETRYABLE_CODES.has(code)) return true;
  if (!status) return true; // network/timeout
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Single Graph call with exponential backoff on transient failures.
 * @returns {Promise<any>} parsed response body
 */
async function graphRequest(method, url, { params, data, logger = console } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await axios({
        method,
        url,
        params,
        data,
        timeout: DEFAULT_TIMEOUT,
        headers: { Accept: 'application/json' },
      });
      return response.data;
    } catch (error) {
      lastError = error;
      const retryable = isRetryable(error);
      logger.warn?.('[Meta] Graph request failed', {
        url: redactToken(url),
        attempt,
        status: error.response?.status,
        code: error.response?.data?.error?.code,
        message: describeError(error),
      });
      if (!retryable || attempt >= MAX_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  const code = lastError?.response?.data?.error?.code;
  const metaAuthFailure = AUTH_CODES.has(code);
  /*
   * A dead Meta token is a bad gateway, not an unauthenticated caller.
   *
   * This used to answer 401 when Facebook rejected the token, and the browser
   * treats 401 as "your CRM session has expired" -- it clears the stored token
   * and signs the user out. So pressing Save or Test token with an expired
   * system user token logged the administrator out of the CRM instead of
   * telling them the Meta token needed replacing.
   *
   * 502 is what every other provider failure in this codebase reports.
   * metaAuth marks it as a credentials problem so callers can say so.
   */
  throw Object.assign(new Error(describeError(lastError)), {
    status: 502,
    metaAuth: metaAuthFailure,
    metaCode: code ?? null,
  });
}

/**
 * Walk Graph cursor pagination to completion.
 *
 * paging.next is a fully-formed URL that already carries the access token
 * and cursor, so it is followed verbatim. maxPages is a runaway guard.
 */
async function graphPaginate(startUrl, { params, logger = console, maxPages = 200 } = {}) {
  const collected = [];
  let url = startUrl;
  let nextParams = params;
  let pages = 0;

  while (url && pages < maxPages) {
    const body = await graphRequest('GET', url, { params: nextParams, logger });
    if (Array.isArray(body?.data)) collected.push(...body.data);
    url = body?.paging?.next || null;
    nextParams = undefined; // the next URL already encodes everything
    pages += 1;
  }
  if (url && pages >= maxPages) {
    logger.warn?.('[Meta] Pagination hit maxPages guard; results may be truncated', { maxPages });
  }
  return collected;
}

/**
 * Pages the given user/system token can manage. Each entry carries that
 * Page's OWN token, which is what every downstream leadgen call must use.
 *
 * Pass a token belonging to a different Facebook account to discover that
 * account's Pages; the Page tokens it returns are self-contained afterwards.
 */
export async function listPages(userToken, { logger = console } = {}) {
  return graphPaginate(`${GRAPH_BASE}/me/accounts`, {
    params: { limit: 100, fields: 'id,name,access_token,category', access_token: userToken },
    logger,
  });
}

/**
 * Who a token belongs to. Used to label Pages with the Facebook account they
 * were connected through, so several accounts stay distinguishable.
 */
export async function getTokenOwner(userToken, { logger = console } = {}) {
  const body = await graphRequest('GET', `${GRAPH_BASE}/me`, {
    params: { fields: 'id,name', access_token: userToken },
    logger,
  });
  return { id: body?.id ? String(body.id) : null, name: body?.name || null };
}

/** Subscribe a Page to leadgen webhook notifications. */
export async function subscribePageToLeadgen(pageId, pageAccessToken, { logger = console } = {}) {
  const body = await graphRequest('POST', `${GRAPH_BASE}/${pageId}/subscribed_apps`, {
    params: { subscribed_fields: 'leadgen', access_token: pageAccessToken },
    logger,
  });
  return body?.success === true;
}

/** Remove leadgen subscription for a Page. */
export async function unsubscribePage(pageId, pageAccessToken, { logger = console } = {}) {
  const body = await graphRequest('DELETE', `${GRAPH_BASE}/${pageId}/subscribed_apps`, {
    params: { access_token: pageAccessToken },
    logger,
  });
  return body?.success === true;
}

/** Lead forms defined on a Page. */
export async function listLeadForms(pageId, pageAccessToken, { logger = console } = {}) {
  return graphPaginate(`${GRAPH_BASE}/${pageId}/leadgen_forms`, {
    params: {
      limit: 100,
      fields: 'id,name,status,locale,questions,created_time',
      access_token: pageAccessToken,
    },
    logger,
  });
}

/**
 * Fetch one lead by its leadgen_id. This is the webhook path -- the
 * webhook payload carries only ids, never the answers themselves.
 */
export async function getLead(leadgenId, pageAccessToken, { logger = console } = {}) {
  return graphRequest('GET', `${GRAPH_BASE}/${leadgenId}`, {
    params: {
      fields: 'id,created_time,ad_id,adset_id,campaign_id,form_id,is_organic,field_data',
      access_token: pageAccessToken,
    },
    logger,
  });
}

/**
 * Historical leads for a form -- the backfill path, and the fallback for
 * environments where Meta cannot reach the webhook (e.g. localhost).
 * @param {number|null} sinceEpochSeconds inclusive lower bound on created_time
 */
export async function listFormLeads(formId, pageAccessToken, { sinceEpochSeconds = null, logger = console, maxPages = 200 } = {}) {
  const params = {
    limit: 100,
    fields: 'id,created_time,ad_id,adset_id,campaign_id,form_id,is_organic,field_data',
    access_token: pageAccessToken,
  };
  if (sinceEpochSeconds) params.filtering = JSON.stringify([
    { field: 'time_created', operator: 'GREATER_THAN', value: Number(sinceEpochSeconds) },
  ]);
  return graphPaginate(`${GRAPH_BASE}/${formId}/leads`, { params, logger, maxPages });
}

/** Validate a token and report its scopes/expiry. Used by the config UI. */
export async function debugToken(inputToken, appId, appSecret, { logger = console } = {}) {
  const body = await graphRequest('GET', `${GRAPH_BASE}/debug_token`, {
    params: { input_token: inputToken, access_token: `${appId}|${appSecret}` },
    logger,
  });
  return body?.data || null;
}

export const __testing = { redactToken, isRetryable, describeError };
