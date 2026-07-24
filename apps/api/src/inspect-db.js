import 'dotenv/config';
import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

try {
  const [[server]] = await connection.query('SELECT VERSION() AS version, DATABASE() AS databaseName');
  const [tables] = await connection.query(`
    SELECT table_name AS tableName FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name IN ('branches','employees','app_users','roles','user_roles','user_branches','role_permissions','role_screen_access')
    ORDER BY table_name`);
  const [[counts]] = await connection.query(`
    SELECT (SELECT COUNT(*) FROM branches) AS branches,
           (SELECT COUNT(*) FROM employees) AS employees,
           (SELECT COUNT(*) FROM app_users) AS appUsers,
           (SELECT COUNT(*) FROM roles) AS roles`);
  const [columns] = await connection.query(`
    SELECT table_name AS tableName, column_name AS columnName, column_type AS columnType
    FROM information_schema.columns WHERE table_schema = DATABASE()
      AND ((table_name = 'branches' AND column_name = 'id')
        OR (table_name = 'employees' AND column_name IN ('id','branch_id'))
        OR (table_name = 'app_users' AND column_name IN ('id','branch_id','employee_id','password_hash')))
    ORDER BY table_name, column_name`);
  const [crmTables] = await connection.query(`
    SELECT table_name AS tableName FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name LIKE 'crm\\_%' ESCAPE '\\\\'
    ORDER BY table_name`);
  const [crmRoles] = await connection.query(`
    SELECT normalized_name AS name FROM roles
    WHERE normalized_name IN ('CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR','CRM_VIEWER')
    ORDER BY normalized_name`);
  const [[crmCounts]] = await connection.query(`
    SELECT (SELECT COUNT(*) FROM crm_lead_stages) AS stages,
           (SELECT COUNT(*) FROM crm_lead_sources) AS sources,
           (SELECT COUNT(*) FROM role_permissions WHERE permission_key LIKE 'crm.%' AND is_allowed = TRUE) AS allowedPermissions`);
  const [userRoleCounts] = await connection.query(`
    SELECT r.normalized_name AS role, COUNT(DISTINCT ur.user_id) AS users
    FROM roles r LEFT JOIN user_roles ur ON ur.role_id = r.id
    GROUP BY r.id, r.normalized_name ORDER BY r.normalized_name`);
  console.log(JSON.stringify({ server, tables: tables.map((row) => row.tableName), counts, columns,
    crmTables: crmTables.map((row) => row.tableName), crmRoles: crmRoles.map((row) => row.name), crmCounts,
    userRoleCounts: userRoleCounts.map((row) => ({ role: row.role, users: Number(row.users) })) }, null, 2));
} finally {
  await connection.end();
}
