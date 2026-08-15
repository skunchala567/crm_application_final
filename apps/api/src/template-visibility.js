const TABLES = {
  email: 'crm_email_template_user_visibility',
  sms: 'crm_sms_template_user_visibility',
};

const readyPools = new WeakSet();

export const isTemplateAdmin = user => (user?.roles || [])
  .some(role => ['CRM_ADMIN', 'SUPER_ADMIN'].includes(String(role).toUpperCase()));

export async function ensureMessageTemplateVisibilitySchema(pool) {
  if (readyPools.has(pool)) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_email_template_user_visibility (
      template_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (template_id,user_id),
      KEY ix_email_template_visibility_user (user_id),
      CONSTRAINT fk_email_template_visibility_template FOREIGN KEY (template_id) REFERENCES crm_email_templates(id) ON DELETE CASCADE,
      CONSTRAINT fk_email_template_visibility_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_sms_template_user_visibility (
      template_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (template_id,user_id),
      KEY ix_sms_template_visibility_user (user_id),
      CONSTRAINT fk_sms_template_visibility_template FOREIGN KEY (template_id) REFERENCES crm_sms_templates(id) ON DELETE CASCADE,
      CONSTRAINT fk_sms_template_visibility_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  readyPools.add(pool);
}

function tableFor(channel) {
  const table = TABLES[channel];
  if (!table) throw new Error(`Unsupported template visibility channel: ${channel}`);
  return table;
}

export async function attachAndFilterVisibility(pool, channel, templates, user) {
  await ensureMessageTemplateVisibilitySchema(pool);
  const ids = [...new Set((templates || []).map(item => Number(item.id)).filter(Number.isInteger))];
  if (!ids.length) return [];
  const [rows] = await pool.query(
    `SELECT v.template_id AS templateId,v.user_id AS userId,
            COALESCE(e.employee_name,CONCAT_WS(' ',p.first_name,p.last_name),u.email) AS name,u.email
       FROM ${tableFor(channel)} v
       JOIN app_users u ON u.id=v.user_id AND u.is_active=TRUE
       LEFT JOIN employees e ON e.id=u.employee_id
       LEFT JOIN crm_user_profiles p ON p.user_id=u.id
      WHERE v.template_id IN (${ids.map(() => '?').join(',')}) ORDER BY name`,
    ids,
  );
  const usersByTemplate = new Map();
  for (const row of rows) {
    const id = Number(row.templateId);
    if (!usersByTemplate.has(id)) usersByTemplate.set(id, []);
    usersByTemplate.get(id).push({ id: Number(row.userId), name: row.name || row.email, email: row.email });
  }
  return templates.map(template => {
    const visibleUsers = usersByTemplate.get(Number(template.id)) || [];
    return { ...template, visibleUsers, visibleUserIds: visibleUsers.map(item => item.id) };
  }).filter(template => isTemplateAdmin(user) || template.visibleUserIds.includes(Number(user?.id)));
}

export async function saveTemplateVisibility(pool, channel, templateId, userIds) {
  await ensureMessageTemplateVisibilitySchema(pool);
  const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map(Number)
    .filter(id => Number.isInteger(id) && id > 0))];
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(`DELETE FROM ${tableFor(channel)} WHERE template_id=?`, [Number(templateId)]);
    for (const userId of ids) {
      await connection.execute(
        `INSERT IGNORE INTO ${tableFor(channel)}(template_id,user_id)
         SELECT ?,id FROM app_users WHERE id=? AND is_active=TRUE`,
        [Number(templateId), userId],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function assertTemplateVisible(pool, channel, templateId, user) {
  if (isTemplateAdmin(user)) return;
  await ensureMessageTemplateVisibilitySchema(pool);
  const [[row]] = await pool.execute(
    `SELECT 1 FROM ${tableFor(channel)} WHERE template_id=? AND user_id=? LIMIT 1`,
    [Number(templateId), Number(user?.id)],
  );
  if (!row) throw Object.assign(new Error(`${channel === 'sms' ? 'SMS' : 'Email'} template not found`), { status: 404 });
}
