const clipped = (value, max) => String(value ?? '').trim().slice(0, max);

export async function notifyUser(connection, {
  businessUnitId, userId, type, title, message, link = null, entityType = null, entityId = null, actorUserId = null,
}) {
  if (!Number(userId)) return;
  await connection.execute(
    `INSERT INTO crm_notifications
     (business_unit_id,user_id,notification_type,title,message,link_url,entity_type,entity_id,actor_user_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [Number(businessUnitId),Number(userId),clipped(type,40),clipped(title,160),clipped(message,500),
      link ? clipped(link,500) : null,entityType ? clipped(entityType,40) : null,entityId ? Number(entityId) : null,
      actorUserId ? Number(actorUserId) : null],
  );
}

export async function notifyEmployee(connection, notification) {
  if (!Number(notification.employeeId)) return;
  const [users] = await connection.execute(
    `SELECT DISTINCT u.id FROM app_users u
     JOIN crm_user_business_units ubu ON ubu.user_id=u.id AND ubu.business_unit_id=?
     WHERE u.employee_id=? AND u.is_active=TRUE`,
    [Number(notification.businessUnitId),Number(notification.employeeId)],
  );
  for (const user of users) await notifyUser(connection,{...notification,userId:Number(user.id)});
}
