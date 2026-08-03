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

  // Get all forms for business unit
  adminRouter.get('/', wrap(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT pf.id, pf.form_key, pf.title, pf.is_active, pf.created_at_utc, b.branch_name,
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
    res.json({ data: rows.map(r => ({ ...r, categoryCount: Number(r.categoryCount), submissionCount: Number(r.submissionCount) })) });
  }));

  // Create form
  adminRouter.post('/', wrap(async (req, res) => {
    const { title, description, selectionType, successMessage, redirectUrl, branchId, categories } = req.body;
    if (!title || !branchId || !Array.isArray(categories) || !categories.length) {
      return res.status(400).json({ message: 'Title, branch, and at least one category required' });
    }
    if (!['single', 'multiple'].includes(selectionType)) {
      return res.status(400).json({ message: 'Selection type must be single or multiple' });
    }
    const config = await branchConfig(pool, branchId);
    const formKey = `pf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.execute(
        `INSERT INTO crm_payment_forms (business_unit_id, branch_id, form_key, title, description, selection_type, success_message, redirect_url, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.businessUnit.id, branchId, formKey, clean(title, 255), description ? clean(description, 1000) : null,
         selectionType, successMessage ? clean(successMessage, 1000) : null, redirectUrl ? clean(redirectUrl, 1000) : null, req.user.id]
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
    const [[form]] = await pool.execute(`SELECT * FROM crm_payment_forms WHERE form_key=? AND is_active=1`, [req.params.formKey]);
    if (!form) return res.status(404).json({ message: 'Form not found' });
    const [categories] = await pool.execute(
      `SELECT id, category_name, amount, selection_type, is_required FROM crm_payment_form_categories WHERE payment_form_id=? ORDER BY display_order`,
      [form.id]
    );
    res.json({ data: { formKey: form.form_key, title: form.title, description: form.description, categories } });
  }));

  publicRouter.post('/:formKey/submit', wrap(async (req, res) => {
    const { name, email, phone, studentName, selectedCategoryIds } = req.body;
    if (!name || !email || !phone || !studentName) {
      return res.status(400).json({ message: 'Name, email, phone, and student name required' });
    }
    if (!Array.isArray(selectedCategoryIds) || !selectedCategoryIds.length) {
      return res.status(400).json({ message: 'Select at least one category' });
    }

    const [[form]] = await pool.execute(`SELECT * FROM crm_payment_forms WHERE form_key=? AND is_active=1`, [req.params.formKey]);
    if (!form) return res.status(404).json({ message: 'Form not found' });

    const [selectedCats] = await pool.execute(
      `SELECT id, category_name, amount FROM crm_payment_form_categories WHERE payment_form_id=? AND id IN (${selectedCategoryIds.map(() => '?').join(',')})`,
      [form.id, ...selectedCategoryIds]
    );

    if (selectedCats.length !== selectedCategoryIds.length) {
      return res.status(400).json({ message: 'Invalid category selection' });
    }

    const amount = selectedCats.reduce((sum, c) => sum + Number(c.amount), 0);
    if (amount <= 0) return res.status(400).json({ message: 'Total amount must be greater than 0' });

    try {
      const config = await branchConfig(pool, form.branch_id);
      const payload = {
        name: clean(name, 200), phone: clean(phone, 30).replace(/\D/g, ''), email: clean(email, 254),
        student_name: clean(studentName, 200), new_admission: true,
        details: [{ component_type: 'Payment', amount }],
        notes: [{ key: 'form_key', value: form.form_key }, { key: 'categories', value: selectedCats.map(c => c.category_name).join(', ') }]
      };

      const response = await jodo(config, 'production', 'POST', '', payload);
      const data = remoteData(response);
      const orderId = clean(data.order_id || data.id, 120);
      const redirectUrl = clean(data.redirect_url || data.payment_url, 1000);

      if (!orderId || !redirectUrl) throw Object.assign(new Error('Jodo failed to return order details'), { status: 502 });

      const [result] = await pool.execute(
        `INSERT INTO crm_payment_form_submissions (business_unit_id, payment_form_id, jodo_order_id, jodo_payment_url, payer_name, payer_email, payer_phone, student_name, selected_categories_json, amount, raw_response)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [form.business_unit_id, form.id, orderId, redirectUrl, name, email, phone, studentName, JSON.stringify(selectedCats), amount, JSON.stringify(response)]
      );

      res.json({ success: true, data: { submissionId: Number(result.insertId), orderId, redirectUrl, amount } });
    } catch (error) { throw error; }
  }));

  router.use('/admin', adminRouter);
  router.use('/public', publicRouter);
  return router;
}
