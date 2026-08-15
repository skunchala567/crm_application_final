/**
 * SMS templates, and sending by one.
 *
 * The SmartPing SMS account held a single DLT Content ID in its config, so
 * every message had to reuse one approved wording. The provider was never the
 * constraint -- its sendMessage() takes a per-message Content ID -- so this
 * keeps as many templates as the DLT portal has approved and picks the right
 * Content ID at send time.
 *
 * Bodies use {{1}}, {{2}} placeholders, matching the WhatsApp templates, so a
 * template means the same thing everywhere in the CRM.
 */
import { Router } from 'express';
import { assertTemplateVisible, attachAndFilterVisibility, saveTemplateVisibility } from './template-visibility.js';

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (status, message) => Object.assign(new Error(message), { status });
const text = (value, max) => {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/** How many distinct {{n}} placeholders a body uses. */
export function countVariables(body) {
  const seen = new Set();
  for (const match of String(body || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)) seen.add(match[1]);
  return seen.size;
}

/** Substitutes {{1}}, {{2}}… with the supplied values, in order. */
export function renderTemplate(body, params = []) {
  return String(body || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, index) => {
    const value = params[Number(index) - 1];
    return value === undefined || value === null ? whole : String(value);
  });
}

export function createSmsTemplateRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin, integrationService) {
  const router = Router();
  router.use(authenticate, requireCrmAccess);

  /** A template, only if it belongs to the integration being addressed. */
  async function templateFor(integrationId, templateId, user) {
    const [[row]] = await pool.execute(
      `SELECT * FROM crm_sms_templates WHERE id=? AND integration_id=? AND is_active=1`,
      [Number(templateId), Number(integrationId)],
    );
    if (!row) throw fail(404, 'SMS template not found for this account');
    await assertTemplateVisible(pool, 'sms', row.id, user);
    return row;
  }

  // ---- Templates ---------------------------------------------------------

  router.get('/integrations/:integrationId/sms-templates', wrap(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT id, integration_id AS integrationId, template_name AS templateName, category, body,
              dlt_content_id AS dltContentId, sender_id AS senderId, variable_count AS variableCount,
              sample_values_json AS sampleValues, is_active AS isActive, created_at_utc AS createdAt
         FROM crm_sms_templates WHERE integration_id=? ORDER BY template_name`,
      [Number(req.params.integrationId)],
    );
    const visibleRows = await attachAndFilterVisibility(pool, 'sms', rows, req.user);
    res.json({
      success: true,
      data: visibleRows.map(row => ({
        ...row,
        isActive: Boolean(row.isActive),
        sampleValues: typeof row.sampleValues === 'string' ? JSON.parse(row.sampleValues || '[]') : (row.sampleValues || []),
      })),
    });
  }));

  router.post('/integrations/:integrationId/sms-templates', requireUserAdmin, wrap(async (req, res) => {
    const integrationId = Number(req.params.integrationId);
    const templateName = text(req.body.templateName, 150);
    const body = text(req.body.body, 2000);
    const dltContentId = text(req.body.dltContentId, 32);
    if (!templateName) throw fail(400, 'Enter a template name');
    if (!body) throw fail(400, 'Enter the message text');
    // The operator rejects anything whose Content ID does not match the
    // wording registered on the DLT portal, so it is required up front.
    if (!/^\d{4,19}$/.test(dltContentId || '')) throw fail(400, 'DLT Content ID must contain 4 to 19 digits');
    const [[duplicate]] = await pool.execute(
      'SELECT id FROM crm_sms_templates WHERE integration_id=? AND template_name=?', [integrationId, templateName]);
    if (duplicate) throw fail(409, `"${templateName}" already exists on this account`);
    const [result] = await pool.execute(
      `INSERT INTO crm_sms_templates
         (integration_id, business_unit_id, template_name, category, body, dlt_content_id,
          sender_id, variable_count, sample_values_json, is_active, created_by_user_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [integrationId, Number(req.businessUnit?.id) || null, templateName,
       text(req.body.category, 60) || 'General', body, dltContentId,
       text(req.body.senderId, 16), countVariables(body),
       JSON.stringify(Array.isArray(req.body.sampleValues) ? req.body.sampleValues : []),
       req.body.isActive === false ? 0 : 1, Number(req.user?.id) || null],
    );
    await saveTemplateVisibility(pool, 'sms', result.insertId, req.body.visibleUserIds);
    res.status(201).json({ success: true, data: { id: result.insertId } });
  }));

  router.put('/sms-templates/:id', requireUserAdmin, wrap(async (req, res) => {
    const body = text(req.body.body, 2000);
    const dltContentId = text(req.body.dltContentId, 32);
    if (!body) throw fail(400, 'Enter the message text');
    if (!/^\d{4,19}$/.test(dltContentId || '')) throw fail(400, 'DLT Content ID must contain 4 to 19 digits');
    const [result] = await pool.execute(
      `UPDATE crm_sms_templates
          SET template_name=?, category=?, body=?, dlt_content_id=?, sender_id=?,
              variable_count=?, sample_values_json=?, is_active=?, updated_at_utc=CURRENT_TIMESTAMP(6)
        WHERE id=?`,
      [text(req.body.templateName, 150), text(req.body.category, 60) || 'General', body, dltContentId,
       text(req.body.senderId, 16), countVariables(body),
       JSON.stringify(Array.isArray(req.body.sampleValues) ? req.body.sampleValues : []),
       req.body.isActive === false ? 0 : 1, Number(req.params.id)],
    );
    if (!result.affectedRows) throw fail(404, 'SMS template not found');
    await saveTemplateVisibility(pool, 'sms', req.params.id, req.body.visibleUserIds);
    res.json({ success: true, message: 'SMS template saved' });
  }));

  router.delete('/sms-templates/:id', requireUserAdmin, wrap(async (req, res) => {
    const [result] = await pool.execute('DELETE FROM crm_sms_templates WHERE id=?', [Number(req.params.id)]);
    if (!result.affectedRows) throw fail(404, 'SMS template not found');
    res.json({ success: true, message: 'SMS template deleted' });
  }));

  /** What the message will look like, before anyone is charged for it. */
  router.post('/sms-templates/:id/preview', wrap(async (req, res) => {
    await assertTemplateVisible(pool, 'sms', req.params.id, req.user);
    const [[row]] = await pool.execute('SELECT body FROM crm_sms_templates WHERE id=?', [Number(req.params.id)]);
    if (!row) throw fail(404, 'SMS template not found');
    const rendered = renderTemplate(row.body, req.body.params || []);
    res.json({ success: true, data: { text: rendered, characters: rendered.length, segments: Math.ceil(rendered.length / 160) || 1 } });
  }));

  // ---- Sending -----------------------------------------------------------

  /** One recipient, one template. */
  router.post('/integrations/:integrationId/sms-templates/:templateId/send', wrap(async (req, res) => {
    const integrationId = Number(req.params.integrationId);
    const template = await templateFor(integrationId, req.params.templateId, req.user);
    const phoneNumber = text(req.body.phoneNumber, 20);
    if (!phoneNumber) throw fail(400, 'A phone number is required');
    const message = renderTemplate(template.body, req.body.params || []);
    const data = await integrationService.sendSmartpingSms(
      integrationId, Number(req.user?.organizationId) || 1, phoneNumber, message,
      {
        // The template's own Content ID, not the account's -- this is what
        // lifts the one-template limit.
        dltContentId: template.dlt_content_id,
        ...(template.sender_id ? { senderId: template.sender_id } : {}),
        leadId: req.body.leadId || null,
      },
    );
    res.json({ success: true, data });
  }));

  /**
   * Many recipients, one template.
   *
   * Each recipient may carry its own params, so a merge field like a student's
   * name differs per message while the approved wording stays identical.
   * Sent one at a time so a single bad number cannot lose the whole batch.
   */
  router.post('/integrations/:integrationId/sms-templates/:templateId/send-bulk', wrap(async (req, res) => {
    const integrationId = Number(req.params.integrationId);
    const template = await templateFor(integrationId, req.params.templateId, req.user);
    const recipients = Array.isArray(req.body.recipients) ? req.body.recipients : [];
    if (!recipients.length) throw fail(400, 'Add at least one recipient');
    if (recipients.length > 1000) throw fail(400, 'Send to at most 1000 recipients at a time');

    const organizationId = Number(req.user?.organizationId) || 1;
    const results = { requested: recipients.length, sent: 0, failed: 0, failures: [] };
    for (const entry of recipients) {
      const phoneNumber = text(typeof entry === 'string' ? entry : entry.phoneNumber, 20);
      if (!phoneNumber) { results.failed += 1; results.failures.push({ phoneNumber: null, error: 'missing number' }); continue; }
      try {
        await integrationService.sendSmartpingSms(
          integrationId, organizationId, phoneNumber,
          renderTemplate(template.body, (entry && entry.params) || req.body.params || []),
          {
            dltContentId: template.dlt_content_id,
            ...(template.sender_id ? { senderId: template.sender_id } : {}),
            leadId: (entry && entry.leadId) || null,
          },
        );
        results.sent += 1;
      } catch (error) {
        results.failed += 1;
        // Capped: a thousand identical errors help nobody, and the response
        // should stay readable.
        if (results.failures.length < 20) results.failures.push({ phoneNumber, error: error.message });
      }
    }
    res.json({ success: true, data: results });
  }));

  return router;
}

export default createSmsTemplateRoutes;
