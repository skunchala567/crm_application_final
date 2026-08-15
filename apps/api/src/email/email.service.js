import nodemailer from 'nodemailer';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { decryptToken, encryptToken, getMasterKey } from '../integration-hub/crypto-utils.js';
import { assertTemplateVisible } from '../template-visibility.js';

export const EMAIL_CATEGORIES = ['Lead','Follow-up','Application','Admission','Payment','General','Other'];
export const MERGE_FIELDS = [
  'student_name','parent_name','lead_name','branch_name','class_name','counsellor_name',
  'counsellor_phone','application_number','application_date','followup_date','company_name'
];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const allowedMime = /^(image\/(jpeg|png|gif|webp)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.|vnd\.ms-excel|vnd\.ms-powerpoint)|text\/(plain|csv))/i;

const json = (value, fallback = {}) => {
  if (!value) return fallback;
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return fallback; }
};
const clean = (value, max = 10000) => String(value ?? '').trim().slice(0, max);
const stripHtml = html => String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
export const sanitizeEmailHtml = html => String(html || '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
  .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  .replace(/javascript\s*:/gi, '');

export function renderMergeFields(value, fields = {}) {
  return String(value || '').replace(/{{\s*([a-z0-9_]+)\s*}}/gi, (_all, key) => String(fields[key] ?? ''));
}

export class EmailService {
  constructor(pool, uploadRoot) { this.pool = pool; this.uploadRoot = uploadRoot; }
  org(req) { return Number(req.user?.organizationId || 1); }

  /**
   * One email account. Without an id this is the organisation's newest, which
   * is what a single-account setup has always meant.
   */
  async integration(organizationId, includeSecret = false, integrationId = null) {
    const [[row]] = integrationId
      ? await this.pool.execute(
          `SELECT * FROM crm_integrations WHERE id=? AND organization_id=? AND provider='smtp' AND deleted_at IS NULL LIMIT 1`,
          [Number(integrationId), organizationId])
      : await this.pool.execute(
          `SELECT * FROM crm_integrations WHERE organization_id=? AND provider='smtp' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`,
          [organizationId]);
    if (!row) return null;
    const config = json(row.config, {});
    if (includeSecret && config.passwordEncrypted) config.password = decryptToken(config.passwordEncrypted, getMasterKey());
    return { ...row, config };
  }

  /**
   * The accounts this user may send from.
   *
   * Email used to be one organisation-wide mailbox. Now each branch says which
   * accounts it sends from, so a counsellor is offered only the accounts of
   * the branches they work in -- an account belonging to another school should
   * not appear in their composer at all. An administrator with no branch
   * restriction sees every account, matching how branch scoping works
   * elsewhere in the CRM.
   */
  async accountsForUser(req) {
    const organizationId = this.org(req);
    const branchIds = Array.isArray(req.user?.branchIds)
      ? req.user.branchIds.map(Number).filter(Number.isFinite) : [];
    const unrestricted = !branchIds.length;
    const [rows] = unrestricted
      ? await this.pool.execute(
          `SELECT i.id, i.name, i.status, i.config FROM crm_integrations i
            WHERE i.organization_id=? AND i.provider='smtp' AND i.deleted_at IS NULL ORDER BY i.name, i.id`,
          [organizationId])
      : await this.pool.query(
          `SELECT DISTINCT i.id, i.name, i.status, i.config, MAX(bea.is_default) AS isDefault
             FROM crm_integrations i
             JOIN crm_branch_email_accounts bea ON bea.integration_id = i.id
            WHERE i.organization_id=? AND i.provider='smtp' AND i.deleted_at IS NULL
              AND bea.branch_id IN (${branchIds.map(() => '?').join(',')})
            GROUP BY i.id, i.name, i.status, i.config
            ORDER BY isDefault DESC, i.name, i.id`,
          [organizationId, ...branchIds]);
    return rows.map(row => {
      const config = json(row.config, {});
      return {
        id: Number(row.id), name: row.name, status: row.status,
        fromName: config.fromName || null, fromEmail: config.fromEmail || null,
        enabled: Boolean(config.enabled),
        isDefault: Boolean(row.isDefault),
      };
    });
  }

  /** Which branches send from an account, for the mapping screen. */
  async accountBranches(integrationId) {
    const [rows] = await this.pool.execute(
      `SELECT b.id, b.branch_name AS name, bea.is_default AS isDefault
         FROM crm_branch_email_accounts bea
         JOIN branches b ON b.id = bea.branch_id AND b.is_active = TRUE
        WHERE bea.integration_id = ? ORDER BY b.branch_name`,
      [Number(integrationId)]);
    return rows.map(row => ({ ...row, id: Number(row.id), isDefault: Boolean(row.isDefault) }));
  }

  /** Replace an account's branches wholesale, so unticking one removes it. */
  async setAccountBranches(req, integrationId, branchIds) {
    const ids = [...new Set((branchIds || []).map(Number).filter(Number.isFinite))];
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('DELETE FROM crm_branch_email_accounts WHERE integration_id=?', [Number(integrationId)]);
      for (const [index, branchId] of ids.entries()) {
        await connection.execute(
          `INSERT INTO crm_branch_email_accounts (branch_id, integration_id, is_default, created_by_user_id)
           VALUES (?,?,?,?)`,
          [branchId, Number(integrationId), index === 0 ? 1 : 0, Number(req.user?.id) || null]);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return { integrationId: Number(integrationId), branches: ids.length };
  }

  publicConfig(row) {
    if (!row) return { configured: false, enabled: false, encryption: 'tls' };
    const { passwordEncrypted, ...config } = row.config;
    return { id: Number(row.id), configured: true, hasPassword: Boolean(passwordEncrypted), status: row.status, ...config };
  }

  validateConfig(input, hasPassword = false) {
    const encryption = clean(input.encryption, 20).toLowerCase();
    if (!clean(input.smtpHost, 255)) throw Object.assign(new Error('SMTP host is required'), { status: 400 });
    const port = Number(input.smtpPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Object.assign(new Error('Enter a valid SMTP port'), { status: 400 });
    if (!['none','ssl','tls'].includes(encryption)) throw Object.assign(new Error('Choose a valid encryption mode'), { status: 400 });
    if (!clean(input.smtpUsername, 500)) throw Object.assign(new Error('SMTP username is required'), { status: 400 });
    if (!hasPassword && !clean(input.smtpPassword, 2000)) throw Object.assign(new Error('SMTP password or app password is required'), { status: 400 });
    if (!emailPattern.test(clean(input.fromEmail, 254))) throw Object.assign(new Error('Enter a valid From email'), { status: 400 });
    if (input.replyToEmail && !emailPattern.test(clean(input.replyToEmail, 254))) throw Object.assign(new Error('Enter a valid Reply-To email'), { status: 400 });
  }

  async saveConfig(req, input) {
    const organizationId = this.org(req);
    const existing = await this.integration(organizationId);
    this.validateConfig(input, Boolean(existing?.config?.passwordEncrypted));
    const passwordEncrypted = clean(input.smtpPassword, 2000)
      ? encryptToken(clean(input.smtpPassword, 2000), getMasterKey()) : existing.config.passwordEncrypted;
    const config = {
      enabled: input.enabled !== false,
      smtpHost: clean(input.smtpHost, 255), smtpPort: Number(input.smtpPort),
      encryption: clean(input.encryption, 20).toLowerCase(), smtpUsername: clean(input.smtpUsername, 500),
      passwordEncrypted, fromName: clean(input.fromName, 200), fromEmail: clean(input.fromEmail, 254),
      replyToEmail: clean(input.replyToEmail, 254)
    };
    if (existing) {
      await this.pool.execute(`UPDATE crm_integrations SET name='SMTP Email',config=?,status=?,updated_by=?,updated_at=NOW() WHERE id=?`,
        [JSON.stringify(config), config.enabled ? 'CONNECTED' : 'INACTIVE', req.user.id, existing.id]);
      return this.publicConfig({ ...existing, status: config.enabled ? 'CONNECTED' : 'INACTIVE', config });
    }
    const [result] = await this.pool.execute(
      `INSERT INTO crm_integrations(organization_id,name,type,provider,config,status,created_by,created_at,updated_at)
       VALUES(?,'SMTP Email','EMAIL','smtp',?,?,?,NOW(),NOW())`,
      [organizationId, JSON.stringify(config), config.enabled ? 'CONNECTED' : 'INACTIVE', req.user.id]
    );
    await this.seedTemplates(organizationId, req.user.id);
    return this.publicConfig({ id: result.insertId, status: config.enabled ? 'CONNECTED' : 'INACTIVE', config });
  }

  transport(config) {
    return nodemailer.createTransport({
      host: config.smtpHost, port: Number(config.smtpPort), secure: config.encryption === 'ssl',
      requireTLS: config.encryption === 'tls', ignoreTLS: config.encryption === 'none',
      auth: { user: config.smtpUsername, pass: config.password },
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
      tls: { minVersion: 'TLSv1.2' }
    });
  }

  async testConnection(req) {
    const integration = await this.integration(this.org(req), true);
    if (!integration) throw Object.assign(new Error('Save SMTP configuration first'), { status: 400 });
    this.validateConfig(integration.config, Boolean(integration.config.password));
    await this.transport(integration.config).verify();
    return { connected: true, message: 'SMTP connection and authentication succeeded' };
  }

  parseAddresses(value, label, required = false) {
    const list = Array.isArray(value) ? value : String(value || '').split(/[;,]/);
    const result = list.map(item => clean(item, 254)).filter(Boolean);
    if (required && !result.length) throw Object.assign(new Error(`${label} is required`), { status: 400 });
    if (result.some(item => !emailPattern.test(item))) throw Object.assign(new Error(`Enter valid ${label} addresses`), { status: 400 });
    return result;
  }

  async mergeContext(leadId, userId, organizationId = 1) {
    if (!leadId) return {};
    const [[row]] = await this.pool.execute(
      `SELECT l.lead_number,l.student_name,l.parent_name,l.created_at_utc,l.next_followup_at_utc,
        COALESCE(cls.display_name,l.applying_class) class_name,b.branch_name,
        COALESCE(owner.employee_name,actor_employee.employee_name,actor.email) counsellor_name,
        COALESCE(owner.mobile_number,actor_employee.mobile_number,'') counsellor_phone,
        COALESCE(o.name,'Admissions Team') company_name
       FROM crm_leads l LEFT JOIN crm_classes cls ON cls.id=l.class_id LEFT JOIN branches b ON b.id=l.branch_id
       LEFT JOIN employees owner ON owner.id=l.owner_employee_id LEFT JOIN app_users actor ON actor.id=?
       LEFT JOIN employees actor_employee ON actor_employee.id=actor.employee_id LEFT JOIN crm_organizations o ON o.id=?
       WHERE l.id=? AND l.deleted_at_utc IS NULL LIMIT 1`, [userId, organizationId, leadId]
    );
    if (!row) throw Object.assign(new Error('Lead not found'), { status: 404 });
    const date = value => value ? new Date(value).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '';
    return {
      student_name: row.student_name || '', parent_name: row.parent_name || '', lead_name: row.student_name || '',
      branch_name: row.branch_name || '', class_name: row.class_name || '', counsellor_name: row.counsellor_name || '',
      counsellor_phone: row.counsellor_phone || '', application_number: row.lead_number || '',
      application_date: date(row.created_at_utc), followup_date: date(row.next_followup_at_utc), company_name: row.company_name || 'Admissions Team'
    };
  }

  async seedTemplates(organizationId, userId) {
    const samples = [
      ['Lead Welcome','Lead','Welcome to {{company_name}}','Dear {{parent_name}},<br><br>Thank you for your interest in {{company_name}}.<br><br>Our counsellor {{counsellor_name}} will get in touch with you shortly to assist you with the admission process.<br><br>Regards,<br>{{counsellor_name}}<br>{{counsellor_phone}}<br>{{company_name}}'],
      ['Follow-up Reminder','Follow-up','Follow-up regarding your enquiry','Dear {{parent_name}},<br><br>This is a follow-up regarding your enquiry for {{student_name}}.<br><br>Our team would be happy to assist you with the next steps.<br><br>Regards,<br>{{counsellor_name}}<br>{{counsellor_phone}}<br>{{company_name}}'],
      ['Application Follow-up','Application','Follow-up regarding application {{application_number}}','Dear {{parent_name}},<br><br>We are following up regarding the application submitted for {{student_name}}.<br><br>Please contact us if you require any assistance with the admission process.<br><br>Regards,<br>{{counsellor_name}}<br>{{counsellor_phone}}'],
      ['General Communication','General','Important communication from {{company_name}}','Dear {{parent_name}},<br><br>We would like to share an important communication regarding {{student_name}}.<br><br>Please contact our team if you require any further information.<br><br>Regards,<br>{{company_name}}']
    ];
    for (const item of samples) await this.pool.execute(
      `INSERT INTO crm_email_templates(organization_id,template_name,category,subject,body_html,body_text,status,created_by_user_id,updated_by_user_id)
       SELECT ?,?,?,?,?,?,'ACTIVE',?,? FROM DUAL WHERE NOT EXISTS
       (SELECT 1 FROM crm_email_templates WHERE organization_id=? AND template_name=? AND deleted_at_utc IS NULL)`,
      [organizationId, item[0], item[1], item[2], item[3], stripHtml(item[3]), userId, userId, organizationId, item[0]]
    );
  }

  async attachmentFiles(userId, attachments = []) {
    if (!Array.isArray(attachments) || attachments.length > 10) throw Object.assign(new Error('A maximum of 10 attachments is allowed'), { status: 400 });
    let total = 0;
    const files = [];
    for (const item of attachments) {
      const token = clean(item.token, 200);
      if (!new RegExp(`^${Number(userId)}-[a-f0-9-]{36}$`).test(token)) throw Object.assign(new Error('Invalid attachment token'), { status: 400 });
      const filePath = path.join(this.uploadRoot, token);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat) throw Object.assign(new Error(`Attachment ${clean(item.filename, 255)} is no longer available`), { status: 400 });
      if (stat.size > 10 * 1024 * 1024) throw Object.assign(new Error('Each attachment must be 10 MB or smaller'), { status: 400 });
      total += stat.size;
      if (total > 20 * 1024 * 1024) throw Object.assign(new Error('Attachments may not exceed 20 MB in total'), { status: 400 });
      if (!allowedMime.test(clean(item.mimeType, 200))) throw Object.assign(new Error(`Unsupported attachment type: ${clean(item.filename, 255)}`), { status: 400 });
      files.push({ filename: clean(item.filename, 255), path: filePath, contentType: clean(item.mimeType, 200), size: stat.size, token });
    }
    return files;
  }

  async send(req, input, testOnly = false) {
    const organizationId = this.org(req);
    if (!testOnly && input.templateId) {
      const [[template]] = await this.pool.execute(
        `SELECT id FROM crm_email_templates WHERE id=? AND organization_id=? AND deleted_at_utc IS NULL LIMIT 1`,
        [Number(input.templateId), organizationId],
      );
      if (!template) throw Object.assign(new Error('Email template not found'), { status: 404 });
      await assertTemplateVisible(this.pool, 'email', template.id, req.user);
    }
    /*
     * The account to send from: the one the caller chose, else the
     * organisation's. A chosen account is checked against what this user may
     * use, so a request naming another branch's mailbox is refused rather
     * than honoured.
     */
    let integrationId = Number(input.integrationId) || null;
    if (integrationId) {
      const allowed = await this.accountsForUser(req);
      if (!allowed.some(account => account.id === integrationId)) {
        throw Object.assign(new Error('You cannot send from that email account'), { status: 403 });
      }
    }
    const integration = await this.integration(organizationId, true, integrationId);
    if (!integration || !integration.config.enabled) throw Object.assign(new Error('Email is not configured or enabled'), { status: 400 });
    const to = this.parseAddresses(input.to, 'recipient', true), cc = this.parseAddresses(input.cc, 'CC'), bcc = this.parseAddresses(input.bcc, 'BCC');
    if (!clean(input.subject, 500)) throw Object.assign(new Error('Email subject is required'), { status: 400 });
    if (!clean(input.bodyHtml, 500000)) throw Object.assign(new Error('Email body is required'), { status: 400 });
    const fields = await this.mergeContext(input.leadId, req.user.id, organizationId);
    const subject = renderMergeFields(clean(input.subject, 500), fields);
    const bodyHtml = sanitizeEmailHtml(renderMergeFields(input.bodyHtml, fields));
    const files = await this.attachmentFiles(req.user.id, input.attachments || []);
    let messageId = null;
    if (!testOnly) {
      const [created] = await this.pool.execute(
        `INSERT INTO crm_email_messages(organization_id,integration_id,lead_id,template_id,sender_user_id,from_name,from_email,to_json,cc_json,bcc_json,subject,body_html,body_text,attachments_json,status)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'SENDING')`,
        [organizationId,integration.id,input.leadId||null,input.templateId||null,req.user.id,integration.config.fromName,integration.config.fromEmail,
         JSON.stringify(to),JSON.stringify(cc),JSON.stringify(bcc),subject,bodyHtml,stripHtml(bodyHtml),JSON.stringify(files.map(({filename,size,contentType,token})=>({filename,size,mimeType:contentType,token})))]
      ); messageId = created.insertId;
    }
    try {
      const info = await this.transport(integration.config).sendMail({
        from: { name: integration.config.fromName || integration.config.fromEmail, address: integration.config.fromEmail },
        replyTo: integration.config.replyToEmail || undefined, to, cc, bcc, subject, html: bodyHtml, text: stripHtml(bodyHtml),
        attachments: files.map(({ filename, path: filePath, contentType }) => ({ filename, path: filePath, contentType }))
      });
      if (messageId) {
        await this.pool.execute(`UPDATE crm_email_messages SET status='SENT',smtp_message_id=?,sent_at_utc=NOW() WHERE id=?`, [info.messageId, messageId]);
        if (input.leadId) await this.pool.execute(
          `INSERT INTO crm_lead_activities(lead_id,activity_type,summary,details_json,actor_user_id)
           VALUES(?,'email_sent',?,?,?)`, [input.leadId, `Email sent · ${subject}`, JSON.stringify({ emailMessageId: messageId, subject, to, from: integration.config.fromEmail, status: 'SENT', bodyHtml }), req.user.id]
        );
      }
      await Promise.all(files.map(file => fs.unlink(file.path).catch(() => {})));
      return { sent: true, id: messageId, smtpMessageId: info.messageId };
    } catch (error) {
      if (messageId) await this.pool.execute(`UPDATE crm_email_messages SET status='FAILED',error_message=?,technical_error=? WHERE id=?`,
        ['Email could not be sent. Check the recipient or contact an administrator.', clean(error.message, 10000), messageId]);
      throw Object.assign(new Error('Email could not be sent. Please try again or contact an administrator.'), { status: 502, cause: error });
    }
  }

  /**
   * One template to many leads.
   *
   * Each lead is sent separately so merge fields resolve per recipient and one
   * bad address cannot lose the batch -- the same reasoning as the bulk SMS
   * path. Leads with no email address are reported rather than skipped
   * silently, since that is the most common reason a bulk send under-delivers.
   */
  async sendBulk(req, input) {
    const leadIds = [...new Set((input.leadIds || []).map(Number).filter(Number.isInteger))];
    if (!leadIds.length) throw Object.assign(new Error('Select at least one lead'), { status: 400 });
    if (leadIds.length > 500) throw Object.assign(new Error('Send to at most 500 leads at a time'), { status: 400 });
    const [leads] = await this.pool.query(
      `SELECT id, email, student_name AS studentName FROM crm_leads
        WHERE id IN (${leadIds.map(() => '?').join(',')}) AND deleted_at_utc IS NULL`, leadIds);

    const summary = { requested: leadIds.length, sent: 0, failed: 0, noEmail: 0, failures: [] };
    for (const lead of leads) {
      if (!lead.email) {
        summary.noEmail += 1;
        if (summary.failures.length < 20) summary.failures.push({ leadId: lead.id, name: lead.studentName, error: 'no email address' });
        continue;
      }
      try {
        await this.send(req, {
          ...input, leadId: lead.id, to: lead.email,
          // Attachments are consumed (unlinked) by the first send, so a bulk
          // run cannot reuse them.
          attachments: [],
        });
        summary.sent += 1;
      } catch (error) {
        summary.failed += 1;
        if (summary.failures.length < 20) summary.failures.push({ leadId: lead.id, name: lead.studentName, error: error.message });
      }
    }
    return summary;
  }

  async retry(req, id) {
    const [[message]] = await this.pool.execute(
      `SELECT * FROM crm_email_messages WHERE id=? AND organization_id=? AND status='FAILED' LIMIT 1`,
      [id, this.org(req)]
    );
    if (!message) throw Object.assign(new Error('Failed email was not found'), { status: 404 });
    return this.send(req, {
      leadId: message.lead_id, templateId: message.template_id,
      to: json(message.to_json, []), cc: json(message.cc_json, []), bcc: json(message.bcc_json, []),
      subject: message.subject, bodyHtml: message.body_html,
      attachments: json(message.attachments_json, []).map(item => ({ ...item, mimeType: item.mimeType }))
    });
  }
}
