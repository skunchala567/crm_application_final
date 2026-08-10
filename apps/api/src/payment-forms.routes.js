import { Router } from 'express';
import axios from 'axios';

const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const baseUrl = environment => environment === 'uat' ? 'https://ext.devtest1.jodopay.com' : 'https://ext.jodo.in';
const endpoint = '/api/v1/integrations/pay/payment_links';

function providerError(error) {
  const body = error.response?.data;
  const message = body?.message || body?.error?.message || body?.error || error.message || 'Jodo request failed';
  const statusCode = error.response?.status;
  const finalMessage = statusCode === 401 ? `Jodo API authentication failed: ${message}` : message;
  const status = statusCode === 401 ? 502 : statusCode >= 400 && statusCode < 500 ? statusCode : 502;
  return Object.assign(new Error(finalMessage), { status });
}

async function jodo(config, environment, method, path, data) {
  try {
    return (await axios({
      method, url: `${baseUrl(environment)}${endpoint}${path}`, data,
      auth: { username: config.apiKey, password: config.secretKey },
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      timeout: 20000
    })).data;
  } catch (error) { throw providerError(error); }
}

async function branchConfig(pool, id) {
  const [[branch]] = await pool.execute(`SELECT id, branch_name, jodo_payment_enabled, jodo_api_key, jodo_secret_key FROM branches WHERE id=? AND is_active=1`, [id]);
  if (!branch) throw Object.assign(new Error('Branch not found'), { status: 404 });
  if (!branch.jodo_payment_enabled || !branch.jodo_api_key || !branch.jodo_secret_key) throw Object.assign(new Error('Enable Jodo and configure credentials for this branch'), { status: 400 });
  return { apiKey: branch.jodo_api_key, secretKey: branch.jodo_secret_key };
}

function remoteData(payload) { return payload?.data && typeof payload.data === 'object' ? payload.data : payload || {}; }

export function createPaymentFormsRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin) {
  const router = Router();
  const adminRouter = Router();
  adminRouter.use(authenticate, requireCrmAccess, requireUserAdmin);

  /**
   * A form stops accepting money at the end of its expiry day.
   *
   * NULL means it never expires, which is what a form without one gets --
   * the comparison has to let those through rather than treat "no date" as
   * "in the past".
   */
  const NOT_EXPIRED = '(pf.expires_at_utc IS NULL OR pf.expires_at_utc >= CURRENT_TIMESTAMP())';

  /** End of the chosen day, so a form set to expire on the 20th works all day. */
  const endOfDay = value => {
    const day = clean(value, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day} 23:59:59` : null;
  };

  /**
   * The customer detail fields configured on the form.
   *
   * Create accepted a `fields` array from the UI and then never wrote it, so
   * every form was saved with none. The live column for it is
   * additional_fields_json.
   */
  const fieldSchema = fields => (Array.isArray(fields) ? JSON.stringify(fields) : null);

  /** Reads the stored schema back. mysql2 hands JSON columns back parsed. */
  const parseFields = value => {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  };

  /*
   * Jodo will not create a payment link without a payer name, email and
   * phone, so those three are collected whether or not the form configures
   * them. Everything else on the page is whatever the Customer Details Form
   * says -- including nothing.
   */
  const PAYER_KEYS = { name: 'name', email: 'email', phone: 'phone' };

  // Get all forms for business unit
  adminRouter.get('/', wrap(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT pf.id, pf.form_key, pf.title, pf.description, pf.branch_id, pf.selection_type,
              pf.is_active, pf.expires_at_utc, pf.created_at_utc, b.branch_name,
              ${NOT_EXPIRED} AS isLive,
              COUNT(DISTINCT pfc.id) as categoryCount, COUNT(DISTINCT pfms.id) as submissionCount
       FROM crm_payment_forms pf
       JOIN branches b ON b.id=pf.branch_id
       LEFT JOIN crm_payment_form_categories pfc ON pfc.payment_form_id=pf.id
       LEFT JOIN crm_payment_form_submissions pfms ON pfms.payment_form_id=pf.id
       WHERE pf.business_unit_id=?
       GROUP BY pf.id
       ORDER BY pf.created_at_utc DESC LIMIT 250`,
      [req.businessUnit.id]
    );
    res.json({ data: rows.map(r => ({
      ...r,
      categoryCount: Number(r.categoryCount),
      submissionCount: Number(r.submissionCount),
      expired: !Number(r.isLive),
    })) });
  }));

  // Create form
  adminRouter.post('/', wrap(async (req, res) => {
    const { title, description, selectionType, successMessage, redirectUrl, branchId, categories, fields, expiresOn } = req.body;
    if (!title || !branchId || !Array.isArray(categories) || !categories.length) {
      return res.status(400).json({ message: 'Title, branch, and at least one category required' });
    }
    if (!['single', 'multiple'].includes(selectionType)) {
      return res.status(400).json({ message: 'Selection type must be single or multiple' });
    }
    await branchConfig(pool, branchId);
    const formKey = `pf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.execute(
        `INSERT INTO crm_payment_forms (business_unit_id, branch_id, form_key, title, description, selection_type, additional_fields_json, expires_at_utc, success_message, redirect_url, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.businessUnit.id, branchId, formKey, clean(title, 255), description ? clean(description, 1000) : null,
         selectionType, fieldSchema(fields), endOfDay(expiresOn),
         successMessage ? clean(successMessage, 1000) : null, redirectUrl ? clean(redirectUrl, 1000) : null, req.user.id]
      );
      const formId = Number(result.insertId);
      for (const [idx, cat] of categories.entries()) {
        await conn.execute(
          `INSERT INTO crm_payment_form_categories (payment_form_id, category_name, amount, display_order)
           VALUES (?, ?, ?, ?)`,
          [formId, clean(cat.name, 255), Number(cat.amount), idx]
        );
      }
      await conn.commit();
      res.status(201).json({ success: true, data: { id: formId, formKey, publicUrl: `/payment/${formKey}` } });
    } finally { await conn.release(); }
  }));

  // Update form
  adminRouter.put('/:id', wrap(async (req, res) => {
    const { title, description, selectionType, successMessage, redirectUrl, branchId, categories, fields, expiresOn, isActive } = req.body;
    if (!title || !branchId || !Array.isArray(categories) || !categories.length) {
      return res.status(400).json({ message: 'Title, branch, and at least one category required' });
    }
    if (!['single', 'multiple'].includes(selectionType)) {
      return res.status(400).json({ message: 'Selection type must be single or multiple' });
    }
    // Scoped to the caller's business unit so an id from another unit cannot
    // be edited by guessing it.
    const [[existing]] = await pool.execute(
      'SELECT id FROM crm_payment_forms WHERE id=? AND business_unit_id=?',
      [req.params.id, req.businessUnit.id],
    );
    if (!existing) return res.status(404).json({ message: 'Form not found' });
    await branchConfig(pool, branchId);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `UPDATE crm_payment_forms
            SET branch_id=?, title=?, description=?, selection_type=?, additional_fields_json=?,
                expires_at_utc=?, success_message=?, redirect_url=?, is_active=?
          WHERE id=? AND business_unit_id=?`,
        [branchId, clean(title, 255), description ? clean(description, 1000) : null, selectionType,
         fieldSchema(fields), endOfDay(expiresOn),
         successMessage ? clean(successMessage, 1000) : null, redirectUrl ? clean(redirectUrl, 1000) : null,
         isActive === false ? 0 : 1, existing.id, req.businessUnit.id],
      );
      // Categories are replaced wholesale: they carry no history of their own
      // and a submission keeps its own copy of what was chosen, so rewriting
      // them cannot rewrite what somebody already paid for.
      await conn.execute('DELETE FROM crm_payment_form_categories WHERE payment_form_id=?', [existing.id]);
      for (const [idx, cat] of categories.entries()) {
        await conn.execute(
          `INSERT INTO crm_payment_form_categories (payment_form_id, category_name, amount, display_order)
           VALUES (?, ?, ?, ?)`,
          [existing.id, clean(cat.name, 255), Number(cat.amount), idx],
        );
      }
      await conn.commit();
      res.json({ success: true, data: { id: existing.id } });
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally { await conn.release(); }
  }));

  // Delete form
  adminRouter.delete('/:id', wrap(async (req, res) => {
    const [[form]] = await pool.execute(
      'SELECT id, title FROM crm_payment_forms WHERE id=? AND business_unit_id=?',
      [req.params.id, req.businessUnit.id],
    );
    if (!form) return res.status(404).json({ message: 'Form not found' });

    /*
     * A form that has taken money is never deleted.
     *
     * crm_payment_form_submissions has ON DELETE CASCADE, so removing the row
     * would take the payment records with it -- the only record the CRM holds
     * of what a customer paid and what Jodo returned. Deactivating leaves the
     * history intact and closes the public URL just the same.
     */
    const [[{ submissions }]] = await pool.execute(
      'SELECT COUNT(*) AS submissions FROM crm_payment_form_submissions WHERE payment_form_id=?',
      [form.id],
    );
    if (Number(submissions) > 0) {
      return res.status(409).json({
        message: `"${form.title}" has ${submissions} payment submission${submissions === 1 ? '' : 's'} and cannot be deleted. Deactivate it instead to close the link and keep the payment history.`,
      });
    }

    await pool.execute('DELETE FROM crm_payment_forms WHERE id=? AND business_unit_id=?', [form.id, req.businessUnit.id]);
    res.json({ success: true });
  }));

  // Get form details
  adminRouter.get('/:id', wrap(async (req, res) => {
    const [[form]] = await pool.execute(`SELECT * FROM crm_payment_forms WHERE id=? AND business_unit_id=?`, [req.params.id, req.businessUnit.id]);
    if (!form) return res.status(404).json({ message: 'Form not found' });
    const [categories] = await pool.execute(`SELECT id, category_name, amount, selection_type, is_required FROM crm_payment_form_categories WHERE payment_form_id=? ORDER BY display_order`, [form.id]);
    res.json({ data: { ...form, categories } });
  }));

  // Get submissions for form
  adminRouter.get('/:id/submissions', wrap(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT id, payer_name, payer_email, payer_phone, student_name, amount, status, transaction_id, created_at_utc
       FROM crm_payment_form_submissions
       WHERE payment_form_id=? AND business_unit_id=?
       ORDER BY created_at_utc DESC LIMIT 500`,
      [req.params.id, req.businessUnit.id]
    );
    res.json({ data: rows });
  }));

  // Public routes
  const publicRouter = Router();

  publicRouter.get('/:formKey', wrap(async (req, res) => {
    const [[form]] = await pool.execute(
      `SELECT pf.* FROM crm_payment_forms pf WHERE pf.form_key=? AND pf.is_active=1 AND ${NOT_EXPIRED}`,
      [req.params.formKey],
    );
    // Deliberately the same 404 an unknown key gets: whether a link has
    // expired or never existed is not something a stranger needs told.
    if (!form) return res.status(404).json({ message: 'Form not found' });
    const [categories] = await pool.execute(
      `SELECT id, category_name, amount, selection_type, is_required FROM crm_payment_form_categories WHERE payment_form_id=? ORDER BY display_order`,
      [form.id]
    );
    /*
     * The configured fields go out with the form.
     *
     * They were never returned, so the public page had no choice but to draw
     * a fixed set of four -- full name, email, phone, student name -- whatever
     * the Customer Details Form said. selectionType was missing for the same
     * reason, which left a single-choice form rendering tick boxes.
     */
    res.json({ data: {
      formKey: form.form_key,
      title: form.title,
      description: form.description,
      selectionType: form.selection_type,
      fields: parseFields(form.additional_fields_json),
      categories,
    } });
  }));

  publicRouter.post('/:formKey/submit', wrap(async (req, res) => {
    const { name, email, phone, studentName, selectedCategoryIds, customFields } = req.body;
    const payerPhone = clean(phone, 30).replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(payerPhone)) return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number' });
    // Student name is no longer demanded outright: it is only on the page if
    // the form configures it, and a form that does not ask for one could
    // never be submitted while this insisted on it.
    if (!name || !email || !phone) {
      return res.status(400).json({ message: 'Name, email and phone are required' });
    }
    if (!Array.isArray(selectedCategoryIds) || !selectedCategoryIds.length) {
      return res.status(400).json({ message: 'Select at least one category' });
    }

    // Re-checked at submit, not just at load: a page left open past midnight
    // would otherwise still be able to start a payment.
    const [[form]] = await pool.execute(
      `SELECT pf.* FROM crm_payment_forms pf WHERE pf.form_key=? AND pf.is_active=1 AND ${NOT_EXPIRED}`,
      [req.params.formKey],
    );
    if (!form) return res.status(404).json({ message: 'This payment link is no longer available' });

    const [selectedCats] = await pool.execute(
      `SELECT id, category_name, amount FROM crm_payment_form_categories WHERE payment_form_id=? AND id IN (${selectedCategoryIds.map(() => '?').join(',')})`,
      [form.id, ...selectedCategoryIds]
    );

    if (selectedCats.length !== selectedCategoryIds.length) {
      return res.status(400).json({ message: 'Invalid category selection' });
    }

    const amount = selectedCats.reduce((sum, c) => sum + Number(c.amount), 0);
    if (amount <= 0) return res.status(400).json({ message: 'Total amount must be greater than 0' });

    /*
     * Whatever the form asked for beyond the payer's own details, kept with
     * the submission. custom_fields_json has been on this table all along
     * with nothing ever written to it.
     */
    const answers = (customFields && typeof customFields === 'object' && !Array.isArray(customFields))
      ? Object.fromEntries(Object.entries(customFields).slice(0, 60).map(([k, v]) => [clean(k, 80), clean(v, 500)]))
      : {};
    // Jodo wants a student name; a form that does not collect one falls back
    // to the payer, which is who the payment is actually from.
    const payerStudentName = clean(studentName, 200) || clean(name, 200);

    try {
      const config = await branchConfig(pool, form.branch_id);
      const payload = {
        name: clean(name, 200), phone: payerPhone, email: clean(email, 254),
        student_name: payerStudentName, new_admission: true,
        details: [{ component_type: 'Payment', amount }],
        notes: [{ key: 'form_key', value: form.form_key }, { key: 'categories', value: selectedCats.map(c => c.category_name).join(', ') }]
      };

      const response = await jodo(config, 'production', 'POST', '', payload);
      const data = remoteData(response);
      const orderId = clean(data.order_id || data.id, 120);
      const redirectUrl = clean(data.redirect_url || data.payment_url, 1000);

      if (!orderId || !redirectUrl) throw Object.assign(new Error('Jodo failed to return order details'), { status: 502 });

      const [result] = await pool.execute(
        `INSERT INTO crm_payment_form_submissions (business_unit_id, payment_form_id, jodo_order_id, jodo_payment_url, payer_name, payer_email, payer_phone, student_name, custom_fields_json, selected_categories_json, amount, raw_response)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [form.business_unit_id, form.id, orderId, redirectUrl, name, email, phone, payerStudentName,
         JSON.stringify(answers), JSON.stringify(selectedCats), amount, JSON.stringify(response)]
      );

      res.json({ success: true, data: { submissionId: Number(result.insertId), orderId, redirectUrl, amount } });
    } catch (error) { throw error; }
  }));

  router.use('/admin', adminRouter);
  router.use('/public', publicRouter);
  return router;
}
