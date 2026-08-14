/**
 * WhatsApp for a new action item.
 *
 * The Tracker already raises in-app notifications, which only reach someone
 * who is looking at the CRM. This sends the same news to the number captured
 * on each account in User Management: the owner gets the action-item template,
 * every approver gets the approval one.
 *
 * Both templates take the same two variables, in this order:
 *   {{1}}  the action item's title
 *   {{2}}  its due date
 *
 * Nothing here is allowed to fail an action item. The send runs after the
 * transaction commits and every error is logged and swallowed -- an
 * unreachable WhatsApp account must not stop work being assigned.
 */

/** Where a person's number comes from, in the order User Management fills it. */
const CONTACT_SQL = `
  SELECT u.id AS userId,
         COALESCE(NULLIF(p.phone,''), NULLIF(e.mobile_number,'')) AS phone,
         COALESCE(e.employee_name, CONCAT_WS(' ', p.first_name, p.last_name), u.email) AS name
    FROM app_users u
    LEFT JOIN employees e ON e.id = u.employee_id
    LEFT JOIN crm_user_profiles p ON p.user_id = u.id
   WHERE u.id = ?`;

/** Indian mobile, however it was typed in. */
function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits.length >= 10 ? digits.slice(-10) : '';
}

/** Read the unit's settings; null when the feature is off or unconfigured. */
export async function trackerNotificationSettings(pool, businessUnitId) {
  const [[row]] = await pool.execute(
    `SELECT is_enabled AS enabled, integration_id AS integrationId,
            action_item_template AS actionItemTemplate, approval_template AS approvalTemplate
       FROM crm_tracker_notification_settings WHERE business_unit_id=?`,
    [Number(businessUnitId)],
  );
  if (!row || !Number(row.enabled) || !row.integrationId) return null;
  return row;
}

/** The date as a person reads it, which is what goes into the template. */
function formatDue(dueAt) {
  if (!dueAt) return 'no deadline';
  const date = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(date.getTime())) return String(dueAt);
  return date.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
  });
}

async function contactFor(pool, userId) {
  if (!userId) return null;
  const [[row]] = await pool.execute(CONTACT_SQL, [Number(userId)]);
  if (!row) return null;
  const phone = normalizePhone(row.phone);
  return phone ? { ...row, phone } : null;
}

/**
 * The owner is held as an employee id, not a user id -- an action item can be
 * owned by someone with no CRM login. Their number still comes from the
 * employee record, so they are reachable either way.
 */
async function contactForEmployee(pool, employeeId) {
  if (!employeeId) return null;
  const [[row]] = await pool.execute(
    `SELECT u.id AS userId,
            COALESCE(NULLIF(p.phone,''), NULLIF(e.mobile_number,'')) AS phone,
            COALESCE(e.employee_name, u.email) AS name
       FROM employees e
       LEFT JOIN app_users u ON u.employee_id = e.id
       LEFT JOIN crm_user_profiles p ON p.user_id = u.id
      WHERE e.id = ? LIMIT 1`,
    [Number(employeeId)],
  );
  if (!row) return null;
  const phone = normalizePhone(row.phone);
  return phone ? { ...row, userId: row.userId || `emp-${employeeId}`, phone } : null;
}

/**
 * Send for one freshly created action item.
 *
 * @param {object} task  { businessUnitId, recordId, title, dueAt, ownerEmployeeId, approverUserIds }
 */
export async function notifyTrackerTask(pool, integrationService, task, logger = console) {
  try {
    const settings = await trackerNotificationSettings(pool, task.businessUnitId);
    if (!settings) return { skipped: 'not configured' };

    const params = [String(task.title || '').slice(0, 500), formatDue(task.dueAt)];
    const jobs = [];

    if (settings.actionItemTemplate && task.ownerEmployeeId) {
      const owner = await contactForEmployee(pool, task.ownerEmployeeId);
      if (owner) jobs.push({ contact: owner, template: settings.actionItemTemplate, role: 'owner' });
    }
    if (settings.approvalTemplate) {
      for (const approverUserId of task.approverUserIds || []) {
        const approver = await contactFor(pool, approverUserId);
        if (approver) jobs.push({ contact: approver, template: settings.approvalTemplate, role: 'approver' });
      }
    }
    if (!jobs.length) return { sent: 0, reason: 'no reachable contacts' };

    let sent = 0;
    for (const job of jobs) {
      try {
        await integrationService.sendSmartpingMessage(
          Number(settings.integrationId),
          1, // organization: the Tracker is single-tenant, as the send API expects
          job.contact.phone,
          `${params[0]} · due ${params[1]}`,
          {
            templateName: job.template,
            templateParams: params,
            userName: job.contact.name,
            source: 'Tracker',
            // Keyed on the record and the person, so a retried request cannot
            // message the same person about the same item twice.
            clientRequestId: `tracker:${task.recordId}:${job.role}:${job.contact.userId}`,
          },
        );
        sent += 1;
      } catch (error) {
        logger.error?.('[Tracker] WhatsApp notification failed', {
          recordId: task.recordId, role: job.role, userId: job.contact.userId, message: error.message,
        });
      }
    }
    logger.info?.('[Tracker] WhatsApp notifications sent', { recordId: task.recordId, sent, of: jobs.length });
    return { sent, of: jobs.length };
  } catch (error) {
    // Configuration or lookup failure: log, never propagate.
    logger.error?.('[Tracker] WhatsApp notification cycle failed', { message: error.message });
    return { error: error.message };
  }
}
