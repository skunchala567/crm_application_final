import axios from 'axios';
import { jodoBaseUrl, jodoHeaders, jodoConfigured } from './jodo-client.js';

/*
 * Raising a Jodo payment link, in one place.
 *
 * Two callers need it now: the screen that raises a single link for one payer,
 * and the bulk cycle that raises one per uploaded mobile number. They must
 * agree on the payload, on what a Jodo error means, and on what gets written
 * to crm_jodo_payment_links -- a second copy of this would be a second set of
 * answers about money.
 */

const ENDPOINT = '/api/v1/integrations/pay/payment_links';

export const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);

export function providerError(error) {
  const body = error.response?.data;
  const message = body?.message || body?.error?.message || body?.error || error.message || 'Jodo request failed';
  const statusCode = error.response?.status;
  const finalMessage = statusCode === 401
    ? `Jodo API authentication failed. Check this branch's Jodo base URL, Authorization header, API key and secret in Business Units > Branches & payments: ${typeof message === 'string' ? message : JSON.stringify(message)}`
    : typeof message === 'string' ? message : JSON.stringify(message);
  const status = statusCode === 401 ? 502 : statusCode >= 400 && statusCode < 500 ? statusCode : 502;
  return Object.assign(new Error(finalMessage), { status });
}

export async function jodo(config, environment, method, path, data) {
  try {
    return (await axios({
      method,
      url: `${jodoBaseUrl(config, environment)}${ENDPOINT}${path}`,
      data,
      headers: jodoHeaders(config),
      timeout: 20000,
    })).data;
  } catch (error) { throw providerError(error); }
}

export function remoteData(payload) {
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
}

export function paymentSummary(data) {
  const details = Array.isArray(data.details) ? data.details : [];
  return {
    status: clean(data.status || 'unpaid', 40).toLowerCase(),
    transactionId: clean(data.transaction_id, 150) || null,
    paidAt: data.paid_at || null,
    settledAt: details.find(item => item.settled_at)?.settled_at || null,
    settlementUtr: clean(details.find(item => item.settlement_utr)?.settlement_utr, 150) || null,
  };
}

export async function branchJodoConfig(pool, id) {
  const [[branch]] = await pool.execute(
    `SELECT id,branch_name AS name,jodo_payment_enabled AS enabled,jodo_api_key AS apiKey,jodo_secret_key AS secretKey,
            jodo_collector_code AS collectorCode,jodo_base_url AS baseUrl,jodo_auth_header AS authHeader,
            application_payment_component AS paymentComponent
     FROM branches WHERE id=? AND is_active=1 LIMIT 1`,
    [id],
  );
  if (!branch) throw Object.assign(new Error('Active branch not found'), { status: 404 });
  // Capability is credentials alone: the per-branch enable flag is no longer
  // editable, so requiring it here would strand every branch that has it off.
  if (!jodoConfigured(branch)) {
    throw Object.assign(new Error("Configure this branch's Jodo credentials in Business Units > Branches & payments"), { status: 400 });
  }
  return branch;
}

/**
 * Raise one payment link at Jodo and record it.
 *
 * Returns the stored row's id along with the order id and hosted URL. Throws
 * with a `status` when Jodo refuses -- the caller decides whether that fails a
 * request or fails one row of a batch.
 */
export async function createPaymentLink(pool, {
  config, environment = 'production', businessUnitId, branchId, leadId = null,
  name, phone, email, studentName = null, grade = null, dateOfBirth = null,
  identifier = null, customIdentifier = null, newAdmission = true,
  academicYearStart = null, academicYearEnd = null, expiresAt = null,
  details, notes = [], createdByUserId,
}) {
  const total = details.reduce((sum, item) => sum + Number(item.amount), 0);
  const payload = {
    name, phone, email,
    student_name: studentName || undefined,
    grade: grade || undefined,
    date_of_birth: dateOfBirth || undefined,
    identifier: identifier || undefined,
    new_admission: newAdmission !== false,
    custom_identifier: customIdentifier || undefined,
    academic_year_start: academicYearStart || undefined,
    academic_year_end: academicYearEnd || undefined,
    expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    details,
    notes,
  };
  const response = await jodo(config, environment, 'POST', '', payload);
  const data = remoteData(response);
  const orderId = clean(data.order_id || data.id, 120);
  const redirectUrl = clean(data.redirect_url, 1000);
  if (!orderId || !redirectUrl) throw Object.assign(new Error('Jodo did not return an order_id and redirect_url'), { status: 502 });

  const [created] = await pool.execute(
    `INSERT INTO crm_jodo_payment_links
       (business_unit_id,branch_id,lead_id,environment,order_id,redirect_url,payer_name,payer_phone,payer_email,
        student_name,identifier,custom_identifier,grade,academic_year_start,academic_year_end,expires_at_utc,
        amount,details_json,notes_json,status,raw_response,created_by_user_id)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [businessUnitId, branchId, leadId, environment, orderId, redirectUrl, name, phone, email,
      payload.student_name || null, payload.identifier || null, payload.custom_identifier || null, payload.grade || null,
      payload.academic_year_start || null, payload.academic_year_end || null, payload.expires_at ? new Date(payload.expires_at) : null,
      total, JSON.stringify(details), JSON.stringify(notes), 'unpaid', JSON.stringify(response), createdByUserId],
  );
  return { id: Number(created.insertId), orderId, redirectUrl, amount: total };
}
