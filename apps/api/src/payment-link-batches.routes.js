import { Router } from 'express';
import { branchScopeSql, denyBranch } from './rbac/branch-scope.js';
import { requireAdminOrPermission } from './rbac/rbac.middleware.js';
import { branchJodoConfig, clean } from './jodo-link-service.js';

/*
 * Uploading a list of mobile numbers and raising a payment link for each.
 *
 * This route only validates and queues. Nothing is sent to Jodo here -- the
 * cycle in payment-link-batch-engine.js does that -- so an upload of five
 * hundred numbers answers immediately and the browser is not the thing keeping
 * the work alive.
 *
 * Mounted under /api/jodo so the existing payment-link permission rules apply:
 * POST needs payments.links.create, reads need payments.links.view.
 */

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const MAX_ROWS = 2000;
const MAX_AMOUNT = 10_00_000;

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits.slice(-10);
}

/**
 * One uploaded row, checked before any money is asked for.
 *
 * A bad row is skipped and reported rather than failing the upload: a single
 * mistyped number in a file of four hundred should not stop the other three
 * hundred and ninety nine going out.
 */
function validateRow(row, index, seen) {
  const phone = normalizePhone(row.phone);
  const amount = Number(row.amount);
  if (!phone) return { error: 'No mobile number' };
  if (!/^[6-9]\d{9}$/.test(phone)) return { error: `Not a valid Indian mobile number: ${clean(row.phone, 30)}` };
  // Twice in one file means two links to one parent, and quite possibly two
  // payments. The first wins and the repeat is reported.
  if (seen.has(phone)) return { error: `Duplicate of row ${seen.get(phone)}` };
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Amount must be greater than zero' };
  if (amount > MAX_AMOUNT) return { error: `Amount above the ₹${MAX_AMOUNT.toLocaleString('en-IN')} limit` };
  seen.set(phone, index + 1);
  return {
    row: {
      phone: clean(row.phone, 30) || phone,
      normalizedPhone: phone,
      name: clean(row.name, 200) || null,
      email: clean(row.email, 254) || null,
      amount: Number(amount.toFixed(2)),
    },
  };
}

export function createPaymentLinkBatchRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin) {
  const router = Router();
  const canView = requireAdminOrPermission(pool, 'payments.collections.view');
  router.use(authenticate, requireCrmAccess);

  /*
   * What was actually collected, alongside what was asked for.
   *
   * Each row keeps the payment link it raised, so the money can be followed
   * from the upload to the payment without matching on mobile numbers -- the
   * link id is exact where a number is not, since one payer can be sent
   * several links over time and only one of them was this upload's.
   *
   * The paid statuses are the same list Collections uses for its own totals
   * (jodo-payment-links.routes.js). Kept identical on purpose: two screens
   * reporting different totals for one payment is worse than either being
   * slightly wrong.
   */
  const PAID_STATUSES = "'paid','settled','success','completed','captured'";

  const COUNTS = `
    (SELECT COUNT(*) FROM crm_payment_link_batch_rows r WHERE r.batch_id=b.id) AS totalRows,
    (SELECT COUNT(*) FROM crm_payment_link_batch_rows r WHERE r.batch_id=b.id AND r.status='sent') AS sentRows,
    (SELECT COUNT(*) FROM crm_payment_link_batch_rows r WHERE r.batch_id=b.id AND r.status='failed') AS failedRows,
    (SELECT COUNT(*) FROM crm_payment_link_batch_rows r WHERE r.batch_id=b.id AND r.status IN ('pending','link_created')) AS pendingRows,
    (SELECT COALESCE(SUM(r.amount),0) FROM crm_payment_link_batch_rows r WHERE r.batch_id=b.id) AS totalAmount,
    (SELECT COUNT(*) FROM crm_payment_link_batch_rows r
       JOIN crm_jodo_payment_links p ON p.id=r.payment_link_id
      WHERE r.batch_id=b.id AND LOWER(p.status) IN (${PAID_STATUSES})) AS paidRows,
    (SELECT COALESCE(SUM(p.amount),0) FROM crm_payment_link_batch_rows r
       JOIN crm_jodo_payment_links p ON p.id=r.payment_link_id
      WHERE r.batch_id=b.id AND LOWER(p.status) IN (${PAID_STATUSES})) AS paidAmount`;

  router.get('/', canView, wrap(async (req, res) => {
    const scope = branchScopeSql(req.user, 'b.branch_id');
    const [rows] = await pool.execute(
      `SELECT b.id,b.file_name AS fileName,b.component_type AS componentType,b.status,b.template_name AS templateName,
              b.created_at_utc AS createdAt,b.completed_at_utc AS completedAt,b.branch_id AS branchId,
              br.branch_name AS branchName,COALESCE(e.employee_name,u.email) AS createdBy,${COUNTS}
       FROM crm_payment_link_batches b
       JOIN branches br ON br.id=b.branch_id
       LEFT JOIN app_users u ON u.id=b.created_by_user_id
       LEFT JOIN employees e ON e.id=u.employee_id
       WHERE b.business_unit_id=? AND ${scope.sql}
       ORDER BY b.created_at_utc DESC LIMIT 100`,
      [req.businessUnit.id, ...scope.params],
    );
    res.json({ data: rows });
  }));

  router.get('/:id', canView, wrap(async (req, res) => {
    const scope = branchScopeSql(req.user, 'b.branch_id');
    const [[batch]] = await pool.execute(
      `SELECT b.*,br.branch_name AS branchName,${COUNTS}
       FROM crm_payment_link_batches b JOIN branches br ON br.id=b.branch_id
       WHERE b.id=? AND b.business_unit_id=? AND ${scope.sql}`,
      [req.params.id, req.businessUnit.id, ...scope.params],
    );
    if (!batch) return res.status(404).json({ message: 'Upload not found' });
    const [rows] = await pool.execute(
      `SELECT r.id,r.row_number_in_file AS rowNumber,r.phone,r.name,r.email,r.amount,r.status,r.error_message AS error,
              r.order_id AS orderId,r.redirect_url AS redirectUrl,r.lead_id AS leadId,l.lead_number AS leadNumber,
              p.status AS paymentStatus,r.processed_at_utc AS processedAt
       FROM crm_payment_link_batch_rows r
       LEFT JOIN crm_leads l ON l.id=r.lead_id
       LEFT JOIN crm_jodo_payment_links p ON p.id=r.payment_link_id
       WHERE r.batch_id=? ORDER BY r.row_number_in_file LIMIT 2000`,
      [batch.id],
    );
    res.json({ data: { ...batch, rows } });
  }));

  router.post('/', requireUserAdmin, wrap(async (req, res) => {
    const branchId = Number(req.body.branchId);
    const denied = denyBranch(req.user, branchId);
    if (denied) return res.status(403).json({ message: denied });
    // Fails now, with a message about credentials, rather than failing every
    // row of the batch one at a time later.
    const config = await branchJodoConfig(pool, branchId);

    const componentType = clean(req.body.componentType, 120) || clean(config.paymentComponent, 120);
    if (!componentType) return res.status(400).json({ message: 'Choose the Jodo component these payments should book against' });

    const uploaded = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!uploaded.length) return res.status(400).json({ message: 'The file has no rows' });
    if (uploaded.length > MAX_ROWS) return res.status(400).json({ message: `Upload up to ${MAX_ROWS} numbers at a time` });

    const seen = new Map();
    const valid = [];
    const skipped = [];
    uploaded.forEach((row, index) => {
      const result = validateRow(row, index, seen);
      if (result.error) skipped.push({ rowNumber: index + 1, phone: clean(row.phone, 30), error: result.error });
      else valid.push({ ...result.row, rowNumber: index + 1 });
    });
    if (!valid.length) return res.status(400).json({ message: 'No usable rows in this file', skipped });

    /*
     * A template is optional. Without one the links are still raised and Jodo
     * sends its own message; with one the link also goes out from the school's
     * own WhatsApp number.
     */
    const integrationId = Number(req.body.integrationId) || null;
    const templateId = Number(req.body.templateId) || null;
    let template = null;
    if (templateId) {
      const [[found]] = await pool.execute(
        `SELECT id,template_name,language,body FROM crm_whatsapp_templates
         WHERE id=? AND integration_id=? AND deleted_at IS NULL AND UPPER(status)='APPROVED'`,
        [templateId, integrationId],
      );
      if (!found) return res.status(400).json({ message: 'Select an approved WhatsApp template on the chosen account' });
      template = found;
    }
    const templateParams = Array.isArray(req.body.templateParams) ? req.body.templateParams.map(value => clean(value, 500)) : [];
    const linkParamIndex = Number(req.body.linkParamIndex) || null;
    if (template && !linkParamIndex) {
      return res.status(400).json({ message: 'Choose which placeholder in the template carries the payment link' });
    }
    if (linkParamIndex && (linkParamIndex < 1 || linkParamIndex > templateParams.length)) {
      return res.status(400).json({ message: 'The chosen placeholder is not one this template has' });
    }

    const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) return res.status(400).json({ message: 'Enter a valid expiry date' });

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [batch] = await connection.execute(
        `INSERT INTO crm_payment_link_batches
           (business_unit_id,branch_id,file_name,component_type,environment,integration_id,template_id,
            template_name,template_language,template_params_json,link_param_index,expires_at_utc,total_rows,created_by_user_id)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [req.businessUnit.id, branchId, clean(req.body.fileName, 255) || null, componentType,
          req.body.environment === 'uat' ? 'uat' : 'production', integrationId, templateId,
          template?.template_name || null, template?.language || 'en',
          JSON.stringify(templateParams), linkParamIndex, expiresAt, valid.length, req.user.id],
      );
      const batchId = Number(batch.insertId);
      for (const row of valid) {
        await connection.execute(
          `INSERT INTO crm_payment_link_batch_rows
             (batch_id,row_number_in_file,phone,normalized_phone,name,email,amount)
           VALUES(?,?,?,?,?,?,?)`,
          [batchId, row.rowNumber, row.phone, row.normalizedPhone, row.name, row.email, row.amount],
        );
      }
      await connection.commit();
      res.status(201).json({
        success: true,
        data: {
          id: batchId,
          queued: valid.length,
          skipped,
          totalAmount: valid.reduce((sum, row) => sum + row.amount, 0),
        },
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }));

  /*
   * Stops a batch that has not finished. Rows already sent keep their link --
   * money asked for cannot be unasked -- so this only prevents the rest going
   * out, which is what somebody who uploaded the wrong file needs.
   */
  router.post('/:id/cancel', requireUserAdmin, wrap(async (req, res) => {
    const scope = branchScopeSql(req.user, 'branch_id');
    const [result] = await pool.execute(
      `UPDATE crm_payment_link_batches SET status='cancelled',completed_at_utc=CURRENT_TIMESTAMP(6)
       WHERE id=? AND business_unit_id=? AND status IN ('queued','processing') AND ${scope.sql}`,
      [req.params.id, req.businessUnit.id, ...scope.params],
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'No unfinished upload found' });
    const [rows] = await pool.execute(
      `UPDATE crm_payment_link_batch_rows SET status='failed',error_message='Cancelled before sending'
       WHERE batch_id=? AND status='pending'`,
      [req.params.id],
    );
    res.json({ success: true, cancelledRows: rows.affectedRows });
  }));

  return router;
}
