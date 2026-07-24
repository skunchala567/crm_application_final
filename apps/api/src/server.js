import 'dotenv/config';
import cors from 'cors';
import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';
import ExcelJS from 'exceljs';
import { demoLeads, demoUser } from './data.js';
import { IntegrationHubService, createIntegrationHubRoutes } from './integration-hub/index.js';

const app = express();
const port = Number(process.env.PORT || 3001);
const jwtSecret = process.env.JWT_SECRET || 'local-development-secret-change-me';
const allowedOrigin = process.env.WEB_ORIGIN || 'http://localhost:3000';

if (process.env.DEMO_MODE && process.env.DEMO_MODE.toLowerCase() !== 'false') {
  throw new Error('DEMO_MODE is disabled for this CRM. Set DEMO_MODE=false and configure MySQL.');
}
const requiredDatabaseSettings = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];
const missingDatabaseSettings = requiredDatabaseSettings.filter((name) => !process.env[name]);
if (missingDatabaseSettings.length) {
  throw new Error(`MySQL configuration is required. Missing: ${missingDatabaseSettings.join(', ')}`);
}

app.use(cors({ origin: allowedOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
    timezone: '+05:30',
});
pool.on('connection', (connection) => connection.query("SET time_zone = '+05:30'"));

// ============= Integration Hub Setup =============
const integrationHubService = new IntegrationHubService(pool);

// Register providers
try {
  // Import and register Google Sheets provider (Phase 4)
  const { GoogleSheetsProvider } = await import('./integration-hub/providers/google-sheets-provider.js');
  integrationHubService.registerProvider('google_sheets', GoogleSheetsProvider);
  console.log('✓ Google Sheets provider registered');

  // Import and register WhatsApp provider (Phase 5)
  const { WhatsAppProvider } = await import('./integration-hub/providers/whatsapp-provider.js');
  integrationHubService.registerProvider('whatsapp', WhatsAppProvider);
  console.log('✓ WhatsApp provider registered');

  // SmartPing provider can be registered similarly
  // const { SmartPingProvider } = await import('./integration-hub/providers/smartping-provider.js');
  // integrationHubService.registerProvider('smartping', SmartPingProvider);
} catch (error) {
  console.error('❌ ERROR loading providers:');
  console.error('Message:', error.message);
  console.error('Stack:', error.stack);
  console.warn('Warning: Could not load providers:', error.message);
}

function verifyAttendancePassword(password, encoded) {
  const [version, iterationsText, saltText, hashText] = String(encoded || '').split('.');
  const iterations = Number(iterationsText);
  if (version !== 'v1' || !Number.isInteger(iterations) || !saltText || !hashText) return false;
  try {
    const salt = Buffer.from(saltText, 'base64');
    const expected = Buffer.from(hashText, 'base64');
    const actual = crypto.pbkdf2Sync(password, salt, iterations, expected.length, 'sha256');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function hashAttendancePassword(password) {
  const iterations = 210000;
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  return `v1.${iterations}.${salt.toString('base64')}.${hash.toString('base64')}`;
}

function issueToken(user) {
  return jwt.sign(user, jwtSecret, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
}

function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ message: 'Authentication required' });
  try {
    req.user = jwt.verify(token, jwtSecret);
    next();
  } catch {
    res.status(401).json({ message: 'Session expired or invalid' });
  }
}

const crmRoles = new Set(['ADMIN', 'CRM_ADMIN', 'ADMISSION_MANAGER', 'COUNSELLOR', 'CRM_VIEWER']);
async function requireCrmAccess(req, res, next) {
  if (!req.user.roles?.some((role) => crmRoles.has(role))) return res.status(403).json({ success: false, error: 'Your account does not have Admissions CRM access', details: `Required roles: ${Array.from(crmRoles).join(', ')}. Your roles: ${req.user.roles?.join(', ') || 'none'}` });
  const [rows]=await pool.execute(`SELECT COALESCE((SELECT is_active FROM crm_user_access_status WHERE user_id=?),1) AS crmActive`,[Number(req.user.id)]);
  if (!Boolean(rows[0]?.crmActive)) return res.status(403).json({ success: false, error: 'Your CRM access is inactive', details: 'Contact a CRM administrator to reactivate your access' });
  return next();
}

function requireLeadWrite(req, res, next) {
  const allowed = ['ADMIN', 'CRM_ADMIN', 'ADMISSION_MANAGER', 'COUNSELLOR'];
  if (req.user.roles?.some((role) => allowed.includes(role))) return next();
  return res.status(403).json({ success: false, error: 'Insufficient permissions for lead creation/import', details: `Required roles: ${allowed.join(', ')}. Your roles: ${req.user.roles?.join(', ') || 'none'}` });
}

function requireLeadDelete(req, res, next) {
  const allowed = ['ADMIN', 'CRM_ADMIN', 'ADMISSION_MANAGER'];
  if (req.user.roles?.some((role) => allowed.includes(role))) return next();
  return res.status(403).json({ message: 'Your CRM role cannot delete leads' });
}

function requireUserAdmin(req, res, next) {
  if (req.user.roles?.some((role) => ['ADMIN', 'CRM_ADMIN'].includes(role))) return next();
  return res.status(403).json({ message: 'CRM user administration requires CRM Admin access' });
}

function scopedWhere(user, column = 'l.branch_id') {
  const branchIds = Array.isArray(user.branchIds) ? user.branchIds.map(Number).filter(Number.isFinite) : [];
  if (user.roles?.includes('ADMIN') && branchIds.length === 0) return { sql: '1=1', params: [] };
  if (branchIds.length === 0) return { sql: '1=0', params: [] };
  return { sql: `${column} IN (${branchIds.map(() => '?').join(',')})`, params: branchIds };
}

function leadScopedWhere(user) {
  const branchIds = Array.isArray(user.branchIds) ? user.branchIds.map(Number).filter(Number.isFinite) : [];
  if (user.roles?.includes('ADMIN') && branchIds.length === 0) return { sql: '1=1', params: [] };
  if (branchIds.length === 0) return { sql: '1=0', params: [] };
  const placeholders = branchIds.map(() => '?').join(',');
  return {
    sql: `(l.branch_id IN (${placeholders}) OR l.referred_to_branch_id IN (${placeholders}))`,
    params: [...branchIds, ...branchIds],
  };
}

async function loadDatabaseUser(email) {
  const [rows] = await pool.execute(
    `SELECT u.id, u.employee_id AS employeeId, u.email, u.password_hash AS passwordHash,
            u.is_active AS isActive, COALESCE(cuas.is_active,1) AS crmActive, u.failed_login_count AS failedLoginCount,
            u.lockout_end_utc AS lockoutEndUtc,
            COALESCE(e.employee_name, u.email) AS name
     FROM app_users u
     LEFT JOIN crm_user_access_status cuas ON cuas.user_id=u.id
     LEFT JOIN employees e ON e.id = u.employee_id
     WHERE u.normalized_email = ? LIMIT 1`,
    [email.trim().toUpperCase()],
  );
  if (!rows.length) return null;
  const user = rows[0];
  const [roles] = await pool.execute(
    `SELECT r.normalized_name AS name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
    [user.id],
  );
  let [branches] = await pool.execute(`SELECT branch_id AS id FROM crm_user_branches WHERE user_id = ?`, [user.id]);
  if (branches.length === 0 && roles.some((role) => role.name === 'ADMIN')) {
    [branches] = await pool.execute(
      `SELECT ub.branch_id AS id FROM user_branches ub WHERE ub.user_id = ?
       UNION SELECT u.branch_id AS id FROM app_users u WHERE u.id = ? AND u.branch_id IS NOT NULL`,
      [user.id, user.id],
    );
  }
  return { ...user, roles: roles.map((role) => role.name), branchIds: branches.map((branch) => Number(branch.id)) };
}

app.get('/', (_req, res) => res.json({ name: 'Admissions CRM API', health: '/health' }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    const [[tables]] = await pool.query(
      `SELECT COUNT(*) AS count FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'crm_leads'`,
    );
    res.json({ status: 'ok', mode: 'mysql', database: 'connected', crmSchema: Number(tables.count) === 1 ? 'ready' : 'migration-required' });
  } catch (error) {
    res.status(503).json({ status: 'error', database: 'disconnected', message: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email = '', password = '' } = req.body;

  const databaseUser = await loadDatabaseUser(email);
  const locked = databaseUser?.lockoutEndUtc && new Date(databaseUser.lockoutEndUtc) > new Date();
  if (!databaseUser || !databaseUser.isActive || locked || !verifyAttendancePassword(password, databaseUser.passwordHash)) {
    if (databaseUser && !locked) {
      await pool.execute(
        `UPDATE app_users SET failed_login_count = failed_login_count + 1,
         lockout_end_utc = CASE WHEN failed_login_count + 1 >= 5 THEN DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL 15 MINUTE) ELSE lockout_end_utc END
         WHERE id = ?`, [databaseUser.id],
      );
    }
    return res.status(401).json({ message: 'Incorrect email or password' });
  }

  await pool.execute(
    `UPDATE app_users SET failed_login_count = 0, lockout_end_utc = NULL, last_login_at_utc = CURRENT_TIMESTAMP(6) WHERE id = ?`,
    [databaseUser.id],
  );
  const user = {
    id: Number(databaseUser.id), employeeId: databaseUser.employeeId ? Number(databaseUser.employeeId) : null,
    name: databaseUser.name, email: databaseUser.email, role: databaseUser.roles[0] || 'CRM User',
    roles: databaseUser.roles, branchIds: databaseUser.branchIds, crmActive:Boolean(databaseUser.crmActive),
  };
  res.json({ token: issueToken(user), user });
});

app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: req.user }));

app.get('/api/branches', authenticate, requireCrmAccess, async (req, res) => {
  const scope = scopedWhere(req.user, 'b.id');
  const [rows] = await pool.execute(
    `SELECT b.id, b.branch_name AS name, b.short_name AS shortName, b.time_zone_id AS timeZoneId
     FROM branches b WHERE b.is_active = TRUE AND ${scope.sql} ORDER BY b.branch_name`, scope.params,
  );
  res.json({ data: rows });
});

app.get('/api/employees', authenticate, requireCrmAccess, async (req, res) => {
  const scope = scopedWhere(req.user, 'e.branch_id');
  const [rows] = await pool.execute(
    `SELECT e.id, e.employee_number AS employeeNumber, e.employee_name AS name,
            e.department, e.designation, e.branch_id AS branchId, e.email, e.mobile_number AS mobileNumber
     FROM employees e WHERE e.status = 'Active' AND ${scope.sql}
     ORDER BY e.employee_name LIMIT 500`, scope.params,
  );
  res.json({ data: rows });
});

app.get('/api/dashboard', authenticate, requireCrmAccess, async (req, res) => {
  const scope = leadScopedWhere(req.user);
  const [[stats]] = await pool.execute(
    `SELECT COUNT(*) AS totalLeads,
       SUM(l.created_at_utc >= DATE_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)) AS newThisWeek,
       SUM(s.name = 'admitted') AS admissions
     FROM crm_leads l JOIN crm_lead_stages s ON s.id = l.stage_id
     WHERE l.deleted_at_utc IS NULL AND ${scope.sql}`, scope.params,
  );
  const [[followups]] = await pool.execute(
    `SELECT COUNT(*) AS followupsDue FROM crm_followups f JOIN crm_leads l ON l.id = f.lead_id
     WHERE f.status = 'pending' AND f.due_at_utc <= CURRENT_TIMESTAMP() AND l.deleted_at_utc IS NULL AND ${scope.sql}`, scope.params,
  );
  const [funnelRows] = await pool.execute(
    `SELECT s.display_name AS label, s.color_code AS color, COUNT(l.id) AS value
     FROM crm_lead_stages s LEFT JOIN crm_leads l ON l.stage_id = s.id AND l.deleted_at_utc IS NULL AND ${scope.sql}
     WHERE s.is_active = TRUE GROUP BY s.id, s.display_name, s.color_code, s.position ORDER BY s.position`, scope.params,
  );
  const recentLeads = await queryLeads(req.user, '', 4);
  res.json({
    stats: { totalLeads: Number(stats.totalLeads || 0), newThisWeek: Number(stats.newThisWeek || 0), followupsDue: Number(followups.followupsDue || 0), admissions: Number(stats.admissions || 0) },
    funnel: funnelRows.map((row) => ({ ...row, value: Number(row.value) })), recentLeads,
  });
});

async function queryLeads(user, search, limit = 100) {
  const scope = leadScopedWhere(user);
  search = String(search || '').trim();
  let whereClause = `(? = '' OR l.student_name LIKE ? OR l.phone LIKE ? OR l.lead_number LIKE ?)`;
  let params = [search, `%${search}%`, `%${search}%`, `%${search}%`];

  // Support comma-separated phone numbers
  if (search.includes(',')) {
    const phoneTokens = search.split(',')
      .map(t => String(t).trim().replace(/[^0-9]/g, ''))
      .filter(Boolean);
    const uniquePhones = [...new Set(phoneTokens)];
    if (uniquePhones.length > 0) {
      whereClause = `l.normalized_phone IN (${uniquePhones.map(() => '?').join(',')})`;
      params = uniquePhones;
    }
  }

  const [rows] = await pool.execute(
    `SELECT l.id, l.lead_number AS leadId, l.branch_id AS branchId, b.branch_name AS branch,
            l.student_name AS studentName, l.phone, l.email,
            l.class_id AS classId, COALESCE(cls.display_name, l.applying_class) AS applyingClass,
            l.curriculum_id AS curriculumId, cur.display_name AS curriculum,
            l.stage_id AS stageId, s.display_name AS stage, l.source_id AS sourceId, src.display_name AS source,
            l.substage_id AS substageId, l.channel_id AS channelId,
            l.campaign_id AS campaignId, l.admission_type_id AS admissionTypeId,
            ch.category AS channelCategory, camp.category AS campaignCategory,
            l.referred_by_employee_id AS referredByEmployeeId, l.touched_at_utc AS touchedAt,
            l.is_parent AS isParent, l.looking_for_admission AS lookingForAdmission, l.whatsapp_response AS whatsappResponse,
            l.lead_score AS score, l.owner_employee_id AS ownerEmployeeId,
            COALESCE(e.employee_name, 'Unassigned') AS owner, l.next_followup_at_utc AS nextFollowup,
            COALESCE(l.updated_at_utc,l.created_at_utc) AS recentModified,
            ((SELECT COUNT(*) FROM crm_lead_comments remark_count WHERE remark_count.lead_id=l.id)
              + CASE WHEN NULLIF(TRIM(l.remarks),'') IS NULL THEN 0 ELSE 1 END) AS remarksCount,
            l.referred_to_branch_id AS referredToBranchId,l.referred_to_branch_name AS referredToBranchName,l.referred_at_utc AS referredAt,
            l.created_at_utc AS addedAt, l.updated_at_utc AS updatedAt, l.re_enquired_at_utc AS reEnquiredAt
     FROM crm_leads l JOIN crm_lead_stages s ON s.id = l.stage_id JOIN branches b ON b.id = l.branch_id
     LEFT JOIN crm_classes cls ON cls.id = l.class_id LEFT JOIN crm_curricula cur ON cur.id = l.curriculum_id
     LEFT JOIN crm_lead_sources src ON src.id = l.source_id
     LEFT JOIN crm_lead_channels ch ON ch.id = l.channel_id LEFT JOIN crm_campaigns camp ON camp.id = l.campaign_id
     LEFT JOIN employees e ON e.id = l.owner_employee_id
     WHERE l.deleted_at_utc IS NULL AND ${scope.sql}
       AND ${whereClause}
     ORDER BY l.created_at_utc DESC LIMIT ${Number(limit)}`,
    [...scope.params, ...params],
  );
  return rows;
}

async function accessibleBranch(user, branchId) {
  const id = Number(branchId);
  if (!Number.isInteger(id) || id <= 0) return false;
  if (user.roles?.includes('ADMIN') && (!user.branchIds || user.branchIds.length === 0)) return true;
  return user.branchIds?.map(Number).includes(id) || false;
}

function cleanOptional(value, maxLength = 500) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maxLength) : null;
}

function validateLead(body) {
  const studentName = cleanOptional(body.studentName, 200);
  const phone = cleanOptional(body.phone, 30);
  const classId = Number(body.classId);
  if (!studentName) return 'Student name is required';
  if (!phone || !/^[0-9+()\-\s]{7,30}$/.test(phone)) return 'Enter a valid phone number';
  if (!Number.isInteger(classId) || classId <= 0) return 'Select a valid Class ID';
  const score = Number(body.leadScore ?? 0);
  if (!Number.isFinite(score) || score < 0 || score > 100) return 'Lead score must be between 0 and 100';
  return null;
}

async function validateStageFollowup(body) {
  const substageId = Number(body.substageId);
  const stageId = Number(body.stageId);

  if (!Number.isInteger(substageId) || substageId <= 0) return { error: 'Sub-stage ID is required' };
  if (!Number.isInteger(stageId) || stageId <= 0) return { error: 'Stage ID is required' };

  try {
    // Validate Stage ID exists
    const [[stage]] = await pool.query(
      `SELECT id, requires_followup AS requiresFollowup FROM crm_lead_stages WHERE id = ? AND is_active = TRUE`,
      [stageId]
    );
    if (!stage) return { error: 'Stage ID not found in database' };

    // Validate Sub-stage ID exists and belongs to Stage
    const [[substage]] = await pool.query(
      `SELECT id, stage_id AS substageStageId FROM crm_lead_substages WHERE id = ? AND is_active = TRUE`,
      [substageId]
    );
    if (!substage) return { error: 'Sub-stage ID not found in database' };

    if (String(substage.substageStageId) !== String(stageId)) {
      return { error: `Sub-stage ID does not belong to selected Stage` };
    }

    const required = Boolean(stage.requiresFollowup);
    if (!required) return { required: false, nextFollowupAt: null, followupType: null };

    // If followup is required, validate followup details
    const nextFollowupAt = cleanOptional(body.nextFollowupAt, 40);
    const followupType = cleanOptional(body.followupType, 30);
    if (!nextFollowupAt) return { error: 'Next follow-up date is required for this stage' };
    if (!followupType) return { error: 'Follow-up type is required for this stage' };

    const explicitIst = /(?:Z|[+-]\d\d:\d\d)$/i.test(nextFollowupAt) ? nextFollowupAt : `${nextFollowupAt}+05:30`;
    const followupTime = new Date(explicitIst).getTime();
    if (!Number.isFinite(followupTime) || followupTime <= Date.now()) return { error: 'Follow-up date must be in the future' };
    return { required: true, nextFollowupAt, followupType };
  } catch (err) {
    return { error: 'Error validating stage details' };
  }
}

async function validateSourceDetails(body) {
  const sourceId = Number(body.sourceId);
  const channelId = Number(body.channelId);

  // Only validate if both sourceId and channelId are provided (optional fields)
  if (!sourceId && !channelId) return null;
  if (!sourceId || !channelId) return 'Both Source ID and Channel ID must be provided together or both omitted';

  try {
    // Validate Source ID exists
    const [[sourceData]] = await pool.query(
      `SELECT id FROM crm_lead_sources WHERE id = ? AND is_active = TRUE LIMIT 1`,
      [sourceId]
    );
    if (!sourceData) return 'Source ID not found in database';

    // Validate Channel ID exists
    const [[channelData]] = await pool.query(
      `SELECT id FROM crm_lead_channels WHERE id = ? AND is_active = TRUE LIMIT 1`,
      [channelId]
    );
    if (!channelData) return 'Channel ID not found in database';

    // Validate Channel-Source relationship
    const [[linkData]] = await pool.query(
      `SELECT id FROM crm_lead_source_history WHERE source_id = ? AND channel_id = ? LIMIT 1`,
      [sourceId, channelId]
    );
    if (!linkData) return 'Source ID does not belong to selected Channel ID';

    return null;
  } catch (err) {
    return 'Error validating source details';
  }
}

app.get('/api/leads/meta', authenticate, requireCrmAccess, async (req, res) => {
  const scope = scopedWhere(req.user, 'b.id');
  const [stages] = await pool.query(`SELECT id, name, display_name AS displayName, color_code AS color, requires_followup AS requiresFollowup FROM crm_lead_stages WHERE is_active = TRUE ORDER BY position`);
  const [sources] = await pool.query(`SELECT id, name, display_name AS displayName FROM crm_lead_sources WHERE is_active = TRUE ORDER BY display_name`);
  const [classes] = await pool.query(`SELECT id, class_code AS code, display_name AS displayName FROM crm_classes WHERE is_active = TRUE ORDER BY position`);
  const [curricula] = await pool.query(`SELECT id, curriculum_code AS code, display_name AS displayName FROM crm_curricula WHERE is_active = TRUE ORDER BY position`);
  const [channels] = await pool.query(`SELECT c.id,c.channel_code AS code,c.display_name AS displayName,COALESCE(cc.display_name,c.category) category FROM crm_lead_channels c LEFT JOIN crm_channel_categories cc ON cc.id=c.category_id WHERE c.is_active=TRUE AND (cc.id IS NULL OR cc.is_active=TRUE) ORDER BY category,c.display_name`);
  const [campaigns] = await pool.query(`SELECT c.id,c.campaign_code AS code,c.display_name AS displayName,COALESCE(cc.display_name,c.category) category FROM crm_campaigns c LEFT JOIN crm_campaign_categories cc ON cc.id=c.category_id WHERE c.is_active=TRUE AND (cc.id IS NULL OR cc.is_active=TRUE) ORDER BY c.display_name`);
  const [sourceLinks]=await pool.query(`SELECT DISTINCT channel_id AS channelId,source_id AS sourceId FROM crm_lead_source_history WHERE channel_id IS NOT NULL AND source_id IS NOT NULL`);
  const [campaignLinks]=await pool.query(`SELECT DISTINCT source_id AS sourceId,campaign_id AS campaignId FROM crm_lead_source_history WHERE source_id IS NOT NULL AND campaign_id IS NOT NULL`);
  const [admissionTypes] = await pool.query(`SELECT id, type_code AS code, display_name AS displayName FROM crm_admission_types WHERE is_active = TRUE ORDER BY display_name`);
  const [substages] = await pool.query(`SELECT id, stage_id AS stageId, substage_code AS code, display_name AS displayName FROM crm_lead_substages WHERE is_active = TRUE ORDER BY stage_id, position`);
  const [branches] = await pool.execute(`SELECT b.id, b.branch_name AS name, b.short_name AS shortName FROM branches b WHERE b.is_active = TRUE AND ${scope.sql} ORDER BY b.branch_name`, scope.params);
  const [academicYears] = await pool.query(`SELECT id, academic_year AS academicYear, display_name AS displayName FROM crm_academic_years WHERE is_active = TRUE ORDER BY academic_year DESC`);
  const employeeScope = scopedWhere(req.user, 'assigned_branch.id');
  const [employees] = await pool.execute(
    `SELECT DISTINCT e.id, e.employee_name AS name,
            assigned_branch.id AS branchId, assigned_branch.branch_name AS branchName,
            e.department, e.designation
     FROM employees e
     JOIN app_users u ON u.employee_id = e.id AND u.is_active = TRUE
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     JOIN crm_user_branches user_access ON user_access.user_id = u.id
     JOIN branches assigned_branch ON assigned_branch.id = user_access.branch_id AND assigned_branch.is_active = TRUE
     WHERE e.status = 'Active'
       AND r.normalized_name IN ('ADMIN','CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR','CRM_VIEWER')
       AND ${employeeScope.sql}
     ORDER BY e.employee_name LIMIT 1000`,
    employeeScope.params,
  );
  res.json({ stages, sources, classes, curricula, channels, campaigns, sourceLinks, campaignLinks, admissionTypes, substages, branches, academicYears, employees });
});

app.get('/api/leads/:id', authenticate, requireCrmAccess, async (req, res) => {
  const scope = leadScopedWhere(req.user);
  const [rows] = await pool.execute(
    `SELECT l.id, l.lead_number AS leadId, l.branch_id AS branchId, l.student_name AS studentName,
      l.phone, l.alternate_phone AS alternatePhone, l.email, l.class_id AS classId,
      COALESCE(cls.display_name, l.applying_class) AS applyingClass, l.curriculum_id AS curriculumId,
      cur.display_name AS curriculum,
      l.academic_year AS academicYear, l.parent_name AS parentName, l.city, l.stage_id AS stageId,
      l.source_id AS sourceId, l.owner_employee_id AS ownerEmployeeId, l.lead_score AS leadScore,
      l.channel_id AS channelId, l.campaign_id AS campaignId,
      l.admission_type_id AS admissionTypeId, l.substage_id AS substageId,
      l.referred_to_branch_id AS referredToBranchId,l.referred_to_branch_name AS referredToBranchName,
      l.remarks, l.next_followup_at_utc AS nextFollowupAt, s.display_name AS stage,
      src.display_name AS source, b.branch_name AS branch, COALESCE(e.employee_name, 'Unassigned') AS owner,
      l.updated_at_utc AS remarksUpdatedAt,
      COALESCE(editor_employee.employee_name,editor_email_employee.employee_name,e.employee_name,'Previous counsellor') AS remarksAuthor,
      l.created_at_utc AS addedAt, l.updated_at_utc AS updatedAt, l.referred_at_utc AS referredAt, l.re_enquired_at_utc AS reEnquiredAt
     FROM crm_leads l JOIN crm_lead_stages s ON s.id = l.stage_id
     JOIN branches b ON b.id = l.branch_id LEFT JOIN crm_lead_sources src ON src.id = l.source_id
     LEFT JOIN crm_classes cls ON cls.id = l.class_id LEFT JOIN crm_curricula cur ON cur.id = l.curriculum_id
     LEFT JOIN employees e ON e.id = l.owner_employee_id
     LEFT JOIN app_users editor_user ON editor_user.id=l.updated_by_user_id
     LEFT JOIN employees editor_employee ON editor_employee.id=editor_user.employee_id
     LEFT JOIN employees editor_email_employee ON editor_user.employee_id IS NULL AND LOWER(editor_email_employee.email)=LOWER(editor_user.email)
     WHERE l.id = ? AND l.deleted_at_utc IS NULL AND ${scope.sql} LIMIT 1`,
    [Number(req.params.id), ...scope.params],
  );
  if (!rows.length) return res.status(404).json({ message: 'Lead not found' });
  const [activities] = await pool.execute(
    `SELECT a.id,a.activity_type AS type,a.summary,a.occurred_at_utc AS occurredAt,
            COALESCE(actor_employee.employee_name,actor_email_employee.employee_name,'CRM user') AS actorName,
            CASE WHEN a.activity_type='followup_updated' THEN (
              SELECT c.comment_text FROM crm_lead_comments c
              WHERE c.lead_id=a.lead_id AND c.created_by_user_id=a.actor_user_id
                AND ABS(TIMESTAMPDIFF(SECOND,c.created_at_utc,a.occurred_at_utc))<=5
              ORDER BY ABS(TIMESTAMPDIFF(MICROSECOND,c.created_at_utc,a.occurred_at_utc)) LIMIT 1
            ) ELSE NULL END AS commentText
     FROM crm_lead_activities a
     LEFT JOIN app_users actor_user ON actor_user.id=a.actor_user_id
     LEFT JOIN employees actor_employee ON actor_employee.id=actor_user.employee_id
     LEFT JOIN employees actor_email_employee ON actor_user.employee_id IS NULL AND LOWER(actor_email_employee.email)=LOWER(actor_user.email)
     WHERE a.lead_id=? ORDER BY a.occurred_at_utc DESC LIMIT 30`, [Number(req.params.id)],
  );
  const [comments] = await pool.execute(
    `SELECT c.id,c.comment_text AS commentText,c.created_at_utc AS createdAt,
            COALESCE(e.employee_name,email_employee.employee_name,'CRM user') AS counsellorName
     FROM crm_lead_comments c JOIN app_users u ON u.id=c.created_by_user_id
     LEFT JOIN employees e ON e.id=u.employee_id
     LEFT JOIN employees email_employee ON u.employee_id IS NULL AND LOWER(email_employee.email)=LOWER(u.email)
     WHERE c.lead_id=? ORDER BY c.created_at_utc DESC`, [Number(req.params.id)],
  );
  const [sourceHistory] = await pool.execute(
    `SELECT h.id,h.academic_year AS academicYear,h.is_primary AS isPrimary,h.intake_method AS intakeMethod,h.created_at_utc AS createdAt,
            src.display_name AS source,ch.display_name AS channel,c.display_name AS campaign,
            COALESCE(e.employee_name,email_employee.employee_name,'System integration') AS addedBy
     FROM crm_lead_source_history h
     JOIN crm_lead_sources src ON src.id=h.source_id JOIN crm_lead_channels ch ON ch.id=h.channel_id
     JOIN crm_campaigns c ON c.id=h.campaign_id
     LEFT JOIN app_users u ON u.id=h.created_by_user_id LEFT JOIN employees e ON e.id=u.employee_id
     LEFT JOIN employees email_employee ON u.employee_id IS NULL AND LOWER(email_employee.email)=LOWER(u.email)
     WHERE h.lead_id=? ORDER BY h.is_primary DESC,h.created_at_utc DESC`, [Number(req.params.id)],
  );
  const [[latestFollowup]] = await pool.execute(`SELECT followup_type AS followupType FROM crm_followups WHERE lead_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`, [Number(req.params.id)]);
  const legacyComment = rows[0].remarks ? [{ id:'legacy',commentText:rows[0].remarks,createdAt:rows[0].remarksUpdatedAt || null,counsellorName:rows[0].remarksAuthor }] : [];
  res.json({ data: { ...rows[0], followupType: latestFollowup?.followupType || '', activities, comments:[...comments,...legacyComment], sourceHistory } });
});

app.post('/api/leads', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
  const validationError = validateLead(req.body);
  if (validationError) return res.status(400).json({ message: validationError });
  let followup = { required: false, nextFollowupAt: null, followupType: null };
  const sourceId = Number(req.body.sourceId);
  const substageId = Number(req.body.substageId);
  if (Number.isInteger(sourceId) && sourceId > 0) {
    const sourceValidationError = await validateSourceDetails(req.body);
    if (sourceValidationError) return res.status(400).json({ message: sourceValidationError });
  }
  if (Number.isInteger(substageId) && substageId > 0) {
    followup = await validateStageFollowup(req.body);
    if (followup.error) return res.status(400).json({ message: followup.error });
  }
  if (!(await accessibleBranch(req.user, req.body.branchId))) return res.status(403).json({ message: 'You do not have access to the selected branch' });
  const connection = await pool.getConnection();
  const normalizedPhone = String(req.body.phone).replace(/[^0-9]/g, '');
  const intakeMethod = ['manual','bulk','integration'].includes(req.body.intakeMethod) ? req.body.intakeMethod : 'manual';
  const lockName = `crm-lead:${Number(req.body.branchId)}:${normalizedPhone}`;
  try {
    const [[lock]] = await connection.execute(`SELECT GET_LOCK(?,10) AS acquired`, [lockName]);
    if (!Number(lock.acquired)) return res.status(409).json({ message: 'This lead is being processed. Please retry.' });
    await connection.beginTransaction();
    const [[existing]] = await connection.execute(`SELECT id,lead_number AS leadNumber FROM crm_leads WHERE branch_id=? AND normalized_phone=? AND deleted_at_utc IS NULL ORDER BY id LIMIT 1 FOR UPDATE`, [Number(req.body.branchId),normalizedPhone]);
    if (existing) {
      await connection.execute(`INSERT INTO crm_lead_source_history(lead_id,academic_year,source_id,channel_id,campaign_id,is_primary,intake_method,created_by_user_id) VALUES(?,?,?,?,?,FALSE,?,?)`, [existing.id,cleanOptional(req.body.academicYear,20),Number(req.body.sourceId),Number(req.body.channelId),Number(req.body.campaignId),intakeMethod,Number(req.user.id)]);
      await connection.execute(`UPDATE crm_leads SET updated_at_utc=CURRENT_TIMESTAMP(6),updated_by_user_id=? WHERE id=?`, [Number(req.user.id),existing.id]);
      await connection.execute(`INSERT INTO crm_lead_activities(lead_id,activity_type,summary,actor_user_id) VALUES(?,'source_appended','Secondary source appended',?)`, [existing.id,Number(req.user.id)]);
      await connection.commit();
      return res.status(200).json({ id:Number(existing.id),leadNumber:existing.leadNumber,duplicatePrevented:true,message:'Existing lead found; the new source details were appended' });
    }
    const temporaryNumber = `PENDING-${crypto.randomUUID()}`;
    const [result] = await connection.execute(
      `INSERT INTO crm_leads (lead_number, branch_id, student_name, phone, normalized_phone, alternate_phone, email,
       applying_class, class_id, curriculum_id, academic_year, parent_name, city, stage_id, source_id,
       owner_employee_id, channel_id, campaign_id, admission_type_id, substage_id,
       lead_score, remarks, next_followup_at_utc, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [temporaryNumber, Number(req.body.branchId), cleanOptional(req.body.studentName, 200), cleanOptional(req.body.phone, 30),
       normalizedPhone, cleanOptional(req.body.alternatePhone, 30), cleanOptional(req.body.email, 254), cleanOptional(req.body.applyingClass, 50),
       Number(req.body.classId), Number(req.body.curriculumId), cleanOptional(req.body.academicYear, 20),
       cleanOptional(req.body.parentName, 200), cleanOptional(req.body.city, 100),
       Number(req.body.stageId), req.body.sourceId ? Number(req.body.sourceId) : null,
       req.body.ownerEmployeeId ? Number(req.body.ownerEmployeeId) : null,
       req.body.channelId ? Number(req.body.channelId) : null, req.body.campaignId ? Number(req.body.campaignId) : null, req.body.admissionTypeId ? Number(req.body.admissionTypeId) : null,
       req.body.substageId ? Number(req.body.substageId) : null, Number(req.body.leadScore || 0),
       cleanOptional(req.body.remarks, 10000), followup.nextFollowupAt, Number(req.user.id)],
    );
    const leadNumber = `ADM-${new Date().getFullYear()}-${String(result.insertId).padStart(6, '0')}`;
    await connection.execute(`UPDATE crm_leads SET lead_number = ? WHERE id = ?`, [leadNumber, result.insertId]);
    await connection.execute(`INSERT INTO crm_lead_source_history(lead_id,academic_year,source_id,channel_id,campaign_id,is_primary,intake_method,created_by_user_id) VALUES(?,?,?,?,?,TRUE,?,?)`, [result.insertId,cleanOptional(req.body.academicYear,20),Number(req.body.sourceId),Number(req.body.channelId),Number(req.body.campaignId),intakeMethod,Number(req.user.id)]);
    await connection.execute(`INSERT INTO crm_lead_activities (lead_id, activity_type, summary, actor_user_id) VALUES (?, 'created', 'Lead created', ?)`, [result.insertId, Number(req.user.id)]);
    if (followup.required) {
      await connection.execute(`INSERT INTO crm_followups (lead_id, assigned_employee_id, followup_type, due_at_utc, created_by_user_id) VALUES (?, ?, ?, ?, ?)`, [result.insertId, req.body.ownerEmployeeId ? Number(req.body.ownerEmployeeId) : null, followup.followupType, followup.nextFollowupAt, Number(req.user.id)]);
    }
    await connection.commit();
    res.status(201).json({ id: Number(result.insertId), leadNumber, message: 'Lead created successfully' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.execute(`SELECT RELEASE_LOCK(?)`, [lockName]).catch(()=>{});
    connection.release();
  }
});

app.put('/api/leads/:id', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
  const validationError = validateLead(req.body);
  if (validationError) return res.status(400).json({ message: validationError });
  let followup = { required: false, nextFollowupAt: null, followupType: null };
  const substageId = Number(req.body.substageId);
  if (Number.isInteger(substageId) && substageId > 0) {
    followup = await validateStageFollowup(req.body);
    if (followup.error) return res.status(400).json({ message: followup.error });
  }
  const scope = leadScopedWhere(req.user);
  const [result] = await pool.execute(
    `UPDATE crm_leads l SET student_name = ?,
      applying_class = ?, class_id = ?, curriculum_id = ?, parent_name = ?, city = ?, stage_id = ?,
      owner_employee_id = ?, admission_type_id = ?, substage_id = ?,
      lead_score = ?, remarks = ?, next_followup_at_utc = ?, updated_by_user_id = ?
     WHERE l.id = ? AND l.deleted_at_utc IS NULL AND ${scope.sql}`,
    [cleanOptional(req.body.studentName, 200), cleanOptional(req.body.applyingClass, 50),
     Number(req.body.classId), Number(req.body.curriculumId), cleanOptional(req.body.parentName, 200), cleanOptional(req.body.city, 100),
     Number(req.body.stageId),
     req.body.ownerEmployeeId ? Number(req.body.ownerEmployeeId) : null,
     req.body.admissionTypeId ? Number(req.body.admissionTypeId) : null,
     req.body.substageId ? Number(req.body.substageId) : null, Number(req.body.leadScore || 0),
     cleanOptional(req.body.remarks, 10000), followup.nextFollowupAt, Number(req.user.id), Number(req.params.id), ...scope.params],
  );
  if (!result.affectedRows) return res.status(404).json({ message: 'Lead not found' });
  const [[pendingFollowup]] = await pool.execute(`SELECT id FROM crm_followups WHERE lead_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`, [Number(req.params.id)]);
  if (followup.required && pendingFollowup) {
    await pool.execute(`UPDATE crm_followups SET assigned_employee_id=?,followup_type=?,due_at_utc=? WHERE id=?`, [req.body.ownerEmployeeId ? Number(req.body.ownerEmployeeId) : null, followup.followupType, followup.nextFollowupAt, pendingFollowup.id]);
  } else if (followup.required) {
    await pool.execute(`INSERT INTO crm_followups (lead_id,assigned_employee_id,followup_type,due_at_utc,created_by_user_id) VALUES (?,?,?,?,?)`, [Number(req.params.id), req.body.ownerEmployeeId ? Number(req.body.ownerEmployeeId) : null, followup.followupType, followup.nextFollowupAt, Number(req.user.id)]);
  } else if (pendingFollowup) {
    await pool.execute(`UPDATE crm_followups SET status='Cancelled' WHERE lead_id=? AND status='P'`, [Number(req.params.id)]);
  }
  await pool.execute(`INSERT INTO crm_lead_activities (lead_id, activity_type, summary, actor_user_id) VALUES (?, 'updated', 'Lead details updated', ?)`, [Number(req.params.id), Number(req.user.id)]);
  res.json({ message: 'Lead updated successfully' });
});

app.put('/api/leads/:id/followup-notes', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
  const leadId = Number(req.params.id);
  const stageId = Number(req.body.stageId);
  const substageId = Number(req.body.substageId);
  const comment = cleanOptional(req.body.comment, 10000);
  const referralBranchId = Number(req.body.referralBranchId);
  const referralEmployeeId = Number(req.body.referralEmployeeId);
  if (!Number.isInteger(stageId) || stageId <= 0) return res.status(400).json({ message: 'Stage is required' });
  if (!Number.isInteger(substageId) || substageId <= 0) return res.status(400).json({ message: 'Sub-stage is required' });
  if (!comment) return res.status(400).json({ message: 'New comment is required' });
  if (!Number.isInteger(referralBranchId) || referralBranchId <= 0) return res.status(400).json({ message: 'Referral branch is required' });
  if (!Number.isInteger(referralEmployeeId) || referralEmployeeId <= 0) return res.status(400).json({ message: 'Counsellor is required' });
  const [[validSubstage]] = await pool.execute(`SELECT ss.id,ss.display_name AS substageName,s.display_name AS stageName FROM crm_lead_substages ss JOIN crm_lead_stages s ON s.id=ss.stage_id WHERE ss.id=? AND ss.stage_id=? AND ss.is_active=TRUE AND s.is_active=TRUE LIMIT 1`, [substageId, stageId]);
  if (!validSubstage) return res.status(400).json({ message: 'Select a valid sub-stage for the selected stage' });
  const followup = await validateStageFollowup(req.body);
  if (followup.error) return res.status(400).json({ message: followup.error });
  const scope = leadScopedWhere(req.user);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[lead]] = await connection.execute(`SELECT l.owner_employee_id AS ownerEmployeeId FROM crm_leads l WHERE l.id=? AND l.deleted_at_utc IS NULL AND ${scope.sql} FOR UPDATE`, [leadId, ...scope.params]);
    if (!lead) { await connection.rollback(); return res.status(404).json({ message: 'Lead not found' }); }
    const [[counsellor]] = await connection.execute(
      `SELECT DISTINCT e.id,e.employee_name AS name,b.branch_name AS branchName
       FROM employees e
       JOIN app_users u ON u.employee_id=e.id AND u.is_active=TRUE
       JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
       JOIN crm_user_branches cub ON cub.user_id=u.id AND cub.branch_id=?
       JOIN branches b ON b.id=cub.branch_id AND b.is_active=TRUE
       LEFT JOIN crm_user_access_status cuas ON cuas.user_id=u.id
       WHERE e.id=? AND e.status='Active' AND COALESCE(cuas.is_active,1)=1
         AND r.normalized_name IN ('ADMIN','CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR') LIMIT 1`,
      [referralBranchId, referralEmployeeId],
    );
    if (!counsellor) { await connection.rollback(); return res.status(400).json({ message: 'The selected counsellor does not have active CRM access to the selected branch' }); }
    const [result] = await connection.execute(
      `UPDATE crm_leads SET stage_id=?,substage_id=?,next_followup_at_utc=?,owner_employee_id=?,referred_to_branch_id=?,referred_to_branch_name=?,referred_at_utc=CURRENT_TIMESTAMP(6),updated_by_user_id=? WHERE id=? AND deleted_at_utc IS NULL`,
      [stageId, substageId, followup.nextFollowupAt, referralEmployeeId, referralBranchId, counsellor.branchName, Number(req.user.id), leadId],
    );
    await connection.execute(`INSERT INTO crm_lead_comments (lead_id,comment_text,created_by_user_id) VALUES (?,?,?)`, [leadId, comment, Number(req.user.id)]);
    const [[pending]] = await connection.execute(`SELECT id FROM crm_followups WHERE lead_id=? AND status='P' ORDER BY id DESC LIMIT 1`, [leadId]);
    if (followup.required && pending) {
      await connection.execute(`UPDATE crm_followups SET assigned_employee_id=?,followup_type=?,due_at_utc=? WHERE id=?`, [referralEmployeeId, followup.followupType, followup.nextFollowupAt, pending.id]);
    } else if (followup.required) {
      await connection.execute(`INSERT INTO crm_followups (lead_id,assigned_employee_id,followup_type,due_at_utc,created_by_user_id) VALUES (?,?,?,?,?)`, [leadId, referralEmployeeId, followup.followupType, followup.nextFollowupAt, Number(req.user.id)]);
    } else {
      await connection.execute(`UPDATE crm_followups SET status='Cancelled' WHERE lead_id=? AND status='P'`, [leadId]);
    }
    await connection.execute(`INSERT INTO crm_lead_activities (lead_id,activity_type,summary,actor_user_id) VALUES (?,'followup_updated',?,?)`, [leadId, `Follow-up updated · ${validSubstage.stageName} · ${validSubstage.substageName}`, Number(req.user.id)]);
    await connection.execute(`INSERT INTO crm_lead_activities (lead_id,activity_type,summary,actor_user_id) VALUES (?,'referred',?,?)`, [leadId, `Lead assigned to ${counsellor.name} · ${counsellor.branchName}`, Number(req.user.id)]);
    await connection.commit();
    res.json({ message: 'Follow-up and notes updated successfully', updated: Boolean(result.affectedRows) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

app.post('/api/leads/:id/sources', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
  const leadId=Number(req.params.id);
  if (!cleanOptional(req.body.academicYear,20)) return res.status(400).json({message:'Academic year is required'});
  const sourceError=await validateSourceDetails(req.body);
  if(sourceError) return res.status(400).json({message:sourceError});
  const scope=leadScopedWhere(req.user);
  const [[lead]]=await pool.execute(`SELECT l.id FROM crm_leads l WHERE l.id=? AND l.deleted_at_utc IS NULL AND ${scope.sql} LIMIT 1`,[leadId,...scope.params]);
  if(!lead) return res.status(404).json({message:'Lead not found'});
  const values=[leadId,cleanOptional(req.body.academicYear,20),Number(req.body.sourceId),Number(req.body.channelId),Number(req.body.campaignId)];
  const [[duplicate]]=await pool.execute(`SELECT id FROM crm_lead_source_history WHERE lead_id=? AND academic_year=? AND source_id=? AND channel_id=? AND campaign_id=? LIMIT 1`,values);
  if(duplicate) return res.status(409).json({message:'These source details are already recorded for this lead'});
  await pool.execute(`INSERT INTO crm_lead_source_history(lead_id,academic_year,source_id,channel_id,campaign_id,is_primary,intake_method,created_by_user_id) VALUES(?,?,?,?,?,FALSE,'manual',?)`,[...values,Number(req.user.id)]);
  await pool.execute(`UPDATE crm_leads SET updated_at_utc=CURRENT_TIMESTAMP(6),updated_by_user_id=? WHERE id=?`,[Number(req.user.id),leadId]);
  await pool.execute(`INSERT INTO crm_lead_activities(lead_id,activity_type,summary,actor_user_id) VALUES(?,'source_appended','Secondary source appended',?)`,[leadId,Number(req.user.id)]);
  res.status(201).json({message:'Secondary source added successfully'});
});

app.put('/api/leads/actions/bulk-refer', authenticate, requireCrmAccess, requireLeadWrite, async (req,res)=>{
  const leadIds=[...new Set((Array.isArray(req.body.leadIds)?req.body.leadIds:[]).map(Number).filter(id=>Number.isInteger(id)&&id>0))];
  const employeeId=Number(req.body.employeeId),branchId=Number(req.body.branchId);
  if(!leadIds.length)return res.status(400).json({message:'No visible leads were supplied'});
  if(leadIds.length>500)return res.status(400).json({message:'A maximum of 500 visible leads can be referred at once'});
  if(!Number.isInteger(branchId)||branchId<=0)return res.status(400).json({message:'Select a referral branch'});
  if(!Number.isInteger(employeeId)||employeeId<=0)return res.status(400).json({message:'Select a counsellor'});
  const [[counsellor]]=await pool.execute(
    `SELECT DISTINCT e.id,e.employee_name AS name,b.branch_name AS branchName FROM employees e
     JOIN app_users u ON u.employee_id=e.id AND u.is_active=TRUE
     JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
     JOIN crm_user_branches cub ON cub.user_id=u.id AND cub.branch_id=?
     JOIN branches b ON b.id=cub.branch_id AND b.is_active=TRUE
     LEFT JOIN crm_user_access_status cuas ON cuas.user_id=u.id
     WHERE e.id=? AND e.status='Active' AND COALESCE(cuas.is_active,1)=1
       AND r.normalized_name IN ('ADMIN','CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR') LIMIT 1`,[branchId,employeeId]);
  if(!counsellor)return res.status(400).json({message:'The selected counsellor does not have active CRM access to the selected branch'});
  const placeholders=leadIds.map(()=>'?').join(',');
  const scope=leadScopedWhere(req.user);
  const [accessible]=await pool.execute(`SELECT l.id FROM crm_leads l WHERE l.id IN (${placeholders}) AND l.deleted_at_utc IS NULL AND ${scope.sql}`,[...leadIds,...scope.params]);
  if(accessible.length!==leadIds.length)return res.status(403).json({message:'One or more visible leads are outside your current access'});
  const connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    await connection.execute(`UPDATE crm_leads SET owner_employee_id=?,referred_to_branch_id=?,referred_to_branch_name=?,referred_at_utc=CURRENT_TIMESTAMP(6),updated_by_user_id=? WHERE id IN (${placeholders}) AND deleted_at_utc IS NULL`,[employeeId,branchId,counsellor.branchName,Number(req.user.id),...leadIds]);
    await connection.execute(`UPDATE crm_followups SET assigned_employee_id=? WHERE lead_id IN (${placeholders}) AND status='P'`,[employeeId,...leadIds]);
    for(const leadId of leadIds)await connection.execute(`INSERT INTO crm_lead_activities(lead_id,activity_type,summary,actor_user_id) VALUES(?,'referred',?,?)`,[leadId,`Lead referred to ${counsellor.name} · ${counsellor.branchName}`,Number(req.user.id)]);
    await connection.commit();
    res.json({message:`${leadIds.length} visible lead${leadIds.length===1?'':'s'} referred to ${counsellor.name} · ${counsellor.branchName}`});
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
});

app.put('/api/leads/:id/refer', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
  const leadId = Number(req.params.id);
  const employeeId = Number(req.body.employeeId);
  const branchId = Number(req.body.branchId);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return res.status(400).json({ message: 'Select a counsellor' });
  if (!Number.isInteger(branchId) || branchId <= 0) return res.status(400).json({ message: 'Select a referral branch' });
  const scope = leadScopedWhere(req.user);
  const [[counsellor]] = await pool.execute(
    `SELECT DISTINCT e.id,e.employee_name AS name,referral_branch.branch_name AS branchName
     FROM crm_leads l
     JOIN employees e ON e.id=? AND e.status='Active'
     JOIN app_users u ON u.employee_id=e.id AND u.is_active=TRUE
     JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
     JOIN crm_user_branches cub ON cub.user_id=u.id AND cub.branch_id=?
     JOIN branches referral_branch ON referral_branch.id=cub.branch_id AND referral_branch.is_active=TRUE
     LEFT JOIN crm_user_access_status cuas ON cuas.user_id=u.id
     WHERE l.id=? AND l.deleted_at_utc IS NULL AND COALESCE(cuas.is_active,1)=1
       AND r.normalized_name IN ('ADMIN','CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR') AND ${scope.sql}
     LIMIT 1`,
    [employeeId, branchId, leadId, ...scope.params],
  );
  if (!counsellor) return res.status(400).json({ message: 'The selected counsellor does not have active CRM access to the selected branch' });
  const [result] = await pool.execute(`UPDATE crm_leads SET owner_employee_id=?,referred_to_branch_id=?,referred_to_branch_name=?,referred_at_utc=CURRENT_TIMESTAMP(6),updated_by_user_id=? WHERE id=? AND deleted_at_utc IS NULL`, [employeeId, branchId, counsellor.branchName, Number(req.user.id), leadId]);
  if (!result.affectedRows) return res.status(404).json({ message: 'Lead not found' });
  await pool.execute(`UPDATE crm_followups SET assigned_employee_id=? WHERE lead_id=? AND status='P'`, [employeeId, leadId]);
  await pool.execute(`INSERT INTO crm_lead_activities (lead_id,activity_type,summary,actor_user_id) VALUES (?,'referred',?,?)`, [leadId, `Lead referred to ${counsellor.name} · ${counsellor.branchName}`, Number(req.user.id)]);
  res.json({ message: `Lead referred to ${counsellor.name} · ${counsellor.branchName}` });
});

app.put('/api/leads/:id/mark-re-enquired', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
  const leadId = Number(req.params.id);
  const scope = leadScopedWhere(req.user);
  const [result] = await pool.execute(`UPDATE crm_leads SET re_enquired_at_utc=CURRENT_TIMESTAMP(6),updated_by_user_id=? WHERE id=? AND deleted_at_utc IS NULL AND ${scope.sql}`, [Number(req.user.id), leadId, ...scope.params]);
  if (!result.affectedRows) return res.status(404).json({ message: 'Lead not found' });
  await pool.execute(`INSERT INTO crm_lead_activities (lead_id,activity_type,summary,actor_user_id) VALUES (?,'re_enquired','Lead marked as re-enquiry',?)`, [leadId, Number(req.user.id)]);
  res.json({ message: 'Lead marked as re-enquiry' });
});

app.put('/api/leads/:id/change-stage', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
  const leadId = Number(req.params.id);
  const stageId = Number(req.body.stageId);
  const substageId = Number(req.body.substageId);
  if (!Number.isInteger(stageId) || stageId <= 0) return res.status(400).json({ message: 'Select a stage' });
  if (!Number.isInteger(substageId) || substageId <= 0) return res.status(400).json({ message: 'Select a sub-stage' });
  const scope = leadScopedWhere(req.user);
  const [[lead]] = await pool.execute(`SELECT stage_id, substage_id FROM crm_leads WHERE id=? AND deleted_at_utc IS NULL AND ${scope.sql} LIMIT 1`, [leadId, ...scope.params]);
  if (!lead) return res.status(404).json({ message: 'Lead not found' });
  const [[stage]] = await pool.execute(`SELECT id, display_name FROM crm_lead_stages WHERE id=? LIMIT 1`, [stageId]);
  const [[substage]] = await pool.execute(`SELECT id, display_name FROM crm_lead_substages WHERE id=? LIMIT 1`, [substageId]);
  if (!stage || !substage) return res.status(400).json({ message: 'Invalid stage or sub-stage' });
  const [[oldStage]] = await pool.execute(`SELECT display_name FROM crm_lead_stages WHERE id=? LIMIT 1`, [lead.stage_id]);
  const oldStageName = oldStage?.display_name || 'Unknown';
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(`UPDATE crm_leads SET stage_id=?, substage_id=?, updated_by_user_id=?, updated_at_utc=CURRENT_TIMESTAMP(6) WHERE id=?`, [stageId, substageId, Number(req.user.id), leadId]);
    await connection.execute(`INSERT INTO crm_lead_stage_history (lead_id, from_stage_id, to_stage_id, from_substage_id, to_substage_id, changed_by_user_id, changed_at_utc) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))`, [leadId, lead.stage_id, stageId, lead.substage_id, substageId, Number(req.user.id)]);
    await connection.execute(`INSERT INTO crm_lead_activities (lead_id, activity_type, summary, actor_user_id) VALUES (?, 'stage_change', ?, ?)`, [leadId, `Stage changed from ${oldStageName} to ${stage.display_name}`, Number(req.user.id)]);
    await connection.commit();
    res.json({ message: `Lead stage changed to ${stage.display_name}` });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

app.put('/api/leads/actions/bulk-change-stage', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
  const leadIds = [...new Set((Array.isArray(req.body.leadIds) ? req.body.leadIds : []).map(Number).filter(id => Number.isInteger(id) && id > 0))];
  const stageId = Number(req.body.stageId);
  const substageId = Number(req.body.substageId);
  if (!leadIds.length) return res.status(400).json({ message: 'No leads were supplied' });
  if (leadIds.length > 500) return res.status(400).json({ message: 'A maximum of 500 leads can be updated at once' });
  if (!Number.isInteger(stageId) || stageId <= 0) return res.status(400).json({ message: 'Select a stage' });
  if (!Number.isInteger(substageId) || substageId <= 0) return res.status(400).json({ message: 'Select a sub-stage' });
  const [[stage]] = await pool.execute(`SELECT id, display_name FROM crm_lead_stages WHERE id=? LIMIT 1`, [stageId]);
  const [[substage]] = await pool.execute(`SELECT id, display_name FROM crm_lead_substages WHERE id=? LIMIT 1`, [substageId]);
  if (!stage || !substage) return res.status(400).json({ message: 'Invalid stage or sub-stage' });
  const placeholders = leadIds.map(() => '?').join(',');
  const scope = leadScopedWhere(req.user);
  const [accessible] = await pool.execute(`SELECT l.id, l.stage_id, l.substage_id FROM crm_leads l WHERE l.id IN (${placeholders}) AND l.deleted_at_utc IS NULL AND ${scope.sql}`, [...leadIds, ...scope.params]);
  if (accessible.length !== leadIds.length) return res.status(403).json({ message: 'One or more leads are outside your current access' });
  const connection = await pool.getConnection();
  let successCount = 0;
  const failures = [];
  try {
    await connection.beginTransaction();
    for (const lead of accessible) {
      try {
        const [[oldStage]] = await connection.execute(`SELECT display_name FROM crm_lead_stages WHERE id=? LIMIT 1`, [lead.stage_id]);
        const oldStageName = oldStage?.display_name || 'Unknown';
        await connection.execute(`UPDATE crm_leads SET stage_id=?, substage_id=?, updated_by_user_id=?, updated_at_utc=CURRENT_TIMESTAMP(6) WHERE id=?`, [stageId, substageId, Number(req.user.id), lead.id]);
        await connection.execute(`INSERT INTO crm_lead_stage_history (lead_id, from_stage_id, to_stage_id, from_substage_id, to_substage_id, changed_by_user_id, changed_at_utc) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))`, [lead.id, lead.stage_id, stageId, lead.substage_id, substageId, Number(req.user.id)]);
        await connection.execute(`INSERT INTO crm_lead_activities (lead_id, activity_type, summary, actor_user_id) VALUES (?, 'stage_change', ?, ?)`, [lead.id, `Stage changed from ${oldStageName} to ${stage.display_name}`, Number(req.user.id)]);
        successCount++;
      } catch (error) {
        failures.push({ leadId: lead.id, error: error.message });
      }
    }
    await connection.commit();
    res.json({
      message: `${successCount} lead${successCount === 1 ? '' : 's'} updated${failures.length ? ` (${failures.length} failed)` : ''}`,
      successCount,
      failedCount: failures.length,
      failures: failures.length ? failures : undefined,
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

app.get('/api/leads/referral-options/all', authenticate, requireCrmAccess, async (req, res) => {
  const [branches] = await pool.query(`SELECT id,branch_name AS name,short_name AS shortName FROM branches WHERE is_active=TRUE ORDER BY branch_name`);
  const [employees] = await pool.query(
    `SELECT DISTINCT e.id,e.employee_name AS name,b.id AS branchId,b.branch_name AS branchName
     FROM employees e
     JOIN app_users u ON u.employee_id=e.id AND u.is_active=TRUE
     JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
     JOIN crm_user_branches cub ON cub.user_id=u.id
     JOIN branches b ON b.id=cub.branch_id AND b.is_active=TRUE
     LEFT JOIN crm_user_access_status cuas ON cuas.user_id=u.id
     WHERE e.status='Active' AND COALESCE(cuas.is_active,1)=1
       AND r.normalized_name IN ('ADMIN','CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR')
    ORDER BY b.branch_name,e.employee_name`,
  );
  const [[currentEmployee]] = req.user.employeeId
    ? await pool.execute(`SELECT branch_id AS branchId FROM employees WHERE id=? LIMIT 1`, [Number(req.user.employeeId)])
    : [[]];
  res.json({ branches, employees, currentEmployeeId: req.user.employeeId || null, currentBranchId: currentEmployee?.branchId || null });
});

app.delete('/api/leads/:id', authenticate, requireCrmAccess, requireLeadDelete, async (req, res) => {
  const scope = leadScopedWhere(req.user);
  const [result] = await pool.execute(`UPDATE crm_leads l SET deleted_at_utc = CURRENT_TIMESTAMP(6), updated_by_user_id = ? WHERE l.id = ? AND l.deleted_at_utc IS NULL AND ${scope.sql}`, [Number(req.user.id), Number(req.params.id), ...scope.params]);
  if (!result.affectedRows) return res.status(404).json({ message: 'Lead not found' });
  res.json({ message: 'Lead removed successfully' });
});

const assignableCrmRoles = ['CRM_ADMIN', 'ADMISSION_MANAGER', 'COUNSELLOR', 'CRM_VIEWER'];

app.get('/api/admin/users/meta', authenticate, requireUserAdmin, async (req, res) => {
  const scope = scopedWhere(req.user, 'b.id');
  const [branches] = await pool.execute(
    `SELECT b.id, b.branch_name AS name, b.short_name AS shortName
     FROM branches b WHERE b.is_active = TRUE AND ${scope.sql} ORDER BY b.branch_name`, scope.params,
  );
  const [employees] = await pool.query(
    `SELECT e.id, e.employee_number AS employeeNumber, e.employee_name AS name, e.email,
            e.branch_id AS employeeBranchId, b.branch_name AS employeeBranch,
            u.id AS userId, u.email AS loginEmail, u.is_active AS userIsActive
     FROM employees e LEFT JOIN branches b ON b.id = e.branch_id
     LEFT JOIN app_users u ON u.employee_id = e.id
     WHERE e.status = 'Active' ORDER BY e.employee_name LIMIT 5000`,
  );
  const [roles] = await pool.query(
    `SELECT id, normalized_name AS name, name AS displayName, description
     FROM roles WHERE normalized_name IN ('CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR','CRM_VIEWER')
     ORDER BY FIELD(normalized_name,'CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR','CRM_VIEWER')`,
  );
  res.json({ branches, employees, roles });
});

app.get('/api/admin/users', authenticate, requireUserAdmin, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.employee_id AS employeeId, u.email, u.is_active AS attendanceActive, COALESCE(cuas.is_active,1) AS isActive,
            COALESCE(e.employee_name, u.email) AS name, e.employee_number AS employeeNumber,
            GROUP_CONCAT(DISTINCT CASE WHEN r.normalized_name LIKE 'CRM\\_%' THEN r.normalized_name END ORDER BY r.normalized_name) AS crmRoles,
            MAX(r.normalized_name = 'ADMIN') AS isSystemAdmin,
            GROUP_CONCAT(DISTINCT cub.branch_id ORDER BY cub.branch_id) AS branchIds,
            GROUP_CONCAT(DISTINCT b.branch_name ORDER BY b.branch_name SEPARATOR ', ') AS branchNames,
            u.last_login_at_utc AS lastLoginAt
     FROM app_users u
     LEFT JOIN employees e ON e.id = u.employee_id
     LEFT JOIN crm_user_access_status cuas ON cuas.user_id=u.id
     JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     LEFT JOIN crm_user_branches cub ON cub.user_id = u.id LEFT JOIN branches b ON b.id = cub.branch_id
     WHERE r.normalized_name = 'ADMIN' OR r.normalized_name IN ('CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR','CRM_VIEWER')
     GROUP BY u.id, u.employee_id, u.email, u.is_active, cuas.is_active, e.employee_name, e.employee_number, u.last_login_at_utc
     ORDER BY name`,
  );
  res.json({ data: rows.map((row) => ({ ...row, id: Number(row.id), employeeId: row.employeeId ? Number(row.employeeId) : null,
    isActive: Boolean(row.isActive), isSystemAdmin: Boolean(row.isSystemAdmin),
    roles: row.crmRoles ? row.crmRoles.split(',') : row.isSystemAdmin ? ['ADMIN'] : [],
    branchIds: row.branchIds ? row.branchIds.split(',').map(Number) : [] })) });
});

async function saveCrmUser(req, res, existingUserId = null) {
  const employeeId = Number(req.body.employeeId);
  const roleName = String(req.body.roleName || '').toUpperCase();
  const branchIds = [...new Set((req.body.branchIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '');
  if (!Number.isInteger(employeeId) || employeeId <= 0) return res.status(400).json({ message: 'Select an employee' });
  if (!assignableCrmRoles.includes(roleName)) return res.status(400).json({ message: 'Select a valid CRM role' });
  if (!branchIds.length) return res.status(400).json({ message: 'Select at least one CRM branch' });
  for (const branchId of branchIds) {
    if (!(await accessibleBranch(req.user, branchId))) return res.status(403).json({ message: 'You cannot assign one or more selected branches' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [employeeRows] = await connection.execute(`SELECT id, email FROM employees WHERE id = ? AND status = 'Active' LIMIT 1`, [employeeId]);
    if (!employeeRows.length) { await connection.rollback(); return res.status(404).json({ message: 'Active employee not found' }); }
    const [userRows] = await connection.execute(`SELECT id, email, is_active AS isActive FROM app_users WHERE employee_id = ? LIMIT 1`, [employeeId]);
    let user = userRows[0];
    if (existingUserId && (!user || Number(user.id) !== Number(existingUserId))) { await connection.rollback(); return res.status(409).json({ message: 'Employee account does not match this CRM user' }); }
    if (!user) {
      const loginEmail = email || employeeRows[0].email;
      if (!loginEmail || !/^\S+@\S+\.\S+$/.test(loginEmail)) { await connection.rollback(); return res.status(400).json({ message: 'A valid login email is required for a new account' }); }
      if (password.length < 8) { await connection.rollback(); return res.status(400).json({ message: 'New accounts require a password of at least 8 characters' }); }
      const [result] = await connection.execute(
        `INSERT INTO app_users (employee_id, email, normalized_email, password_hash, security_stamp, is_active, created_at_utc)
         VALUES (?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP(6))`,
        [employeeId, loginEmail, loginEmail.toUpperCase(), hashAttendancePassword(password), crypto.randomUUID()],
      );
      user = { id: result.insertId, email: loginEmail, isActive: true };
    } else if (!user.isActive) {
      await connection.rollback(); return res.status(409).json({ message: 'The existing Attendance login is inactive. Reactivate it in Attendance before granting CRM access.' });
    }
    if (password) {
      if (password.length < 8) { await connection.rollback(); return res.status(400).json({ message: 'Password must contain at least 8 characters' }); }
      await connection.execute(`UPDATE app_users SET password_hash = ?, security_stamp = ?, failed_login_count = 0, lockout_end_utc = NULL, updated_at_utc = CURRENT_TIMESTAMP(6) WHERE id = ?`, [hashAttendancePassword(password), crypto.randomUUID(), user.id]);
    }
    await connection.execute(
      `DELETE ur FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ? AND r.normalized_name IN ('CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR','CRM_VIEWER')`, [user.id],
    );
    await connection.execute(
      `INSERT INTO user_roles (user_id, role_id, created_at_utc)
       SELECT ?, id, CURRENT_TIMESTAMP(6) FROM roles WHERE normalized_name = ?`, [user.id, roleName],
    );
    await connection.execute(`DELETE FROM crm_user_branches WHERE user_id = ?`, [user.id]);
    for (const branchId of branchIds) {
      await connection.execute(`INSERT INTO crm_user_branches (user_id, branch_id, created_by_user_id) VALUES (?, ?, ?)`, [user.id, branchId, Number(req.user.id)]);
    }
    await connection.execute(`INSERT INTO crm_user_access_status(user_id,is_active,updated_by_user_id) VALUES(?,?,?) ON DUPLICATE KEY UPDATE is_active=VALUES(is_active),updated_by_user_id=VALUES(updated_by_user_id)`,[user.id,req.body.isActive===false?0:1,Number(req.user.id)]);
    await connection.commit();
    res.status(existingUserId ? 200 : 201).json({ id: Number(user.id), message: existingUserId ? 'CRM user updated successfully' : 'CRM user added successfully' });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'That email address is already used by another account' });
    throw error;
  } finally { connection.release(); }
}

app.post('/api/admin/users', authenticate, requireUserAdmin, (req, res) => saveCrmUser(req, res));
app.put('/api/admin/users/:id', authenticate, requireUserAdmin, (req, res) => saveCrmUser(req, res, Number(req.params.id)));

app.put('/api/admin/users/:id/status', authenticate, requireUserAdmin, async (req,res)=>{
  const userId=Number(req.params.id); if(userId===Number(req.user.id)&&req.body.isActive===false)return res.status(400).json({message:'You cannot deactivate your own CRM access'});
  await pool.execute(`INSERT INTO crm_user_access_status(user_id,is_active,updated_by_user_id) VALUES(?,?,?) ON DUPLICATE KEY UPDATE is_active=VALUES(is_active),updated_by_user_id=VALUES(updated_by_user_id)`,[userId,req.body.isActive?1:0,Number(req.user.id)]);
  res.json({message:`CRM user marked ${req.body.isActive?'active':'inactive'}`});
});

app.delete('/api/admin/users/:id/access', authenticate, requireUserAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (userId === Number(req.user.id)) return res.status(400).json({ message: 'You cannot remove your own CRM access' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(`DELETE ur FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.normalized_name IN ('CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR','CRM_VIEWER')`, [userId]);
    await connection.execute(`DELETE FROM crm_user_branches WHERE user_id = ?`, [userId]);
    await connection.commit();
    res.json({ message: 'CRM access removed. Attendance access was not changed.' });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
});

const leadConfigTypes = {
  stages: { table:'crm_lead_stages', label:'Stage' },
  substages: { table:'crm_lead_substages', label:'Sub-stage' },
  sources: { table:'crm_lead_sources', label:'Source' },
  campaignCategories: { table:'crm_campaign_categories', label:'Campaign category' },
  campaigns: { table:'crm_campaigns', label:'Campaign' },
  channelCategories: { table:'crm_channel_categories', label:'Channel category' },
  channels: { table:'crm_lead_channels', label:'Channel' },
};
function configCode(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 70); }

app.get('/api/admin/lead-config', authenticate, requireUserAdmin, async (_req, res) => {
  const [stages] = await pool.query(`SELECT id,name code,display_name displayName,position,is_active isActive,requires_followup requiresFollowup FROM crm_lead_stages ORDER BY position,display_name`);
  const [substages] = await pool.query(`SELECT ss.id,ss.substage_code code,ss.display_name displayName,ss.stage_id parentId,s.display_name parentName,ss.position,ss.is_active isActive FROM crm_lead_substages ss JOIN crm_lead_stages s ON s.id=ss.stage_id ORDER BY s.position,ss.position,ss.display_name`);
  const [sources] = await pool.query(`SELECT id,name code,display_name displayName,is_active isActive FROM crm_lead_sources ORDER BY display_name`);
  const [campaignCategories] = await pool.query(`SELECT id,category_code code,display_name displayName,is_active isActive FROM crm_campaign_categories ORDER BY display_name`);
  const [campaigns] = await pool.query(`SELECT c.id,c.campaign_code code,c.display_name displayName,c.category_id parentId,COALESCE(cc.display_name,c.category) parentName,c.is_active isActive FROM crm_campaigns c LEFT JOIN crm_campaign_categories cc ON cc.id=c.category_id ORDER BY parentName,c.display_name`);
  const [channelCategories] = await pool.query(`SELECT id,category_code code,display_name displayName,is_active isActive FROM crm_channel_categories ORDER BY display_name`);
  const [channels] = await pool.query(`SELECT c.id,c.channel_code code,c.display_name displayName,c.category_id parentId,COALESCE(cc.display_name,c.category) parentName,c.is_active isActive FROM crm_lead_channels c LEFT JOIN crm_channel_categories cc ON cc.id=c.category_id ORDER BY parentName,c.display_name`);
  res.json({ stages, substages, sources, campaignCategories, campaigns, channelCategories, channels });
});

app.post('/api/admin/lead-config/:type', authenticate, requireUserAdmin, async (req, res) => {
  const type=req.params.type; const definition=leadConfigTypes[type];
  if (!definition) return res.status(404).json({message:'Configuration type not found'});
  const displayName=cleanOptional(req.body.displayName,150); const code=configCode(req.body.code || displayName);
  if (!displayName || !code) return res.status(400).json({message:'Name is required'});
  try {
    if (type==='stages') await pool.execute(`INSERT INTO crm_lead_stages(name,display_name,position,color_code,requires_followup) SELECT ?,?,COALESCE(MAX(position),0)+1,'#555AB1',? FROM crm_lead_stages`,[code,displayName,req.body.requiresFollowup?1:0]);
    else if (type==='substages') await pool.execute(`INSERT INTO crm_lead_substages(stage_id,substage_code,display_name,position) SELECT ?,?,?,COALESCE(MAX(position),0)+1 FROM crm_lead_substages WHERE stage_id=?`,[Number(req.body.parentId),code,displayName,Number(req.body.parentId)]);
    else if (type==='sources') await pool.execute(`INSERT INTO crm_lead_sources(name,display_name) VALUES(?,?)`,[code,displayName]);
    else if (type==='campaignCategories') await pool.execute(`INSERT INTO crm_campaign_categories(category_code,display_name) VALUES(?,?)`,[code,displayName]);
    else if (type==='campaigns') { const [[category]]=await pool.execute(`SELECT id,display_name FROM crm_campaign_categories WHERE id=?`,[Number(req.body.parentId)]); if(!category)return res.status(400).json({message:'Campaign category is required'}); await pool.execute(`INSERT INTO crm_campaigns(campaign_code,display_name,category,category_id) VALUES(?,?,?,?)`,[code,displayName,category.display_name,category.id]); }
    else if (type==='channelCategories') await pool.execute(`INSERT INTO crm_channel_categories(category_code,display_name) VALUES(?,?)`,[code,displayName]);
    else if (type==='channels') { const [[category]]=await pool.execute(`SELECT id,display_name FROM crm_channel_categories WHERE id=?`,[Number(req.body.parentId)]); if(!category)return res.status(400).json({message:'Channel category is required'}); await pool.execute(`INSERT INTO crm_lead_channels(channel_code,display_name,category,category_id) VALUES(?,?,?,?)`,[code,displayName,category.display_name,category.id]); }
    res.status(201).json({message:`${definition.label} added successfully`});
  } catch(error) { if(error.code==='ER_DUP_ENTRY') return res.status(409).json({message:`A ${definition.label.toLowerCase()} with this name already exists`}); throw error; }
});

app.put('/api/admin/lead-config/:type/:id', authenticate, requireUserAdmin, async (req,res) => {
  const type=req.params.type; const definition=leadConfigTypes[type]; const id=Number(req.params.id);
  if(!definition)return res.status(404).json({message:'Configuration type not found'});
  const displayName=cleanOptional(req.body.displayName,150); if(!displayName)return res.status(400).json({message:'Name is required'});
  const connection=await pool.getConnection();
  try {
    await connection.beginTransaction();
    let result;
    if(type==='stages') [result]=await connection.execute(`UPDATE crm_lead_stages SET display_name=?,requires_followup=? WHERE id=?`,[displayName,req.body.requiresFollowup?1:0,id]);
    else if(type==='substages') [result]=await connection.execute(`UPDATE crm_lead_substages SET display_name=?,stage_id=? WHERE id=?`,[displayName,Number(req.body.parentId),id]);
    else if(type==='sources') [result]=await connection.execute(`UPDATE crm_lead_sources SET display_name=? WHERE id=?`,[displayName,id]);
    else if(type==='campaignCategories') { [result]=await connection.execute(`UPDATE crm_campaign_categories SET display_name=? WHERE id=?`,[displayName,id]); await connection.execute(`UPDATE crm_campaigns SET category=? WHERE category_id=?`,[displayName,id]); }
    else if(type==='campaigns') { const [[category]]=await connection.execute(`SELECT id,display_name FROM crm_campaign_categories WHERE id=?`,[Number(req.body.parentId)]); if(!category){await connection.rollback();return res.status(400).json({message:'Campaign category is required'});} [result]=await connection.execute(`UPDATE crm_campaigns SET display_name=?,category=?,category_id=? WHERE id=?`,[displayName,category.display_name,category.id,id]); }
    else if(type==='channelCategories') { [result]=await connection.execute(`UPDATE crm_channel_categories SET display_name=? WHERE id=?`,[displayName,id]); await connection.execute(`UPDATE crm_lead_channels SET category=? WHERE category_id=?`,[displayName,id]); }
    else if(type==='channels') { const [[category]]=await connection.execute(`SELECT id,display_name FROM crm_channel_categories WHERE id=?`,[Number(req.body.parentId)]); if(!category){await connection.rollback();return res.status(400).json({message:'Channel category is required'});} [result]=await connection.execute(`UPDATE crm_lead_channels SET display_name=?,category=?,category_id=? WHERE id=?`,[displayName,category.display_name,category.id,id]); }
    if(!result?.affectedRows){await connection.rollback();return res.status(404).json({message:`${definition.label} not found`});}
    await connection.commit();res.json({message:`${definition.label} updated successfully`});
  } catch(error){await connection.rollback();if(error.code==='ER_DUP_ENTRY')return res.status(409).json({message:`A ${definition.label.toLowerCase()} with this name already exists`});throw error;} finally{connection.release();}
});

app.put('/api/admin/lead-config/:type/:id/status', authenticate, requireUserAdmin, async (req,res) => {
  const definition=leadConfigTypes[req.params.type]; if(!definition)return res.status(404).json({message:'Configuration type not found'});
  const [result]=await pool.execute(`UPDATE ${definition.table} SET is_active=? WHERE id=?`,[req.body.isActive?1:0,Number(req.params.id)]);
  if(!result.affectedRows)return res.status(404).json({message:`${definition.label} not found`});
  res.json({message:`${definition.label} marked ${req.body.isActive?'active':'inactive'}`});
});

app.get('/api/saved-filters', authenticate, requireCrmAccess, async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, name, filter_type AS type, filters_json AS filters, created_at_utc AS createdAt
     FROM crm_saved_filters WHERE user_id = ? ORDER BY updated_at_utc DESC, created_at_utc DESC`,
    [Number(req.user.id)],
  );
  res.json({ data: rows.map(row => ({ ...row, id: Number(row.id), filters: typeof row.filters === 'string' ? JSON.parse(row.filters) : row.filters })) });
});

app.post('/api/saved-filters', authenticate, requireCrmAccess, async (req, res) => {
  const name = cleanOptional(req.body.name, 150);
  const type = req.body.type === 'funnel' ? 'funnel' : 'filter';
  const filters = req.body.filters && typeof req.body.filters === 'object' ? req.body.filters : {};
  if (!name) return res.status(400).json({ message: 'Enter a name for this saved filter' });
  await pool.execute(
    `INSERT INTO crm_saved_filters (user_id, name, filter_type, filters_json)
     VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE filter_type = VALUES(filter_type), filters_json = VALUES(filters_json), updated_at_utc = CURRENT_TIMESTAMP(6)`,
    [Number(req.user.id), name, type, JSON.stringify(filters)],
  );
  res.status(201).json({ message: `${type === 'funnel' ? 'View' : 'Filter'} saved successfully` });
});

app.delete('/api/saved-filters/:id', authenticate, requireCrmAccess, async (req, res) => {
  const [result] = await pool.execute(`DELETE FROM crm_saved_filters WHERE id = ? AND user_id = ?`, [Number(req.params.id), Number(req.user.id)]);
  if (!result.affectedRows) return res.status(404).json({ message: 'Saved filter not found' });
  res.json({ message: 'Saved filter removed' });
});

app.get('/api/automations', authenticate, requireCrmAccess, async (req,res)=>{
  const [rows]=await pool.execute(`SELECT w.id,w.name,w.category,w.start_at AS startAt,w.definition_json AS definition,w.is_active AS isActive,w.created_at_utc AS createdAt,COALESCE(e.employee_name,u.email) AS createdBy FROM crm_automation_workflows w JOIN app_users u ON u.id=w.created_by LEFT JOIN employees e ON e.id=u.employee_id ORDER BY w.created_at_utc DESC`);
  res.json({data:rows.map(row=>({...row,id:Number(row.id),isActive:Boolean(row.isActive),definition:typeof row.definition==='string'?JSON.parse(row.definition):row.definition}))});
});

app.post('/api/automations', authenticate, requireCrmAccess, requireLeadWrite, async (req,res)=>{
  const name=cleanOptional(req.body.name,180); const category=cleanOptional(req.body.category,40); const definition=req.body.definition&&typeof req.body.definition==='object'?req.body.definition:{};
  if(!name||!category)return res.status(400).json({message:'Automation name and category are required'});
  const [result]=await pool.execute(`INSERT INTO crm_automation_workflows(name,category,start_at,definition_json,is_active,created_by) VALUES(?,?,?,?,?,?)`,[name,category,req.body.startAt||null,JSON.stringify(definition),req.body.isActive?1:0,Number(req.user.id)]);
  res.status(201).json({message:'Automation workflow created',id:Number(result.insertId)});
});

app.put('/api/automations/:id', authenticate, requireCrmAccess, requireLeadWrite, async (req,res)=>{
  const name=cleanOptional(req.body.name,180); const category=cleanOptional(req.body.category,40); if(!name||!category)return res.status(400).json({message:'Automation name and category are required'});
  const [result]=await pool.execute(`UPDATE crm_automation_workflows SET name=?,category=?,start_at=?,definition_json=? WHERE id=?`,[name,category,req.body.startAt||null,JSON.stringify(req.body.definition||{}),Number(req.params.id)]);
  if(!result.affectedRows)return res.status(404).json({message:'Automation workflow not found'}); res.json({message:'Automation workflow updated'});
});

app.put('/api/automations/:id/status', authenticate, requireCrmAccess, requireLeadWrite, async (req,res)=>{
  const [result]=await pool.execute(`UPDATE crm_automation_workflows SET is_active=? WHERE id=?`,[req.body.isActive?1:0,Number(req.params.id)]); if(!result.affectedRows)return res.status(404).json({message:'Automation workflow not found'}); res.json({message:`Automation ${req.body.isActive?'activated':'paused'}`});
});

app.delete('/api/automations/:id', authenticate, requireCrmAccess, requireLeadDelete, async (req,res)=>{
  const [result]=await pool.execute(`DELETE FROM crm_automation_workflows WHERE id=?`,[Number(req.params.id)]); if(!result.affectedRows)return res.status(404).json({message:'Automation workflow not found'}); res.json({message:'Automation workflow deleted'});
});

app.get('/api/leads', authenticate, requireCrmAccess, async (req, res) => {
  const search = String(req.query.search || '').trim();
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const rows = await queryLeads(req.user, search, limit);
  const scope=leadScopedWhere(req.user);

  // Get actual total count from database (not page size)
  const [[totalCount]]=await pool.execute(
    `SELECT COUNT(*) AS count FROM crm_leads l
     WHERE l.deleted_at_utc IS NULL AND ${scope.sql}`,
    scope.params,
  );

  // Get stage counts
  const [[stageCounts]]=await pool.execute(
    `SELECT
       SUM(CASE WHEN s.display_name = 'New' THEN 1 ELSE 0 END) AS 'New',
       SUM(CASE WHEN s.display_name = 'Contacted' THEN 1 ELSE 0 END) AS 'Contacted',
       SUM(CASE WHEN s.display_name = 'Counselling' THEN 1 ELSE 0 END) AS 'Counselling',
       SUM(CASE WHEN s.display_name = 'Applications' THEN 1 ELSE 0 END) AS 'Applications',
       SUM(CASE WHEN s.display_name = 'Admissions' THEN 1 ELSE 0 END) AS 'Admissions',
       SUM(CASE WHEN s.display_name = 'Campus Visit' THEN 1 ELSE 0 END) AS 'Campus Visit',
       SUM(CASE WHEN s.display_name = 'Application' THEN 1 ELSE 0 END) AS 'Application',
       SUM(CASE WHEN s.display_name = 'Admitted' THEN 1 ELSE 0 END) AS 'Admitted',
       SUM(CASE WHEN s.display_name = 'Lost' THEN 1 ELSE 0 END) AS 'Lost'
     FROM crm_leads l
     JOIN crm_lead_stages s ON s.id = l.stage_id
     WHERE l.deleted_at_utc IS NULL AND ${scope.sql}`,
    scope.params,
  );

  // Get followups due
  const [[due]]=await pool.execute(
    `SELECT COUNT(*) AS count FROM crm_leads l
     WHERE l.deleted_at_utc IS NULL AND l.next_followup_at_utc IS NOT NULL
       AND DATE(l.next_followup_at_utc)<=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+05:30'))
       AND ${scope.sql}`,
    scope.params,
  );

  // Get re-enquired count
  const [[reEnquiredCount]]=await pool.execute(
    `SELECT COUNT(DISTINCT l.id) AS count FROM crm_leads l
     JOIN crm_lead_source_history h ON h.lead_id = l.id
     WHERE l.deleted_at_utc IS NULL AND ${scope.sql}
     GROUP BY l.id HAVING COUNT(h.id) > 1`,
    scope.params,
  );

  res.json({
    data: rows,
    total: Number(totalCount.count||0),
    stageCounts: {
      ...stageCounts,
      'Re-enquired': Number(reEnquiredCount.count||0)
    },
    followupsTillToday: Number(due.count||0)
  });
});

// ============= Bulk Upload Routes =============
app.get('/api/bulk-uploads/download-template', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
  try {
    // Query for real sample data from database (with fallbacks)
    let classData, campaignData, substageData, userData, sourceData;

    try { [classData] = await pool.query(`SELECT id FROM crm_classes WHERE is_active=TRUE ORDER BY position LIMIT 1`); } catch (e) { classData = []; }
    try { [campaignData] = await pool.query(`SELECT display_name FROM crm_campaigns WHERE is_active=TRUE ORDER BY display_name LIMIT 1`); } catch (e) { campaignData = []; }
    try { [substageData] = await pool.query(`SELECT id FROM crm_lead_substages WHERE is_active=TRUE ORDER BY position LIMIT 1`); } catch (e) { substageData = []; }
    try { [userData] = await pool.query(`SELECT email FROM app_users WHERE is_active=TRUE LIMIT 1`); } catch (e) { userData = []; }
    try { [sourceData] = await pool.query(`SELECT id, display_name FROM crm_lead_sources WHERE is_active=TRUE ORDER BY display_name LIMIT 1`); } catch (e) { sourceData = []; }

    // Use real values from database or fallbacks
    const classId = classData?.[0]?.id || '1';
    const campaignName = campaignData?.[0]?.display_name || 'Admissions 2026-27';
    const substageId = substageData?.[0]?.id || '1';
    const userEmail = userData?.[0]?.email || 'counsellor@school.com';
    const sourceId = sourceData?.[0]?.id || '1';
    const sourceName = sourceData?.[0]?.display_name || 'Web Form';

    // Mandatory and optional columns for bulk upload
    const headers = [
      'Student Name *',
      'Phone *',
      'Class ID *',
      'Campaign Name *',
      'Sub-stage ID *',
      'Assign To *',
      'Source ID *',
      'Remarks'
    ];

    const sampleRow = [
      'Rahul Kumar',
      '9876543210',
      classId,
      campaignName,
      substageId,
      userEmail,
      sourceId,
      'Sample lead'
    ];

    // Escape CSV values
    const escapeCSV = (value) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Create CSV with header and sample row with real data
    const templateContent = [
      headers.map(escapeCSV).join(','),
      sampleRow.map(escapeCSV).join(',')
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bulk_lead_upload_template_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(templateContent);
  } catch (error) {
    console.error('Template download error:', error);
    res.status(500).json({ message: 'Failed to generate template' });
  }
});

app.get('/api/bulk-uploads/config', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
  const scope = scopedWhere(req.user, 'b.id');
  const [branches] = await pool.execute(`SELECT b.id, b.branch_name AS name FROM branches b WHERE b.is_active=TRUE AND ${scope.sql} ORDER BY b.branch_name`, scope.params);
  const [stages] = await pool.query(`SELECT id, display_name AS displayName FROM crm_lead_stages WHERE is_active=TRUE ORDER BY position`);
  const [substages] = await pool.query(`SELECT id, stage_id AS stageId, display_name AS displayName FROM crm_lead_substages WHERE is_active=TRUE ORDER BY stage_id, position`);
  const [sources] = await pool.query(`SELECT id, display_name AS displayName FROM crm_lead_sources WHERE is_active=TRUE ORDER BY display_name`);
  const [channels] = await pool.query(`SELECT id, display_name AS displayName FROM crm_lead_channels WHERE is_active=TRUE ORDER BY display_name`);
  const [campaigns] = await pool.query(`SELECT id, display_name AS displayName FROM crm_campaigns WHERE is_active=TRUE ORDER BY display_name`);
  const [classes] = await pool.query(`SELECT id, display_name AS displayName FROM crm_classes WHERE is_active=TRUE ORDER BY position`);
  const [curricula] = await pool.query(`SELECT id, display_name AS displayName FROM crm_curricula WHERE is_active=TRUE ORDER BY position`);
  const [admissionTypes] = await pool.query(`SELECT id, display_name AS displayName FROM crm_admission_types WHERE is_active=TRUE ORDER BY display_name`);

  res.json({
    branches,
    stages,
    substages,
    sources,
    channels,
    campaigns,
    classes,
    curricula,
    admissionTypes
  });
});

// ============= Admission Class Configuration APIs =============
app.get('/api/admission-class-configurations', authenticate, requireUserAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        acc.id,
        acc.academic_year AS academicYear,
        b.branch_name AS branch,
        c.display_name AS curriculum,
        aat.display_name AS admissionType,
        acc.is_active AS isActive,
        acc.created_at AS createdAt,
        acc.updated_at AS updatedAt,
        GROUP_CONCAT(cl.display_name ORDER BY cl.display_name SEPARATOR ', ') AS classes,
        COUNT(DISTINCT accd.class_id) AS classCount
      FROM mse_admission_class_configuration acc
      LEFT JOIN branches b ON b.id = acc.branch_id
      LEFT JOIN crm_curricula c ON c.id = acc.curriculum_id
      LEFT JOIN crm_admission_types aat ON aat.id = acc.admission_type_id
      LEFT JOIN mse_admission_class_configuration_details accd ON accd.configuration_id = acc.id AND accd.is_active = TRUE
      LEFT JOIN crm_classes cl ON cl.id = accd.class_id
      GROUP BY acc.id
      ORDER BY acc.academic_year DESC, b.branch_name, c.display_name
    `);
    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/admission-class-configurations/:id', authenticate, requireUserAdmin, async (req, res) => {
  try {
    const configId = Number(req.params.id);
    const [[config]] = await pool.query(`
      SELECT
        acc.id,
        acc.academic_year AS academicYear,
        acc.branch_id AS branchId,
        acc.curriculum_id AS curriculumId,
        acc.admission_type_id AS admissionTypeId,
        acc.is_active AS isActive
      FROM mse_admission_class_configuration acc
      WHERE acc.id = ?
    `, [configId]);

    if (!config) return res.status(404).json({ message: 'Configuration not found' });

    const [classes] = await pool.query(`
      SELECT class_id AS classId FROM mse_admission_class_configuration_details
      WHERE configuration_id = ? AND is_active = TRUE
      ORDER BY class_id
    `, [configId]);

    res.json({
      ...config,
      classIds: classes.map(c => c.classId)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/admission-class-configurations', authenticate, requireUserAdmin, async (req, res) => {
  try {
    const { academicYear, branchId, curriculumId, admissionTypeId, classIds } = req.body;

    if (!academicYear || !branchId || !curriculumId || !admissionTypeId) {
      return res.status(400).json({ message: 'Academic Year, Branch, Curriculum, and Admission Type are required' });
    }

    if (!Array.isArray(classIds) || classIds.length === 0) {
      return res.status(400).json({ message: 'At least one class must be selected' });
    }

    // Check for duplicate configuration
    const [[existing]] = await pool.query(`
      SELECT id FROM mse_admission_class_configuration
      WHERE academic_year = ? AND branch_id = ? AND curriculum_id = ? AND admission_type_id = ?
      LIMIT 1
    `, [String(academicYear), branchId, curriculumId, admissionTypeId]);

    if (existing) {
      return res.status(409).json({ message: 'Configuration already exists for the selected Academic Year, Branch, Curriculum and Admission Type' });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [result] = await connection.execute(`
        INSERT INTO mse_admission_class_configuration (academic_year, branch_id, curriculum_id, admission_type_id, is_active, created_by, updated_by)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `, [String(academicYear), branchId, curriculumId, admissionTypeId, Number(req.user.id), Number(req.user.id)]);

      const configId = result.insertId;

      for (const classId of classIds) {
        await connection.execute(`
          INSERT INTO mse_admission_class_configuration_details (configuration_id, class_id, is_active)
          VALUES (?, ?, 1)
        `, [configId, Number(classId)]);
      }

      await connection.commit();
      res.status(201).json({ id: configId, message: 'Configuration created successfully' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put('/api/admission-class-configurations/:id', authenticate, requireUserAdmin, async (req, res) => {
  try {
    const configId = Number(req.params.id);
    const { academicYear, branchId, curriculumId, admissionTypeId, classIds, isActive } = req.body;

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.execute(`
        UPDATE mse_admission_class_configuration
        SET academic_year = ?, branch_id = ?, curriculum_id = ?, admission_type_id = ?, is_active = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [String(academicYear), branchId, curriculumId, admissionTypeId, isActive ? 1 : 0, Number(req.user.id), configId]);

      await connection.execute(`DELETE FROM mse_admission_class_configuration_details WHERE configuration_id = ?`, [configId]);

      if (Array.isArray(classIds) && classIds.length > 0) {
        for (const classId of classIds) {
          await connection.execute(`
            INSERT INTO mse_admission_class_configuration_details (configuration_id, class_id, is_active)
            VALUES (?, ?, 1)
          `, [configId, Number(classId)]);
        }
      }

      await connection.commit();
      res.json({ message: 'Configuration updated successfully' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.delete('/api/admission-class-configurations/:id', authenticate, requireUserAdmin, async (req, res) => {
  try {
    const configId = Number(req.params.id);

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(`DELETE FROM mse_admission_class_configuration_details WHERE configuration_id = ?`, [configId]);
      await connection.execute(`DELETE FROM mse_admission_class_configuration WHERE id = ?`, [configId]);
      await connection.commit();
      res.json({ message: 'Configuration deleted successfully' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/available-classes', authenticate, requireCrmAccess, async (req, res) => {
  try {
    const { academicYear, branchId, curriculumId, admissionTypeId } = req.query;

    if (!academicYear || !branchId || !curriculumId || !admissionTypeId) {
      return res.status(400).json({ message: 'All parameters are required' });
    }

    const [classes] = await pool.query(`
      SELECT DISTINCT cl.id, cl.display_name AS displayName
      FROM mse_admission_class_configuration_details accd
      JOIN mse_admission_class_configuration acc ON acc.id = accd.configuration_id
      JOIN crm_classes cl ON cl.id = accd.class_id
      WHERE acc.academic_year = ?
        AND acc.branch_id = ?
        AND acc.curriculum_id = ?
        AND acc.admission_type_id = ?
        AND acc.is_active = TRUE
        AND accd.is_active = TRUE
        AND cl.is_active = TRUE
      ORDER BY cl.display_name
    `, [String(academicYear), branchId, curriculumId, admissionTypeId]);

    res.json({ classes });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/available-curricula', authenticate, requireCrmAccess, async (req, res) => {
  try {
    const { academicYear, branchId, admissionTypeId } = req.query;

    if (!academicYear || !branchId || !admissionTypeId) {
      return res.status(400).json({ message: 'academicYear, branchId, and admissionTypeId are required' });
    }

    const [curricula] = await pool.query(`
      SELECT DISTINCT cr.id, cr.display_name AS displayName
      FROM mse_admission_class_configuration acc
      JOIN crm_curricula cr ON cr.id = acc.curriculum_id
      WHERE acc.academic_year = ?
        AND acc.branch_id = ?
        AND acc.admission_type_id = ?
        AND acc.is_active = TRUE
        AND cr.is_active = TRUE
      ORDER BY cr.display_name
    `, [String(academicYear), branchId, admissionTypeId]);

    res.json({ curricula });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/available-admission-types', authenticate, requireCrmAccess, async (req, res) => {
  try {
    const { academicYear, branchId } = req.query;

    if (!academicYear || !branchId) {
      return res.status(400).json({ message: 'academicYear and branchId are required' });
    }

    const [admissionTypes] = await pool.query(`
      SELECT DISTINCT at.id, at.display_name AS displayName
      FROM mse_admission_class_configuration acc
      JOIN crm_admission_types at ON at.id = acc.admission_type_id
      WHERE acc.academic_year = ?
        AND acc.branch_id = ?
        AND acc.is_active = TRUE
        AND at.is_active = TRUE
      ORDER BY at.display_name
    `, [String(academicYear), branchId]);

    res.json({ admissionTypes });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============= Academic Years Management APIs =============

app.get('/api/academic-years', authenticate, requireUserAdmin, async (req, res) => {
  try {
    const [years] = await pool.query(`
      SELECT id, academic_year AS academicYear, display_name AS displayName, is_active AS isActive,
             created_at AS createdAt, updated_at AS updatedAt
      FROM crm_academic_years
      ORDER BY academic_year DESC
    `);
    res.json({ data: years });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/academic-years/:id', authenticate, requireUserAdmin, async (req, res) => {
  try {
    const [[year]] = await pool.query(`
      SELECT id, academic_year AS academicYear, display_name AS displayName, is_active AS isActive
      FROM crm_academic_years
      WHERE id = ?
    `, [Number(req.params.id)]);
    if (!year) return res.status(404).json({ message: 'Academic year not found' });
    res.json(year);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/academic-years', authenticate, requireUserAdmin, async (req, res) => {
  try {
    const { academicYear, displayName, isActive } = req.body;

    if (!academicYear || !academicYear.trim()) {
      return res.status(400).json({ message: 'Academic Year is required' });
    }

    const [[exists]] = await pool.query(`
      SELECT id FROM crm_academic_years WHERE academic_year = ?
    `, [String(academicYear).trim()]);

    if (exists) {
      return res.status(409).json({ message: 'Academic Year already exists' });
    }

    const [result] = await pool.execute(`
      INSERT INTO crm_academic_years (academic_year, display_name, is_active, created_by_user_id)
      VALUES (?, ?, ?, ?)
    `, [String(academicYear).trim(), String(displayName || academicYear).trim(), Number(isActive), Number(req.user.id)]);

    res.status(201).json({ id: result.insertId, message: 'Academic Year created successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put('/api/academic-years/:id', authenticate, requireUserAdmin, async (req, res) => {
  try {
    const { academicYear, displayName, isActive } = req.body;
    const yearId = Number(req.params.id);

    if (!academicYear || !academicYear.trim()) {
      return res.status(400).json({ message: 'Academic Year is required' });
    }

    const [[existing]] = await pool.query(`
      SELECT id FROM crm_academic_years WHERE academic_year = ? AND id != ?
    `, [String(academicYear).trim(), yearId]);

    if (existing) {
      return res.status(409).json({ message: 'Academic Year already exists' });
    }

    await pool.execute(`
      UPDATE crm_academic_years
      SET academic_year = ?, display_name = ?, is_active = ?, updated_by_user_id = ?
      WHERE id = ?
    `, [String(academicYear).trim(), String(displayName || academicYear).trim(), Number(isActive), Number(req.user.id), yearId]);

    res.json({ message: 'Academic Year updated successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.delete('/api/academic-years/:id', authenticate, requireUserAdmin, async (req, res) => {
  try {
    const yearId = Number(req.params.id);

    await pool.execute(`DELETE FROM crm_academic_years WHERE id = ?`, [yearId]);

    res.json({ message: 'Academic Year deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/bulk-uploads', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
  const scope = scopedWhere(req.user, 'bu.branch_id');
  const [rows] = await pool.execute(
    `SELECT
      bu.id, bu.file_name AS fileName, bu.uploaded_by_user_id AS uploadedByUserId,
      COALESCE(e.employee_name, u.email) AS uploadedBy, bu.status, bu.total_records AS totalRecords,
      bu.successful_records AS successfulRecords, bu.failed_records AS failedRecords,
      bu.duplicate_records AS duplicateRecords, bu.created_at_utc AS createdAt,
      bu.processing_completed_at_utc AS completedAt
     FROM crm_bulk_uploads bu
     JOIN app_users u ON u.id=bu.uploaded_by_user_id
     LEFT JOIN employees e ON e.id=u.employee_id
     WHERE ${scope.sql}
     ORDER BY bu.created_at_utc DESC
     LIMIT 100`,
    scope.params
  );
  res.json({ data: rows.map(row => ({ ...row, id: Number(row.id) })) });
});

app.get('/api/bulk-uploads/:id', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
  const scope = scopedWhere(req.user, 'bu.branch_id');
  const [[upload]] = await pool.execute(
    `SELECT bu.id, bu.file_name AS fileName, bu.uploaded_by_user_id AS uploadedByUserId,
            COALESCE(e.employee_name, u.email) AS uploadedBy, bu.status, bu.total_records AS totalRecords,
            bu.processed_records AS processedRecords, bu.successful_records AS successfulRecords,
            bu.failed_records AS failedRecords, bu.duplicate_records AS duplicateRecords,
            bu.skipped_records AS skippedRecords, bu.created_at_utc AS createdAt,
            bu.processing_started_at_utc AS startedAt, bu.processing_completed_at_utc AS completedAt,
            bu.error_summary AS errorSummary
     FROM crm_bulk_uploads bu
     JOIN app_users u ON u.id=bu.uploaded_by_user_id
     LEFT JOIN employees e ON e.id=u.employee_id
     WHERE bu.id=? AND ${scope.sql}`,
    [Number(req.params.id), ...scope.params]
  );
  if (!upload) return res.status(404).json({ message: 'Upload not found' });

  const [records] = await pool.execute(
    `SELECT \`row_number\` AS rowNumber, \`status\`, lead_id AS leadId, created_lead_number AS leadNumber,
            validation_errors AS validationErrors
     FROM crm_bulk_upload_records
     WHERE bulk_upload_id=?
     ORDER BY \`row_number\``,
    [Number(req.params.id)]
  );

  const [events] = await pool.execute(
    `SELECT event_type AS eventType, message, created_at_utc AS createdAt
     FROM crm_bulk_upload_events
     WHERE bulk_upload_id=?
     ORDER BY created_at_utc`,
    [Number(req.params.id)]
  );

  res.json({
    upload: { ...upload, id: Number(upload.id) },
    records: records.map(r => ({ ...r, validationErrors: typeof r.validationErrors === 'string' ? JSON.parse(r.validationErrors) : r.validationErrors })),
    events
  });
});

app.get('/api/bulk-uploads/:id/download-errors', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
  const scope = scopedWhere(req.user, 'bu.branch_id');
  const [[upload]] = await pool.execute(
    `SELECT id FROM crm_bulk_uploads bu WHERE bu.id=? AND ${scope.sql}`,
    [Number(req.params.id), ...scope.params]
  );
  if (!upload) return res.status(404).json({ message: 'Upload not found' });

  const [records] = await pool.execute(
    `SELECT \`row_number\` AS rowNumber, validation_errors AS validationErrors FROM crm_bulk_upload_records WHERE bulk_upload_id=? AND \`status\`='Failed'`,
    [Number(req.params.id)]
  );

  const csvRows = [['Row Number', 'Error Details']];
  records.forEach(record => {
    const errors = typeof record.validationErrors === 'string' ? JSON.parse(record.validationErrors) : record.validationErrors;
    const errorMsg = Object.values(errors).join('; ');
    csvRows.push([record.rowNumber, errorMsg]);
  });

  const csv = csvRows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="error-report-${Number(req.params.id)}.csv"`);
  res.send(csv);
});

app.get('/api/bulk-uploads/:id/download-successful', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
  const scope = scopedWhere(req.user, 'bu.branch_id');
  const [[upload]] = await pool.execute(
    `SELECT id FROM crm_bulk_uploads bu WHERE bu.id=? AND ${scope.sql}`,
    [Number(req.params.id), ...scope.params]
  );
  if (!upload) return res.status(404).json({ message: 'Upload not found' });

  const [records] = await pool.execute(
    `SELECT bur.\`row_number\` AS rowNumber, bur.created_lead_number AS leadNumber, l.student_name AS studentName, l.phone, l.email FROM crm_bulk_upload_records bur
     LEFT JOIN crm_leads l ON l.id=bur.lead_id
     WHERE bur.bulk_upload_id=? AND bur.\`status\`='Success'
     ORDER BY bur.\`row_number\``,
    [Number(req.params.id)]
  );

  const csvRows = [['Row Number', 'Lead Number', 'Student Name', 'Phone', 'Email']];
  records.forEach(record => {
    csvRows.push([
      record.rowNumber,
      record.leadNumber || '',
      record.studentName || '',
      record.phone || '',
      record.email || ''
    ]);
  });

  const csv = csvRows.map(row => row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="successful-records-${Number(req.params.id)}.csv"`);
  res.send(csv);
});

app.post('/api/bulk-uploads', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
  const fileName = cleanOptional(req.body.fileName, 255);
  const records = Array.isArray(req.body.records) ? req.body.records : [];

  if (!fileName) return res.status(400).json({ message: 'File name is required' });
  if (!fileName.toLowerCase().endsWith('.csv')) return res.status(400).json({ message: 'Only CSV files (.csv) are supported. Please upload a .csv file.' });
  if (records.length === 0) return res.status(400).json({ message: 'No records to upload' });
  if (records.length > 5000) return res.status(400).json({ message: 'Maximum 5000 records per upload' });

  // Get branch from first valid Class ID (or use default for now)
  let branchId = null;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.classId) {
      const [[classData]] = await pool.query(
        `SELECT id, branch_id FROM crm_classes WHERE id=? AND is_active=TRUE LIMIT 1`,
        [Number(record.classId)]
      );
      if (classData) {
        branchId = classData.branch_id;
        break;
      }
    }
  }

  // If no valid class found, use a default branch (validation will catch invalid records)
  if (!branchId) {
    const [[defaultBranch]] = await pool.query(`SELECT id FROM branches WHERE is_active=TRUE LIMIT 1`);
    branchId = defaultBranch?.id || 1;
  }
  if (!(await accessibleBranch(req.user, branchId))) return res.status(403).json({ message: 'You do not have access to the branch for the selected Class' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.execute(
      `INSERT INTO crm_bulk_uploads (branch_id, file_name, uploaded_by_user_id, total_records)
       VALUES (?, ?, ?, ?)`,
      [branchId, fileName, Number(req.user.id), records.length]
    );
    const uploadId = result.insertId;

    await connection.execute(
      `INSERT INTO crm_bulk_upload_events (bulk_upload_id, event_type, message)
       VALUES (?, 'file_uploaded', ?)`,
      [uploadId, `File uploaded: ${fileName} with ${records.length} records`]
    );

    // Insert all records as pending
    for (let i = 0; i < records.length; i++) {
      await connection.execute(
        `INSERT INTO crm_bulk_upload_records (bulk_upload_id, \`row_number\`, \`status\`, validation_errors)
         VALUES (?, ?, 'pending', ?)`,
        [uploadId, i + 1, JSON.stringify({})]
      );
    }

    await connection.commit();

    // Queue async processing
    setImmediate(() => processBulkUpload(uploadId, records, branchId, Number(req.user.id), connection.pool || pool).catch(e => console.error('Bulk upload processing error:', e)));

    res.status(202).json({ id: uploadId, message: 'Upload received and queued for processing' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

async function processBulkUpload(uploadId, records, branchId, userId, pool) {
  const connection = await pool.getConnection();
  try {
    await connection.execute(`UPDATE crm_bulk_uploads SET processing_started_at_utc=CURRENT_TIMESTAMP(6) WHERE id=?`, [uploadId]);

    let successCount = 0, failureCount = 0, duplicateCount = 0;
    const errors = [];

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const rowNum = i + 1;
      const validationErrors = {};

      // Validate Class ID and derive branch, curriculum, admission type
      if (!record.classId) {
        validationErrors.classId = 'Class ID is required';
      } else {
        const [[classData]] = await connection.execute(
          `SELECT id, branch_id, curriculum_id FROM crm_classes WHERE id=? AND is_active=TRUE LIMIT 1`,
          [Number(record.classId)]
        );
        if (!classData) {
          validationErrors.classId = 'Invalid Class ID. Unable to determine Branch, Curriculum and Admission Type.';
        } else {
          record.branchId = classData.branch_id;
          record.curriculumId = classData.curriculum_id;
          // Fallback: if no curriculum from class, use first active curriculum
          if (!record.curriculumId) {
            const [[defaultCurr]] = await pool.execute(
              `SELECT id FROM crm_curricula WHERE is_active=TRUE LIMIT 1`
            );
            if (defaultCurr) {
              record.curriculumId = defaultCurr.id;
            }
          }
        }
      }

      // Validate lead data using existing validation
      const leadValidationError = validateLead(record);
      if (leadValidationError) {
        validationErrors.lead = leadValidationError;
      }

      const sourceValidationError = await validateSourceDetails(record);
      if (sourceValidationError) {
        validationErrors.source = sourceValidationError;
      }

      const followupValidation = await validateStageFollowup(record);
      if (followupValidation.error) {
        validationErrors.followup = followupValidation.error;
      }

      if (Object.keys(validationErrors).length > 0) {
        await connection.execute(
          `UPDATE crm_bulk_upload_records SET validation_errors=? WHERE bulk_upload_id=? AND \`row_number\`=?`,
          [JSON.stringify(validationErrors), uploadId, rowNum]
        );
        failureCount++;
        errors.push({ row: rowNum, message: Object.values(validationErrors).join('; ') });
        continue;
      }

      // Check for duplicates and create lead
      try {
        const normalizedPhone = String(record.phone).replace(/[^0-9]/g, '');
        const [[existing]] = await connection.execute(
          `SELECT id, lead_number FROM crm_leads WHERE branch_id=? AND normalized_phone=? AND deleted_at_utc IS NULL LIMIT 1`,
          [branchId, normalizedPhone]
        );

        if (existing) {
          duplicateCount++;
          await connection.execute(
            `UPDATE crm_bulk_upload_records SET lead_id=? WHERE bulk_upload_id=? AND \`row_number\`=?`,
            [existing.id, uploadId, rowNum]
          );
          continue;
        }

        // Create lead
        const temporaryNumber = `PENDING-${crypto.randomUUID()}`;
        const [result] = await connection.execute(
          `INSERT INTO crm_leads (lead_number, branch_id, student_name, phone, normalized_phone, alternate_phone, email,
           applying_class, class_id, curriculum_id, academic_year, parent_name, city, stage_id, source_id,
           owner_employee_id, channel_id, campaign_id, admission_type_id, substage_id,
           lead_score, remarks, next_followup_at_utc, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [temporaryNumber, branchId, cleanOptional(record.studentName, 200), cleanOptional(record.phone, 30),
           normalizedPhone, cleanOptional(record.alternatePhone, 30), cleanOptional(record.email, 254),
           cleanOptional(record.applyingClass, 50), Number(record.classId), Number(record.curriculumId || 1),
           cleanOptional(record.academicYear, 20), cleanOptional(record.parentName, 200),
           cleanOptional(record.city, 100), Number(record.stageId),
           record.sourceId ? Number(record.sourceId) : null,
           record.ownerEmployeeId ? Number(record.ownerEmployeeId) : null,
           record.channelId ? Number(record.channelId) : null,
           record.campaignId ? Number(record.campaignId) : null,
           record.admissionTypeId ? Number(record.admissionTypeId) : null,
           record.substageId ? Number(record.substageId) : null,
           Number(record.leadScore || 0), cleanOptional(record.remarks, 10000),
           followupValidation.nextFollowupAt, userId]
        );

        const leadNumber = `ADM-${new Date().getFullYear()}-${String(result.insertId).padStart(6, '0')}`;
        await connection.execute(`UPDATE crm_leads SET lead_number=? WHERE id=?`, [leadNumber, result.insertId]);

        // Insert source history
        await connection.execute(
          `INSERT INTO crm_lead_source_history(lead_id,academic_year,source_id,channel_id,campaign_id,is_primary,intake_method,created_by_user_id)
           VALUES(?,?,?,?,?,TRUE,'bulk',?)`,
          [result.insertId, cleanOptional(record.academicYear, 20), Number(record.sourceId),
           Number(record.channelId), Number(record.campaignId), userId]
        );

        // Insert activity
        await connection.execute(
          `INSERT INTO crm_lead_activities (lead_id, activity_type, summary, actor_user_id)
           VALUES (?, 'created', 'Lead created via bulk upload', ?)`,
          [result.insertId, userId]
        );

        // Insert followup if required
        if (followupValidation.required) {
          await connection.execute(
            `INSERT INTO crm_followups (lead_id, assigned_employee_id, followup_type, due_at_utc, created_by_user_id)
             VALUES (?, ?, ?, ?, ?)`,
            [result.insertId, record.ownerEmployeeId ? Number(record.ownerEmployeeId) : null,
             followupValidation.followupType, followupValidation.nextFollowupAt, userId]
          );
        }

        await connection.execute(
          `UPDATE crm_bulk_upload_records SET lead_id=?, created_lead_number=?, processed_at_utc=CURRENT_TIMESTAMP(6)
           WHERE bulk_upload_id=? AND \`row_number\`=?`,
          [result.insertId, leadNumber, uploadId, rowNum]
        );
        successCount++;
      } catch (error) {
        failureCount++;
        console.error(`[BULK-IMPORT-ERROR] Row ${rowNum} failed:`);
        console.error(`  Message: ${error.message}`);
        console.error(`  Code: ${error.code}`);
        console.error(`  SQL: ${error.sql}`);
        console.error(`  Stack: ${error.stack}`);

        await connection.execute(
          `UPDATE crm_bulk_upload_records SET validation_errors=?, \`status\`='Failed' WHERE bulk_upload_id=? AND \`row_number\`=?`,
          [JSON.stringify({
            error: error.message,
            code: error.code,
            sql: error.sql
          }), uploadId, rowNum]
        );
        errors.push({ row: rowNum, message: error.message });
      }
    }

    // Query actual counts from database (validates all phases: validation + import)
    // Success = record has lead_id (was imported), Failed = status='Failed', Duplicate = status='Duplicate'
    const [[counts]] = await connection.execute(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN lead_id IS NOT NULL THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN \`status\`='Failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN \`status\`='Duplicate' THEN 1 ELSE 0 END) as duplicate
       FROM crm_bulk_upload_records WHERE bulk_upload_id=?`,
      [uploadId]
    );

    const actualSuccessful = counts.completed || 0;
    const actualFailed = counts.failed || 0;
    const actualDuplicate = counts.duplicate || 0;
    const actualTotal = counts.total || 0;

    // Determine final status based on actual database counts
    let finalStatus = 'Completed';
    if (actualFailed > 0 && actualSuccessful === 0) {
      finalStatus = 'Failed';
    } else if (actualFailed > 0) {
      finalStatus = 'Completed with Errors';
    }

    console.log(`[BULK-IMPORT-SUMMARY] Upload ${uploadId}: ${actualSuccessful} successful, ${actualFailed} failed, ${actualDuplicate} duplicate`);

    await connection.execute(
      `UPDATE crm_bulk_uploads SET
        status=?,
        processed_records=?,
        successful_records=?,
        failed_records=?,
        duplicate_records=?,
        processing_completed_at_utc=CURRENT_TIMESTAMP(6),
        error_summary=?
       WHERE id=?`,
      [finalStatus, actualTotal, actualSuccessful, actualFailed, actualDuplicate,
       errors.length > 0 ? JSON.stringify(errors.slice(0, 10)).slice(0, 500) : null, uploadId]
    );

    await connection.execute(
      `INSERT INTO crm_bulk_upload_events (bulk_upload_id, event_type, message)
       VALUES (?, 'processing_completed', ?)`,
      [uploadId, `Completed: ${actualSuccessful} successful, ${actualFailed} failed, ${actualDuplicate} duplicates`]
    );
  } catch (error) {
    await connection.execute(
      `UPDATE crm_bulk_uploads SET error_summary=?, processing_completed_at_utc=CURRENT_TIMESTAMP(6)
       WHERE id=?`,
      [JSON.stringify({ error: error.message }), uploadId]
    ).catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

// ============= Bulk Leads Validation API (synchronous, no DB writes) =============
app.post('/api/bulk-leads/validate', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
  try {
    const fileName = cleanOptional(req.body.fileName, 255);
    const records = Array.isArray(req.body.records) ? req.body.records : [];

    if (!fileName) return res.status(400).json({ message: 'File name is required' });
    if (records.length === 0) return res.status(400).json({ message: 'No records to validate' });
    if (records.length > 5000) return res.status(400).json({ message: 'Maximum 5000 records per upload' });

    const failedRecords = [];
    let duplicateCount = 0;
    const branchId = req.user.branchId || 1; // Default branch if available

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const rowNum = i + 1;
      const errors = [];

      // ==== STEP 1: Validate Class ID (Master Key) ====
      if (!record.classId) {
        errors.push('Class ID is required');
      } else {
        try {
          const [[accData]] = await pool.execute(
            `SELECT acc.id, acc.academic_year, acc.branch_id, acc.admission_type_id, c.id as curriculum_id
             FROM mse_admission_class_configuration acc
             JOIN mse_admission_class_configuration_details accd
               ON accd.configuration_id = acc.id
             LEFT JOIN crm_curricula c ON c.id = acc.curriculum_id
             WHERE accd.class_id = ?
             AND accd.is_active = TRUE
             AND acc.is_active = TRUE
             LIMIT 1`,
            [Number(record.classId)]
          );
          if (!accData) {
            errors.push(`Class ID ${record.classId} not found or inactive in Admission Class Configuration`);
          } else {
            // Auto-populate all derived fields from ACC
            record.academicYear = accData.academic_year;
            record.branchId = accData.branch_id;
            record.admissionTypeId = accData.admission_type_id;
            record.curriculumId = accData.curriculum_id;
            if (!record.curriculumId) {
              errors.push('Curriculum not linked to this Class ID');
            }
          }
        } catch (err) {
          errors.push(`Error validating Class ID: ${err.message}`);
        }
      }

      // ==== STEP 2: Validate Sub-stage ID and derive Stage ID ====
      if (!record.substageId) {
        errors.push('Sub-stage ID is required');
      } else {
        try {
          const [[substageData]] = await pool.execute(
            `SELECT stage_id FROM crm_lead_substages WHERE id = ? AND is_active = TRUE LIMIT 1`,
            [Number(record.substageId)]
          );
          if (!substageData) {
            errors.push('Sub-stage ID not found or inactive');
          } else {
            record.stageId = substageData.stage_id;
          }
        } catch (err) {
          errors.push(`Error validating Sub-stage ID: ${err.message}`);
        }
      }

      // ==== STEP 3: Validate Campaign Name and derive Campaign ID ====
      if (!record.campaignName) {
        errors.push('Campaign Name is required');
      } else {
        try {
          const [[campaignData]] = await pool.execute(
            `SELECT id FROM crm_campaigns WHERE display_name = ? AND is_active = TRUE LIMIT 1`,
            [String(record.campaignName).trim()]
          );
          if (!campaignData) {
            errors.push(`Campaign "${record.campaignName}" not found or inactive`);
          } else {
            record.campaignId = campaignData.id;
          }
        } catch (err) {
          errors.push(`Error validating Campaign Name: ${err.message}`);
        }
      }

      // ==== STEP 4: Validate Source ID ====
      if (!record.sourceId) {
        errors.push('Source ID is required');
      } else {
        try {
          const [[sourceData]] = await pool.execute(
            `SELECT id FROM crm_lead_sources WHERE id = ? AND is_active = TRUE LIMIT 1`,
            [Number(record.sourceId)]
          );
          if (!sourceData) {
            errors.push(`Source ID ${record.sourceId} not found or inactive`);
          } else {
            record.sourceId = Number(record.sourceId);
          }
        } catch (err) {
          errors.push(`Error validating Source ID: ${err.message}`);
        }
      }

      // ==== STEP 5: Validate Assign To (email) and derive owner_employee_id ====
      if (!record.assignTo) {
        errors.push('Assign To (employee email) is required');
      } else {
        try {
          const [[userRecord]] = await pool.execute(
            `SELECT e.id as employeeId FROM app_users u
             LEFT JOIN employees e ON e.id = u.employee_id
             WHERE LOWER(u.email) = LOWER(?) AND u.is_active = TRUE LIMIT 1`,
            [String(record.assignTo).trim()]
          );
          if (!userRecord || !userRecord.employeeId) {
            errors.push(`Employee with email "${record.assignTo}" not found or has no employee ID`);
          } else {
            record.ownerEmployeeId = userRecord.employeeId;
          }
        } catch (err) {
          errors.push(`Error validating Assign To: ${err.message}`);
        }
      }

      // ==== STEP 6: Validate lead data (student name, phone) ====
      if (!record.studentName || String(record.studentName).trim().length === 0) {
        errors.push('Student Name is required');
      } else if (String(record.studentName).length > 200) {
        errors.push('Student Name must be 200 characters or less');
      }

      if (!record.phone || String(record.phone).trim().length === 0) {
        errors.push('Phone is required');
      } else {
        const normalizedPhone = String(record.phone).replace(/[^0-9]/g, '');
        if (normalizedPhone.length < 7 || normalizedPhone.length > 15) {
          errors.push('Phone must contain 7-15 digits');
        }
        record.normalizedPhone = normalizedPhone;
      }

      // ==== STEP 6: Check for duplicates (only if all other validations pass) ====
      if (errors.length === 0 && record.normalizedPhone && record.branchId) {
        try {
          const [[existing]] = await pool.execute(
            `SELECT id FROM crm_leads WHERE branch_id = ? AND normalized_phone = ? AND deleted_at_utc IS NULL LIMIT 1`,
            [record.branchId, record.normalizedPhone]
          );
          if (existing) {
            errors.push('Duplicate: Phone number already exists in database');
            duplicateCount++;
          }
        } catch (err) {
          errors.push(`Error checking duplicates: ${err.message}`);
        }
      }

      // ==== STEP 7: Validate Curriculum exists in crm_curricula ====
      if (record.curriculumId && errors.length === 0) {
        try {
          const [[curricData]] = await pool.execute(
            `SELECT id FROM crm_curricula WHERE id = ? AND is_active = TRUE LIMIT 1`,
            [record.curriculumId]
          );
          if (!curricData) {
            errors.push('Curriculum not found or inactive in database');
          }
        } catch (err) {
          errors.push(`Error validating Curriculum: ${err.message}`);
        }
      }

      if (errors.length > 0) {
        failedRecords.push({
          row: rowNum,
          studentName: record.studentName || '-',
          phone: record.phone || '-',
          errors
        });
      }
    }

    res.json({
      failedRecords,
      duplicateRecords: duplicateCount,
      validCount: records.length - failedRecords.length - duplicateCount
    });
  } catch (error) {
    console.error('Validation endpoint error:', error);
    res.status(500).json({ message: `Validation error: ${error.message}` });
  }
});

// ============= Bulk Leads Import API =============
app.post('/api/bulk-leads/import', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const fileName = cleanOptional(req.body.fileName, 255);
    const records = Array.isArray(req.body.records) ? req.body.records : [];
    const userId = Number(req.user.id);

    // LOG: Received records from frontend
    console.log(`[BULK-IMPORT] Received ${records.length} records. Sample record:`, JSON.stringify(records[0], null, 2));

    if (!fileName) return res.status(400).json({ message: 'File name is required' });
    if (records.length === 0) return res.status(400).json({ message: 'No records to import' });
    if (records.length > 5000) return res.status(400).json({ message: 'Maximum 5000 records per upload' });

    // Get user's branch
    const [userBranches] = await pool.query(
      `SELECT branch_id FROM crm_user_branches WHERE user_id = ? LIMIT 1`,
      [userId]
    );
    const userBranchId = userBranches[0]?.branch_id;
    if (!userBranchId) {
      return res.status(403).json({ message: 'You do not have access to any branch' });
    }

    // STEP 1: Create upload record FIRST with status VALIDATING
    await connection.beginTransaction();

    const [result] = await connection.execute(
      `INSERT INTO crm_bulk_uploads (branch_id, file_name, uploaded_by_user_id, total_records, status, processing_started_at_utc)
       VALUES (?, ?, ?, ?, 'Validating', CURRENT_TIMESTAMP(6))`,
      [userBranchId, fileName, userId, records.length]
    );
    const newUploadId = result.insertId;

    // STEP 2: Run validation and save results to database
    let successCount = 0;
    let failureCount = 0;
    let duplicateCount = 0;

    console.log(`[BULK-IMPORT-VALIDATION] Starting validation loop for ${records.length} records`);

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const rowNum = i + 1;
      const errors = [];

      console.log(`[BULK-IMPORT-VALIDATION] START Row ${rowNum}`);

      // ==== STEP 1: Validate Class ID (Master Key) ====
      if (!record.classId) {
        errors.push('Class ID is required');
      } else {
        try {
          const [[accData]] = await connection.execute(
            `SELECT acc.id, acc.academic_year, acc.branch_id, acc.admission_type_id, c.id as curriculum_id
             FROM mse_admission_class_configuration acc
             JOIN mse_admission_class_configuration_details accd
               ON accd.configuration_id = acc.id
             LEFT JOIN crm_curricula c ON c.id = acc.curriculum_id
             WHERE accd.class_id = ?
             AND accd.is_active = TRUE
             AND acc.is_active = TRUE
             LIMIT 1`,
            [Number(record.classId)]
          );
          if (!accData) {
            errors.push(`Class ID ${record.classId} not found or inactive in Admission Class Configuration`);
          } else {
            record.academicYear = accData.academic_year;
            record.branchId = accData.branch_id;
            record.admissionTypeId = accData.admission_type_id;
            record.curriculumId = accData.curriculum_id;
            if (!record.curriculumId) {
              errors.push('Curriculum not linked to this Class ID');
            }
          }
        } catch (err) {
          errors.push(`Error validating Class ID: ${err.message}`);
        }
      }

      // ==== STEP 2: Validate Sub-stage ID and derive Stage ID ====
      if (!record.substageId) {
        errors.push('Sub-stage ID is required');
      } else {
        try {
          const [[substageData]] = await connection.execute(
            `SELECT stage_id FROM crm_lead_substages WHERE id = ? AND is_active = TRUE LIMIT 1`,
            [Number(record.substageId)]
          );
          if (!substageData) {
            errors.push('Sub-stage ID not found or inactive');
          } else {
            record.stageId = substageData.stage_id;
          }
        } catch (err) {
          errors.push(`Error validating Sub-stage ID: ${err.message}`);
        }
      }

      // ==== STEP 3: Validate Campaign Name and derive Campaign ID ====
      if (!record.campaignName) {
        errors.push('Campaign Name is required');
      } else {
        try {
          const [[campaignData]] = await connection.execute(
            `SELECT id FROM crm_campaigns WHERE display_name = ? AND is_active = TRUE LIMIT 1`,
            [String(record.campaignName).trim()]
          );
          if (!campaignData) {
            errors.push(`Campaign "${record.campaignName}" not found or inactive`);
          } else {
            record.campaignId = campaignData.id;
          }
        } catch (err) {
          errors.push(`Error validating Campaign Name: ${err.message}`);
        }
      }

      // ==== STEP 4: Validate Source ID and resolve Channel ID (NO DEFAULTS) ====
      if (!record.sourceId) {
        errors.push('Source ID is required');
      } else {
        const sourceIdNum = Number(record.sourceId);
        if (isNaN(sourceIdNum) || sourceIdNum <= 0) {
          errors.push('Source ID must be a positive number');
        } else {
          // Validate source exists
          try {
            const [[sourceData]] = await connection.execute(
              `SELECT id FROM crm_lead_sources WHERE id = ? AND is_active = TRUE LIMIT 1`,
              [sourceIdNum]
            );
            if (!sourceData) {
              errors.push(`Source ID '${record.sourceId}' not found or inactive`);
            } else {
              record.sourceId = sourceIdNum;

              // Resolve channel_id from source_id using crm_lead_source_history
              try {
                const [[channelLink]] = await connection.execute(
                  `SELECT DISTINCT channel_id FROM crm_lead_source_history
                   WHERE source_id = ? LIMIT 1`,
                  [sourceIdNum]
                );
                if (!channelLink) {
                  errors.push(`Source ID '${record.sourceId}' has no associated Channel. Cannot import.`);
                } else {
                  record.channelId = channelLink.channel_id;
                }
              } catch (err) {
                errors.push(`Error resolving Channel for Source ID: ${err.message}`);
              }
            }
          } catch (err) {
            errors.push(`Error validating Source ID: ${err.message}`);
          }
        }
      }

      // LOG: After sourceId and channelId validation
      if (rowNum === 1) console.log(`[BULK-IMPORT] Row ${rowNum} after validation: sourceId=${record.sourceId}, channelId=${record.channelId}`);

      // ==== STEP 5: Validate Assign To (email) and derive owner_employee_id ====
      if (!record.assignTo) {
        errors.push('Assign To (employee email) is required');
      } else {
        try {
          const [[userRecord]] = await connection.execute(
            `SELECT e.id as employeeId FROM app_users u
             LEFT JOIN employees e ON e.id = u.employee_id
             WHERE LOWER(u.email) = LOWER(?) AND u.is_active = TRUE LIMIT 1`,
            [String(record.assignTo).trim()]
          );
          if (!userRecord || !userRecord.employeeId) {
            errors.push(`Employee with email "${record.assignTo}" not found or has no employee ID`);
          } else {
            record.ownerEmployeeId = userRecord.employeeId;
          }
        } catch (err) {
          errors.push(`Error validating Assign To: ${err.message}`);
        }
      }

      // ==== STEP 6: Validate lead data (student name, phone) ====
      if (!record.studentName || String(record.studentName).trim().length === 0) {
        errors.push('Student Name is required');
      } else if (String(record.studentName).length > 200) {
        errors.push('Student Name must be 200 characters or less');
      }

      if (!record.phone || String(record.phone).trim().length === 0) {
        errors.push('Phone is required');
      } else {
        const normalizedPhone = String(record.phone).replace(/[^0-9]/g, '');
        if (normalizedPhone.length < 7 || normalizedPhone.length > 15) {
          errors.push('Phone must contain 7-15 digits');
        }
        record.normalizedPhone = normalizedPhone;
      }

      // ==== STEP 6: Check for duplicates (only if all other validations pass) ====
      if (errors.length === 0 && record.normalizedPhone && record.branchId) {
        try {
          const [[existing]] = await connection.execute(
            `SELECT id FROM crm_leads WHERE branch_id = ? AND normalized_phone = ? AND deleted_at_utc IS NULL LIMIT 1`,
            [record.branchId, record.normalizedPhone]
          );
          if (existing) {
            errors.push('Duplicate: Phone number already exists in database');
            duplicateCount++;
          }
        } catch (err) {
          errors.push(`Error checking duplicates: ${err.message}`);
        }
      }

      // ==== STEP 7: Validate Curriculum exists in crm_curricula ====
      if (record.curriculumId && errors.length === 0) {
        try {
          const [[curricData]] = await connection.execute(
            `SELECT id FROM crm_curricula WHERE id = ? AND is_active = TRUE LIMIT 1`,
            [record.curriculumId]
          );
          if (!curricData) {
            errors.push('Curriculum not found or inactive in database');
          }
        } catch (err) {
          errors.push(`Error validating Curriculum: ${err.message}`);
        }
      }

      // STEP 3: Persist validation result to database
      if (errors.length === 0) {
        successCount++;
        console.log(`[BULK-IMPORT-VALIDATION] END Row ${rowNum} - PASSED validation (status=Pending)`);
        await connection.execute(
          `INSERT INTO crm_bulk_upload_records (bulk_upload_id, \`row_number\`, \`status\`)
           VALUES (?, ?, 'Pending')`,
          [newUploadId, rowNum]
        );
      } else {
        failureCount++;
        console.log(`[BULK-IMPORT-VALIDATION] END Row ${rowNum} - FAILED validation (status=Failed, errors: ${JSON.stringify(errors)})`);
        await connection.execute(
          `INSERT INTO crm_bulk_upload_records (bulk_upload_id, \`row_number\`, validation_errors, \`status\`)
           VALUES (?, ?, ?, 'Failed')`,
          [newUploadId, rowNum, JSON.stringify(errors).slice(0, 1000)]
        );
      }
    }

    console.log(`[BULK-IMPORT-VALIDATION] Validation loop completed: ${successCount} passed, ${failureCount} failed`);

    // STEP 4: Update upload status based on validation results
    let uploadStatus = 'Completed';
    let eventType = 'import_success';
    let eventMessage = `All ${records.length} records imported successfully`;

    if (failureCount > 0 && successCount === 0) {
      uploadStatus = 'Failed';
      eventType = 'validation_failed';
      eventMessage = `All ${failureCount} records failed validation`;
    } else if (failureCount > 0) {
      uploadStatus = 'Completed with Errors';
      eventType = 'validation_partial';
      eventMessage = `${successCount} imported, ${failureCount} failed, ${duplicateCount} duplicates`;
    } else if (duplicateCount > 0) {
      uploadStatus = 'Completed';
      eventType = 'validation_complete';
      eventMessage = `${successCount} valid records (${duplicateCount} duplicates)`;
    }

    await connection.execute(
      `INSERT INTO crm_bulk_upload_events (bulk_upload_id, event_type, message)
       VALUES (?, ?, ?)`,
      [newUploadId, eventType, eventMessage]
    );

    // STEP 5: If ALL records failed validation, return (nothing to import)
    if (failureCount > 0 && successCount === 0) {
      console.log(`[BULK-IMPORT] All records failed validation. Returning without import phase.`);
      await connection.execute(
        `UPDATE crm_bulk_uploads SET status = ?, processing_completed_at_utc = CURRENT_TIMESTAMP(6) WHERE id = ?`,
        [uploadStatus, newUploadId]
      );
      await connection.commit();
      return res.status(202).json({
        id: newUploadId,
        status: uploadStatus,
        message: 'Validation completed with errors',
        successCount,
        failureCount,
        duplicateCount
      });
    }

    // STEP 6: Some records passed validation - queue async import
    if (successCount > 0) {
      console.log(`[BULK-IMPORT] ${successCount} records passed validation. Queuing async import phase.`);
      await connection.execute(
        `UPDATE crm_bulk_uploads SET status = 'In Progress' WHERE id = ?`,
        [newUploadId]
      );

      await connection.commit();

      // Queue async lead creation
      setImmediate(() => processBulkUploadImport(newUploadId, records, userBranchId, userId, pool)
        .catch(e => console.error('Bulk import error:', e)));
    } else {
      // No records passed validation, mark as complete
      console.log(`[BULK-IMPORT] No records passed validation. Marking upload as complete.`);
      await connection.commit();
    }

    res.status(202).json({
      id: newUploadId,
      status: 'IMPORTING',
      message: 'Validation passed. Import queued for processing',
      successCount,
      failureCount
    });

  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('Import error:', error);
    res.status(500).json({ message: `Import error: ${error.message}` });
  } finally {
    connection.release();
  }
});

// Helper function to process lead creation during import
async function processBulkUploadImport(uploadId, records, branchId, userId, pool) {
  console.log(`[BULK-IMPORT-PROCESS] START: processBulkUploadImport called for upload ${uploadId}, records count: ${records.length}`);
  const connection = await pool.getConnection();
  try {
    console.log(`[BULK-IMPORT-PROCESS] Got database connection`);
    await connection.execute(`UPDATE crm_bulk_uploads SET processing_started_at_utc=CURRENT_TIMESTAMP(6) WHERE id=?`, [uploadId]);
    console.log(`[BULK-IMPORT-PROCESS] Updated processing_started_at_utc`);

    // Query database for records with status='Pending' (validation passed)
    const [pendingRecords] = await connection.execute(
      `SELECT \`row_number\` FROM crm_bulk_upload_records WHERE bulk_upload_id=? AND \`status\`='Pending'`,
      [uploadId]
    );

    console.log(`[BULK-IMPORT-PROCESS] Found ${pendingRecords.length} pending records for processing`);

    let successCount = 0, failureCount = 0, duplicateCount = 0;
    const errors = [];

    // Process only records that passed validation
    console.log(`[BULK-IMPORT-LOOP] Starting to process ${pendingRecords.length} pending records`);

    for (const pendingRecord of pendingRecords) {
      const rowNum = pendingRecord.row_number;
      const record = records[rowNum - 1]; // records array is 0-indexed, row_number is 1-indexed

      console.log(`[BULK-IMPORT-LOOP] START Row ${rowNum}`);

      if (!record) {
        console.error(`[BULK-IMPORT-ERROR] Row ${rowNum}: Record data not found in memory`);
        failureCount++;
        await connection.execute(
          `UPDATE crm_bulk_upload_records SET validation_errors=?, \`status\`='Failed'
           WHERE bulk_upload_id=? AND \`row_number\`=?`,
          [JSON.stringify({ error: 'Internal error: record data not found' }), uploadId, rowNum]
        );
        console.log(`[BULK-IMPORT-LOOP] END Row ${rowNum} (record not found, continuing to next)`);
        continue;
      }

      try {
        // Start transaction for this row
        await connection.beginTransaction();

        // All validations have already been done in the import endpoint
        // Verify ALL required fields are present and valid - NO DEFAULTS
        const requiredFields = {
          branchId: record.branchId,
          curriculumId: record.curriculumId,
          academicYear: record.academicYear,
          stageId: record.stageId,
          substageId: record.substageId,
          sourceId: record.sourceId,
          channelId: record.channelId,
          campaignId: record.campaignId,
          admissionTypeId: record.admissionTypeId,
          ownerEmployeeId: record.ownerEmployeeId,
          normalizedPhone: record.normalizedPhone
        };

        const missingFields = Object.entries(requiredFields)
          .filter(([key, value]) => !value || (typeof value === 'string' && value.trim() === ''))
          .map(([key]) => key);

        if (missingFields.length > 0) {
          throw new Error(`Missing required fields after validation: ${missingFields.join(', ')}`);
        }

        const followupValidation = await validateStageFollowup(record);

        // No need to re-check duplicates - already validated
        const normalizedPhone = String(record.phone).replace(/[^0-9]/g, '');
        const [[existing]] = await connection.execute(
          `SELECT id, lead_number FROM crm_leads WHERE branch_id=? AND normalized_phone=? AND deleted_at_utc IS NULL LIMIT 1`,
          [branchId, normalizedPhone]
        );

        if (existing) {
          duplicateCount++;
          await connection.execute(
            `UPDATE crm_bulk_upload_records SET lead_id=? WHERE bulk_upload_id=? AND \`row_number\`=?`,
            [existing.id, uploadId, rowNum]
          );
          continue;
        }

        // Create lead - use pre-validated values (all required fields already verified)
        const temporaryNumber = `PENDING-${crypto.randomUUID()}`;
        const params = [temporaryNumber, Number(record.branchId), cleanOptional(record.studentName, 200), cleanOptional(record.phone, 30),
           record.normalizedPhone, Number(record.classId), Number(record.curriculumId),
           record.academicYear, Number(record.stageId), Number(record.sourceId),
           Number(record.channelId), Number(record.ownerEmployeeId), Number(record.campaignId), Number(record.admissionTypeId), Number(record.substageId),
           cleanOptional(record.remarks, 10000), followupValidation.nextFollowupAt, userId];

        // Convert undefined to null for MySQL compatibility
        const safeParams = params.map(p => p === undefined ? null : p);

        // LOG: Before INSERT with full params
        if (rowNum === 1) console.log(`[BULK-IMPORT-LEAD] Row ${rowNum} params:`, JSON.stringify(safeParams.map((p, i) => `[${i}]=${p===null?'NULL':p}`), null, 2));

        const sqlInsert = `INSERT INTO crm_leads (lead_number, branch_id, student_name, phone, normalized_phone,
           class_id, curriculum_id, academic_year, stage_id, source_id,
           channel_id, owner_employee_id, campaign_id, admission_type_id, substage_id,
           remarks, next_followup_at_utc, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        if (rowNum === 1) {
          console.log(`[SQL-EXACT] Complete SQL string:\n${sqlInsert}`);
          console.log(`[SQL-EXACT] Column count: 17`);
          console.log(`[SQL-EXACT] Parameter count: ${params.length}`);
          console.log(`[SQL-EXACT] Parameters:`, params);
        }

        const [leadResult] = await connection.execute(sqlInsert, safeParams);

        const leadNumber = `ADM-${new Date().getFullYear()}-${String(leadResult.insertId).padStart(6, '0')}`;
        await connection.execute(`UPDATE crm_leads SET lead_number=? WHERE id=?`, [leadNumber, leadResult.insertId]);

        // Insert source history
        await connection.execute(
          `INSERT INTO crm_lead_source_history(lead_id, academic_year, source_id, channel_id, campaign_id, is_primary, intake_method, created_by_user_id)
           VALUES(?, ?, ?, ?, ?, TRUE, 'bulk', ?)`,
          [leadResult.insertId, record.academicYear, Number(record.sourceId), Number(record.channelId), Number(record.campaignId), userId]
        );

        // Insert activity
        await connection.execute(
          `INSERT INTO crm_lead_activities (lead_id, activity_type, summary, actor_user_id)
           VALUES (?, 'created', 'Lead created via bulk upload', ?)`,
          [leadResult.insertId, userId]
        );

        // Insert followup if required
        if (followupValidation.required) {
          await connection.execute(
            `INSERT INTO crm_followups (lead_id, assigned_employee_id, followup_type, due_at_utc, created_by_user_id)
             VALUES (?, ?, ?, ?, ?)`,
            [leadResult.insertId, record.ownerEmployeeId ? Number(record.ownerEmployeeId) : null,
             followupValidation.followupType, followupValidation.nextFollowupAt, userId]
          );
        }

        await connection.execute(
          `UPDATE crm_bulk_upload_records SET lead_id=?, created_lead_number=?, processed_at_utc=CURRENT_TIMESTAMP(6)
           WHERE bulk_upload_id=? AND \`row_number\`=?`,
          [leadResult.insertId, leadNumber, uploadId, rowNum]
        );

        // Commit transaction for this row
        await connection.commit();
        successCount++;
        console.log(`[BULK-IMPORT-LOOP] END Row ${rowNum} (success, lead created)`);
      } catch (error) {
        failureCount++;
        console.error(`[BULK-IMPORT-ERROR] Row ${rowNum} failed:`);
        console.error(`  Message: ${error.message}`);
        console.error(`  Code: ${error.code}`);
        console.error(`  SQL: ${error.sql}`);
        console.error(`  Stack: ${error.stack}`);

        // Rollback transaction for this row
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error(`[BULK-IMPORT-ERROR] Row ${rowNum} rollback failed:`, rollbackError.message);
        }

        // Update record status to Failed (using a separate connection/statement, not in transaction)
        try {
          await connection.execute(
            `UPDATE crm_bulk_upload_records SET validation_errors=?, \`status\`='Failed' WHERE bulk_upload_id=? AND \`row_number\`=?`,
            [JSON.stringify({
              error: error.message,
              code: error.code,
              sql: error.sql
            }), uploadId, rowNum]
          );
        } catch (updateError) {
          console.error(`[BULK-IMPORT-ERROR] Row ${rowNum} failed to update status:`, updateError.message);
        }

        errors.push({ row: rowNum, message: error.message });
      }
    }

    // Query actual counts from database (validates all phases: validation + import)
    // Success = record has lead_id (was imported), Failed = status='Failed', Duplicate = status='Duplicate'
    const [[counts]] = await connection.execute(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN lead_id IS NOT NULL THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN \`status\`='Failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN \`status\`='Duplicate' THEN 1 ELSE 0 END) as duplicate
       FROM crm_bulk_upload_records WHERE bulk_upload_id=?`,
      [uploadId]
    );

    const actualSuccessful = counts.completed || 0;
    const actualFailed = counts.failed || 0;
    const actualDuplicate = counts.duplicate || 0;
    const actualTotal = counts.total || 0;

    // Determine final status based on actual database counts
    let finalStatus = 'Completed';
    if (actualFailed > 0 && actualSuccessful === 0) {
      finalStatus = 'Failed';
    } else if (actualFailed > 0) {
      finalStatus = 'Completed with Errors';
    }

    console.log(`[BULK-IMPORT-SUMMARY] Upload ${uploadId}: ${actualSuccessful} successful, ${actualFailed} failed, ${actualDuplicate} duplicate`);

    await connection.execute(
      `UPDATE crm_bulk_uploads SET
        status=?,
        processed_records=?,
        successful_records=?,
        failed_records=?,
        duplicate_records=?,
        processing_completed_at_utc=CURRENT_TIMESTAMP(6),
        error_summary=?
       WHERE id=?`,
      [finalStatus, actualTotal, actualSuccessful, actualFailed, actualDuplicate,
       errors.length > 0 ? JSON.stringify(errors.slice(0, 10)).slice(0, 500) : null, uploadId]
    );

    await connection.execute(
      `INSERT INTO crm_bulk_upload_events (bulk_upload_id, event_type, message)
       VALUES (?, 'processing_completed', ?)`,
      [uploadId, `Completed: ${actualSuccessful} successful, ${actualFailed} failed, ${actualDuplicate} duplicates`]
    );
  } catch (error) {
    await connection.execute(
      `UPDATE crm_bulk_uploads SET status='Failed', error_summary=?, processing_completed_at_utc=CURRENT_TIMESTAMP(6)
       WHERE id=?`,
      [JSON.stringify({ error: error.message }), uploadId]
    ).catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

// ============= Integration Hub Routes =============
app.use('/api/hub', createIntegrationHubRoutes(integrationHubService, authenticate, requireCrmAccess));

app.use((error, _req, res, _next) => {
  console.error('[API Error]', error.message, error.stack);
  const status = error.status || 500;
  let message = error.message || 'Database operation failed';

  // Ensure message is always a string
  if (typeof message !== 'string') {
    console.error('[API Error] Non-string message:', message);
    try {
      message = JSON.stringify(message);
    } catch {
      message = String(message);
    }
  }

  res.status(status).json({
    success: false,
    message: message.trim() || 'Unknown error',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

try {
  await pool.query('SELECT 1');
  const [[schema]] = await pool.query(`SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='crm_leads'`);
  if (Number(schema.count) !== 1) throw new Error('CRM database schema is not ready. Run the MySQL migrations.');
} catch (error) {
  console.error(`CRM API startup failed: ${error.message}`);
  process.exit(1);
}

app.listen(port, async () => {
  console.log(`Admissions CRM API running at http://localhost:${port}`);
  console.log(`Data mode: ${process.env.MYSQL_DATABASE} MySQL (required)`);

  // Log crm_leads table structure for debugging
  try {
    const [[tableInfo]] = await pool.query(`SHOW CREATE TABLE crm_leads`);
    console.log(`\n[TABLE-SCHEMA] crm_leads CREATE statement:\n${tableInfo['Create Table']}\n`);
  } catch (err) {
    console.error('[TABLE-SCHEMA] Error fetching crm_leads schema:', err.message);
  }
});
