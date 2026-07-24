import 'dotenv/config';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';

const baseUrl = `http://localhost:${process.env.PORT || 3001}/api`;
const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${path}: ${body.message}`);
  return body;
}

const [users] = await connection.query(`SELECT u.id, u.employee_id AS employeeId, u.email, COALESCE(e.employee_name, u.email) AS name FROM app_users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id LEFT JOIN employees e ON e.id = u.employee_id WHERE r.normalized_name = 'ADMIN' AND u.is_active = TRUE LIMIT 1`);
if (!users.length) throw new Error('No active ADMIN user exists for the smoke test.');
const user = users[0];
const [branchRows] = await connection.execute(`SELECT branch_id AS id FROM user_branches WHERE user_id = ? UNION SELECT branch_id AS id FROM app_users WHERE id = ? AND branch_id IS NOT NULL`, [user.id, user.id]);
const token = jwt.sign({ id: Number(user.id), employeeId: user.employeeId ? Number(user.employeeId) : null, name: user.name, email: user.email, role: 'ADMIN', roles: ['ADMIN'], branchIds: branchRows.map(row => Number(row.id)) }, process.env.JWT_SECRET, { expiresIn: '10m' });

try {
  const meta = await request('/leads/meta');
  if (!meta.branches.length || !meta.stages.length || !meta.classes.length || !meta.curricula.length) throw new Error('Lead metadata is incomplete.');
  const created = await request('/leads', { method: 'POST', body: JSON.stringify({ studentName: 'CRM System Test', phone: '9999999999', branchId: meta.branches[0].id, classId: meta.classes[0].id, curriculumId: meta.curricula[0].id, stageId: meta.stages[0].id, sourceId: meta.sources[0]?.id || null, leadScore: 50, remarks: 'Automated end-to-end verification record' }) });
  const detail = await request(`/leads/${created.id}`);
  await request(`/leads/${created.id}`, { method: 'PUT', body: JSON.stringify({ ...detail.data, studentName: 'CRM System Test Updated', branchId: detail.data.branchId, stageId: detail.data.stageId, leadScore: 55, nextFollowupAt: null }) });
  await request(`/leads/${created.id}`, { method: 'DELETE' });
  const list = await request('/leads?search=CRM%20System%20Test');
  console.log(JSON.stringify({ metadata: { branches: meta.branches.length, employees: meta.employees.length, stages: meta.stages.length, sources: meta.sources.length, classes: meta.classes.length, curricula: meta.curricula.length }, created: created.leadNumber, detailLoaded: detail.data.id === created.id, updated: true, softDeleted: list.total === 0 }, null, 2));
} finally {
  await connection.end();
}
