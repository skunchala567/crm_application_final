const FIELD_COLUMNS = {
  stage: 'stage_id',
  substage: 'substage_id',
  branch: 'branch_id',
  source: 'source_id',
  channel: 'channel_id',
  campaign: 'campaign_id',
  class: 'class_id',
  curriculum: 'curriculum_id',
  owner: 'owner_employee_id',
  addedDate: 'created_at_utc',
  modifiedDate: 'modified_at_utc',
};

const DELAY_SECONDS = {
  immediate: 0,
  '1h': 60 * 60,
  '1d': 24 * 60 * 60,
  '3d': 3 * 24 * 60 * 60,
};

function parseJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

function asDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function relativeBoundary(condition, now) {
  const amount = Math.max(0, Number(condition.duration || 0));
  const multipliers = {
    minutes: 60_000,
    hours: 3_600_000,
    days: 86_400_000,
    weeks: 604_800_000,
    months: 2_629_746_000,
  };
  return new Date(now.getTime() - amount * (multipliers[condition.durationUnit] || multipliers.days));
}

function matchesCondition(lead, condition, now = new Date()) {
  const column = FIELD_COLUMNS[condition.field];
  if (!column) return false;
  const actual = lead[column];
  const operator = condition.operator || 'includes';

  if (operator === 'is_empty') return actual === null || actual === undefined || actual === '';
  if (operator === 'not_empty') return actual !== null && actual !== undefined && actual !== '';

  if (['addedDate', 'modifiedDate'].includes(condition.field)) {
    const actualDate = asDate(actual);
    if (!actualDate) return false;
    if (condition.dateMode === 'absolute') {
      const from = asDate(`${condition.dateFrom || ''}T00:00:00`);
      const to = asDate(`${condition.dateTo || condition.dateFrom || ''}T23:59:59.999`);
      if (!from) return false;
      if (operator === 'on') return actualDate >= from && actualDate <= to;
      if (operator === 'before') return actualDate < from;
      if (operator === 'after') return actualDate > to;
      if (operator === 'between') return Boolean(to) && actualDate >= from && actualDate <= to;
      return false;
    }
    const boundary = relativeBoundary(condition, now);
    return operator === 'not_within_last' ? actualDate < boundary : actualDate >= boundary;
  }

  const values = (Array.isArray(condition.values) ? condition.values : [])
    .map((value) => String(value));
  const actualValue = actual === null || actual === undefined ? '' : String(actual);
  const contains = values.includes(actualValue);
  if (operator === 'excludes' || operator === 'not_equals') return !contains;
  return contains;
}

function workflowMatches(lead, definition) {
  const conditions = Array.isArray(definition.conditions) ? definition.conditions : [];
  if (!conditions.length) return true;
  let result = matchesCondition(lead, conditions[0]);
  for (let index = 1; index < conditions.length; index += 1) {
    const connector = conditions[index - 1]?.joinWith || definition.logic || 'and';
    const next = matchesCondition(lead, conditions[index]);
    result = connector === 'or' ? result || next : result && next;
  }
  return result;
}

async function updateLead(connection, workflow, execution, lead, action) {
  const value = Number(action.value);
  if (!Number.isFinite(value) && action.field !== 'score') {
    throw new Error(`A valid ${action.field} value is required`);
  }

  if (action.field === 'stage') {
    const [[stage]] = await connection.execute(
      `SELECT id FROM crm_lead_stages WHERE id = ? AND is_active = TRUE LIMIT 1`,
      [value],
    );
    if (!stage) throw new Error('Selected stage is no longer available');
    const [[substage]] = await connection.execute(
      `SELECT id FROM crm_lead_substages
       WHERE stage_id = ? AND is_active = TRUE ORDER BY position, id LIMIT 1`,
      [value],
    );
    if (!substage) throw new Error('The selected stage has no active sub-stage');
    await connection.execute(
      `UPDATE crm_leads
       SET stage_id = ?, substage_id = ?, updated_by_user_id = ?,
           updated_at_utc = CURRENT_TIMESTAMP(6)
       WHERE id = ?`,
      [value, substage.id, workflow.created_by, lead.id],
    );
    if (Number(lead.stage_id) !== value || Number(lead.substage_id) !== Number(substage.id)) {
      await connection.execute(
        `INSERT INTO crm_lead_stage_history
         (lead_id, from_stage_id, to_stage_id, from_substage_id, to_substage_id,
          changed_by_user_id, changed_at_utc)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))`,
        [lead.id, lead.stage_id, value, lead.substage_id, substage.id, workflow.created_by],
      );
    }
    return `Stage updated to ${value}`;
  }

  const updates = {
    substage: ['substage_id', value],
    owner: ['owner_employee_id', value],
    score: ['lead_score', Math.max(0, Math.min(100, Number(action.value)))],
  };
  const update = updates[action.field];
  if (!update || !Number.isFinite(update[1])) {
    throw new Error(`Update action “${action.field}” is not supported`);
  }
  await connection.execute(
    `UPDATE crm_leads
     SET ${update[0]} = ?, updated_by_user_id = ?, updated_at_utc = CURRENT_TIMESTAMP(6)
     WHERE id = ?`,
    [update[1], workflow.created_by, lead.id],
  );
  return `${action.field} updated`;
}

async function performExecution(pool, execution, handlers) {
  const connection = await pool.getConnection();
  let transactionOpen = false;
  try {
    await connection.beginTransaction();
    transactionOpen = true;
    const [[claimed]] = await connection.execute(
      `SELECT e.*, w.definition_json, w.created_by, w.is_active,
              l.student_name, l.phone, l.stage_id, l.substage_id, l.branch_id, l.source_id, l.channel_id,
              l.campaign_id, l.class_id, l.curriculum_id, l.owner_employee_id,
              l.created_at_utc, COALESCE(l.updated_at_utc, l.created_at_utc) AS modified_at_utc
       FROM crm_automation_executions e
       JOIN crm_automation_workflows w ON w.id = e.workflow_id
       JOIN crm_leads l ON l.id = e.lead_id AND l.deleted_at_utc IS NULL
       WHERE e.id = ? FOR UPDATE`,
      [execution.id],
    );
    if (!claimed || claimed.status !== 'running') {
      await connection.rollback();
      return;
    }
    if (!claimed.is_active) throw new Error('Workflow was paused before execution');

    const definition = parseJson(claimed.definition_json);
    const action = parseJson(claimed.action_json);
    const isDelayedAction = action.delay && action.delay !== 'immediate';
    if (
      isDelayedAction &&
      !definition.noRecheckAfterDelay &&
      !workflowMatches(claimed, definition)
    ) {
      await connection.execute(
        `UPDATE crm_automation_executions
         SET status = 'skipped', error_message = 'Lead no longer matches the workflow conditions',
             executed_at_utc = CURRENT_TIMESTAMP(6)
         WHERE id = ?`,
        [claimed.id],
      );
      await connection.commit();
      return;
    }

    let result;
    if (action.type === 'update') {
      result = await updateLead(
        connection,
        { created_by: claimed.created_by },
        claimed,
        { ...claimed, id: claimed.lead_id },
        action,
      );
    } else if (action.type === 'whatsapp') {
      if (!handlers.sendWhatsApp) throw new Error('WhatsApp automation service is unavailable');
      if (!action.integrationId || !action.templateName || !action.templateBody) {
        throw new Error('WhatsApp account and approved template are required');
      }
      // The messaging service creates conversation/message rows that reference
      // this lead. Release the lead row lock before that separate service uses
      // another pooled connection, otherwise the FK check waits on our lock.
      await connection.commit();
      transactionOpen = false;
      const sent = await handlers.sendWhatsApp({
        integrationId: Number(action.integrationId),
        organizationId: Number(claimed.created_by),
        phoneNumber: claimed.phone,
        message: action.templateBody,
        options: {
          templateName: action.templateName,
          campaignName: action.templateName,
          templateParams: Array.isArray(action.templateParams) ? action.templateParams : [],
          language: action.templateLanguage || 'en',
          leadId: Number(claimed.lead_id),
          userName: claimed.student_name,
          source: 'CRM Automation',
          clientRequestId: `automation-${claimed.id}`,
        },
      });
      await connection.beginTransaction();
      transactionOpen = true;
      result = `WhatsApp template ${action.templateName} queued (${sent.messageId || sent.status || 'accepted'})`;
    } else {
      throw new Error(`${action.type || 'Unknown'} actions are not configured yet`);
    }
    await connection.execute(
      `INSERT INTO crm_lead_activities
       (lead_id, activity_type, summary, details_json, actor_user_id, occurred_at_utc)
       VALUES (?, 'Automation', ?, ?, ?, CURRENT_TIMESTAMP(6))`,
      [
        claimed.lead_id,
        `Workflow “${claimed.workflow_name || execution.workflow_name}” executed`,
        JSON.stringify({ workflowId: claimed.workflow_id, action, result }),
        claimed.created_by,
      ],
    );
    await connection.execute(
      `UPDATE crm_automation_executions
       SET status = 'completed', result_json = ?, error_message = NULL,
           executed_at_utc = CURRENT_TIMESTAMP(6)
       WHERE id = ?`,
      [JSON.stringify({ message: result }), claimed.id],
    );
    await connection.commit();
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) await connection.rollback();
    await pool.execute(
      `UPDATE crm_automation_executions
       SET status = 'failed', error_message = ?, attempts = attempts + 1,
           executed_at_utc = CURRENT_TIMESTAMP(6)
       WHERE id = ?`,
      [String(error.message || error).slice(0, 1000), execution.id],
    );
  } finally {
    connection.release();
  }
}

export async function ensureAutomationRuntimeSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_automation_executions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      workflow_id BIGINT UNSIGNED NOT NULL,
      lead_id BIGINT UNSIGNED NOT NULL,
      action_index SMALLINT UNSIGNED NOT NULL,
      action_json JSON NOT NULL,
      scheduled_for DATETIME(6) NOT NULL,
      status ENUM('pending','running','completed','skipped','failed') NOT NULL DEFAULT 'pending',
      attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      result_json JSON NULL,
      error_message VARCHAR(1000) NULL,
      executed_at_utc DATETIME(6) NULL,
      created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE KEY uq_crm_automation_execution (workflow_id, lead_id, action_index),
      KEY ix_crm_automation_execution_due (status, scheduled_for),
      KEY ix_crm_automation_execution_lead (lead_id),
      CONSTRAINT fk_crm_automation_execution_workflow FOREIGN KEY (workflow_id)
        REFERENCES crm_automation_workflows(id) ON DELETE CASCADE,
      CONSTRAINT fk_crm_automation_execution_lead FOREIGN KEY (lead_id)
        REFERENCES crm_leads(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

export function createAutomationEngine(pool, options = {}) {
  const handlers = options && typeof options === 'object' && !('error' in options)
    ? { logger: console, ...options }
    : { logger: options || console };
  const logger = handlers.logger;
  let running = false;

  async function runDueExecutions(workflowId = null) {
    const params = [];
    const workflowClause = workflowId ? 'AND e.workflow_id = ?' : '';
    if (workflowId) params.push(workflowId);
    const [due] = await pool.execute(
      `SELECT e.id, w.name AS workflow_name
       FROM crm_automation_executions e
       JOIN crm_automation_workflows w ON w.id = e.workflow_id
       WHERE e.status = 'pending' AND e.scheduled_for <= NOW()
         AND w.is_active = TRUE ${workflowClause}
       ORDER BY e.scheduled_for, e.id LIMIT 500`,
      params,
    );
    for (const execution of due) {
      const [claim] = await pool.execute(
        `UPDATE crm_automation_executions SET status = 'running'
         WHERE id = ? AND status = 'pending'`,
        [execution.id],
      );
      if (claim.affectedRows) await performExecution(pool, execution, handlers);
    }
  }

  async function run({ workflowId = null } = {}) {
    if (running) return { skipped: true, reason: 'Automation cycle already running' };
    running = true;
    let scheduled = 0;
    try {
      await pool.query(
        `UPDATE crm_automation_executions
         SET status='pending', error_message='Recovered after an interrupted automation cycle'
         WHERE status='running'
           AND COALESCE(updated_at_utc,created_at_utc) < DATE_SUB(NOW(), INTERVAL 2 MINUTE)`,
      );
      const params = [];
      const workflowClause = workflowId ? 'AND id = ?' : '';
      if (workflowId) params.push(workflowId);
      const [workflows] = await pool.execute(
        `SELECT id, name, definition_json, created_by, business_unit_id
         FROM crm_automation_workflows
         WHERE is_active = TRUE AND start_at IS NOT NULL AND start_at <= NOW()
         ${workflowClause}
         ORDER BY start_at, id`,
        params,
      );
      // Evaluate every workflow against the same immutable lead snapshot.
      // Actions from an earlier workflow must not change the conditions seen
      // by another workflow during the same cycle.
      const [leadSnapshot] = await pool.query(
        `SELECT id, business_unit_id, stage_id, substage_id, branch_id, source_id, channel_id,
                student_name, phone, campaign_id, class_id, curriculum_id,
                owner_employee_id, created_at_utc,
                COALESCE(updated_at_utc, created_at_utc) AS modified_at_utc
         FROM crm_leads WHERE deleted_at_utc IS NULL`,
      );
      for (const workflow of workflows) {
        const definition = parseJson(workflow.definition_json);
        const actions = Array.isArray(definition.actions) ? definition.actions : [];
        if (!actions.length) continue;
        for (const lead of leadSnapshot) {
          if (Number(lead.business_unit_id) !== Number(workflow.business_unit_id)) continue;
          if (!workflowMatches(lead, definition)) continue;
          for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
            const action = actions[actionIndex];
            const seconds = DELAY_SECONDS[action.delay] ?? 0;
            const [insert] = await pool.execute(
              `INSERT IGNORE INTO crm_automation_executions
               (workflow_id, lead_id, action_index, action_json, scheduled_for)
               VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
              [workflow.id, lead.id, actionIndex, JSON.stringify(action), seconds],
            );
            scheduled += insert.affectedRows;
          }
        }
      }
      await runDueExecutions(workflowId);
      return { skipped: false, scheduled };
    } catch (error) {
      logger.error('Automation workflow cycle failed:', error);
      throw error;
    } finally {
      running = false;
    }
  }

  return { run };
}
