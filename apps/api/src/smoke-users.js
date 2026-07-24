import 'dotenv/config';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
try {
  const [users] = await connection.query(`SELECT u.id, u.employee_id AS employeeId, u.email, COALESCE(e.employee_name,u.email) AS name FROM app_users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id LEFT JOIN employees e ON e.id=u.employee_id WHERE r.normalized_name='ADMIN' AND u.is_active=TRUE LIMIT 1`);
  if (!users.length) throw new Error('No active administrator account found.');
  const user = users[0];
  const [branches] = await connection.execute(`SELECT branch_id AS id FROM user_branches WHERE user_id=? UNION SELECT branch_id AS id FROM app_users WHERE id=? AND branch_id IS NOT NULL`, [user.id,user.id]);
  const token = jwt.sign({ id:Number(user.id),employeeId:user.employeeId?Number(user.employeeId):null,name:user.name,email:user.email,role:'ADMIN',roles:['ADMIN'],branchIds:branches.map(row=>Number(row.id)) }, process.env.JWT_SECRET, { expiresIn:'5m' });
  const headers = { Authorization:`Bearer ${token}` };
  const [listResponse,metaResponse] = await Promise.all([fetch(`http://localhost:${process.env.PORT||3001}/api/admin/users`,{headers}),fetch(`http://localhost:${process.env.PORT||3001}/api/admin/users/meta`,{headers})]);
  const list = await listResponse.json(); const meta = await metaResponse.json();
  if (!listResponse.ok) throw new Error(list.message); if (!metaResponse.ok) throw new Error(meta.message);
  console.log(JSON.stringify({crmUsers:list.data.length,activeEmployees:meta.employees.length,assignableBranches:meta.branches.length,roles:meta.roles.map(role=>role.name)},null,2));
} finally { await connection.end(); }
