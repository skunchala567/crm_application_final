import express from 'express';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { EMAIL_CATEGORIES, EmailService, MERGE_FIELDS, renderMergeFields, sanitizeEmailHtml } from './email.service.js';

const wrap = handler => async (req, res, next) => { try { await handler(req, res); } catch (error) { error.status ||= 500; next(error); } };
const text = (value, max = 10000) => String(value ?? '').trim().slice(0, max);
const parse = (value, fallback = []) => { try { return typeof value === 'string' ? JSON.parse(value) : value ?? fallback; } catch { return fallback; } };
const admin = req => (req.user?.roles || []).some(role => ['CRM_ADMIN','SUPER_ADMIN'].includes(String(role).toUpperCase()));

export function createEmailRoutes(pool, authenticate, requireCrmAccess, uploadRoot) {
  const router = express.Router();
  const service = new EmailService(pool, uploadRoot);
  router.use(authenticate, requireCrmAccess);

  router.get('/configuration', wrap(async (req, res) => {
    const row = await service.integration(service.org(req));
    res.json({ data: service.publicConfig(row) });
  }));
  router.put('/configuration', wrap(async (req, res) => {
    if (!admin(req)) return res.status(403).json({ message: 'Only CRM administrators can change SMTP settings' });
    res.json({ data: await service.saveConfig(req, req.body || {}) });
  }));
  router.post('/configuration/test', wrap(async (req, res) => {
    if (!admin(req)) return res.status(403).json({ message: 'Only CRM administrators can test SMTP settings' });
    res.json({ data: await service.testConnection(req) });
  }));
  router.post('/configuration/test-email', wrap(async (req, res) => {
    if (!admin(req)) return res.status(403).json({ message: 'Only CRM administrators can send SMTP test messages' });
    res.json({ data: await service.send(req, {
      to: req.body?.to, subject: 'CRM SMTP test email',
      bodyHtml: '<p>Your CRM SMTP configuration is working correctly.</p>'
    }, true) });
  }));

  router.post('/attachments', express.raw({ type: () => true, limit: '10mb' }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ message: 'Choose a file to attach' });
    const mimeType = text(req.headers['content-type'], 200).toLowerCase();
    const allowed = /^(image\/(jpeg|png|gif|webp)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.|vnd\.ms-excel|vnd\.ms-powerpoint)|text\/(plain|csv))/i;
    if (!allowed.test(mimeType)) return res.status(400).json({ message: 'This file type is not allowed' });
    const filename = path.basename(decodeURIComponent(text(req.headers['x-file-name'], 255) || 'attachment'));
    const token = `${Number(req.user.id)}-${crypto.randomUUID()}`;
    await fs.mkdir(uploadRoot, { recursive: true });
    await fs.writeFile(path.join(uploadRoot, token), req.body, { flag: 'wx' });
    res.status(201).json({ data: { token, filename, mimeType, size: req.body.length } });
  }));

  router.get('/merge-fields', (_req, res) => res.json({ data: MERGE_FIELDS }));
  router.get('/templates', wrap(async (req, res) => {
    await service.seedTemplates(service.org(req), req.user.id);
    const where = ['t.organization_id=?','t.deleted_at_utc IS NULL']; const values = [service.org(req)];
    if (req.query.status) { where.push('t.status=?'); values.push(text(req.query.status, 20).toUpperCase()); }
    if (req.query.category) { where.push('t.category=?'); values.push(text(req.query.category, 30)); }
    if (req.query.search) { where.push('(t.template_name LIKE ? OR t.subject LIKE ?)'); values.push(`%${text(req.query.search,100)}%`,`%${text(req.query.search,100)}%`); }
    const [rows] = await pool.execute(
      `SELECT t.id,t.template_name AS templateName,t.category,t.subject,t.body_html AS bodyHtml,t.body_text AS bodyText,
       t.status,t.created_at_utc AS createdAt,t.updated_at_utc AS updatedAt,
       COALESCE(ce.employee_name,cu.email) AS createdBy,COALESCE(ue.employee_name,uu.email) AS updatedBy
       FROM crm_email_templates t LEFT JOIN app_users cu ON cu.id=t.created_by_user_id LEFT JOIN employees ce ON ce.id=cu.employee_id
       LEFT JOIN app_users uu ON uu.id=t.updated_by_user_id LEFT JOIN employees ue ON ue.id=uu.employee_id
       WHERE ${where.join(' AND ')} ORDER BY COALESCE(t.updated_at_utc,t.created_at_utc) DESC`, values
    );
    res.json({ data: rows });
  }));
  router.get('/templates/:id', wrap(async (req, res) => {
    const [[row]] = await pool.execute(`SELECT id,template_name AS templateName,category,subject,body_html AS bodyHtml,body_text AS bodyText,status,created_at_utc AS createdAt,updated_at_utc AS updatedAt FROM crm_email_templates WHERE id=? AND organization_id=? AND deleted_at_utc IS NULL`, [req.params.id, service.org(req)]);
    if (!row) return res.status(404).json({ message: 'Email template not found' });
    res.json({ data: row });
  }));
  const validateTemplate = body => {
    if (!text(body.templateName,200) || !text(body.subject,500) || !text(body.bodyHtml,500000)) throw Object.assign(new Error('Template name, subject and body are required'), { status: 400 });
    if (!EMAIL_CATEGORIES.includes(body.category)) throw Object.assign(new Error('Choose a valid template category'), { status: 400 });
  };
  router.post('/templates', wrap(async (req, res) => {
    validateTemplate(req.body || {});
    const [created] = await pool.execute(
      `INSERT INTO crm_email_templates(organization_id,template_name,category,subject,body_html,body_text,status,created_by_user_id,updated_by_user_id)
       VALUES(?,?,?,?,?,?,?, ?,?)`, [service.org(req),text(req.body.templateName,200),req.body.category,text(req.body.subject,500),sanitizeEmailHtml(req.body.bodyHtml),text(req.body.bodyText,500000)||null,
       req.body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',req.user.id,req.user.id]
    );
    res.status(201).json({ data: { id: created.insertId } });
  }));
  router.put('/templates/:id', wrap(async (req, res) => {
    validateTemplate(req.body || {});
    const [result] = await pool.execute(
      `UPDATE crm_email_templates SET template_name=?,category=?,subject=?,body_html=?,body_text=?,status=?,updated_by_user_id=?
       WHERE id=? AND organization_id=? AND deleted_at_utc IS NULL`, [text(req.body.templateName,200),req.body.category,text(req.body.subject,500),sanitizeEmailHtml(req.body.bodyHtml),text(req.body.bodyText,500000)||null,
       req.body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',req.user.id,req.params.id,service.org(req)]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Email template not found' });
    res.json({ success: true });
  }));
  router.post('/templates/:id/duplicate', wrap(async (req, res) => {
    const [result] = await pool.execute(
      `INSERT INTO crm_email_templates(organization_id,template_name,category,subject,body_html,body_text,status,created_by_user_id,updated_by_user_id)
       SELECT organization_id,CONCAT(LEFT(template_name,180),' Copy'),category,subject,body_html,body_text,'INACTIVE',?,?
       FROM crm_email_templates WHERE id=? AND organization_id=? AND deleted_at_utc IS NULL`, [req.user.id,req.user.id,req.params.id,service.org(req)]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Email template not found' });
    res.status(201).json({ data: { id: result.insertId } });
  }));
  router.patch('/templates/:id/status', wrap(async (req, res) => {
    const status = req.body?.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
    const [result] = await pool.execute(`UPDATE crm_email_templates SET status=?,updated_by_user_id=? WHERE id=? AND organization_id=? AND deleted_at_utc IS NULL`, [status,req.user.id,req.params.id,service.org(req)]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Email template not found' });
    res.json({ success: true });
  }));
  router.delete('/templates/:id', wrap(async (req, res) => {
    const [result] = await pool.execute(`UPDATE crm_email_templates SET deleted_at_utc=NOW(),updated_by_user_id=? WHERE id=? AND organization_id=? AND deleted_at_utc IS NULL`, [req.user.id,req.params.id,service.org(req)]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Email template not found' });
    res.json({ success: true });
  }));

  router.post('/templates/:id/preview', wrap(async (req, res) => {
    const [[template]] = await pool.execute(`SELECT subject,body_html AS bodyHtml FROM crm_email_templates WHERE id=? AND organization_id=? AND deleted_at_utc IS NULL`, [req.params.id,service.org(req)]);
    if (!template) return res.status(404).json({ message: 'Email template not found' });
    const fields = await service.mergeContext(req.body?.leadId, req.user.id, service.org(req));
    res.json({ data: { subject: renderMergeFields(template.subject,fields), bodyHtml: renderMergeFields(template.bodyHtml,fields), fields } });
  }));
  router.post('/send', wrap(async (req, res) => res.json({ data: await service.send(req, req.body || {}) })));
  router.post('/messages/:id/retry', wrap(async (req, res) => res.json({ data: await service.retry(req, req.params.id) })));
  router.get('/leads/:leadId/messages', wrap(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT m.id,m.subject,m.to_json AS recipients,m.from_email AS fromEmail,m.body_html AS bodyHtml,m.status,m.error_message AS errorMessage,
       m.sent_at_utc AS sentAt,m.created_at_utc AS createdAt,COALESCE(e.employee_name,u.email) AS sentBy
       FROM crm_email_messages m LEFT JOIN app_users u ON u.id=m.sender_user_id LEFT JOIN employees e ON e.id=u.employee_id
       WHERE m.organization_id=? AND m.lead_id=? ORDER BY m.created_at_utc DESC`, [service.org(req),req.params.leadId]
    );
    res.json({ data: rows.map(row => ({ ...row, recipients: parse(row.recipients) })) });
  }));
  return router;
}
