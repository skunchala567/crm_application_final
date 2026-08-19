import { branchJodoConfig, createPaymentLink, clean } from './jodo-link-service.js';

/*
 * Turns an uploaded list of mobile numbers into payment links, and sends each
 * one on WhatsApp.
 *
 * Runs as a cycle rather than inside the upload request. Two hundred numbers
 * is two hundred Jodo calls followed by two hundred WhatsApp sends; holding a
 * browser connection open for that would time out long before it finished,
 * and a refresh would leave nobody knowing which numbers had already been
 * charged. Rows carry their own status instead, so the work is resumable and
 * a restart costs at most the row in flight.
 *
 * The two steps are recorded separately on purpose. Raising a link at Jodo is
 * the step that cannot be taken twice -- a payer who gets two links may pay
 * twice -- so a row that has a link but whose WhatsApp failed retries only the
 * message, never the link.
 */

const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 3;

/**
 * The template body with {{n}} filled in, which is what the send path stores
 * as the message text. The link goes into whichever placeholder the batch
 * nominated.
 */
function renderTemplate(body, params) {
  return String(body || '').replace(/\{\{(\d+)\}\}/g, (match, index) => {
    const value = params[Number(index) - 1];
    return value === undefined || value === null ? match : String(value);
  });
}

export function createPaymentLinkBatchEngine(pool, { sendWhatsApp, logger = console }) {
  /**
   * Name, email and lead for one uploaded number.
   *
   * The file wins where it has an answer, then the lead the number belongs to,
   * then a fallback. Jodo will not raise a link without all three, and a fee
   * drive cannot stall because a parent's record has no email address -- so
   * the fallback address is deliberate, not an accident of empty data.
   */
  async function resolvePayer(row, batch) {
    const [[lead]] = await pool.execute(
      `SELECT id,student_name AS studentName,email FROM crm_leads
       WHERE business_unit_id=? AND normalized_phone=? AND deleted_at_utc IS NULL
       ORDER BY id DESC LIMIT 1`,
      [Number(batch.business_unit_id), row.normalized_phone],
    );
    return {
      leadId: lead ? Number(lead.id) : null,
      name: clean(row.name, 200) || clean(lead?.studentName, 200) || 'Parent',
      email: clean(row.email, 254) || clean(lead?.email, 254) || 'na@gmail.com',
    };
  }

  async function processRow(row, batch, config) {
    let linkId = row.payment_link_id;
    let redirectUrl = row.redirect_url;
    let orderId = row.order_id;
    let leadId = row.lead_id;
    let payerName = clean(row.name, 200);

    // Step one, and only if it has not already happened for this row.
    if (!linkId) {
      const payer = await resolvePayer(row, batch);
      leadId = payer.leadId;
      payerName = payer.name;
      const created = await createPaymentLink(pool, {
        config,
        environment: batch.environment,
        businessUnitId: Number(batch.business_unit_id),
        branchId: Number(batch.branch_id),
        leadId: payer.leadId,
        name: payer.name,
        phone: row.normalized_phone,
        email: payer.email,
        studentName: payer.name,
        customIdentifier: clean(batch.file_name, 120) || undefined,
        expiresAt: batch.expires_at_utc,
        details: [{ component_type: batch.component_type, amount: Number(row.amount) }],
        notes: [
          { key: 'crm_source', value: 'payment_link_batch' },
          { key: 'crm_batch_id', value: String(batch.id) },
        ],
        createdByUserId: Number(batch.created_by_user_id),
      });
      linkId = created.id;
      orderId = created.orderId;
      redirectUrl = created.redirectUrl;
      await pool.execute(
        `UPDATE crm_payment_link_batch_rows
         SET status='link_created',payment_link_id=?,order_id=?,redirect_url=?,lead_id=?,name=?,email=?
         WHERE id=?`,
        [linkId, orderId, redirectUrl, leadId, payer.name, payer.email, row.id],
      );
    }

    // Step two. A batch with no template raises links and stops there, which
    // is a legitimate way to use this: Jodo sends its own message anyway.
    if (!batch.integration_id || !batch.template_name) {
      await pool.execute(
        `UPDATE crm_payment_link_batch_rows SET status='sent',processed_at_utc=CURRENT_TIMESTAMP(6),error_message=NULL WHERE id=?`,
        [row.id],
      );
      return;
    }

    const configured = Array.isArray(batch.template_params_json)
      ? batch.template_params_json
      : JSON.parse(batch.template_params_json || '[]');
    /*
     * A placeholder is either the payment link, or text that may name the
     * payer and what they owe. Without {amount} a fee reminder could not say
     * the sum it is asking for, which is most of the message.
     */
    const amountText = Number(row.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const params = configured.map((value, index) => (
      Number(batch.link_param_index) === index + 1
        ? redirectUrl
        : String(value ?? '')
          .replace(/\{name\}/gi, payerName || 'Parent')
          .replace(/\{amount\}/gi, amountText)
          .replace(/\{link\}/gi, redirectUrl)
    ));
    const result = await sendWhatsApp({
      integrationId: Number(batch.integration_id),
      organizationId: Number(batch.business_unit_id),
      phoneNumber: row.normalized_phone,
      message: renderTemplate(batch.template_body, params),
      options: {
        templateName: batch.template_name,
        campaignName: batch.template_name,
        templateParams: params,
        language: batch.template_language || 'en',
        leadId,
        userName: payerName || undefined,
        source: 'CRM Bulk Payment Links',
        // Keyed to the row, so a retried cycle cannot send the same parent a
        // second copy of the same link.
        clientRequestId: `payment-link-row-${row.id}`,
      },
    });
    if (result && result.success === false) throw new Error(result.error || result.message || 'WhatsApp send failed');
    await pool.execute(
      `UPDATE crm_payment_link_batch_rows
       SET status='sent',whatsapp_message_id=?,error_message=NULL,processed_at_utc=CURRENT_TIMESTAMP(6)
       WHERE id=?`,
      [clean(result?.messageId || result?.message_id, 190) || null, row.id],
    );
  }

  async function run() {
    const [rows] = await pool.execute(
      `SELECT r.*, b.business_unit_id, b.branch_id, b.component_type, b.environment, b.integration_id,
              b.template_name, b.template_language, b.template_params_json, b.link_param_index,
              b.expires_at_utc, b.created_by_user_id, b.file_name, b.id AS batch_id_out,
              t.body AS template_body
       FROM crm_payment_link_batch_rows r
       JOIN crm_payment_link_batches b ON b.id=r.batch_id
       LEFT JOIN crm_whatsapp_templates t ON t.id=b.template_id
       WHERE r.status IN ('pending','link_created') AND r.attempts < ? AND b.status <> 'cancelled'
       ORDER BY r.id LIMIT ${BATCH_SIZE}`,
      [MAX_ATTEMPTS],
    );
    if (!rows.length) return { processed: 0 };

    const configByBranch = new Map();
    let processed = 0;
    for (const row of rows) {
      // Claimed by bumping attempts, so two overlapping cycles cannot both
      // take the same row and raise two links for one parent.
      const [claim] = await pool.execute(
        `UPDATE crm_payment_link_batch_rows SET attempts=attempts+1 WHERE id=? AND attempts=?`,
        [row.id, row.attempts],
      );
      if (!claim.affectedRows) continue;
      const batch = {
        id: row.batch_id, business_unit_id: row.business_unit_id, branch_id: row.branch_id,
        component_type: row.component_type, environment: row.environment, integration_id: row.integration_id,
        template_name: row.template_name, template_language: row.template_language,
        template_params_json: row.template_params_json, link_param_index: row.link_param_index,
        template_body: row.template_body, expires_at_utc: row.expires_at_utc,
        created_by_user_id: row.created_by_user_id, file_name: row.file_name,
      };
      try {
        if (!configByBranch.has(row.branch_id)) {
          configByBranch.set(row.branch_id, await branchJodoConfig(pool, row.branch_id));
        }
        await processRow(row, batch, configByBranch.get(row.branch_id));
        processed += 1;
      } catch (error) {
        const attempts = Number(row.attempts) + 1;
        await pool.execute(
          `UPDATE crm_payment_link_batch_rows
           SET status=IF(? >= ?, 'failed', status), error_message=?, processed_at_utc=CURRENT_TIMESTAMP(6)
           WHERE id=?`,
          [attempts, MAX_ATTEMPTS, clean(error.message, 500), row.id],
        );
        logger.error?.(`Payment link batch row ${row.id} failed: ${error.message}`);
      }
    }

    // A batch is done when nothing in it can move again.
    await pool.execute(
      `UPDATE crm_payment_link_batches b
       SET b.status='completed', b.completed_at_utc=CURRENT_TIMESTAMP(6)
       WHERE b.status IN ('queued','processing')
         AND NOT EXISTS (
           SELECT 1 FROM crm_payment_link_batch_rows r
           WHERE r.batch_id=b.id AND r.status IN ('pending','link_created') AND r.attempts < ?
         )`,
      [MAX_ATTEMPTS],
    );
    return { processed };
  }

  return { run };
}
