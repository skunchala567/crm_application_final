import 'dotenv/config';
import cors from 'cors';
import crypto from 'node:crypto';
import express from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';
import axios from 'axios';
import { branchScopeSql, canAccessBranch, referenceBranchScopeSql } from './rbac/branch-scope.js';
import { IntegrationHubService, createIntegrationHubRoutes } from './integration-hub/index.js';
import { createWhatsAppTemplateRoutes } from './whatsapp/whatsapp-template.routes.js';
import { createWebhookRoutes } from './whatsapp/webhook.routes.js';
import { createAutomationEngine, ensureAutomationRuntimeSchema } from './automation-engine.js';
import { createMarketingCampaignEngine, ensureMarketingCampaignSchema } from './marketing-campaign-engine.js';
import { createBusinessPlatformRoutes } from './business-platform.routes.js';
import { createUsageRoutes } from './usage.routes.js';
import { createCallerDeskRoutes, createCallerDeskWebhookRoutes } from './callerdesk/callerdesk.routes.js';
import { createSmartfloRoutes, createSmartfloWebhookRoutes } from './smartflo/smartflo.routes.js';
import { createJodoPaymentLinkRoutes } from './jodo-payment-links.routes.js';
import { createPaymentLinkBatchRoutes } from './payment-link-batches.routes.js';
import { createPaymentLinkBatchEngine } from './payment-link-batch-engine.js';
import { createJodoWebhookRoutes } from './jodo-webhook.routes.js';
import { jodoBaseUrl, jodoHeaders } from './jodo-client.js';
import { createBranchesRoutes } from './branches.routes.js';
import { createPaymentFormsRoutes } from './payment-forms.routes.js';
import { createPartnerRoutes } from './partner/partner.routes.js';
import { createReportDataSourceRoutes } from './report-data-sources.routes.js';
import { createBusinessConfigRoutes } from './business-config.routes.js';
import { createSmsTemplateRoutes } from './sms-templates.routes.js';
import { createMetaRoutes } from './meta/meta.routes.js';
import { createMetaWebhookRoutes } from './meta/meta-webhook.routes.js';
import { createMetaRemarketingRoutes } from './meta/meta-remarketing.routes.js';
import { syncAudience as syncRemarketingAudience, nextSyncAt as nextRemarketingSyncAt } from './meta/meta-remarketing.service.js';
import { startMetaPoller } from './meta/meta-poller.js';
import { createEmailRoutes } from './email/email.routes.js';
import { recordLeadAttribution } from './attribution/attribution-contract.js';
import { createRbacMiddleware } from './rbac/rbac.middleware.js';
import { scopeNarrowingSql, scopeCovers } from './rbac/permission-service.js';
import { createRbacRoutes } from './rbac/rbac.routes.js';
import { bootstrapRbac } from './rbac/rbac-bootstrap.js';
import { notifyEmployee } from './notification-service.js';
import { resolveAssignmentRuleOwner } from './assignment-rules/engine.js';
import { findDuplicateLead, loadDuplicateRule, normalizeDuplicateRule, describeRule, DUPLICATE_FIELDS } from './lead-duplicate-rule.js';
import zlib from 'node:zlib';

const app = express();
const port = Number(process.env.PORT || 3001);
const jwtSecret = process.env.JWT_SECRET || 'local-development-secret-change-me';
const allowedOrigin = process.env.WEB_ORIGIN || 'http://localhost:3000';
const whatsappMediaDirectory = path.resolve('uploads/whatsapp');
const emailAttachmentDirectory = path.resolve('uploads/email-attachments');

if (process.env.DEMO_MODE && process.env.DEMO_MODE.toLowerCase() !== 'false') {
    throw new Error('DEMO_MODE is disabled for this CRM. Set DEMO_MODE=false and configure MySQL.');
}
const requiredDatabaseSettings = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];
const missingDatabaseSettings = requiredDatabaseSettings.filter((name) => !process.env[name]);
if (missingDatabaseSettings.length) {
    throw new Error(`MySQL configuration is required. Missing: ${missingDatabaseSettings.join(', ')}`);
}

app.use(cors({ origin: "*" }));
app.use(express.json({
    limit: '1mb',
    // Meta signs the exact bytes it sent, so the HMAC must be computed over the
    // raw buffer -- re-serialising req.body would not reproduce them. Scoped to
    // the Meta webhook so other routes do not retain a second copy of the body.
    verify: (req, _res, buf) => {
        const url = req.originalUrl || req.url || '';
        if (url.startsWith('/api/meta/')) req.rawBody = buf;
    },
}));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use('/media/whatsapp', express.static(whatsappMediaDirectory, {
    fallthrough: false,
    maxAge: '1d',
    immutable: false
}));

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
    timezone: '+05:30',
    // The database is reached over the open network, where anything in the
    // path -- NAT tables, load balancers, the server's own wait_timeout --
    // silently drops connections that have sat idle. Neither end is told, so
    // mysql2 hands out a socket that is already gone and the next query dies
    // with ECONNRESET. TCP keepalives stop the middle boxes from considering
    // the connection idle in the first place.
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    // And if one is dropped anyway, retire it on our own schedule rather than
    // discovering it mid-request. Four minutes sits under the usual 5-minute
    // NAT idle window.
    idleTimeout: Number(process.env.MYSQL_IDLE_TIMEOUT || 240_000),
    maxIdle: Number(process.env.MYSQL_MAX_IDLE || 4),
});
pool.on('connection', (connection) => connection.query("SET time_zone = '+05:30'"));

/* Keepalives make a dropped connection rare, not impossible -- a server
   restart or a network blip still lands one in the pool. These are the codes
   that mean "this socket is dead", as opposed to "the database rejected your
   query". */
const DEAD_CONNECTION_CODES = new Set([
    'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ECONNREFUSED',
    'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN',
]);
// These errors occur before a packet can reach MySQL, so one retry is safe
// for writes as well as reads. Socket resets/timeouts remain read-only retries
// because the server may already have executed a write before the connection
// failed.
const PRE_CONNECT_FAILURE_CODES = new Set(['ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'ECONNREFUSED']);
// Deliberately no WITH: MySQL 8 allows `WITH ... UPDATE` and `WITH ... DELETE`,
// so a leading CTE says nothing about whether the statement writes.
const READ_ONLY_STATEMENT = /^\s*(?:\/\*[\s\S]*?\*\/\s*)?(?:SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i;

/* Retry a dead connection once, but only for reads.

   When the socket was reaped while idle, the reset arrives as we write the
   query and the server never saw it, so replaying is safe. We cannot prove
   that from the error alone, though: a reset that arrives *after* the server
   ran an autocommitted INSERT looks identical, and replaying that would
   duplicate a lead. Reads carry no such risk, and they are the overwhelming
   majority of what breaks after an idle spell. A failed write still surfaces
   -- loudly -- rather than being silently doubled. */
for (const method of ['execute', 'query']) {
    const direct = pool[method].bind(pool);
    pool[method] = async (...args) => {
        try {
            return await direct(...args);
        } catch (error) {
            const sql = typeof args[0] === 'string' ? args[0] : args[0]?.sql;
            if (!DEAD_CONNECTION_CODES.has(error?.code)) throw error;
            if (!READ_ONLY_STATEMENT.test(sql || '') && !PRE_CONNECT_FAILURE_CODES.has(error?.code)) {
                console.error(`[mysql] ${error.code} on a write; not retried:`, String(sql || '').slice(0, 120));
                throw error;
            }
            console.warn(`[mysql] ${error.code} on a database connection, retrying once`);
            await new Promise(resolve => setTimeout(resolve, 250));
            return await direct(...args);
        }
    };
}

// ============= Integration Hub Setup =============

// Check if migration 005 has been applied (consolidation of integrations tables)
async function checkIntegrationsMigration() {
    try {
        const [columns] = await pool.execute(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'crm_integrations'
      AND TABLE_SCHEMA = DATABASE()
    `);

        const columnNames = columns.map(c => c.COLUMN_NAME);
        const hasMigration = columnNames.includes('integration_type') && columnNames.includes('provider_name');

        if (!hasMigration) {
            console.warn('⚠️  WARNING: Migration 005 (integrations consolidation) not yet applied');
            console.warn('   Columns integration_type, provider_name, integration_name are missing');
            console.warn('   Using backward-compatible fallback. Please run: mysql -u root < apps/api/src/migrations/005_consolidate_integrations_tables.sql');
        } else {
            console.log('✓ Integration table consolidation (migration 005) detected');
        }
    } catch (error) {
        console.warn('⚠️  Could not check migration status:', error.message);
    }
}

await checkIntegrationsMigration();

const integrationHubService = new IntegrationHubService(pool);
const automationEngine = createAutomationEngine(pool, {
    logger: console,
    sendWhatsApp: (request) => integrationHubService.sendSmartpingMessage(
        request.integrationId,
        request.organizationId,
        request.phoneNumber,
        request.message,
        request.options,
    ),
});
const paymentLinkBatchEngine = createPaymentLinkBatchEngine(pool, {
    logger: console,
    sendWhatsApp: (request) => integrationHubService.sendSmartpingMessage(
        request.integrationId,
        request.organizationId,
        request.phoneNumber,
        request.message,
        request.options,
    ),
});

const marketingCampaignEngine = createMarketingCampaignEngine(pool, {
    logger: console,
    sendWhatsApp: (request) => integrationHubService.sendSmartpingMessage(
        request.integrationId,
        request.organizationId,
        request.phoneNumber,
        request.message,
        request.options,
    ),
});

// Register providers
try {
    // Import and register Google Sheets provider
    const { GoogleSheetsProvider } = await import('./integration-hub/providers/google-sheets-provider.js');
    integrationHubService.registerProvider('google_sheets', GoogleSheetsProvider);
    console.log('✓ Google Sheets provider registered');

    // Import and register Smartping provider
    const { SmartpingProvider } = await import('./integration-hub/providers/smartping-provider.js');
    integrationHubService.registerProvider('smartping', SmartpingProvider);
    console.log('✓ Smartping provider registered');

    const { SmartpingSmsProvider } = await import('./integration-hub/providers/smartping-sms-provider.js');
    integrationHubService.registerProvider('smartping_sms', SmartpingSmsProvider);
    console.log('✓ SmartPing SMS provider registered');
} catch (error) {
    console.error('❌ ERROR loading providers:');
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    console.warn('Warning: Could not load providers:', error.message);
}

let whatsAppStatusPollRunning = false;
setInterval(async () => {
    if (whatsAppStatusPollRunning) return;
    whatsAppStatusPollRunning = true;
    try {
        await integrationHubService.pollPendingWhatsAppMessages();
    } catch (error) {
        console.error('WhatsApp status polling cycle failed:', error.message);
    } finally {
        whatsAppStatusPollRunning = false;
    }
}, 5000).unref();

let googleSheetSyncRunning = false;
const runGoogleSheetSync = async () => {
    if (googleSheetSyncRunning) return;
    googleSheetSyncRunning = true;
    try {
        await integrationHubService.syncActiveSheetSources();
    } catch (error) {
        console.error('Continuous Google Sheets sync cycle failed:', error.message);
    } finally {
        googleSheetSyncRunning = false;
    }
};
// Meta will not deliver webhooks while the app is unpublished, so leads are
// polled until App Review completes. Harmless once the webhook is live: both
// paths share one ledger keyed on leadgen_id.
startMetaPoller(pool, console);

const googleSheetSyncTimer = setInterval(runGoogleSheetSync, 60000);
googleSheetSyncTimer.unref();
setTimeout(runGoogleSheetSync, 10000).unref();

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

// Access control runs as the second half of authentication rather than as a
// middleware each route opts into. Every protected route already passes
// through here, so nothing can be left unguarded by omission -- which is the
// difference between an access control system and a set of hidden buttons.
const rbacGuard = createRbacMiddleware(pool, console);

function authenticate(req, res, next) {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ message: 'Authentication required' });
    let claims;
    try {
        claims = jwt.verify(token, jwtSecret);
    } catch {
        return res.status(401).json({ message: 'Session expired or invalid' });
    }
    req.user = claims;
    return rbacGuard(req, res, next);
}

const whatsappMediaRules = {
    IMAGE: { prefixes: ['image/'], maxBytes: 5 * 1024 * 1024, label: 'image' },
    VIDEO: { prefixes: ['video/mp4'], maxBytes: 16 * 1024 * 1024, label: 'MP4 video' },
    DOCUMENT: { prefixes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument'], maxBytes: 20 * 1024 * 1024, label: 'PDF or document' },
    FILE: { prefixes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument'], maxBytes: 20 * 1024 * 1024, label: 'PDF or document' }
};

app.post(
    '/api/whatsapp/media-upload',
    authenticate,
    express.raw({ type: () => true, limit: '20mb' }),
    async (req, res, next) => {
        try {
            const templateType = String(req.headers['x-template-type'] || '').toUpperCase();
            const integrationId = Number(req.headers['x-integration-id']);
            if (!Number.isInteger(integrationId) || integrationId < 1) {
                return res.status(400).json({ message: 'Select a WhatsApp account before uploading' });
            }
            const [integrationRows] = await pool.query(
                `SELECT id, provider, config, media_public_base_url
         FROM crm_integrations
         WHERE id = ? AND deleted_at IS NULL
         LIMIT 1`,
                [integrationId]
            );
            const integration = integrationRows[0];
            if (!integration || String(integration.provider).toLowerCase() !== 'smartping') {
                return res.status(404).json({ message: 'WhatsApp integration not found' });
            }
            const integrationConfig = typeof integration.config === 'string'
                ? JSON.parse(integration.config)
                : integration.config || {};
            const mediaPublicBaseUrl = String(
                integration.media_public_base_url || integrationConfig.mediaPublicBaseUrl || ''
            ).trim().replace(/\/+$/, '');
            if (!/^https:\/\/[^/\s]+/i.test(mediaPublicBaseUrl)) {
                return res.status(400).json({ message: 'Configure the Public Media Base URL for this WhatsApp integration first' });
            }
            const rule = whatsappMediaRules[templateType];
            if (!rule) return res.status(400).json({ message: 'This template does not accept an attachment' });
            if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ message: 'Choose a file to upload' });

            const mimeType = String(req.headers['content-type'] || 'application/octet-stream').toLowerCase();
            if (!rule.prefixes.some(prefix => mimeType.startsWith(prefix))) {
                return res.status(400).json({ message: `Choose a valid ${rule.label} file` });
            }
            if (req.body.length > rule.maxBytes) {
                return res.status(413).json({ message: `${rule.label} exceeds the allowed upload size` });
            }

            const requestedName = decodeURIComponent(String(req.headers['x-file-name'] || 'attachment'));
            const safeExtensions = {
                'image/jpeg': '.jpg',
                'image/png': '.png',
                'image/webp': '.webp',
                'image/gif': '.gif',
                'video/mp4': '.mp4',
                'application/pdf': '.pdf',
                'application/msword': '.doc',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
            };
            const extension = safeExtensions[mimeType] || '.bin';
            const storedName = `${Date.now()}-${crypto.randomUUID()}${extension}`;
            const integrationDirectory = path.join(whatsappMediaDirectory, String(integrationId));
            await fs.mkdir(integrationDirectory, { recursive: true });
            await fs.writeFile(path.join(integrationDirectory, storedName), req.body, { flag: 'wx' });

            res.status(201).json({
                success: true,
                data: {
                    url: `${mediaPublicBaseUrl}/media/whatsapp/${integrationId}/${encodeURIComponent(storedName)}`,
                    filename: path.basename(requestedName),
                    mimeType,
                    size: req.body.length,
                    templateType
                }
            });
        } catch (error) {
            next(error);
        }
    }
);

const crmRoles = new Set(['CRM_ADMIN', 'SUPER_ADMIN', 'ADMISSION_MANAGER', 'COUNSELLOR', 'CRM_VIEWER']);
async function requireCrmAccess(req, res, next) {
    if (!req.user.roles?.some((role) => crmRoles.has(role))) return res.status(403).json({ success: false, error: 'Your account does not have Admissions CRM access', details: `Required roles: ${Array.from(crmRoles).join(', ')}. Your roles: ${req.user.roles?.join(', ') || 'none'}` });
    const [rows] = await pool.execute(`SELECT COALESCE((SELECT is_active FROM crm_user_access_status WHERE user_id=?),1) AS crmActive`, [Number(req.user.id)]);
    if (!Boolean(rows[0]?.crmActive)) return res.status(403).json({ success: false, error: 'Your CRM access is inactive', details: 'Contact a CRM administrator to reactivate your access' });
    const requestedUnitId = Number(req.headers['x-business-unit-id']);
    /*
     * Only an unrestricted administrator may work in any unit.
     *
     * This used to treat every CRM_ADMIN as unrestricted, so a CRM
     * administrator assigned to one business unit could reach any other simply
     * by sending a different X-Business-Unit-Id -- and with it that unit's
     * leads, configuration and staff. A CRM_ADMIN who has been given units is
     * now held to them, exactly like anyone else; one with no units assigned
     * is still unrestricted, matching how branches already behave.
     */
    const superAdmin = req.user.roles?.some(role => String(role).toUpperCase() === 'SUPER_ADMIN');
    const [ownUnits] = superAdmin
        ? [[]]
        : await pool.execute('SELECT business_unit_id AS id FROM crm_user_business_units WHERE user_id=?', [Number(req.user.id)]);
    const isAdmin = superAdmin || ownUnits.length === 0;
    const params = isAdmin
        ? (Number.isInteger(requestedUnitId) && requestedUnitId > 0 ? [requestedUnitId] : [])
        : [Number(req.user.id), ...(Number.isInteger(requestedUnitId) && requestedUnitId > 0 ? [requestedUnitId] : [])];
    const requestedClause = Number.isInteger(requestedUnitId) && requestedUnitId > 0 ? 'AND bu.id=?' : '';
    const [[businessUnit]] = await pool.execute(
        isAdmin
            ? `SELECT bu.id,bu.unit_code AS unitCode,bu.display_name AS displayName,bu.compatibility_mode AS compatibilityMode,bu.deletion_password_hash AS deletionPasswordHash
         FROM crm_business_units bu WHERE bu.is_active=TRUE ${requestedClause}
         ORDER BY bu.is_default DESC,bu.id LIMIT 1`
            : `SELECT bu.id,bu.unit_code AS unitCode,bu.display_name AS displayName,bu.compatibility_mode AS compatibilityMode,bu.deletion_password_hash AS deletionPasswordHash
         FROM crm_business_units bu
         JOIN crm_user_business_units ubu ON ubu.business_unit_id=bu.id AND ubu.user_id=?
         WHERE bu.is_active=TRUE ${requestedClause}
         ORDER BY ubu.is_default DESC,bu.is_default DESC,bu.id LIMIT 1`,
        params,
    );
    if (!businessUnit) return res.status(403).json({ message: 'You do not have access to the selected Business Unit' });
    req.businessUnit = { ...businessUnit, id: Number(businessUnit.id) };
    req.user.businessUnitId = Number(businessUnit.id);
    if (req.method === 'DELETE' && businessUnit.deletionPasswordHash) {
        const supplied = String(req.headers['x-deletion-password'] || '');
        if (!supplied) return res.status(428).json({ code: 'DELETION_PASSWORD_REQUIRED', message: 'Enter the Business Unit deletion password to continue' });
        if (!verifyAttendancePassword(supplied, businessUnit.deletionPasswordHash)) return res.status(403).json({ code: 'DELETION_PASSWORD_INVALID', message: 'Incorrect deletion password' });
    }
    return next();
}

function requireLeadWrite(req, res, next) {
    const allowed = ['CRM_ADMIN', 'SUPER_ADMIN', 'ADMISSION_MANAGER', 'COUNSELLOR'];
    if (req.user.roles?.some((role) => allowed.includes(role))) return next();
    return res.status(403).json({ success: false, error: 'Insufficient permissions for lead creation/import', details: `Required roles: ${allowed.join(', ')}. Your roles: ${req.user.roles?.join(', ') || 'none'}` });
}

function requireLeadDelete(req, res, next) {
    const allowed = ['CRM_ADMIN', 'SUPER_ADMIN', 'ADMISSION_MANAGER'];
    if (req.user.roles?.some((role) => allowed.includes(role))) return next();
    return res.status(403).json({ message: 'Your CRM role cannot delete leads' });
}

/**
 * CRM user administration.
 *
 * Deliberately does not accept the Attendance system's 'ADMIN' role: the CRM
 * decides who administers the CRM. Anyone who needs it holds CRM_ADMIN or
 * SUPER_ADMIN, which are granted from Settings -> User Management -> Access
 * Control rather than from the Attendance application.
 */
function requireUserAdmin(req, res, next) {
    if (req.user.roles?.some((role) => ['CRM_ADMIN', 'SUPER_ADMIN'].includes(role))) return next();
    return res.status(403).json({ message: 'CRM user administration requires CRM Admin access' });
}

/*
 * Now a thin name over rbac/branch-scope.js. The rule used to live here in
 * full, which meant the route files split out of app.js could not reach it and
 * went unscoped; it moved to a module so payments, payment forms and enquiry
 * forms enforce the same "your branches" that leads always did.
 */
function scopedWhere(user, column = 'l.branch_id') {
    return branchScopeSql(user, column);
}

/**
 * Which lead rows this user may see.
 *
 * Two independent bounds, ANDed:
 *
 *   Tenancy  - the business unit, and the branches the user is mapped to.
 *              This is data isolation and applies whatever the roles say.
 *   Record scope - the own/team/department/all scope attached to the user's
 *              leads.list.view grant, resolved by the RBAC middleware.
 *
 * While enforcement is off or in audit the record scope is not applied, so
 * these queries return exactly what they returned before RBAC existed --
 * "audit changes nothing" has to be literally true or it is not a safe place
 * to land.
 *
 * The role-name test below survives only as the pre-RBAC fallback. Once
 * enforcement is on, a scope of 'all' is what lifts the branch restriction,
 * so access follows the grant rather than a hardcoded role name.
 */
/*
 * "Due today", defined once.
 *
 * The follow-up badges disagreed -- the bell said 1 while the Leads screen
 * said 2 for the same two leads -- because each decided for itself what
 * "due" meant:
 *
 *   bell   f.due_at_utc <= CURRENT_TIMESTAMP()      -- up to this instant
 *   leads  DATE(l.next_followup_at_utc) <= <today>  -- the whole day
 *
 * A follow-up set for 11:31 pm is due today but not yet due at 5 pm, so the
 * bell dropped it. The badge answers "how many leads need me today", which
 * is a calendar day, so both now compare days.
 *
 * On timezones: despite the _utc suffix these columns hold IST wall-clock
 * time. The pool pins every connection to '+05:30' (see createPool above),
 * so values are written in IST and CURRENT_DATE() reads back in IST. The
 * comparison stays inside that one frame -- converting the column with
 * CONVERT_TZ would shift it a second time and push an 11:31 pm follow-up
 * into tomorrow.
 *
 * Both badges also read the same column now. crm_followups keeps a row per
 * scheduled follow-up and they accumulate -- lead 621 has three pending for
 * one lead -- so counting there needs a DISTINCT that crm_leads does not.
 */
/** Leads with an actual pending follow-up due on or before today. */
const FOLLOWUP_DUE_SQL = `EXISTS (
         SELECT 1 FROM crm_followups due_followup
         WHERE due_followup.lead_id=l.id
           AND LOWER(due_followup.status) IN ('p','pending')
           AND DATE(due_followup.due_at_utc)<=CURRENT_DATE()
       )`;
/** ...and those whose day has already passed. */
const FOLLOWUP_OVERDUE_SQL = 'DATE(l.next_followup_at_utc) < CURRENT_DATE()';

/**
 * @param widerScope optional scope that may replace the list scope when it
 *   grants more -- used by search, which has a permission of its own.
 */
function leadScopedWhere(user, widerScope = null, options = {}) {
    const branchIds = Array.isArray(user.branchIds) ? user.branchIds.map(Number).filter(Number.isFinite) : [];
    const unitId = Number(user.businessUnitId);
    const unitSql = Number.isInteger(unitId) && unitId > 0 ? 'l.business_unit_id=?' : '1=1';
    const unitParams = Number.isInteger(unitId) && unitId > 0 ? [unitId] : [];

    const enforced = Boolean(user.rbacEnforced);
    const listScope = enforced ? (user.rbacScope || 'none') : null;
    // Whichever of the two reaches further; never narrower than the list.
    const scope = enforced && widerScope
        ? (scopeCovers(widerScope, listScope) ? widerScope : listScope)
        : listScope;

    // Narrowing from the permission grant, applied on top of tenancy.
    const narrow = enforced
        ? scopeNarrowingSql(user, scope)
        : { sql: '1=1', params: [] };

    const compose = (base) => ({
        sql: narrow.sql === '1=1' ? base.sql : `${base.sql} AND (${narrow.sql})`,
        params: [...base.params, ...(narrow.sql === '1=1' ? [] : narrow.params)],
    });

    // Unrestricted readers -- an 'all' grant, or an admin while RBAC is not yet
    // enforcing -- are bounded by the business unit only.
    const unrestricted = enforced
        ? scope === 'all'
        : user.roles?.some((role) => ['CRM_ADMIN', 'SUPER_ADMIN'].includes(role));
    if (unrestricted) return compose({ sql: unitSql, params: unitParams });

    if (branchIds.length === 0) return { sql: '1=0', params: [] };
    const placeholders = branchIds.map(() => '?').join(',');
    // A lead with no branch (currently only WhatsApp-originated leads
    // awaiting a claim -- see webhook.routes.js) belongs to no one's branch
    // list, so the branch test alone would hide it from everyone. Letting it
    // through here leaves the narrow (own/team/department) predicate below
    // as the sole gate, which is exactly "owner and admin only" once someone
    // claims it, and "admin only" (unrestricted, above) until then.
    const restricted = compose({
        sql: `(l.branch_id IN (${placeholders}) OR l.referred_to_branch_id IN (${placeholders}) OR l.branch_id IS NULL)`,
        params: [...branchIds, ...branchIds],
    });

    /*
     * Leads this user referred to someone else.
     *
     * An 'own' grant keys on owner_employee_id, and referring a lead hands that
     * column to the new counsellor -- so the moment a counsellor refers a lead
     * away it drops out of their list entirely, and the "Referred by me" filter
     * on the Leads screen had nothing left to match. The referrer is recorded on
     * the lead itself, so add it back as an alternative to the branch and owner
     * test. Only the business unit still bounds it: a lead referred on to a
     * third branch is no longer in any branch this user reads, and hiding it
     * would put the filter right back where it started.
     *
     * Opt-in per call site: this is for reading the Leads list and opening a
     * lead from it, not for the routes that edit, refer or delete -- those stay
     * with the current owner. A 'none' grant is not widened; it is no access.
     */
    const referrerEmployeeId = Number(user.employeeId) || 0;
    if (!options.includeReferredAway || !referrerEmployeeId || narrow.sql === '1=0') return {
        sql: unitSql === '1=1' ? restricted.sql : `${unitSql} AND ${restricted.sql}`,
        params: [...unitParams, ...restricted.params],
    };
    const body = `((${restricted.sql}) OR l.referred_by_employee_id = ?)`;
    return {
        sql: unitSql === '1=1' ? body : `${unitSql} AND ${body}`,
        params: [...unitParams, ...restricted.params, referrerEmployeeId],
    };
}

async function loadDatabaseUser(email) {
    const [rows] = await pool.execute(
        `SELECT u.id, u.employee_id AS employeeId, u.email, u.password_hash AS passwordHash,
            u.is_active AS isActive, COALESCE(cuas.is_active,1) AS crmActive, u.failed_login_count AS failedLoginCount,
            u.lockout_end_utc AS lockoutEndUtc,
            COALESCE(e.employee_name,CONCAT_WS(' ',p.first_name,p.last_name),u.email) AS name
     FROM app_users u
     LEFT JOIN crm_user_access_status cuas ON cuas.user_id=u.id
     LEFT JOIN employees e ON e.id = u.employee_id
     LEFT JOIN crm_user_profiles p ON p.user_id=u.id
     WHERE u.normalized_email = ? LIMIT 1`,
        [email.trim().toUpperCase()],
    );
    if (!rows.length) return null;
    const user = rows[0];
    const [roles] = await pool.execute(
        `SELECT r.normalized_name AS name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
        [user.id],
    );
    // CRM branch access comes from crm_user_branches only.
    //
    // This used to fall back to the Attendance system's `user_branches` table
    // for anyone holding its ADMIN role, which meant a CRM user's data access
    // could be widened by a change made in a different application, with nothing
    // in the CRM to show why. Branch access is now granted in one place:
    // Settings -> User Management -> Access Configuration.
    const [branches] = await pool.execute(
        `SELECT branch_id AS id FROM crm_user_branches WHERE user_id = ?`, [user.id],
    );
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
        roles: databaseUser.roles, branchIds: databaseUser.branchIds, crmActive: Boolean(databaseUser.crmActive),
        organizationId: 1, // Single-tenant: all users belong to the default organization
    };
    res.json({ token: issueToken(user), user });
});

app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: req.user }));

/**
 * Change the signed-in user's own password.
 *
 * app_users is shared with the Attendance system, so this changes the single
 * credential used by both. Rotating security_stamp mirrors what user creation
 * does and is what lets existing sessions be invalidated later.
 */
app.post('/api/auth/change-password', authenticate, async (req, res) => {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: 'Current and new password are both required' });
    }
    if (newPassword.length < 8) {
        return res.status(400).json({ message: 'New password must be at least 8 characters' });
    }
    if (newPassword === currentPassword) {
        return res.status(400).json({ message: 'New password must be different from the current one' });
    }

    const [[row]] = await pool.execute(
        'SELECT id, password_hash AS passwordHash, is_active AS isActive FROM app_users WHERE id = ? LIMIT 1',
        [req.user.id],
    );
    if (!row || !row.isActive) return res.status(401).json({ message: 'Account is not active' });

    // Re-verify the current password: a stolen token must not be enough to
    // take over the account.
    if (!verifyAttendancePassword(currentPassword, row.passwordHash)) {
        return res.status(400).json({ message: 'Current password is incorrect' });
    }

    await pool.execute(
        `UPDATE app_users
        SET password_hash = ?, security_stamp = ?, failed_login_count = 0,
            lockout_end_utc = NULL, updated_at_utc = CURRENT_TIMESTAMP(6)
      WHERE id = ?`,
        [hashAttendancePassword(newPassword), crypto.randomUUID(), row.id],
    );

    res.json({ success: true, message: 'Password changed' });
});

async function publicFormDefinition(formKey, activeOnly = true) {
    const [[form]] = await pool.execute(
        `SELECT f.id,f.form_key AS formKey,f.display_name AS displayName,f.description,f.business_unit_id AS businessUnitId,
            f.default_branch_id AS defaultBranchId,f.default_stage_id AS defaultStageId,f.default_substage_id AS defaultSubstageId,
            f.default_source_id AS defaultSourceId,f.default_channel_id AS defaultChannelId,f.default_campaign_id AS defaultCampaignId,
            f.default_owner_employee_id AS defaultOwnerEmployeeId,f.field_schema_json AS fieldSchema,f.settings_json AS settings,
            f.success_message AS successMessage,f.redirect_url AS redirectUrl,f.is_active AS isActive,
            f.payment_required AS paymentRequired,f.payment_amount AS paymentAmount,
            COALESCE(f.updated_by_user_id,f.created_by_user_id) AS actorUserId,bu.display_name AS businessUnitName,bu.color_code AS color
     FROM crm_public_enquiry_forms f
     JOIN crm_business_units bu ON bu.id=f.business_unit_id
     WHERE f.form_key=? ${activeOnly ? 'AND f.is_active=TRUE AND bu.is_active=TRUE' : ''}
     LIMIT 1`,
        [String(formKey || '').trim()],
    );
    if (!form) return null;
    form.fieldSchema = parseJsonValue(form.fieldSchema, []);
    form.settings = parseJsonValue(form.settings, {});
    return form;
}

/**
 * Options for fields that take them from a configuration section.
 *
 * The values are read on every request rather than copied into the field when
 * it was created: adding a course under Course Type has to show up on the
 * lead form, in the filters and in the import template without anyone
 * reopening the field. A field whose section has since been deleted falls
 * back to whatever list it had stored.
 */
async function resolveSectionOptions(fields) {
    const sectionIds = [...new Set(
        fields.map(field => Number(field.optionsSectionId)).filter(id => Number.isInteger(id) && id > 0),
    )];
    if (!sectionIds.length) return new Map();
    const [values] = await pool.query(
        `SELECT section_id AS sectionId, parent_value_id AS parentValueId, display_name AS displayName
     FROM crm_config_section_values
     WHERE is_active = TRUE AND section_id IN (${sectionIds.map(() => '?').join(',')})
     ORDER BY position, display_name`,
        sectionIds,
    );
    const byKey = new Map();
    for (const value of values) {
        // 'parent' holds the top-level values, 'child' every sub-value.
        const level = value.parentValueId === null ? 'parent' : 'child';
        const key = `${value.sectionId}:${level}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(value.displayName);
    }
    return byKey;
}

/** The option list one field should serve, section-backed or its own. */
function optionsForField(field, sectionOptions, fallback) {
    if (field.optionsSectionId) {
        const key = `${Number(field.optionsSectionId)}:${field.optionsSectionLevel || 'parent'}`;
        return sectionOptions.get(key) || [];
    }
    return fallback;
}

async function publicFieldOptions(businessUnitId, fieldKeys, { branchId, academicYear } = {}) {
    const [fields] = await pool.execute(
        `SELECT field_key AS fieldKey,display_name AS displayName,field_type AS fieldType,placeholder,options_json AS options,
            options_section_id AS optionsSectionId,options_section_level AS optionsSectionLevel,is_required AS isRequired,validation_json AS validation
     FROM crm_metadata_fields WHERE business_unit_id=? AND module_key='leads' AND is_active=TRUE ORDER BY position,display_name`,
        [Number(businessUnitId)],
    );
    const selected = new Set(fieldKeys);
    const visible = fields.filter(field => selected.has(field.fieldKey));
    const configurationParams = [String(academicYear || ''), Number(branchId) || 0];
    const [[classes], [curricula], [admissionTypes]] = await Promise.all([
        pool.query(`SELECT DISTINCT cl.id AS value,cl.display_name AS label,cl.position AS sortPosition,acc.curriculum_id AS curriculumId,acc.admission_type_id AS admissionTypeId
      FROM crm_admission_class_configurations acc
      JOIN crm_admission_class_configuration_details d ON d.configuration_id=acc.id AND d.is_active=TRUE
      JOIN crm_classes cl ON cl.id=d.class_id AND cl.is_active=TRUE
      WHERE acc.academic_year=? AND acc.branch_id=? AND acc.is_active=TRUE
      ORDER BY sortPosition,label`, configurationParams),
        pool.query(`SELECT DISTINCT c.id AS value,c.display_name AS label,c.position AS sortPosition
      FROM crm_admission_class_configurations acc
      JOIN crm_admission_class_configuration_details d ON d.configuration_id=acc.id AND d.is_active=TRUE
      JOIN crm_curricula c ON c.id=acc.curriculum_id AND c.is_active=TRUE
      WHERE acc.academic_year=? AND acc.branch_id=? AND acc.is_active=TRUE
      ORDER BY sortPosition,label`, configurationParams),
        pool.query(`SELECT id AS value,display_name AS label FROM crm_admission_types WHERE is_active=TRUE ORDER BY display_name`),
    ]);
    const optionMap = { class_id: classes, curriculum_id: curricula, admission_type_id: admissionTypes };
    // Public forms serve {value,label} pairs, so section-backed options are
    // shaped the same way rather than being left as bare strings.
    const sectionOptions = await resolveSectionOptions(visible);
    return visible.map(field => ({
        ...field,
        options: optionMap[field.fieldKey]
            || optionsForField(field, sectionOptions, parseJsonValue(field.options, []))
                .map(value => ({ value, label: String(value) })),
        validation: parseJsonValue(field.validation, {}),
    }));
}

function normalizeMarketingCode(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
}

function safeTrackingValue(value, maxLength = 500) {
    const text = String(value ?? '').trim();
    return text ? text.slice(0, maxLength) : '';
}

/**
 * The attribution contract payload for a public enquiry.
 *
 * Newer embeds send `tracking.attribution` already in contract shape, built
 * by the capture script that has been following the visitor since they
 * landed. Older ones only ever send whatever was in the enquiry form's own
 * query string, so map that flat shape across rather than losing it --
 * gclid/fbclid pass through under their raw parameter names on purpose,
 * because classifyClickId resolves those against crm_attribution_platforms.
 */
function publicAttributionPayload(trackingInput, resolvedTracking) {
    const provided = trackingInput && typeof trackingInput.attribution === 'object'
        ? trackingInput.attribution
        : null;
    if (provided) return { ...provided, origin: provided.origin || 'website' };

    const legacy = resolvedTracking?.attribution || {};
    return {
        origin: 'website',
        campaignSource: legacy.utmSource,
        campaignMedium: legacy.utmMedium,
        campaignName: legacy.utmCampaign,
        campaignTerm: legacy.utmTerm,
        campaignContent: legacy.utmContent,
        gclid: legacy.gclid,
        fbclid: legacy.fbclid,
        landingUrl: legacy.landingPage,
        referrerUrl: legacy.referrer,
    };
}

async function resolvePublicTracking(form, trackingInput = {}) {
    const tracking = trackingInput && typeof trackingInput === 'object' ? trackingInput : {};
    const locationInput = tracking.location && typeof tracking.location === 'object' ? tracking.location : {};
    const latitude = Number(locationInput.latitude);
    const longitude = Number(locationInput.longitude);
    const accuracy = Number(locationInput.accuracy);
    const attribution = {
        branchId: Number(tracking.branchId) || null,
        academicYearId: Number(tracking.academicYearId) || null,
        academicYear: safeTrackingValue(tracking.academicYear, 20),
        instituteId: safeTrackingValue(tracking.instituteId, 50),
        sourceId: Number(tracking.sourceId) || null,
        channelId: Number(tracking.channelId) || null,
        campaignId: Number(tracking.campaignId) || null,
        utmSource: safeTrackingValue(tracking.utmSource || tracking.utm_source, 120),
        utmMedium: safeTrackingValue(tracking.utmMedium || tracking.utm_medium, 120),
        utmCampaign: safeTrackingValue(tracking.utmCampaign || tracking.utm_campaign, 180),
        utmTerm: safeTrackingValue(tracking.utmTerm || tracking.utm_term, 180),
        utmContent: safeTrackingValue(tracking.utmContent || tracking.utm_content, 180),
        gclid: safeTrackingValue(tracking.gclid, 255),
        fbclid: safeTrackingValue(tracking.fbclid, 255),
        landingPage: safeTrackingValue(tracking.landingPage, 1000),
        referrer: safeTrackingValue(tracking.referrer, 1000),
        location: {
            supported: Boolean(locationInput.supported),
            captured: Boolean(locationInput.captured && Number.isFinite(latitude) && Number.isFinite(longitude)),
            latitude: Number.isFinite(latitude) ? latitude : null,
            longitude: Number.isFinite(longitude) ? longitude : null,
            accuracy: Number.isFinite(accuracy) ? accuracy : null,
            capturedAt: safeTrackingValue(locationInput.capturedAt, 80),
            reason: safeTrackingValue(locationInput.reason, 120),
        },
    };
    const resolved = {
        branchId: Number(form.defaultBranchId),
        academicYear: form.settings?.defaultAcademicYear || '',
        sourceId: form.defaultSourceId ? Number(form.defaultSourceId) : null,
        channelId: form.defaultChannelId ? Number(form.defaultChannelId) : null,
        campaignId: form.defaultCampaignId ? Number(form.defaultCampaignId) : null,
        attribution,
    };
    if (attribution.branchId) {
        const [[branch]] = await pool.execute(`SELECT id FROM branches WHERE id=? AND is_active=TRUE LIMIT 1`, [attribution.branchId]);
        if (branch) resolved.branchId = attribution.branchId;
    }
    if (attribution.academicYearId) {
        const [[year]] = await pool.execute(`SELECT academic_year AS academicYear FROM crm_academic_years WHERE id=? AND is_active=TRUE LIMIT 1`, [attribution.academicYearId]);
        if (year?.academicYear) resolved.academicYear = year.academicYear;
    } else if (attribution.academicYear) {
        const [[year]] = await pool.execute(`SELECT academic_year AS academicYear FROM crm_academic_years WHERE academic_year=? AND is_active=TRUE LIMIT 1`, [attribution.academicYear]);
        if (year?.academicYear) resolved.academicYear = year.academicYear;
    }
    if (attribution.sourceId) {
        const [[source]] = await pool.execute(`SELECT id FROM crm_lead_sources WHERE id=? AND is_active=TRUE LIMIT 1`, [attribution.sourceId]);
        if (source) resolved.sourceId = attribution.sourceId;
    } else if (attribution.utmSource) {
        const sourceCode = normalizeMarketingCode(attribution.utmSource);
        const [[source]] = await pool.execute(`SELECT id FROM crm_lead_sources WHERE is_active=TRUE AND (LOWER(name)=? OR LOWER(display_name)=?) LIMIT 1`, [sourceCode, attribution.utmSource.toLowerCase()]);
        if (source) resolved.sourceId = Number(source.id);
    }
    if (attribution.channelId) {
        const [[channel]] = await pool.execute(`SELECT id FROM crm_lead_channels WHERE id=? AND is_active=TRUE LIMIT 1`, [attribution.channelId]);
        if (channel) resolved.channelId = attribution.channelId;
    } else if (attribution.utmMedium) {
        const channelCode = normalizeMarketingCode(attribution.utmMedium);
        const [[channel]] = await pool.execute(`SELECT id FROM crm_lead_channels WHERE is_active=TRUE AND (LOWER(channel_code)=? OR LOWER(display_name)=?) LIMIT 1`, [channelCode, attribution.utmMedium.toLowerCase()]);
        if (channel) resolved.channelId = Number(channel.id);
    }
    if (attribution.campaignId) {
        const [[campaign]] = await pool.execute(`SELECT id FROM crm_campaigns WHERE id=? AND is_active=TRUE LIMIT 1`, [attribution.campaignId]);
        if (campaign) resolved.campaignId = attribution.campaignId;
    } else if (attribution.utmCampaign) {
        const campaignCode = normalizeMarketingCode(attribution.utmCampaign);
        const [[campaign]] = await pool.execute(`SELECT id FROM crm_campaigns WHERE is_active=TRUE AND (LOWER(campaign_code)=? OR LOWER(display_name)=?) LIMIT 1`, [campaignCode, attribution.utmCampaign.toLowerCase()]);
        if (campaign) resolved.campaignId = Number(campaign.id);
    }
    return resolved;
}

async function branchPaymentConfig(branchId) {
    let hasPaymentColumns = true;
    try {
        const [columns] = await pool.execute(
            `SELECT column_name AS columnName FROM information_schema.columns
       WHERE table_schema=DATABASE() AND table_name='branches'
         AND column_name IN ('jodo_payment_enabled','jodo_api_key','jodo_secret_key','jodo_collector_code','jodo_base_url','jodo_auth_header','application_amount','application_stage_id','application_payment_component')`,
        );
        hasPaymentColumns = columns.length >= 7;
    } catch {
        hasPaymentColumns = false;
    }
    const sql = hasPaymentColumns
        ? `SELECT id,branch_name AS branchName,jodo_payment_enabled AS paymentEnabled,
            jodo_api_key AS apiKey,jodo_secret_key AS secretKey,jodo_collector_code AS collectorCode,
            jodo_base_url AS baseUrl,jodo_auth_header AS authHeader,
            application_amount AS amount,application_stage_id AS applicationStageId,
            application_payment_component AS componentType
     FROM branches
     WHERE id=? AND is_active=TRUE LIMIT 1`
        : `SELECT id,branch_name AS branchName,0 AS paymentEnabled,
              NULL AS apiKey,NULL AS secretKey,NULL AS collectorCode,NULL AS amount,NULL AS applicationStageId,
              'Payable Amount' AS componentType
       FROM branches
       WHERE id=? AND is_active=TRUE LIMIT 1`;
    const [[branch]] = await pool.execute(
        sql,
        [Number(branchId)],
    );
    if (!branch) return null;
    return {
        ...branch,
        paymentEnabled: Boolean(branch.paymentEnabled),
        amount: branch.amount == null ? null : Number(branch.amount),
    };
}

/**
 * Payment settings for one submission.
 *
 * The FORM decides whether to collect and how much; the BRANCH supplies the
 * Jodo credentials that make collection possible. A form with no amount of
 * its own falls back to the branch's application amount, so forms created
 * before the setting moved keep working unchanged.
 */
function resolvePaymentContext(form, branchConfig) {
    const formAmount = Number(form?.paymentAmount);
    const branchAmount = Number(branchConfig?.amount);
    const amount = Number.isFinite(formAmount) && formAmount > 0
        ? formAmount
        : (Number.isFinite(branchAmount) && branchAmount > 0 ? branchAmount : 0);
    /*
     * The component this form's payments book against at Jodo.
     *
     * The branch default is one value for everything it collects, so every
     * form on a branch settles under the same label and a Jodo report cannot
     * say which form the money came from. A form that names its own component
     * -- one configured on the collector -- settles under that instead.
     */
    const formComponent = cleanOptional(form?.settings?.paymentComponentType, 120);
    return {
        ...(branchConfig || {}),
        required: Boolean(form?.paymentRequired),
        amount,
        componentType: formComponent || branchConfig?.componentType || null,
    };
}

function publicPaymentEnabled(config) {
    const authenticated = Boolean(String(config?.authHeader || '').trim())
        || Boolean(config?.apiKey && config?.secretKey);
    return Boolean(config?.required && authenticated && config.collectorCode && Number(config.amount) > 0);
}

function publicPaymentVisible(config) {
    return Boolean(config?.required && Number(config.amount) > 0);
}

function publicPaymentMissingParts(config) {
    if (!config?.required) return ['payment enabled on the enquiry form'];
    const missing = [];
    if (!String(config.authHeader || '').trim() && !(config.apiKey && config.secretKey)) missing.push('Jodo Authorization header or API key and secret');
    if (!config.collectorCode) missing.push('Jodo collector code');
    if (!(Number(config.amount) > 0)) missing.push('application amount');
    return missing;
}

function normalizeJodoOrderId(payload) {
    if (!payload || typeof payload !== 'object') return '';
    return String(payload.order_id || payload.orderId || payload.id || payload.order?.id || payload.data?.order_id || payload.data?.id || '').slice(0, 120);
}

function jodoPaymentUrl(payload) {
    if (!payload || typeof payload !== 'object') return '';
    return String(payload.redirect_url || payload.redirectUrl || payload.payment_url || payload.paymentUrl || payload.payment_link || payload.paymentLink || payload.url || payload.order?.redirect_url || payload.order?.payment_url || payload.data?.redirect_url || payload.data?.payment_url || payload.data?.payment_link || '').slice(0, 1000);
}

function isPublicHttpsUrl(value) {
    try {
        const url = new URL(String(value || ''));
        const hostname = url.hostname.toLowerCase();
        return url.protocol === 'https:' &&
            hostname !== 'localhost' &&
            hostname !== '127.0.0.1' &&
            hostname !== '0.0.0.0' &&
            !hostname.endsWith('.local');
    } catch {
        return false;
    }
}

function jodoCallbackBaseUrl(req) {
    // Trailing slash trimmed: API_PUBLIC_URL is routinely pasted from a browser
    // with one, and the callback path is appended straight onto it -- which
    // would hand Jodo a "//api/..." URL that matches no route.
    const configured = cleanOptional(process.env.API_PUBLIC_URL, 500);
    return String(configured || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

/*
 * Where the visitor's browser lands once Jodo is done with them.
 *
 * The callback URL we hand Jodo is an API URL, and Jodo sends the payer's
 * browser there -- it is a redirect target, not just a server-to-server ping.
 * The API has no pages, so the browser has to be handed back to the web app
 * (or to whatever the form's own redirect URL is) instead of being left on a
 * JSON endpoint.
 */
function publicWebBaseUrl(req) {
    const trim = value => String(value || '').trim().replace(/\/+$/, '');
    const configured = trim(cleanOptional(process.env.WEB_PUBLIC_URL, 500));
    if (configured) return configured;
    // WEB_ORIGIN is the CORS origin, and on a deployment where the site and
    // the API share one address it is often left at localhost -- CORS never
    // notices, because the browser is same-origin. Sending a paying applicant
    // to localhost would be very noticeable, so a public WEB_ORIGIN is trusted
    // and a local one gives way to the address the browser actually reached.
    const origin = trim(String(allowedOrigin || '').split(',')[0]);
    if (isPublicHttpsUrl(origin) || /^https?:\/\/(?!localhost|127\.0\.0\.1)/.test(origin)) return origin;
    const requested = req ? trim(`${req.protocol}://${req.get('host')}`) : '';
    if (requested && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(requested)) return requested;
    return origin || 'http://localhost:3000';
}

function enquiryPaymentReturnUrl(req, form, orderId, status) {
    const fallback = `${publicWebBaseUrl(req)}/public/enquiry/${encodeURIComponent(form.formKey)}`;
    const configured = cleanOptional(form.redirectUrl, 500);
    try {
        const url = new URL(configured || fallback, fallback);
        url.searchParams.set('payment', status || 'unknown');
        if (orderId) url.searchParams.set('orderId', orderId);
        return url.toString();
    } catch {
        return fallback;
    }
}

async function createJodoOrder(config, customer, callbackUrl, origin = {}) {
    /*
     * What this payment was for, sent in the fields Jodo accepts free text in.
     *
     * component_type is the label Jodo displays, and it has to be a component
     * configured on the collector -- Jodo rejects anything else outright. The
     * form's name therefore travels as custom_identifier and as notes, which
     * take any string and come back on the order, so a payment can be traced
     * to the form that raised it even where the label is shared.
     */
    const formTitle = cleanOptional(origin.formTitle, 120);
    const notes = [
        { key: 'crm_source', value: 'enquiry_form' },
        origin.formKey ? { key: 'crm_form_key', value: cleanOptional(origin.formKey, 120) } : null,
        formTitle ? { key: 'crm_form_title', value: formTitle } : null,
    ].filter(Boolean);
    const payload = {
        name: cleanOptional(customer.name, 200),
        phone: normalizeIndianMobile(customer.phone),
        email: cleanOptional(customer.email, 254),
        collector_code: cleanOptional(config.collectorCode, 100),
        custom_identifier: formTitle || undefined,
        details: [{
            component_type: cleanOptional(config.componentType, 120) || 'Payable Amount',
            amount: Number(Number(config.amount).toFixed(2)),
        }],
        notes,
        callback_url: callbackUrl,
    };
    const response = await axios.post(`${jodoBaseUrl(config)}/api/v1/integrations/pay/orders`, payload, {
        headers: jodoHeaders(config),
        timeout: 20000,
    });
    return response.data;
}

async function getJodoOrder(config, orderId) {
    const response = await axios.get(`${jodoBaseUrl(config)}/api/v1/integrations/pay/orders/${encodeURIComponent(orderId)}`, {
        headers: jodoHeaders(config),
        timeout: 20000,
    });
    return response.data;
}

function jodoOrderData(payload) {
    return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
}

app.get('/api/public/enquiry-forms/:formKey', async (req, res) => {
    const form = await publicFormDefinition(req.params.formKey, true);
    if (!form) return res.status(404).json({ message: 'This enquiry form is not available' });
    const schema = Array.isArray(form.fieldSchema) ? form.fieldSchema : [];
    const resolvedTracking = await resolvePublicTracking(form, req.query);
    const fields = await publicFieldOptions(form.businessUnitId, schema.map(field => field.fieldKey), {
        branchId: resolvedTracking.branchId,
        academicYear: resolvedTracking.academicYear || form.settings?.defaultAcademicYear,
    });
    const fieldsByKey = new Map(fields.map(field => [field.fieldKey, field]));
    const paymentConfig = resolvePaymentContext(form, await branchPaymentConfig(resolvedTracking.branchId));
    const paymentVisible = publicPaymentVisible(paymentConfig);
    const storedLeadDefaults=parseJsonValue(unitDefaultsRow?.manualLeadDefaults, {});
    res.json({
        form: {
            key: form.formKey, name: form.displayName, description: form.description, businessUnitName: form.businessUnitName,
            color: form.color, settings: form.settings, successMessage: form.successMessage, redirectUrl: form.redirectUrl,
            payment: paymentVisible ? {
                enabled: true,
                configured: publicPaymentEnabled(paymentConfig),
                amount: paymentConfig.amount,
                componentType: paymentConfig.componentType || 'Payable Amount',
                branchId: resolvedTracking.branchId,
            } : { enabled: false },
            fields: schema.map(item => ({ ...(fieldsByKey.get(item.fieldKey) || {}), ...item })).filter(item => item.fieldKey),
        },
    });
});

app.post('/api/public/enquiry-forms/:formKey/payment-order', async (req, res) => {
    const form = await publicFormDefinition(req.params.formKey, true);
    if (!form) return res.status(404).json({ message: 'This enquiry form is not available' });
    if (String(req.body.website || '').trim()) return res.status(400).json({ message: 'Submission rejected' });
    const values = req.body.values && typeof req.body.values === 'object' ? req.body.values : {};
    const resolvedTracking = await resolvePublicTracking(form, req.body.tracking);
    const config = resolvePaymentContext(form, await branchPaymentConfig(resolvedTracking.branchId));
    if (!publicPaymentEnabled(config)) return res.status(400).json({ message: `Online application payment is incomplete for this form. Missing: ${publicPaymentMissingParts(config).join(', ')}` });
    const name = values.student_name || values.name || values.studentName;
    const phone = values.phone || values.primary_phone || values.primaryPhone;
    const email = values.email || '';
    if (!cleanOptional(name, 200) || !cleanOptional(phone, 30) || !cleanOptional(email, 254)) return res.status(400).json({ message: 'Student name, phone and email are required before payment' });
    if (!isValidIndianMobile(phone)) return res.status(400).json({ message: 'Enter a valid Indian mobile number before payment' });
    if (!isValidEmailAddress(email)) return res.status(400).json({ message: 'Enter a valid email address before payment' });
    const baseUrl = jodoCallbackBaseUrl(req);
    if (!isPublicHttpsUrl(baseUrl)) return res.status(400).json({ message: 'Payment callback URL must be a public HTTPS URL. Set API_PUBLIC_URL to your public API URL, for example an ngrok HTTPS URL while testing.' });
    const callbackUrl = `${baseUrl}/api/public/enquiry-forms/${encodeURIComponent(form.formKey)}/payment-callback`;
    try {
        const order = await createJodoOrder(config, { name, phone, email }, callbackUrl, { formKey: form.formKey, formTitle: form.displayName });
        const orderId = normalizeJodoOrderId(order);
        const paymentUrl = jodoPaymentUrl(order);
        if (!orderId || !paymentUrl) return res.status(502).json({ message: 'Jodo did not return the order ID and redirect URL required to continue payment' });
        res.json({ orderId, paymentUrl, amount: config.amount });
    } catch (error) {
        const message = error.response?.data?.message || error.response?.data?.error || error.message || 'Unable to create payment order';
        res.status(502).json({ message: `Payment order creation failed: ${String(message).slice(0, 300)}` });
    }
});

app.post('/api/public/enquiry-forms/:formKey/submit', async (req, res) => {
    const form = await publicFormDefinition(req.params.formKey, true);
    if (!form) return res.status(404).json({ message: 'This enquiry form is not available' });
    if (String(req.body.website || '').trim()) return res.status(400).json({ message: 'Submission rejected' });
    const schema = Array.isArray(form.fieldSchema) ? form.fieldSchema : [];
    const values = req.body.values && typeof req.body.values === 'object' ? req.body.values : {};
    const resolvedTracking = await resolvePublicTracking(form, req.body.tracking);
    const missing = schema.filter(field => field.required && cleanOptional(values[field.fieldKey], 500) == null);
    if (missing.length) return res.status(400).json({ message: `${missing[0].label || missing[0].fieldKey} is required` });
    const standard = {
        name: 'studentName', student_name: 'studentName', phone: 'phone', primary_phone: 'phone', alternate_phone: 'alternatePhone',
        email: 'email', parent_name: 'parentName', city: 'city', academic_year: 'academicYear', class_id: 'classId',
        curriculum_id: 'curriculumId', admission_type_id: 'admissionTypeId', remarks: 'remarks',
    };
    const body = {
        branchId: resolvedTracking.branchId, stageId: Number(form.defaultStageId), substageId: form.defaultSubstageId ? Number(form.defaultSubstageId) : null,
        sourceId: resolvedTracking.sourceId, channelId: resolvedTracking.channelId,
        campaignId: resolvedTracking.campaignId, ownerEmployeeId: form.defaultOwnerEmployeeId ? Number(form.defaultOwnerEmployeeId) : null,
        intakeMethod: 'website', leadScore: 0, customValues: {},
    };
    // This form has no default owner of its own -- fall back to whichever
    // Assignment Rule matches the resolved branch and source, if any.
    if (!body.ownerEmployeeId && body.branchId && body.sourceId) {
        body.ownerEmployeeId = await resolveAssignmentRuleOwner(pool, { businessUnitId: Number(form.businessUnitId), branchId: body.branchId, sourceId: body.sourceId });
    }
    for (const [fieldKey, value] of Object.entries(values)) {
        if (standard[fieldKey]) body[standard[fieldKey]] = value;
        else body.customValues[fieldKey] = value;
    }
    body.customValues = { ...(body.customValues || {}), websiteAttribution: resolvedTracking.attribution };
    if (resolvedTracking.attribution?.location?.captured) {
        body.customValues.latitude = resolvedTracking.attribution.location.latitude;
        body.customValues.longitude = resolvedTracking.attribution.location.longitude;
        body.customValues.locationAccuracy = resolvedTracking.attribution.location.accuracy;
        body.customValues.locationCapturedAt = resolvedTracking.attribution.location.capturedAt;
    }
    if (!body.academicYear) body.academicYear = resolvedTracking.academicYear || form.settings?.defaultAcademicYear;
    if (!cleanOptional(body.academicYear, 20)) return res.status(400).json({ message: 'This enquiry form is not configured with an academic year. Please contact admissions.' });
    if (!body.remarks) {
        const campaignNote = resolvedTracking.attribution.utmCampaign ? ` · Campaign: ${resolvedTracking.attribution.utmCampaign}` : '';
        const sourceNote = resolvedTracking.attribution.utmSource ? ` · Source: ${resolvedTracking.attribution.utmSource}` : '';
        body.remarks = `Website enquiry from ${form.displayName}${sourceNote}${campaignNote}`;
    }
    const validationError = validateLead(body, { requireClass: schema.some(field => field.fieldKey === 'class_id' && field.required), requirePhone: schema.some(field => ['phone', 'primary_phone'].includes(field.fieldKey) && field.required) !== false });
    if (validationError) return res.status(400).json({ message: validationError });
    const paymentConfig = resolvePaymentContext(form, await branchPaymentConfig(body.branchId));
    const payment = req.body.payment && typeof req.body.payment === 'object' ? req.body.payment : {};
    const paymentOrderId = cleanOptional(payment.orderId || payment.order_id, 120);
    const paymentStatus = cleanOptional(payment.status, 40) || (paymentOrderId ? 'order_created' : null);
    if (publicPaymentEnabled(paymentConfig) && !paymentOrderId) return res.status(400).json({ message: 'Create the online application payment order before submitting this form' });
    if (publicPaymentEnabled(paymentConfig) && paymentStatus && ['paid', 'success', 'completed', 'captured'].includes(String(paymentStatus).toLowerCase()) && paymentConfig.applicationStageId) {
        body.stageId = Number(paymentConfig.applicationStageId);
        body.customValues.websiteAttribution.paymentMovedStage = true;
    }
    const [[branch]] = await pool.execute(`SELECT id FROM branches WHERE id=? AND is_active=TRUE LIMIT 1`, [body.branchId]);
    if (!branch) return res.status(400).json({ message: 'This enquiry form is not mapped to an active branch' });
    const [[stage]] = await pool.execute(`SELECT id FROM crm_lead_stages WHERE id=? AND business_unit_id=? AND is_active=TRUE LIMIT 1`, [body.stageId, Number(form.businessUnitId)]);
    if (!stage) return res.status(400).json({ message: 'This enquiry form is not mapped to an active stage' });
    if (body.curriculumId || body.classId) {
        const admissionTypeId = Number(body.admissionTypeId) || null;
        const classId = Number(body.classId) || null;
        const [[configuredOffering]] = await pool.execute(
            `SELECT acc.id FROM crm_admission_class_configurations acc
       LEFT JOIN crm_admission_class_configuration_details d ON d.configuration_id=acc.id AND d.is_active=TRUE
       WHERE acc.academic_year=? AND acc.branch_id=? AND acc.curriculum_id=? AND acc.is_active=TRUE
         AND (? IS NULL OR acc.admission_type_id=?) AND (? IS NULL OR d.class_id=?) LIMIT 1`,
            [String(body.academicYear), Number(body.branchId), Number(body.curriculumId), admissionTypeId, admissionTypeId, classId, classId],
        );
        if (!configuredOffering) return res.status(400).json({ message: 'The selected curriculum and class are not configured for this branch' });
    }
    if (body.sourceId && body.channelId) {
        const sourceValidationError = await validateSourceDetails(body);
        if (sourceValidationError) return res.status(400).json({ message: sourceValidationError });
    }
    const connection = await pool.getConnection();
    const submittedPhone = cleanOptional(body.phone, 30);
    const normalizedPhone = submittedPhone ? normalizeIndianMobile(submittedPhone) : `no-phone-${crypto.randomUUID()}`;
    const actorUserId = Number(form.actorUserId);
    const lockName = `crm-public-lead:${Number(form.businessUnitId)}:${body.branchId}:${normalizedPhone}`;
    try {
        const [[lock]] = await connection.execute(`SELECT GET_LOCK(?,10) AS acquired`, [lockName]);
        if (!Number(lock.acquired)) return res.status(409).json({ message: 'This enquiry is being processed. Please retry.' });
        await connection.beginTransaction();
        const { lead: existing } = await findDuplicateLead(connection, {
            businessUnitId: Number(form.businessUnitId),
            record: { ...body, normalizedPhone },
            forUpdate: true,
        });
        /*
         * A repeat enquiry from a number we already hold still went through the
         * payment page, so the order has to be written onto the lead we are
         * keeping. Without this the order id exists only at Jodo, and the
         * payment callback -- which finds the lead by jodo_order_id -- answers
         * "Lead not found for this payment order" for a fee that was collected.
         */
        if (existing && paymentOrderId) {
            await connection.execute(
                `UPDATE crm_leads SET jodo_order_id=?,application_payment_status=?,application_payment_amount=?,enquiry_form_id=?,updated_at_utc=CURRENT_TIMESTAMP(6) WHERE id=?`,
                [paymentOrderId, paymentStatus, publicPaymentEnabled(paymentConfig) ? Number(paymentConfig.amount) : null, Number(form.id), Number(existing.id)],
            );
        }
        if (existing && body.sourceId && body.channelId && body.campaignId) {
            const enquiry = await appendLeadSourceOrDetectDuplicate(connection, existing, body, 'website', actorUserId);
            await connection.commit();
            // A return visit from a different advertisement is an extra touch on
            // the same lead. Recorded after the commit, on the pool rather than
            // this connection, so attribution can never roll the enquiry back.
            if (!enquiry.duplicate) {
                await recordLeadAttribution(pool, existing.id, publicAttributionPayload(req.body.tracking, resolvedTracking), { origin: 'website' });
            }
            if (enquiry.duplicate) return res.status(200).json({ id: Number(existing.id), leadNumber: existing.leadNumber, message: 'Your enquiry is already available with our admissions team.' });
            return res.json({ id: Number(existing.id), leadNumber: existing.leadNumber, reEnquired: true, message: form.successMessage });
        }
        if (existing) {
            await connection.commit();
            return res.status(200).json({ id: Number(existing.id), leadNumber: existing.leadNumber, message: 'Your enquiry is already available with our admissions team.' });
        }
        const temporaryNumber = `PENDING-${crypto.randomUUID()}`;
        const [result] = await connection.execute(
            `INSERT INTO crm_leads (business_unit_id,lead_number,branch_id,student_name,phone,normalized_phone,alternate_phone,email,applying_class,class_id,curriculum_id,academic_year,parent_name,city,stage_id,source_id,owner_employee_id,channel_id,campaign_id,admission_type_id,substage_id,lead_score,remarks,custom_values_json,jodo_order_id,application_payment_status,application_payment_amount,application_payment_at_utc,enquiry_form_id,created_by_user_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [Number(form.businessUnitId), temporaryNumber, body.branchId, cleanOptional(body.studentName, 200), submittedPhone || '', normalizedPhone, cleanOptional(body.alternatePhone, 30), cleanOptional(body.email, 254), null, body.classId ? Number(body.classId) : null, body.curriculumId ? Number(body.curriculumId) : null, cleanOptional(body.academicYear, 20), cleanOptional(body.parentName, 200), cleanOptional(body.city, 100), body.stageId, body.sourceId, body.ownerEmployeeId, body.channelId, body.campaignId, body.admissionTypeId ? Number(body.admissionTypeId) : null, body.substageId, 0, cleanOptional(body.remarks, 10000), JSON.stringify(body.customValues || {}), paymentOrderId, paymentStatus, publicPaymentEnabled(paymentConfig) ? Number(paymentConfig.amount) : null, ['paid', 'success', 'completed', 'captured'].includes(String(paymentStatus || '').toLowerCase()) ? new Date() : null, Number(form.id), actorUserId],
        );
        const leadNumber = `ADM-${new Date().getFullYear()}-${String(result.insertId).padStart(6, '0')}`;
        await connection.execute(`UPDATE crm_leads SET lead_number=? WHERE id=?`, [leadNumber, result.insertId]);
        if (body.sourceId && body.channelId && body.campaignId) await connection.execute(`INSERT INTO crm_lead_source_history(lead_id,academic_year,source_id,channel_id,campaign_id,is_primary,intake_method,created_by_user_id) VALUES(?,?,?,?,?,TRUE,'website',?)`, [result.insertId, cleanOptional(body.academicYear, 20), body.sourceId, body.channelId, body.campaignId, actorUserId]);
        await connection.execute(`INSERT INTO crm_lead_activities(lead_id,activity_type,summary,actor_user_id) VALUES(?,'created','Lead created via website enquiry form',?)`, [result.insertId, actorUserId]);
        await notifyEmployee(connection, {
            businessUnitId: Number(form.businessUnitId), employeeId: Number(body.ownerEmployeeId), actorUserId,
            type: 'lead_assigned', title: 'New lead added from website', message: `${cleanOptional(body.studentName, 200) || 'New lead'} · ${leadNumber}`,
            link: `/leads?lead=${Number(result.insertId)}`, entityType: 'lead', entityId: Number(result.insertId)
        });
        await connection.commit();
        // Touch 1: the advertisement that produced this lead. Never throws, so a
        // tracking problem cannot cost us the enquiry itself.
        await recordLeadAttribution(pool, result.insertId, publicAttributionPayload(req.body.tracking, resolvedTracking), { origin: 'website' });
        res.status(201).json({ id: Number(result.insertId), leadNumber, message: form.successMessage });
    } catch (error) { await connection.rollback(); throw error; }
    finally { await connection.execute(`SELECT RELEASE_LOCK(?)`, [lockName]).catch(() => { }); connection.release(); }
});

/*
 * Verify one Jodo order and write what it says onto the lead.
 *
 * Shared by the two ways a payment comes back to us: Jodo redirecting the
 * payer's browser here (GET) and a server-side POST. Neither is trusted for
 * the outcome -- the status always comes from reading the order back from
 * Jodo, so a hand-typed callback URL cannot mark an application as paid.
 */
async function applyEnquiryPaymentCallback(form, orderId) {
    if (!orderId) return { ok: false, code: 400, status: 'unknown', paid: false, message: 'Order id is required' };
    const [[lead]] = await pool.execute(
        `SELECT l.id,l.branch_id AS branchId,l.stage_id AS stageId,b.application_stage_id AS applicationStageId
     FROM crm_leads l
     JOIN branches b ON b.id=l.branch_id
     WHERE l.business_unit_id=? AND l.jodo_order_id=? AND l.deleted_at_utc IS NULL
     ORDER BY l.id DESC LIMIT 1`,
        [Number(form.businessUnitId), orderId],
    );
    if (!lead) return { ok: false, code: 404, status: 'unknown', paid: false, message: 'Lead not found for this payment order' };
    const config = resolvePaymentContext(form, await branchPaymentConfig(lead.branchId));
    if (!publicPaymentEnabled(config)) return { ok: false, code: 400, status: 'unknown', paid: false, message: 'Payment is not configured for this form' };
    let orderPayload;
    try {
        orderPayload = await getJodoOrder(config, orderId);
    } catch (error) {
        const message = error.response?.data?.message || error.response?.data?.error || error.message || 'Unable to verify payment order';
        return { ok: false, code: 502, status: 'unknown', paid: false, message: `Payment verification failed: ${String(message).slice(0, 300)}` };
    }
    const order = jodoOrderData(orderPayload);
    const status = cleanOptional(order?.status, 40) || 'unpaid';
    const paid = String(status).toLowerCase() === 'paid';
    const paidAt = cleanOptional(order?.paid_at, 80);
    const amount = Array.isArray(order?.details) ? order.details.reduce((sum, item) => sum + Number(item.amount || 0), 0) : Number(config.amount || 0);
    const nextStageId = paid && lead.applicationStageId ? Number(lead.applicationStageId) : Number(lead.stageId);
    await pool.execute(
        `UPDATE crm_leads
     SET application_payment_status=?,application_payment_amount=?,
         application_payment_at_utc=IF(?,COALESCE(?,CURRENT_TIMESTAMP(6)),application_payment_at_utc),
         stage_id=?,updated_at_utc=CURRENT_TIMESTAMP(6)
     WHERE id=?`,
        [status, amount || config.amount, paid ? 1 : 0, paidAt ? new Date(paidAt) : null, nextStageId, Number(lead.id)],
    );
    await pool.execute(
        `INSERT INTO crm_lead_activities(lead_id,activity_type,summary,actor_user_id)
     VALUES(?,?,?,?)`,
        [Number(lead.id), paid ? 'payment_completed' : 'payment_update', `Jodo payment ${status || 'callback received'} for order ${orderId}`, Number(form.actorUserId)],
    );
    return { ok: true, status, paid, message: 'Payment status updated' };
}

function callbackOrderId(source) {
    const payload = source && typeof source === 'object' ? source : {};
    return normalizeJodoOrderId(payload) || cleanOptional(payload.order_id || payload.orderId || payload.id, 120) || '';
}

/*
 * Jodo returns the payer by redirecting their browser, which is a GET. This
 * used to be a POST-only route, so a successful payment ended on
 * "Cannot GET /api/public/enquiry-forms/.../payment-callback" -- the payment
 * had gone through and the applicant was staring at an Express 404.
 *
 * So: verify the order if we can identify it, then send the browser on to the
 * form's redirect URL, or back to the public form with the outcome in the
 * query string. A missing or unverifiable order id is not an error page
 * either; the visitor still lands somewhere sensible and the Jodo webhook
 * remains the authority on the final status.
 */
app.get('/api/public/enquiry-forms/:formKey/payment-callback', async (req, res) => {
    const form = await publicFormDefinition(req.params.formKey, true);
    if (!form) return res.status(404).json({ message: 'This enquiry form is not available' });
    const orderId = callbackOrderId(req.query);
    let outcome = { ok: false, status: 'unknown', paid: false };
    try {
        outcome = await applyEnquiryPaymentCallback(form, orderId);
    } catch (error) {
        console.error('Enquiry payment callback failed', { formKey: form.formKey, orderId, error: error.message });
    }
    const status = outcome.ok ? (outcome.paid ? 'paid' : String(outcome.status || 'unpaid').toLowerCase()) : 'unknown';
    res.redirect(302, enquiryPaymentReturnUrl(req, form, orderId, status));
});

app.post('/api/public/enquiry-forms/:formKey/payment-callback', async (req, res) => {
    const form = await publicFormDefinition(req.params.formKey, true);
    if (!form) return res.status(404).json({ message: 'This enquiry form is not available' });
    const orderId = callbackOrderId(req.body) || callbackOrderId(req.query);
    const outcome = await applyEnquiryPaymentCallback(form, orderId);
    if (!outcome.ok) return res.status(outcome.code).json({ message: outcome.message });
    res.json({ message: outcome.message, paid: outcome.paid });
});

app.post('/api/public/enquiry-forms/:formKey/payment-status', async (req, res) => {
    const form = await publicFormDefinition(req.params.formKey, true);
    if (!form) return res.status(404).json({ message: 'This enquiry form is not available' });
    const orderId = cleanOptional(req.body.orderId || req.body.order_id, 120);
    if (!orderId) return res.status(400).json({ message: 'Order id is required' });
    const [[lead]] = await pool.execute(
        `SELECT l.id,l.branch_id AS branchId,l.stage_id AS stageId,b.application_stage_id AS applicationStageId
     FROM crm_leads l JOIN branches b ON b.id=l.branch_id
     WHERE l.business_unit_id=? AND l.jodo_order_id=? AND l.deleted_at_utc IS NULL
     ORDER BY l.id DESC LIMIT 1`,
        [Number(form.businessUnitId), orderId],
    );
    if (!lead) return res.status(404).json({ message: 'Lead not found for this payment order' });
    const config = resolvePaymentContext(form, await branchPaymentConfig(lead.branchId));
    if (!publicPaymentEnabled(config)) return res.status(400).json({ message: 'Payment is not configured for this form' });
    const orderPayload = await getJodoOrder(config, orderId);
    const order = jodoOrderData(orderPayload);
    const paid = String(order?.status || '').toLowerCase() === 'paid';
    if (paid) {
        const nextStageId = lead.applicationStageId ? Number(lead.applicationStageId) : Number(lead.stageId);
        await pool.execute(
            `UPDATE crm_leads SET application_payment_status='paid',application_payment_at_utc=COALESCE(?,CURRENT_TIMESTAMP(6)),stage_id=?,updated_at_utc=CURRENT_TIMESTAMP(6) WHERE id=?`,
            [order?.paid_at ? new Date(order.paid_at) : null, nextStageId, Number(lead.id)],
        );
    }
    res.json({ orderId, status: order?.status || 'unpaid', paid });
});

/*
 * Every active branch, for pickers and reference lists.
 *
 * This used to return only the caller's own branches, which is right for lead
 * data but wrong for a list of what exists: an administrator mapping WhatsApp
 * accounts saw 4 of 20 branches and had no way to know the rest were there,
 * and the same list feeds several other pickers.
 *
 * Naming a branch is not access to it. Every write still checks
 * accessibleBranch(), and lead rows are still bounded by leadScopedWhere(),
 * so widening this list grants nothing -- it only stops the interface hiding
 * options an administrator is entitled to choose.
 *
 * That reasoning holds for administrators, and only for them. For an end user
 * a branch they do not have has no business appearing in a picker at all, so
 * the list is now widened by role rather than for everybody -- which is what
 * referenceBranchScopeSql draws the line on.
 *
 * This handler also shadows the scoped GET / in branches.routes.js, which is
 * mounted later on the same path and therefore never runs. Left as it is
 * rather than deleted, because this is the definition that has always served
 * the pickers; the router keeps the per-branch Jodo endpoints.
 */
app.get('/api/branches', authenticate, requireCrmAccess, async (req, res) => {
    const scope = referenceBranchScopeSql(req.user, 'b.id');
    const [rows] = await pool.execute(
        `SELECT b.id, b.branch_name AS name, b.branch_name AS branch_name,
            b.short_name AS shortName, b.time_zone_id AS timeZoneId
     FROM branches b WHERE b.is_active = TRUE AND ${scope.sql} ORDER BY b.branch_name`,
        scope.params,
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

app.get('/api/notifications', authenticate, requireCrmAccess, async (req, res) => {
    const [rows] = await pool.execute(
        `SELECT id,notification_type AS type,title,message,link_url AS link,entity_type AS entityType,
            entity_id AS entityId,read_at_utc AS readAt,created_at_utc AS createdAt
     FROM crm_notifications WHERE business_unit_id=? AND user_id=?
     ORDER BY created_at_utc DESC,id DESC LIMIT 10`,
        [Number(req.businessUnit.id), Number(req.user.id)],
    );
    const [[count]] = await pool.execute(
        `SELECT COUNT(*) AS unread FROM crm_notifications
     WHERE business_unit_id=? AND user_id=? AND read_at_utc IS NULL`,
        [Number(req.businessUnit.id), Number(req.user.id)],
    );
    res.json({ data: rows.map(row => ({ ...row, id: Number(row.id), entityId: row.entityId ? Number(row.entityId) : null })), unread: Number(count.unread || 0) });
});

app.put('/api/notifications/:id/read', authenticate, requireCrmAccess, async (req, res) => {
    await pool.execute(
        `UPDATE crm_notifications SET read_at_utc=COALESCE(read_at_utc,CURRENT_TIMESTAMP(6))
     WHERE id=? AND business_unit_id=? AND user_id=?`,
        [Number(req.params.id), Number(req.businessUnit.id), Number(req.user.id)],
    );
    res.json({ success: true });
});

app.put('/api/notifications/read-all', authenticate, requireCrmAccess, async (req, res) => {
    await pool.execute(
        `UPDATE crm_notifications SET read_at_utc=CURRENT_TIMESTAMP(6)
     WHERE business_unit_id=? AND user_id=? AND read_at_utc IS NULL`,
        [Number(req.businessUnit.id), Number(req.user.id)],
    );
    res.json({ success: true });
});

app.get('/api/dashboard', authenticate, requireCrmAccess, async (req, res) => {
    /* The metadata-mode dashboard that used to sit here was disabled with
       `if (false && ...)` and superseded by the query below, which serves
       metadata units correctly. Removed as unreachable. */
    const scope = leadScopedWhere(req.user);
    const [[stats]] = await pool.execute(
        `SELECT COUNT(*) AS totalLeads,
       SUM(l.created_at_utc >= DATE_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)) AS newThisWeek,
       SUM(l.created_at_utc >= DATE_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY)
           AND l.created_at_utc < DATE_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)) AS newPreviousWeek,
       SUM(l.created_at_utc < DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01')) AS totalLeadsLastMonth,
       SUM(s.is_admission_stage) AS admissions
     FROM crm_leads l JOIN crm_lead_stages s ON s.id = l.stage_id
     WHERE l.deleted_at_utc IS NULL AND ${scope.sql}`, scope.params,
    );
    /*
     * Follow-ups due, counted as LEADS and over the same IST day the Leads
     * screen counts (see FOLLOWUP_DUE_SQL). The bell and the Leads date badge
     * are the same number by construction now, rather than by coincidence.
     *
     * The owner filter is what makes it personal: someone whose lead scope is
     * their own records only should see their own follow-ups, while a manager
     * or admin keeps the wider count their scope already gives them. It is
     * l.owner_employee_id here for the same reason -- it is the column the
     * Leads list filters on.
     */
    const ownFollowupsOnly = req.user.rbacEnforced && req.user.rbacScope === 'own';
    const assigneeSql = ownFollowupsOnly ? ' AND l.owner_employee_id = ?' : '';
    const assigneeParams = ownFollowupsOnly ? [Number(req.user.employeeId) || 0] : [];
    const [[followups]] = await pool.execute(
        `SELECT COUNT(*) AS followupsDue,
            SUM(${FOLLOWUP_OVERDUE_SQL}) AS followupsOverdue
     FROM crm_leads l
     WHERE l.deleted_at_utc IS NULL AND ${FOLLOWUP_DUE_SQL}
      AND ${scope.sql}${assigneeSql}`, [...scope.params, ...assigneeParams],
    );
    // Mirrors the Leads touch-status badge exactly: untouched work belongs to
    // the signed-in employee, even when an administrator has a wider lead scope.
    const notificationEmployeeId = Number(req.user.employeeId) || 0;
    const [[untouchedAssigned]] = await pool.execute(
        `SELECT COUNT(*) AS count
     FROM crm_leads l
     WHERE l.deleted_at_utc IS NULL
       AND l.owner_employee_id=?
       AND ${scope.sql}
       AND NOT EXISTS (
         SELECT 1
         FROM crm_lead_comments touch_comment
         JOIN app_users touch_user ON touch_user.id=touch_comment.created_by_user_id
         WHERE touch_comment.lead_id=l.id
           AND touch_user.employee_id=l.owner_employee_id
           AND touch_comment.created_at_utc>=COALESCE(l.owner_assigned_at_utc,l.referred_at_utc,l.created_at_utc)
       )`,
        [notificationEmployeeId, ...scope.params],
    );
    const [[admissionPeriods]] = await pool.execute(
        `SELECT
       SUM(events.admittedAt >= DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01')) AS admissionsThisMonth,
       SUM(events.admittedAt >= DATE_FORMAT(CURRENT_DATE() - INTERVAL 1 MONTH, '%Y-%m-01')
           AND events.admittedAt < DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01')) AS admissionsLastMonth
     FROM (
       SELECT l.id,
              COALESCE(MIN(CASE WHEN admitted_stage.is_admission_stage THEN h.changed_at_utc END),
                       CASE WHEN current_stage.is_admission_stage THEN l.created_at_utc END) AS admittedAt
       FROM crm_leads l
       JOIN crm_lead_stages current_stage ON current_stage.id = l.stage_id
       LEFT JOIN crm_lead_stage_history h ON h.lead_id = l.id
       LEFT JOIN crm_lead_stages admitted_stage ON admitted_stage.id = h.to_stage_id
       WHERE l.deleted_at_utc IS NULL AND ${scope.sql}
       GROUP BY l.id, l.created_at_utc, current_stage.is_admission_stage
     ) events
     WHERE events.admittedAt IS NOT NULL`, scope.params,
    );
    /*
     * Follow-ups completed today: leads that were actually worked on.
     *
     * Counted as DISTINCT leads with a comment logged today, not the number of
     * comments -- five comments across three leads is three follow-ups done.
     * A comment is the record of the conversation, so it is the closest thing
     * the CRM has to "this lead was followed up".
     *
     * Day boundaries in IST: the timestamps are UTC, and without converting
     * both sides everything after 5:30am would fall on the wrong day.
     */
    const [[followupsDone]] = await pool.execute(
        `SELECT
       COUNT(DISTINCT CASE WHEN DATE(CONVERT_TZ(c.created_at_utc,'+00:00','+05:30'))
                                = DATE(CONVERT_TZ(NOW(),'+00:00','+05:30'))
                           THEN c.lead_id END) AS today,
       COUNT(DISTINCT CASE WHEN DATE(CONVERT_TZ(c.created_at_utc,'+00:00','+05:30'))
                                = DATE(CONVERT_TZ(NOW(),'+00:00','+05:30')) - INTERVAL 1 DAY
                           THEN c.lead_id END) AS yesterday
       FROM crm_lead_comments c
       JOIN crm_leads l ON l.id = c.lead_id
      WHERE l.deleted_at_utc IS NULL AND ${scope.sql}`,
        scope.params,
    );

    const [funnelRows] = await pool.execute(
        `SELECT s.display_name AS label, s.color_code AS color, COUNT(l.id) AS value
     FROM crm_lead_stages s LEFT JOIN crm_leads l ON l.stage_id = s.id AND l.deleted_at_utc IS NULL AND ${scope.sql}
     WHERE s.is_active = TRUE AND s.business_unit_id=? GROUP BY s.id, s.display_name, s.color_code, s.position ORDER BY s.position`, [...scope.params, Number(req.businessUnit.id)],
    );
    const trendDays = 14;
    const trendFrom = new Date();
    trendFrom.setDate(trendFrom.getDate() - (trendDays - 1));
    const trendFromKey = `${trendFrom.getFullYear()}-${String(trendFrom.getMonth() + 1).padStart(2, '0')}-${String(trendFrom.getDate()).padStart(2, '0')}`;
    const currentUserId = Number(req.user.id) || 0;
    const currentEmployeeId = Number(req.user.employeeId) || 0;
    const [usageTrendRows, assignedTrendRows, followupTrendRows] = await Promise.all([
        pool.execute(
            `SELECT DATE_FORMAT(usage_date,'%Y-%m-%d') AS day,active_seconds AS value
       FROM crm_user_daily_usage WHERE user_id=? AND usage_date>=? ORDER BY usage_date`,
            [currentUserId, trendFromKey],
        ),
        pool.execute(
            `SELECT DATE_FORMAT(DATE(CONVERT_TZ(COALESCE(l.owner_assigned_at_utc,l.created_at_utc),'+00:00','+05:30')),'%Y-%m-%d') AS day,
              COUNT(*) AS value
       FROM crm_leads l
       WHERE l.deleted_at_utc IS NULL AND l.owner_employee_id=? AND ${scope.sql}
         AND DATE(CONVERT_TZ(COALESCE(l.owner_assigned_at_utc,l.created_at_utc),'+00:00','+05:30'))>=?
       GROUP BY day ORDER BY day`,
            [currentEmployeeId, ...scope.params, trendFromKey],
        ),
        pool.execute(
            `SELECT DATE_FORMAT(DATE(CONVERT_TZ(c.created_at_utc,'+00:00','+05:30')),'%Y-%m-%d') AS day,
              COUNT(DISTINCT c.lead_id) AS value
       FROM crm_lead_comments c JOIN crm_leads l ON l.id=c.lead_id
       WHERE c.created_by_user_id=? AND l.deleted_at_utc IS NULL AND ${scope.sql}
         AND DATE(CONVERT_TZ(c.created_at_utc,'+00:00','+05:30'))>=?
       GROUP BY day ORDER BY day`,
            [currentUserId, ...scope.params, trendFromKey],
        ),
    ]);
    const trendMap = rows => new Map(rows.map(row => [String(row.day), Number(row.value || 0)]));
    const usageMap = trendMap(usageTrendRows[0]);
    const assignedMap = trendMap(assignedTrendRows[0]);
    const followupMap = trendMap(followupTrendRows[0]);
    const activityTrends = Array.from({ length: trendDays }, (_, index) => {
        const date = new Date(`${trendFromKey}T00:00:00`);
        date.setDate(date.getDate() + index);
        const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        return { day, crmHours: Number(((usageMap.get(day) || 0) / 3600).toFixed(2)), leadsAssigned: assignedMap.get(day) || 0, followupsDone: followupMap.get(day) || 0 };
    });
    const recentLeads = await queryLeads(req.user, '', 4);
    res.json({
        businessUnit: { id: Number(req.businessUnit.id), name: req.businessUnit.displayName },
        stats: {
            totalLeads: Number(stats.totalLeads || 0),
            newThisWeek: Number(stats.newThisWeek || 0),
            followupsDue: Number(followups.followupsDue || 0),
            untouchedAssignedCount: Number(untouchedAssigned.count || 0),
            admissions: Number(stats.admissions || 0),
            followupsDoneToday: Number(followupsDone.today || 0),
            comparisons: {
                totalLeadsLastMonth: Number(stats.totalLeadsLastMonth || 0),
                newPreviousWeek: Number(stats.newPreviousWeek || 0),
                followupsOverdue: Number(followups.followupsOverdue || 0),
                admissionsThisMonth: Number(admissionPeriods.admissionsThisMonth || 0),
                admissionsLastMonth: Number(admissionPeriods.admissionsLastMonth || 0),
                followupsDoneYesterday: Number(followupsDone.yesterday || 0),
            },
        },
        funnel: funnelRows.map((row) => ({ ...row, value: Number(row.value) })), activityTrends, recentLeads,
    });
});

async function queryLeads(user, search, limit = null, options = {}) {
    search = String(search || '').trim();
    const currentUserId = Number(user.id) || 0;
    /*
     * A search uses the Global Search scope when that is the wider of the two.
     *
     * Browsing the list and looking one lead up by phone are different
     * permissions on purpose: a counsellor answering a call needs to find the
     * caller's record even when the list itself is limited to their own. With
     * Global Search granted over all records, a search that matched a lead but
     * returned nothing was the setting being quietly ignored.
     *
     * It only ever widens, and only while a search term is present -- an empty
     * search is a browse, and stays on the list scope.
     */
    const scope = leadScopedWhere(user, search ? user.rbacSearchScope : null, options);
    /*
     * One pipeline's leads.
     *
     * A business unit can run several, and each has its own Leads screen. The
     * lead's pipeline is its stage's pipeline -- crm_leads.stage_id is NOT
     * NULL, so this is exact, and there is no second copy to fall out of step.
     */
    const pipelineId = Number(options.pipelineId) || null;
    const pipelineClause = pipelineId ? ' AND s.pipeline_id = ?' : '';
    const pipelineParams = pipelineId ? [pipelineId] : [];
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

    const parsedLimit = Number(limit);
    const limitClause = Number.isInteger(parsedLimit) && parsedLimit > 0
        ? ` LIMIT ${parsedLimit}`
        : '';
    const [rows] = await pool.execute(
        `SELECT l.id, l.lead_number AS leadId, l.branch_id AS branchId, b.branch_name AS branch,
            l.student_name AS studentName, l.student_id AS studentId, l.parked_at_utc AS parkedAt, l.phone, l.alternate_phone AS alternatePhone, l.email, l.parent_name AS parentName, l.city,
            l.application_payment_status AS paymentStatus,l.application_payment_amount AS paymentAmount,
            l.application_payment_at_utc AS paymentAt,l.jodo_order_id AS paymentOrderId,
            l.class_id AS classId, COALESCE(cls.display_name, l.applying_class) AS applyingClass,
            l.curriculum_id AS curriculumId, cur.display_name AS curriculum, l.academic_year AS academicYear,
            l.stage_id AS stageId, s.display_name AS stage, l.source_id AS sourceId, src.display_name AS source,
            /*
             * Every source the lead has, oldest first, not only the one on the
             * lead row.
             *
             * A lead that re-enquires through a second advertisement gets a
             * row in crm_lead_source_history; crm_leads.source_id keeps the
             * first. Filtering and exporting read the list below, so a lead
             * found through its second source is not invisible to a filter on
             * that source. Ordered by id, so the first entry is the original
             * and everything after it is a secondary source.
             */
            (SELECT GROUP_CONCAT(h.source_id ORDER BY h.id)
               FROM crm_lead_source_history h WHERE h.lead_id=l.id) AS sourceIdList,
            (SELECT GROUP_CONCAT(hsrc.display_name ORDER BY h.id SEPARATOR '||')
               FROM crm_lead_source_history h JOIN crm_lead_sources hsrc ON hsrc.id=h.source_id
              WHERE h.lead_id=l.id) AS sourceNameList,
            l.substage_id AS substageId, ss.display_name AS substage, l.channel_id AS channelId, ch.display_name AS channel,
            l.campaign_id AS campaignId, camp.display_name AS campaign, l.admission_type_id AS admissionTypeId,
            ch.category AS channelCategory, camp.category AS campaignCategory,
            CASE
              WHEN EXISTS (SELECT 1 FROM crm_bulk_upload_records bur WHERE bur.lead_id=l.id) THEN 'bulk_upload'
              WHEN l.lead_number LIKE 'LEAD-%' OR l.lead_number LIKE 'IMPORT-%' THEN 'google_sheets'
              WHEN JSON_UNQUOTE(JSON_EXTRACT(l.custom_values_json,'$.metaLeadgenId')) IS NOT NULL THEN 'integration'
              WHEN (SELECT h.intake_method FROM crm_lead_source_history h WHERE h.lead_id=l.id AND h.is_primary=TRUE ORDER BY h.id LIMIT 1)='website' THEN 'website_form'
              WHEN (SELECT h.intake_method FROM crm_lead_source_history h WHERE h.lead_id=l.id AND h.is_primary=TRUE ORDER BY h.id LIMIT 1)='integration' THEN 'integration'
              WHEN (SELECT h.intake_method FROM crm_lead_source_history h WHERE h.lead_id=l.id AND h.is_primary=TRUE ORDER BY h.id LIMIT 1)='bulk' THEN 'bulk_upload'
              ELSE 'manual'
            END AS leadEntryPath,
            l.referred_by_employee_id AS referredByEmployeeId,
            (SELECT MAX(touch_comment.created_at_utc)
             FROM crm_lead_comments touch_comment
             JOIN app_users touch_user ON touch_user.id=touch_comment.created_by_user_id
             WHERE touch_comment.lead_id=l.id
               AND touch_user.employee_id=l.owner_employee_id
               AND touch_comment.created_at_utc >= COALESCE(l.owner_assigned_at_utc,l.referred_at_utc,l.created_at_utc)) AS touchedAt,
            CASE
              WHEN l.owner_employee_id IS NULL THEN 'unassigned'
              WHEN EXISTS (
                SELECT 1
                FROM crm_lead_comments touch_comment
                JOIN app_users touch_user ON touch_user.id=touch_comment.created_by_user_id
                WHERE touch_comment.lead_id=l.id
                  AND touch_user.employee_id=l.owner_employee_id
                  AND touch_comment.created_at_utc >= COALESCE(l.owner_assigned_at_utc,l.referred_at_utc,l.created_at_utc)
              ) THEN 'touched'
              ELSE 'untouched'
            END AS touchStatus,
            l.is_parent AS isParent, l.looking_for_admission AS lookingForAdmission, l.whatsapp_response AS whatsappResponse,
            l.lead_score AS score, l.remarks, l.custom_values_json AS customValues, l.owner_employee_id AS ownerEmployeeId,
            l.owner_assigned_at_utc AS ownerAssignedAt,
            COALESCE(e.employee_name, 'Unassigned') AS owner, l.next_followup_at_utc AS nextFollowup,
            (SELECT GROUP_CONCAT(DISTINCT DATE_FORMAT(DATE(CONVERT_TZ(done_comment.created_at_utc,'+00:00','+05:30')),'%Y-%m-%d'))
             FROM crm_lead_comments done_comment
             WHERE done_comment.lead_id=l.id AND done_comment.created_by_user_id=${currentUserId}) AS followupDoneDayList,
            (${FOLLOWUP_DUE_SQL}) AS pendingFollowupTillToday,
            COALESCE(l.updated_at_utc,l.created_at_utc) AS recentModified,
            ((SELECT COUNT(*) FROM crm_lead_comments remark_count WHERE remark_count.lead_id=l.id)
              + CASE WHEN NULLIF(TRIM(l.remarks),'') IS NULL THEN 0 ELSE 1 END) AS remarksCount,
            l.referred_to_branch_id AS referredToBranchId,l.referred_to_branch_name AS referredToBranchName,l.referred_at_utc AS referredAt,
            l.created_at_utc AS addedAt, l.updated_at_utc AS updatedAt,
             CASE
              WHEN l.re_enquired_at_utc IS NOT NULL
                OR (SELECT COUNT(*) FROM crm_lead_source_history re_enquiry_history WHERE re_enquiry_history.lead_id = l.id) > 1
              THEN COALESCE(l.re_enquired_at_utc, l.updated_at_utc, l.created_at_utc)
              ELSE NULL
            END AS reEnquiredAt,
            (SELECT GROUP_CONCAT(DISTINCT CONCAT(mr.campaign_id, ':', md.status))
             FROM crm_marketing_campaign_recipients mr
             JOIN crm_marketing_campaign_deliveries md ON md.recipient_id=mr.id
             WHERE mr.lead_id=l.id) AS marketingDeliveryPairs
     FROM crm_leads l JOIN crm_lead_stages s ON s.id = l.stage_id LEFT JOIN branches b ON b.id = l.branch_id
     LEFT JOIN crm_lead_substages ss ON ss.id = l.substage_id
     LEFT JOIN crm_classes cls ON cls.id = l.class_id LEFT JOIN crm_curricula cur ON cur.id = l.curriculum_id
     LEFT JOIN crm_lead_sources src ON src.id = l.source_id
     LEFT JOIN crm_lead_channels ch ON ch.id = l.channel_id LEFT JOIN crm_campaigns camp ON camp.id = l.campaign_id
     LEFT JOIN employees e ON e.id = l.owner_employee_id
     WHERE l.deleted_at_utc IS NULL AND ${scope.sql}
       AND ${whereClause}${pipelineClause}
     ORDER BY l.created_at_utc DESC${limitClause}`,
        [...scope.params, ...params, ...pipelineParams],
    );
    return rows.map((row) => {
        const customValues = parseJsonValue(row.customValues, {});
        const location = customValues.websiteAttribution?.location || {};
        return {
            ...row,
            latitude: customValues.latitude ?? location.latitude ?? null,
            longitude: customValues.longitude ?? location.longitude ?? null,
            customValues,
            followupDoneDays: String(row.followupDoneDayList || '').split(',').filter(Boolean),
            marketingDeliveries: String(row.marketingDeliveryPairs || '')
                .split(',')
                .filter(Boolean)
                .map((pair) => {
                    const [campaignId, status] = pair.split(':');
                    return { campaignId: String(campaignId), status: String(status).toUpperCase() };
                }),
            marketingDeliveryPairs: undefined,
            followupDoneDayList: undefined,
        };
    });
}

async function accessibleBranch(user, branchId) {
    return canAccessBranch(user, branchId);
}

/*
 * What one administrator is allowed to hand out.
 *
 * User Management grants CRM access to other people, so without a bound it is
 * an escalation route: an administrator confined to one business unit could
 * grant themselves -- or a colleague -- every other unit and branch, and from
 * there read the whole system. Scope is therefore the granter's own.
 *
 * Two deliberate exceptions:
 *   SUPER_ADMIN is the unrestricted owner role, and the way back in if
 *   scoping ever leaves nobody able to administer anything.
 *   An administrator holding no explicit branches or units is unrestricted
 *   rather than holding none, which is the convention accessibleBranch() and
 *   scopedWhere() already follow.
 */
function isUnrestrictedAdmin(user) {
    return user?.roles?.some((role) => String(role).toUpperCase() === 'SUPER_ADMIN') || false;
}

/** Business units this administrator belongs to; empty means unrestricted. */
async function callerBusinessUnitIds(user) {
    const [rows] = await pool.execute(
        `SELECT business_unit_id AS id FROM crm_user_business_units WHERE user_id = ?`,
        [Number(user.id)],
    );
    return rows.map((row) => Number(row.id));
}

/**
 * The business units this administrator may grant, or null for "no limit".
 * Null rather than a list of every id so callers can skip filtering entirely.
 */
async function assignableBusinessUnitIds(user) {
    if (isUnrestrictedAdmin(user)) return null;
    const own = await callerBusinessUnitIds(user);
    return own.length ? own : null;
}

/** The branches this administrator may grant, or null for "no limit". */
function assignableBranchIds(user) {
    if (isUnrestrictedAdmin(user)) return null;
    const own = Array.isArray(user.branchIds) ? user.branchIds.map(Number).filter(Number.isFinite) : [];
    return own.length ? own : null;
}

/**
 * Whether this administrator may act on that user's CRM access.
 *
 * Someone outside the granter's reach must not be editable through it either:
 * being unable to grant a branch means little if the same person can strip a
 * colleague in another unit of their access, or deactivate them.
 */
async function administersUser(actor, targetUserId) {
    if (isUnrestrictedAdmin(actor)) return true;
    const units = await assignableBusinessUnitIds(actor);
    const branches = assignableBranchIds(actor);
    if (!units && !branches) return true;
    const [[target]] = await pool.execute(
        `SELECT
           (SELECT COUNT(*) FROM crm_user_business_units WHERE user_id = ?) AS unitCount,
           (SELECT COUNT(*) FROM crm_user_branches WHERE user_id = ?) AS branchCount,
           (SELECT COUNT(*) FROM crm_user_business_units WHERE user_id = ?
              ${units ? `AND business_unit_id IN (${units.map(() => '?').join(',')})` : ''}) AS unitOverlap,
           (SELECT COUNT(*) FROM crm_user_branches WHERE user_id = ?
              ${branches ? `AND branch_id IN (${branches.map(() => '?').join(',')})` : ''}) AS branchOverlap`,
        [
            Number(targetUserId), Number(targetUserId),
            Number(targetUserId), ...(units || []),
            Number(targetUserId), ...(branches || []),
        ],
    );
    // A user with nothing assigned yet is fair game; one with assignments must
    // overlap the administrator on both axes that the administrator is bound by.
    const unitOk = !units || Number(target.unitCount) === 0 || Number(target.unitOverlap) > 0;
    const branchOk = !branches || Number(target.branchCount) === 0 || Number(target.branchOverlap) > 0;
    return unitOk && branchOk;
}

function cleanOptional(value, maxLength = 500) {
    const text = String(value ?? '').trim();
    return text ? text.slice(0, maxLength) : null;
}

function normalizeIndianMobile(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (digits.length === 10) return digits;
    if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
    return digits;
}

function isValidIndianMobile(value) {
    return /^[6-9]\d{9}$/.test(normalizeIndianMobile(value));
}

function isValidEmailAddress(value) {
    const email = String(value ?? '').trim();
    if (!email) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function parseJsonValue(value, fallback = {}) {
    if (value == null) return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return fallback; }
}

async function appendLeadSourceOrDetectDuplicate(connection, existingLead, record, intakeMethod, userId) {
    const sourceId = Number(record.sourceId);
    const [[sameSource]] = await connection.execute(
        `SELECT id FROM crm_lead_source_history WHERE lead_id=? AND source_id=? LIMIT 1`,
        [existingLead.id, sourceId]
    );
    if (sameSource) return { duplicate: true };
    await connection.execute(
        `INSERT INTO crm_lead_source_history
      (lead_id,academic_year,source_id,channel_id,campaign_id,is_primary,intake_method,created_by_user_id)
     VALUES(?,?,?,?,?,FALSE,?,?)`,
        [existingLead.id, cleanOptional(record.academicYear, 20), sourceId, Number(record.channelId),
        Number(record.campaignId), intakeMethod, Number(userId)]
    );
    await connection.execute(
        `UPDATE crm_leads SET re_enquired_at_utc=CURRENT_TIMESTAMP(6),updated_at_utc=CURRENT_TIMESTAMP(6),updated_by_user_id=? WHERE id=?`,
        [Number(userId), existingLead.id]
    );
    await connection.execute(
        `INSERT INTO crm_lead_activities(lead_id,activity_type,summary,actor_user_id)
     VALUES(?,'re_enquired','Re-enquiry received from a new source',?)`,
        [existingLead.id, Number(userId)]
    );
    return { duplicate: false, reEnquired: true };
}

function validateLead(body, options = {}) {
    const studentName = cleanOptional(body.studentName, 200);
    const phone = cleanOptional(body.phone, 30);
    const alternatePhone = cleanOptional(body.alternatePhone, 30);
    const email = cleanOptional(body.email, 254);
    const classId = Number(body.classId);
    if (!studentName) return 'Student name is required';
    if (options.requirePhone !== false && !phone) return 'Phone is required';
    if (phone && !isValidIndianMobile(phone)) return 'Enter a valid Indian mobile number';
    if (alternatePhone && !isValidIndianMobile(alternatePhone)) return 'Enter a valid alternate Indian mobile number';
    if (email && !isValidEmailAddress(email)) return 'Enter a valid email address';
    if (options.requireClass !== false && (!Number.isInteger(classId) || classId <= 0)) return 'Select a valid Class ID';
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
        // Validate the source and its configured parent channel together. Source
        // history records usage; it is not the configuration relationship.
        const [[sourceData]] = await pool.query(
            `SELECT id FROM crm_lead_sources
       WHERE id = ? AND channel_id = ? AND is_active = TRUE LIMIT 1`,
            [sourceId, channelId]
        );
        if (!sourceData) return 'Source ID does not belong to selected Channel ID';

        // Validate Channel ID exists
        const [[channelData]] = await pool.query(
            `SELECT id FROM crm_lead_channels WHERE id = ? AND is_active = TRUE LIMIT 1`,
            [channelId]
        );
        if (!channelData) return 'Channel ID not found in database';

        return null;
    } catch (err) {
        return 'Error validating source details';
    }
}

/*
 * The lead pipelines this business unit runs.
 *
 * Small on purpose: the app shell needs it on every page to build one Leads
 * entry per pipeline in the sidebar, and /leads/meta is far too heavy to
 * load for that.
 */
app.get('/api/leads/pipelines', authenticate, requireCrmAccess, async (req, res) => {
    const [rows] = await pool.execute(
        `SELECT p.id, p.pipeline_key AS pipelineKey, p.display_name AS displayName,
                p.description, p.is_default AS isDefault, p.position
           FROM crm_lead_pipelines p
          WHERE p.business_unit_id=? AND p.is_active=TRUE
          ORDER BY p.position, p.display_name`,
        [Number(req.businessUnit.id)],
    );
    res.json({ data: rows });
});

/*
 * Which Leads screen the column arrangement belongs to.
 *
 * A pipeline id off the query string is trusted only after it is confirmed to
 * be one of this unit's -- the arrangement is keyed by pipeline, so an id from
 * another unit would let a person write onto a screen they cannot see. With no
 * id the request is for the plain /leads route, which shows the unit's default
 * pipeline, so that is what is resolved here.
 */
async function resolveLeadColumnPipeline(businessUnitId, pipelineId) {
    if (Number(pipelineId) > 0) {
        const [[pipeline]] = await pool.execute(
            `SELECT id FROM crm_lead_pipelines WHERE id=? AND business_unit_id=? LIMIT 1`,
            [Number(pipelineId), Number(businessUnitId)],
        );
        return pipeline ? Number(pipeline.id) : null;
    }
    const [[fallback]] = await pool.execute(
        `SELECT id FROM crm_lead_pipelines
          WHERE business_unit_id=? AND is_active=TRUE
          ORDER BY is_default DESC, position, id LIMIT 1`,
        [Number(businessUnitId)],
    );
    return fallback ? Number(fallback.id) : null;
}

/*
 * The columns this person arranged on this Leads screen.
 *
 * An empty list is the honest answer for a screen nobody has arranged --
 * a new business unit, a pipeline created this morning, a colleague's first
 * visit -- and the screen falls back to its default columns rather than the
 * API inventing an arrangement nobody chose.
 */
app.get('/api/leads/column-preferences', authenticate, requireCrmAccess, async (req, res) => {
    const pipelineId = await resolveLeadColumnPipeline(req.businessUnit.id, req.query.pipelineId);
    if (!pipelineId) return res.json({ data: { pipelineId: null, columns: [] } });
    const [[row]] = await pool.execute(
        `SELECT columns_json AS columns FROM crm_lead_column_preferences WHERE user_id=? AND pipeline_id=? LIMIT 1`,
        [Number(req.user.id), pipelineId],
    );
    const columns = row ? parseJsonValue(row.columns, []) : [];
    res.json({ data: { pipelineId, columns: Array.isArray(columns) ? columns : [] } });
});

/*
 * Store one screen's arrangement. Sending an empty list deletes the row, which
 * is how "reset to the default columns" is recorded -- storing the defaults
 * instead would freeze today's defaults onto the user for ever.
 */
app.put('/api/leads/column-preferences', authenticate, requireCrmAccess, async (req, res) => {
    const pipelineId = await resolveLeadColumnPipeline(req.businessUnit.id, req.body.pipelineId);
    if (!pipelineId) return res.status(400).json({ message: 'This business unit has no lead pipeline to arrange columns on' });
    const columns = [...new Set((Array.isArray(req.body.columns) ? req.body.columns : [])
        .filter(column => typeof column === 'string')
        .map(column => column.trim())
        .filter(column => column && column.length <= 150))].slice(0, 120);
    if (!columns.length) {
        await pool.execute(`DELETE FROM crm_lead_column_preferences WHERE user_id=? AND pipeline_id=?`, [Number(req.user.id), pipelineId]);
        return res.json({ message: 'Columns reset to the default arrangement', data: { pipelineId, columns: [] } });
    }
    await pool.execute(
        `INSERT INTO crm_lead_column_preferences (user_id, pipeline_id, columns_json) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE columns_json=VALUES(columns_json), updated_at_utc=CURRENT_TIMESTAMP(6)`,
        [Number(req.user.id), pipelineId, JSON.stringify(columns)],
    );
    res.json({ message: 'Columns saved', data: { pipelineId, columns } });
});

app.get('/api/leads/meta', authenticate, requireCrmAccess, async (req, res) => {
    const scope = scopedWhere(req.user, 'b.id');
    const [[unitDefaultsRow]] = await pool.execute(
        `SELECT manual_lead_defaults_json AS manualLeadDefaults FROM crm_business_units WHERE id=?`,
        [Number(req.businessUnit.id)],
    );
    /* Stages carry the pipeline they belong to: a unit can run several, and
       two of them may both contain a stage called "New". Every stage picker
       narrows to one pipeline, so the id has to travel with the stage. */
    const [stages] = await pool.execute(`SELECT id, pipeline_id AS pipelineId, name, display_name AS displayName, color_code AS color, requires_followup AS requiresFollowup FROM crm_lead_stages WHERE business_unit_id=? AND is_active = TRUE ORDER BY position`, [Number(req.businessUnit.id)]);
    const [pipelines] = await pool.execute(`SELECT id, pipeline_key AS pipelineKey, display_name AS displayName, is_default AS isDefault, position FROM crm_lead_pipelines WHERE business_unit_id=? AND is_active = TRUE ORDER BY position, display_name`, [Number(req.businessUnit.id)]);
    const [sources] = await pool.query(`SELECT id, name, display_name AS displayName FROM crm_lead_sources WHERE is_active = TRUE ORDER BY display_name`);
    const [classes] = await pool.query(`SELECT id, class_code AS code, display_name AS displayName FROM crm_classes WHERE is_active = TRUE ORDER BY position`);
    const [curricula] = await pool.query(`SELECT id, curriculum_code AS code, display_name AS displayName FROM crm_curricula WHERE is_active = TRUE ORDER BY position`);
    const [channels] = await pool.query(`SELECT c.id,c.channel_code AS code,c.display_name AS displayName,COALESCE(cc.display_name,c.category) category FROM crm_lead_channels c LEFT JOIN crm_channel_categories cc ON cc.id=c.category_id WHERE c.is_active=TRUE AND (cc.id IS NULL OR cc.is_active=TRUE) ORDER BY category,c.display_name`);
    const [campaigns] = await pool.query(`SELECT c.id,c.campaign_code AS code,c.display_name AS displayName,COALESCE(cc.display_name,c.category) category FROM crm_campaigns c LEFT JOIN crm_campaign_categories cc ON cc.id=c.category_id WHERE c.is_active=TRUE AND (cc.id IS NULL OR cc.is_active=TRUE) ORDER BY c.display_name`);
    /*
     * Which sources belong to which channel.
     *
     * Taken from the configured mapping on crm_lead_sources, not from
     * crm_lead_source_history as before. History only knows the combinations
     * somebody has already used, so a channel nobody had picked yet appeared
     * to have no sources -- and the form's "no links, show everything"
     * fallback then offered every source under it. Selecting "Phone enquiry"
     * listed Website and Meta Ads because of exactly that.
     */
    const [sourceLinks] = await pool.query(`SELECT channel_id AS channelId,id AS sourceId FROM crm_lead_sources WHERE channel_id IS NOT NULL AND is_active=TRUE`);
    const [campaignLinks] = await pool.query(`SELECT DISTINCT source_id AS sourceId,campaign_id AS campaignId FROM crm_lead_source_history WHERE source_id IS NOT NULL AND campaign_id IS NOT NULL`);
    const [admissionTypes] = await pool.query(`SELECT id, type_code AS code, display_name AS displayName FROM crm_admission_types WHERE is_active = TRUE ORDER BY display_name`);
    /* A sub-stage carries the pipeline of the stage it hangs off, so a Meta
       lead form pointed at a sub-stage id lands its leads in that pipeline. */
    const [substages] = await pool.execute(`SELECT ss.id, ss.stage_id AS stageId, s.pipeline_id AS pipelineId, ss.substage_code AS code, ss.display_name AS displayName FROM crm_lead_substages ss JOIN crm_lead_stages s ON s.id=ss.stage_id WHERE s.business_unit_id=? AND s.is_active=TRUE AND ss.is_active = TRUE ORDER BY s.position, ss.position`, [Number(req.businessUnit.id)]);
    const [branches] = await pool.execute(`SELECT b.id, b.branch_name AS name, b.short_name AS shortName FROM branches b WHERE b.is_active = TRUE AND ${scope.sql} ORDER BY b.branch_name`, scope.params);
    /* Which pipelines each branch is shown in. Attached rather than filtered
       here: this one payload feeds every screen, and several of them -- the
       branch picker in settings, assignment rules -- need all branches
       whatever pipeline is on screen. A branch with no rows is unrestricted,
       so it carries an empty list and every caller shows it. */
    const [branchPipelines] = await pool.query(
        'SELECT branch_id AS branchId, pipeline_id AS pipelineId FROM crm_branch_pipelines');
    const pipelinesByBranch = new Map();
    for (const row of branchPipelines) {
        const key = Number(row.branchId);
        if (!pipelinesByBranch.has(key)) pipelinesByBranch.set(key, []);
        pipelinesByBranch.get(key).push(Number(row.pipelineId));
    }
    for (const branch of branches) branch.pipelineIds = pipelinesByBranch.get(Number(branch.id)) || [];
    const [academicYears] = await pool.query(`SELECT id, academic_year AS academicYear, display_name AS displayName FROM crm_academic_years WHERE is_active = TRUE ORDER BY academic_year DESC`);
    const [leadFields] = await pool.execute(
        `SELECT id,field_key AS fieldKey,display_name AS displayName,field_type AS fieldType,placeholder,
            options_json AS options,options_section_id AS optionsSectionId,options_section_level AS optionsSectionLevel,
            validation_json AS validation,is_system AS isSystem,is_required AS isRequired,position
     FROM crm_metadata_fields
     WHERE business_unit_id=? AND module_key='leads' AND is_active=TRUE
     ORDER BY position,display_name`,
        [Number(req.businessUnit.id)],
    );
    const leadFieldSectionOptions = await resolveSectionOptions(leadFields);
    const [businessSources] = await pool.execute(
        `SELECT display_name AS displayName
     FROM crm_business_sources
     WHERE business_unit_id=? AND is_active=TRUE
     ORDER BY display_name`,
        [Number(req.businessUnit.id)],
    );
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
       AND r.normalized_name IN ('CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR','CRM_VIEWER','SUPER_ADMIN')
       AND ${employeeScope.sql}
     ORDER BY e.employee_name LIMIT 1000`,
        employeeScope.params,
    );
    res.json({
        stages, pipelines, sources, classes, curricula, channels, campaigns, sourceLinks, campaignLinks, admissionTypes, substages, branches, academicYears, employees,
        manualLeadDefaults: storedLeadDefaults,
        reEnquiryDefaults: storedLeadDefaults.reEnquiry||{},
        leadFields: leadFields.map(field => ({
            ...field,
            options: field.fieldKey === 'source'
                ? businessSources.map(source => source.displayName)
                : optionsForField(field, leadFieldSectionOptions, parseJsonValue(field.options, [])),
            validation: parseJsonValue(field.validation, {}),
        }))
    });
});

app.get('/api/leads/:id', authenticate, requireCrmAccess, async (req, res) => {
    // Reading a lead this user referred away is allowed: it is listed for them
    // on the Leads screen, so opening it must not 404. Editing it still is not
    // -- the write routes below stay on the unwidened scope.
    const scope = leadScopedWhere(req.user, null, { includeReferredAway: true });
    const [rows] = await pool.execute(
        `SELECT l.id, l.lead_number AS leadId, l.branch_id AS branchId, l.student_name AS studentName,
      l.phone, l.alternate_phone AS alternatePhone, l.email, l.class_id AS classId,
      l.application_payment_status AS paymentStatus,l.application_payment_amount AS paymentAmount,
      l.application_payment_at_utc AS paymentAt,l.jodo_order_id AS paymentOrderId,
      COALESCE(cls.display_name, l.applying_class) AS applyingClass, l.curriculum_id AS curriculumId,
      cur.display_name AS curriculum,
      l.academic_year AS academicYear, l.parent_name AS parentName, l.city, l.stage_id AS stageId,
      l.source_id AS sourceId, l.owner_employee_id AS ownerEmployeeId, l.lead_score AS leadScore,
      l.channel_id AS channelId, l.campaign_id AS campaignId,
      l.admission_type_id AS admissionTypeId, l.substage_id AS substageId,
      l.referred_to_branch_id AS referredToBranchId,l.referred_to_branch_name AS referredToBranchName,
      l.remarks, l.custom_values_json AS customValues, l.next_followup_at_utc AS nextFollowupAt, s.display_name AS stage,
      ss.display_name AS substage,
      src.display_name AS source, b.branch_name AS branch, COALESCE(e.employee_name, 'Unassigned') AS owner,
      l.updated_at_utc AS remarksUpdatedAt,
      COALESCE(editor_employee.employee_name,editor_email_employee.employee_name,e.employee_name,'Previous counsellor') AS remarksAuthor,
      l.created_at_utc AS addedAt, l.updated_at_utc AS updatedAt, l.referred_at_utc AS referredAt, l.re_enquired_at_utc AS reEnquiredAt
     FROM crm_leads l JOIN crm_lead_stages s ON s.id = l.stage_id
     LEFT JOIN crm_lead_substages ss ON ss.id=l.substage_id
     LEFT JOIN branches b ON b.id = l.branch_id LEFT JOIN crm_lead_sources src ON src.id = l.source_id
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
        `SELECT a.id,a.activity_type AS type,a.summary,a.details_json AS details,a.occurred_at_utc AS occurredAt,
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
    /*
     * Calls placed through the CRM, folded into the same feed.
     *
     * CallerDesk and Smartflo write every call to crm_call_activities --
     * including its recording_url -- but nothing ever wrote a matching row to
     * crm_lead_activities, and the feed reads only that table. Calls therefore
     * never appeared on a lead at all, recording or not.
     *
     * Merged at read time rather than duplicated on write: crm_call_activities
     * stays the single record of a call, and calls already made show up without
     * a backfill.
     */
    const [callActivities] = await pool.execute(
        `SELECT ca.id, ca.direction, ca.status, ca.call_result AS callResult, ca.disposition,
            ca.duration_seconds AS durationSeconds, ca.talk_seconds AS talkSeconds,
            ca.recording_url AS recordingUrl, ca.notes, ca.raw_payload AS rawPayload,
            ca.destination_number AS destinationNumber, ca.agent_number AS agentNumber,
            COALESCE(ca.started_at_utc, ca.created_at_utc) AS occurredAt,
            COALESCE(agent_employee.employee_name, agent_email_employee.employee_name, 'CRM user') AS actorName
       FROM crm_call_activities ca
       LEFT JOIN app_users agent_user ON agent_user.id = ca.agent_user_id
       LEFT JOIN employees agent_employee ON agent_employee.id = agent_user.employee_id
       LEFT JOIN employees agent_email_employee ON agent_user.employee_id IS NULL
            AND LOWER(agent_email_employee.email) = LOWER(agent_user.email)
      WHERE ca.lead_id = ?
      ORDER BY COALESCE(ca.started_at_utc, ca.created_at_utc) DESC LIMIT 30`,
        [Number(req.params.id)],
    );
    const callDuration = (seconds) => {
        const total = Number(seconds) || 0;
        if (!total) return null;
        const minutes = Math.floor(total / 60);
        return minutes ? `${minutes}m ${total % 60}s` : `${total}s`;
    };
    for (const call of callActivities) {
        const spoken = callDuration(call.talkSeconds || call.durationSeconds);
        const rawCall = parseJsonValue(call.rawPayload, {});
        const callingMode = rawCall.request?.calling_mode || null;
        const callingApi = rawCall.request?.api_endpoint || null;
        const providerCall = rawCall.cdr || rawCall.webhook || rawCall;
        const hangupCode = providerCall.hangup_cause_code ?? providerCall.hangupcause_code ?? providerCall.$hangupcause_code ?? null;
        const hangupKey = providerCall.hangup_cause_key ?? providerCall.hangupcause_key ?? providerCall.$hangupcause_key ?? null;
        const hangupDescription = providerCall.hangup_cause_description ?? providerCall.hangupcause_desc ?? providerCall.$hangupcause_desc ?? providerCall.hangup_cause ?? null;
        activities.push({
            // Prefixed so it cannot collide with a crm_lead_activities id, which
            // the front end uses as a React key and an expand/collapse key.
            id: `call-${call.id}`,
            type: 'call',
            summary: [
                call.direction === 'inbound' ? 'Incoming call' : 'Outgoing call',
                call.callResult || call.status,
                spoken ? `${spoken} talk time` : null,
            ].filter(Boolean).join(' · '),
            occurredAt: call.occurredAt,
            actorName: call.actorName,
            commentText: call.notes || null,
            details: {
                recordingUrl: call.recordingUrl || null,
                direction: call.direction || null,
                outcome: call.callResult || call.status || null,
                disposition: call.disposition || null,
                duration: spoken,
                number: call.destinationNumber || null,
                callingMode: callingMode === 'CUSTOMER_FIRST' ? 'Customer First – Click to Call Support' : callingMode === 'AGENT_FIRST' ? 'Agent First – Standard Click to Call' : null,
                callingApi,
                hangupCauseCode: hangupCode,
                hangupCauseKey: hangupKey,
                hangupCause: hangupDescription,
            },
        });
    }

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
    const legacyComment = rows[0].remarks ? [{ id: 'legacy', commentText: rows[0].remarks, createdAt: rows[0].remarksUpdatedAt || null, counsellorName: rows[0].remarksAuthor }] : [];
    res.json({ data: { ...rows[0], customValues: parseJsonValue(rows[0].customValues, {}), followupType: latestFollowup?.followupType || '', activities: activities.map(item => ({ ...item, details: parseJsonValue(item.details, {}) })), comments: [...comments, ...legacyComment], sourceHistory } });
});

app.post('/api/leads', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
    const [configuredFields] = await pool.execute(
        `SELECT field_key AS fieldKey,display_name AS displayName,is_required AS isRequired
     FROM crm_metadata_fields WHERE business_unit_id=? AND module_key='leads' AND is_active=TRUE`,
        [Number(req.businessUnit.id)],
    );
    const configuredKeys = new Set(configuredFields.map(field => field.fieldKey));
    const requiredKeys = new Set(configuredFields.filter(field => field.isRequired).map(field => field.fieldKey));
    const validationError = validateLead(req.body, {
        requireClass: configuredKeys.has('class_id'),
        requirePhone: requiredKeys.has('phone') || requiredKeys.has('primary_phone'),
    });
    if (validationError) return res.status(400).json({ message: validationError });
    const standardValues = {
        name: req.body.studentName, student_name: req.body.studentName, phone: req.body.phone, primary_phone: req.body.phone,
        alternate_phone: req.body.alternatePhone, email: req.body.email, parent_name: req.body.parentName, city: req.body.city,
        academic_year: req.body.academicYear, branch_id: req.body.branchId, admission_type_id: req.body.admissionTypeId,
        curriculum_id: req.body.curriculumId, class_id: req.body.classId, channel_id: req.body.channelId, source_id: req.body.sourceId,
        campaign_id: req.body.campaignId, stage_id: req.body.stageId, substage_id: req.body.substageId,
        owner_employee_id: req.body.ownerEmployeeId, next_followup_at_utc: req.body.nextFollowupAt,
        followup_type: req.body.followupType, remarks: req.body.remarks, lead_score: req.body.leadScore,
        status: req.body.status,
    };
    for (const field of configuredFields) {
        if (!field.isRequired) continue;
        const value = Object.prototype.hasOwnProperty.call(standardValues, field.fieldKey) ? standardValues[field.fieldKey] : req.body.customValues?.[field.fieldKey];
        if (value == null || String(value).trim() === '') return res.status(400).json({ message: `${field.displayName} is required` });
    }
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
    const academicYear = cleanOptional(req.body.academicYear, 20);
    const branchId = Number(req.body.branchId);
    const admissionTypeId = Number(req.body.admissionTypeId);
    const curriculumId = Number(req.body.curriculumId);
    const classId = Number(req.body.classId);
    if (!academicYear || ![branchId, admissionTypeId, curriculumId, classId].every(value => Number.isInteger(value) && value > 0)) {
        return res.status(400).json({ message: 'Select all academic requirements from the configured options' });
    }
    const [[academicConfiguration]] = await pool.execute(
        `SELECT acc.id
     FROM crm_admission_class_configurations acc
     JOIN crm_admission_class_configuration_details detail
       ON detail.configuration_id=acc.id AND detail.class_id=? AND detail.is_active=TRUE
     /* crm_academic_years was created utf8mb4_unicode_ci and
        crm_admission_class_configurations utf8mb4_0900_ai_ci, so comparing
        the two academic_year columns is an illegal mix of collations. Stated
        explicitly here so the join works whichever way round the tables are. */
     JOIN crm_academic_years ay ON ay.academic_year=acc.academic_year COLLATE utf8mb4_unicode_ci AND ay.is_active=TRUE
     JOIN branches b ON b.id=acc.branch_id AND b.is_active=TRUE
     JOIN crm_admission_types admission_type ON admission_type.id=acc.admission_type_id AND admission_type.is_active=TRUE
     JOIN crm_curricula curriculum ON curriculum.id=acc.curriculum_id AND curriculum.is_active=TRUE
     JOIN crm_classes class ON class.id=detail.class_id AND class.is_active=TRUE
     WHERE acc.academic_year=? AND acc.branch_id=?
       AND acc.admission_type_id=? AND acc.curriculum_id=? AND acc.is_active=TRUE
     LIMIT 1`,
        [classId, academicYear, branchId, admissionTypeId, curriculumId],
    );
    if (!academicConfiguration) return res.status(400).json({ message: 'The selected academic requirements are not an active configured combination' });
    if (!(await accessibleBranch(req.user, req.body.branchId))) return res.status(403).json({ message: 'You do not have access to the selected branch' });
    const connection = await pool.getConnection();
    const submittedPhone = cleanOptional(req.body.phone, 30);
    const normalizedPhone = submittedPhone
        ? normalizeIndianMobile(submittedPhone)
        : `no-phone-${crypto.randomUUID()}`;
    const intakeMethod = ['manual', 'bulk', 'integration'].includes(req.body.intakeMethod) ? req.body.intakeMethod : 'manual';
    const lockName = `crm-lead:${Number(req.businessUnit.id)}:${Number(req.body.branchId)}:${normalizedPhone}`;
    try {
        const [[lock]] = await connection.execute(`SELECT GET_LOCK(?,10) AS acquired`, [lockName]);
        if (!Number(lock.acquired)) return res.status(409).json({ message: 'This lead is being processed. Please retry.' });
        await connection.beginTransaction();
        // What counts as the same lead is the unit's own rule, not a fixed
        // branch + mobile pair. Unset units still match on branch + mobile.
        const { lead: existing } = await findDuplicateLead(connection, {
            businessUnitId: Number(req.businessUnit.id),
            record: { ...req.body, normalizedPhone },
            forUpdate: true,
        });
        if (existing) {
            if (!req.body.sourceId || !req.body.channelId || !req.body.campaignId) {
                await connection.commit();
                return res.status(409).json({
                    id: Number(existing.id),
                    leadNumber: existing.leadNumber,
                    message: 'This mobile number is already recorded in this Business Unit and branch',
                });
            }
            const enquiry = await appendLeadSourceOrDetectDuplicate(connection, existing, req.body, intakeMethod, req.user.id);
            await connection.commit();
            if (enquiry.duplicate) return res.status(409).json({ id: Number(existing.id), leadNumber: existing.leadNumber, message: 'This mobile number is already recorded for the same branch and source' });
            return res.status(200).json({ id: Number(existing.id), leadNumber: existing.leadNumber, reEnquired: true, message: 'Existing lead updated with a secondary source and marked as re-enquired' });
        }
        const temporaryNumber = `PENDING-${crypto.randomUUID()}`;
        const [result] = await connection.execute(
            `INSERT INTO crm_leads (business_unit_id,lead_number, branch_id, student_name, phone, normalized_phone, alternate_phone, email,
       applying_class, class_id, curriculum_id, academic_year, parent_name, city, stage_id, source_id,
       owner_employee_id, channel_id, campaign_id, admission_type_id, substage_id,
       lead_score, remarks, custom_values_json, next_followup_at_utc, student_id, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [Number(req.businessUnit.id), temporaryNumber, Number(req.body.branchId), cleanOptional(req.body.studentName, 200), submittedPhone || '',
                normalizedPhone, cleanOptional(req.body.alternatePhone, 30), cleanOptional(req.body.email, 254), cleanOptional(req.body.applyingClass, 50),
            req.body.classId ? Number(req.body.classId) : null, req.body.curriculumId ? Number(req.body.curriculumId) : null, cleanOptional(req.body.academicYear, 20),
            cleanOptional(req.body.parentName, 200), cleanOptional(req.body.city, 100),
            Number(req.body.stageId), req.body.sourceId ? Number(req.body.sourceId) : null,
            req.body.ownerEmployeeId ? Number(req.body.ownerEmployeeId) : null,
            req.body.channelId ? Number(req.body.channelId) : null, req.body.campaignId ? Number(req.body.campaignId) : null, req.body.admissionTypeId ? Number(req.body.admissionTypeId) : null,
            req.body.substageId ? Number(req.body.substageId) : null, Number(req.body.leadScore || 0),
            cleanOptional(req.body.remarks, 10000), JSON.stringify(req.body.customValues || {}), followup.nextFollowupAt, cleanOptional(req.body.studentId, 60), Number(req.user.id)],
        );
        const leadNumber = `ADM-${new Date().getFullYear()}-${String(result.insertId).padStart(6, '0')}`;
        await connection.execute(`UPDATE crm_leads SET lead_number = ? WHERE id = ?`, [leadNumber, result.insertId]);
        if (req.body.sourceId && req.body.channelId && req.body.campaignId) {
            await connection.execute(`INSERT INTO crm_lead_source_history(lead_id,academic_year,source_id,channel_id,campaign_id,is_primary,intake_method,created_by_user_id) VALUES(?,?,?,?,?,TRUE,?,?)`, [result.insertId, cleanOptional(req.body.academicYear, 20), Number(req.body.sourceId), Number(req.body.channelId), Number(req.body.campaignId), intakeMethod, Number(req.user.id)]);
        }
        await connection.execute(`INSERT INTO crm_lead_activities (lead_id, activity_type, summary, actor_user_id) VALUES (?, 'created', 'Lead created', ?)`, [result.insertId, Number(req.user.id)]);
        if (followup.required) {
            await connection.execute(`INSERT INTO crm_followups (lead_id, assigned_employee_id, followup_type, due_at_utc, created_by_user_id) VALUES (?, ?, ?, ?, ?)`, [result.insertId, req.body.ownerEmployeeId ? Number(req.body.ownerEmployeeId) : null, followup.followupType, followup.nextFollowupAt, Number(req.user.id)]);
        }
        await notifyEmployee(connection, {
            businessUnitId: Number(req.businessUnit.id), employeeId: Number(req.body.ownerEmployeeId), actorUserId: Number(req.user.id),
            type: 'lead_assigned', title: 'New lead assigned', message: `${cleanOptional(req.body.studentName, 200)} · ${leadNumber}`,
            link: `/leads?lead=${Number(result.insertId)}`, entityType: 'lead', entityId: Number(result.insertId),
        });
        await connection.commit();
        res.status(201).json({ id: Number(result.insertId), leadNumber, message: 'Lead created successfully' });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        await connection.execute(`SELECT RELEASE_LOCK(?)`, [lockName]).catch(() => { });
        connection.release();
    }
});

app.put('/api/leads/:id', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
    const [configuredFields] = await pool.execute(
        `SELECT field_key AS fieldKey FROM crm_metadata_fields
     WHERE business_unit_id=? AND module_key='leads' AND is_active=TRUE`,
        [Number(req.businessUnit.id)],
    );
    const validationError = validateLead(req.body, { requireClass: configuredFields.some(field => field.fieldKey === 'class_id') });
    if (validationError) return res.status(400).json({ message: validationError });
    let followup = { required: false, nextFollowupAt: null, followupType: null };
    const substageId = Number(req.body.substageId);
    if (Number.isInteger(substageId) && substageId > 0) {
        followup = await validateStageFollowup(req.body);
        if (followup.error) return res.status(400).json({ message: followup.error });
    }
    const scope = leadScopedWhere(req.user);
    const [[previousLeadOwner]] = await pool.execute(
        `SELECT l.owner_employee_id AS ownerEmployeeId,l.lead_number AS leadNumber,l.student_name AS studentName
     FROM crm_leads l WHERE l.id=? AND l.deleted_at_utc IS NULL AND ${scope.sql}`,
        [Number(req.params.id), ...scope.params],
    );
    const [result] = await pool.execute(
        /* academic_year and alternate_phone are updatable: both are editable
           on the lead form, and without them here a change made on screen was
           accepted and then silently dropped. The rest of the contact and
           primary-source columns stay out on purpose -- the form locks them. */
        `UPDATE crm_leads l SET student_name = ?, academic_year = ?, alternate_phone = ?,
      applying_class = ?, class_id = ?, curriculum_id = ?, parent_name = ?, city = ?, stage_id = ?,
      owner_assigned_at_utc = IF(NOT (owner_employee_id <=> ?), CURRENT_TIMESTAMP(6), owner_assigned_at_utc),
      owner_employee_id = ?, admission_type_id = ?, substage_id = ?,
      lead_score = ?, remarks = ?, custom_values_json = ?, next_followup_at_utc = ?, student_id = ?, updated_by_user_id = ?
     WHERE l.id = ? AND l.deleted_at_utc IS NULL AND ${scope.sql}`,
        [cleanOptional(req.body.studentName, 200),
        cleanOptional(req.body.academicYear, 20), cleanOptional(req.body.alternatePhone, 30),
        cleanOptional(req.body.applyingClass, 50),
        req.body.classId ? Number(req.body.classId) : null, req.body.curriculumId ? Number(req.body.curriculumId) : null, cleanOptional(req.body.parentName, 200), cleanOptional(req.body.city, 100),
        Number(req.body.stageId),
        req.body.ownerEmployeeId ? Number(req.body.ownerEmployeeId) : null,
        req.body.ownerEmployeeId ? Number(req.body.ownerEmployeeId) : null,
        req.body.admissionTypeId ? Number(req.body.admissionTypeId) : null,
        req.body.substageId ? Number(req.body.substageId) : null, Number(req.body.leadScore || 0),
        cleanOptional(req.body.remarks, 10000), JSON.stringify(req.body.customValues || {}), followup.nextFollowupAt, cleanOptional(req.body.studentId, 60), Number(req.user.id), Number(req.params.id), ...scope.params],
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Lead not found' });
    const [[pendingFollowup]] = await pool.execute(`SELECT id FROM crm_followups WHERE lead_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`, [Number(req.params.id)]);
    if (followup.required && pendingFollowup) {
        await pool.execute(`UPDATE crm_followups SET assigned_employee_id=?,followup_type=?,due_at_utc=? WHERE id=?`, [req.body.ownerEmployeeId ? Number(req.body.ownerEmployeeId) : null, followup.followupType, followup.nextFollowupAt, pendingFollowup.id]);
    } else if (followup.required) {
        await pool.execute(`INSERT INTO crm_followups (lead_id,assigned_employee_id,followup_type,due_at_utc,created_by_user_id) VALUES (?,?,?,?,?)`, [Number(req.params.id), req.body.ownerEmployeeId ? Number(req.body.ownerEmployeeId) : null, followup.followupType, followup.nextFollowupAt, Number(req.user.id)]);
    } else if (pendingFollowup) {
        await pool.execute(`UPDATE crm_followups SET status='Cancelled' WHERE lead_id=? AND LOWER(status) IN ('p','pending')`, [Number(req.params.id)]);
    }
    await pool.execute(`INSERT INTO crm_lead_activities (lead_id, activity_type, summary, actor_user_id) VALUES (?, 'updated', 'Lead details updated', ?)`, [Number(req.params.id), Number(req.user.id)]);
    const assignedEmployeeId = Number(req.body.ownerEmployeeId) || null;
    if (assignedEmployeeId && assignedEmployeeId !== Number(previousLeadOwner?.ownerEmployeeId)) await notifyEmployee(pool, {
        businessUnitId: Number(req.businessUnit.id), employeeId: assignedEmployeeId, actorUserId: Number(req.user.id), type: 'lead_assigned',
        title: 'Lead assigned to you', message: `${previousLeadOwner?.studentName || 'Lead'} · ${previousLeadOwner?.leadNumber || `#${req.params.id}`}`,
        link: `/leads?lead=${Number(req.params.id)}`, entityType: 'lead', entityId: Number(req.params.id),
    });
    res.json({ message: 'Lead updated successfully' });
});

/*
 * Park a lead, or take it off the shelf.
 *
 * Deliberately not part of the lead update endpoint: that one rewrites every
 * column from its request body, so parking through it would need the whole
 * lead and could quietly blank a field the caller did not send. This touches
 * two columns and nothing else.
 */
app.post('/api/leads/:id/park', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
    const parked = req.body?.parked !== false;
    const scope = leadScopedWhere(req.user);
    const [result] = await pool.execute(
        `UPDATE crm_leads l
            SET l.parked_at_utc = ?, l.parked_by_user_id = ?, l.updated_at_utc = CURRENT_TIMESTAMP(6)
          WHERE l.id = ? AND l.deleted_at_utc IS NULL AND ${scope.sql}`,
        [parked ? new Date() : null, parked ? Number(req.user.id) : null, Number(req.params.id), ...scope.params],
    );
    // Not found rather than forbidden: a lead outside the caller's scope should
    // not be distinguishable from one that does not exist.
    if (!result.affectedRows) return res.status(404).json({ message: 'Lead not found' });
    await pool.execute(
        `INSERT INTO crm_lead_activities (lead_id, activity_type, summary, actor_user_id) VALUES (?, 'updated', ?, ?)`,
        [Number(req.params.id), parked ? 'Lead parked for follow-up' : 'Lead taken off the parked list', Number(req.user.id)],
    );
    res.json({ success: true, parked });
});

app.put('/api/leads/:id/followup-notes', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
    const leadId = Number(req.params.id);
    const stageId = Number(req.body.stageId);
    const substageId = Number(req.body.substageId);
    const comment = cleanOptional(req.body.comment, 10000);
    const referralBranchId = Number(req.body.referralBranchId);
    const referralEmployeeId = Number(req.body.referralEmployeeId);
    const callActivityId = Number(req.body.callActivityId) || null;
    const callAttempt = Boolean(req.body.callAttempt || callActivityId);
    let callDisposition = cleanOptional(req.body.callDisposition, 80);
    if (!Number.isInteger(stageId) || stageId <= 0) return res.status(400).json({ message: 'Stage is required' });
    if (!Number.isInteger(substageId) || substageId <= 0) return res.status(400).json({ message: 'Sub-stage is required' });
    if (!comment) return res.status(400).json({ message: 'New comment is required' });
    if (!Number.isInteger(referralBranchId) || referralBranchId <= 0) return res.status(400).json({ message: 'Referral branch is required' });
    if (!Number.isInteger(referralEmployeeId) || referralEmployeeId <= 0) return res.status(400).json({ message: 'Counsellor is required' });
    const [[validSubstage]] = await pool.execute(`SELECT ss.id,ss.display_name AS substageName,s.display_name AS stageName FROM crm_lead_substages ss JOIN crm_lead_stages s ON s.id=ss.stage_id WHERE ss.id=? AND ss.stage_id=? AND ss.is_active=TRUE AND s.is_active=TRUE LIMIT 1`, [substageId, stageId]);
    if (!validSubstage) return res.status(400).json({ message: 'Select a valid sub-stage for the selected stage' });
    // Call disposition is the selected sub-stage. Derive it server-side so a
    // client cannot save a label that disagrees with the stage hierarchy.
    if (callAttempt) callDisposition = validSubstage.substageName;
    const followup = await validateStageFollowup(req.body);
    if (followup.error) return res.status(400).json({ message: followup.error });
    const scope = leadScopedWhere(req.user);
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [[lead]] = await connection.execute(`SELECT l.owner_employee_id AS ownerEmployeeId, l.branch_id AS branchId, l.referred_to_branch_id AS referredToBranchId FROM crm_leads l WHERE l.id=? AND l.deleted_at_utc IS NULL AND ${scope.sql} FOR UPDATE`, [leadId, ...scope.params]);
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
         AND r.normalized_name IN ('CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR','SUPER_ADMIN') LIMIT 1`,
            [referralBranchId, referralEmployeeId],
        );
        if (!counsellor) { await connection.rollback(); return res.status(400).json({ message: 'The selected counsellor does not have active CRM access to the selected branch' }); }
        /*
         * A referral only happened if the lead actually moved.
         *
         * The counsellor field is pre-filled with whoever already owns the lead,
         * so saving an ordinary follow-up sent the same owner back. Writing the
         * referral columns regardless stamped referred_at_utc with the current
         * time on every save and logged a "Lead referred" activity for a referral
         * that never took place -- which is why the timeline showed the lead being
         * referred to the same person over and over.
         *
         * The branch counts too: the same counsellor in a different branch is a
         * genuine transfer. A lead that has never been referred is compared
         * against its own branch, not against NULL.
         */
        const currentBranchId = Number(lead.referredToBranchId || lead.branchId) || null;
        const referralChanged = Number(lead.ownerEmployeeId) !== referralEmployeeId
            || currentBranchId !== referralBranchId;

        const [result] = await connection.execute(
            `UPDATE crm_leads SET stage_id=?,substage_id=?,next_followup_at_utc=?${referralChanged
                ? ',owner_employee_id=?,owner_assigned_at_utc=CURRENT_TIMESTAMP(6),referred_to_branch_id=?,referred_to_branch_name=?,referred_at_utc=CURRENT_TIMESTAMP(6),referred_by_employee_id=?'
                : ''},updated_by_user_id=? WHERE id=? AND deleted_at_utc IS NULL`,
            [stageId, substageId, followup.nextFollowupAt,
                ...(referralChanged ? [referralEmployeeId, referralBranchId, counsellor.branchName, Number(req.user.employeeId) || null] : []),
                Number(req.user.id), leadId],
        );
        await connection.execute(`INSERT INTO crm_lead_comments (lead_id,comment_text,created_by_user_id) VALUES (?,?,?)`, [leadId, comment, Number(req.user.id)]);
        if (callActivityId) {
            const [callUpdate] = await connection.execute(
                `UPDATE crm_call_activities SET disposition=?,notes=? WHERE id=? AND lead_id=? AND business_unit_id=?`,
                [callDisposition, comment, callActivityId, leadId, Number(req.businessUnit.id)],
            );
            if (!callUpdate.affectedRows) { await connection.rollback(); return res.status(400).json({ message: 'The call activity is not available for this lead' }); }
        }
        const [[pending]] = await connection.execute(`SELECT id FROM crm_followups WHERE lead_id=? AND LOWER(status) IN ('p','pending') ORDER BY id DESC LIMIT 1`, [leadId]);
        if (followup.required && pending) {
            await connection.execute(`UPDATE crm_followups SET assigned_employee_id=?,followup_type=?,due_at_utc=? WHERE id=?`, [referralEmployeeId, followup.followupType, followup.nextFollowupAt, pending.id]);
        } else if (followup.required) {
            await connection.execute(`INSERT INTO crm_followups (lead_id,assigned_employee_id,followup_type,due_at_utc,created_by_user_id) VALUES (?,?,?,?,?)`, [leadId, referralEmployeeId, followup.followupType, followup.nextFollowupAt, Number(req.user.id)]);
        } else {
            await connection.execute(`UPDATE crm_followups SET status='Cancelled' WHERE lead_id=? AND LOWER(status) IN ('p','pending')`, [leadId]);
        }
        // The scheduled follow-up is recorded on the activity itself. Reading it
        // back off the lead would only ever show the CURRENT date, so every past
        // entry in the timeline would claim whatever was scheduled most recently.
        await connection.execute(
            `INSERT INTO crm_lead_activities (lead_id,activity_type,summary,details_json,actor_user_id) VALUES (?,'followup_updated',?,?,?)`,
            [leadId, `Follow-up updated · ${validSubstage.stageName} · ${validSubstage.substageName}`,
                JSON.stringify({
                    nextFollowupAt: followup.nextFollowupAt || null,
                    followupType: followup.followupType || null,
                    stage: validSubstage.stageName,
                    substage: validSubstage.substageName,
                    callActivityId,
                    callAttempt,
                    callDisposition: callDisposition || null,
                }),
                Number(req.user.id)],
        );
        // Only recorded when the lead genuinely changed hands.
        if (referralChanged) {
            await connection.execute(`INSERT INTO crm_lead_activities (lead_id,activity_type,summary,actor_user_id) VALUES (?,'referred',?,?)`, [leadId, `Lead assigned to ${counsellor.name} · ${counsellor.branchName}`, Number(req.user.id)]);
            await notifyEmployee(connection, {
                businessUnitId: Number(req.businessUnit.id), employeeId: referralEmployeeId, actorUserId: Number(req.user.id),
                type: 'lead_referred', title: 'Lead referred to you', message: `Lead #${leadId} · ${counsellor.branchName}`,
                link: `/leads?lead=${leadId}`, entityType: 'lead', entityId: leadId,
            });
        }
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
    const leadId = Number(req.params.id);
    if (!cleanOptional(req.body.academicYear, 20)) return res.status(400).json({ message: 'Academic year is required' });
    const sourceError = await validateSourceDetails(req.body);
    if (sourceError) return res.status(400).json({ message: sourceError });
    const scope = leadScopedWhere(req.user);
    const [[lead]] = await pool.execute(`SELECT l.id FROM crm_leads l WHERE l.id=? AND l.deleted_at_utc IS NULL AND ${scope.sql} LIMIT 1`, [leadId, ...scope.params]);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    const values = [leadId, cleanOptional(req.body.academicYear, 20), Number(req.body.sourceId), Number(req.body.channelId), Number(req.body.campaignId)];
    const [[duplicate]] = await pool.execute(`SELECT id FROM crm_lead_source_history WHERE lead_id=? AND academic_year=? AND source_id=? AND channel_id=? AND campaign_id=? LIMIT 1`, values);
    if (duplicate) return res.status(409).json({ message: 'These source details are already recorded for this lead' });
    /* A re-enquiry is a lead coming back through some source, so the mark and
       the source that earned it are written together -- a lead can never end
       up flagged as a re-enquiry with nothing to say where it came from. */
    const markReEnquired = req.body.markReEnquired === true || req.body.markReEnquired === 'true';
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.execute(`INSERT INTO crm_lead_source_history(lead_id,academic_year,source_id,channel_id,campaign_id,is_primary,intake_method,created_by_user_id) VALUES(?,?,?,?,?,FALSE,'manual',?)`, [...values, Number(req.user.id)]);
        await connection.execute(`UPDATE crm_leads SET ${markReEnquired ? 're_enquired_at_utc=CURRENT_TIMESTAMP(6),' : ''}updated_at_utc=CURRENT_TIMESTAMP(6),updated_by_user_id=? WHERE id=?`, [Number(req.user.id), leadId]);
        await connection.execute(`INSERT INTO crm_lead_activities(lead_id,activity_type,summary,actor_user_id) VALUES(?,'source_appended','Secondary source appended',?)`, [leadId, Number(req.user.id)]);
        if (markReEnquired) await connection.execute(`INSERT INTO crm_lead_activities(lead_id,activity_type,summary,actor_user_id) VALUES(?,'re_enquired','Lead marked as re-enquiry against a new source',?)`, [leadId, Number(req.user.id)]);
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally { connection.release(); }
    res.status(201).json({ message: markReEnquired ? 'Secondary source added and lead marked as re-enquiry' : 'Secondary source added successfully', reEnquired: markReEnquired });
});

/**
 * Where a lead lands when it is referred into another pipeline.
 *
 * A lead's pipeline is its stage's pipeline, so moving it between pipelines
 * means giving it a stage in the target one. It goes to that pipeline's first
 * active stage -- the entry point every new lead there starts at -- and that
 * stage's first sub-stage, because substage_id must belong to stage_id.
 *
 * Returns null when the pipeline is not this unit's, or has no active stage
 * to receive the lead; the caller refuses the referral rather than moving a
 * lead somewhere it cannot be worked.
 */
async function resolvePipelineEntry(connection, businessUnitId, pipelineId) {
    const [[pipeline]] = await connection.execute(
        `SELECT id, display_name AS displayName FROM crm_lead_pipelines
          WHERE id=? AND business_unit_id=? AND is_active=TRUE LIMIT 1`,
        [Number(pipelineId), Number(businessUnitId)],
    );
    if (!pipeline) return null;
    const [[stage]] = await connection.execute(
        `SELECT id, display_name AS displayName FROM crm_lead_stages
          WHERE pipeline_id=? AND is_active=TRUE ORDER BY position, id LIMIT 1`,
        [pipeline.id],
    );
    if (!stage) return null;
    const [[substage]] = await connection.execute(
        `SELECT id FROM crm_lead_substages WHERE stage_id=? AND is_active=TRUE ORDER BY position, id LIMIT 1`,
        [stage.id],
    );
    return { pipeline, stageId: Number(stage.id), stageName: stage.displayName, substageId: substage ? Number(substage.id) : null };
}

/**
 * Move one lead onto the entry stage of another pipeline.
 *
 * Records the move in crm_lead_stage_history like any other stage change, so
 * a lead that changed pipelines does not appear to have skipped a stage.
 * Does nothing when the lead is already in that pipeline.
 */
async function moveLeadToPipeline(connection, leadId, entry, actorUserId) {
    const [[lead]] = await connection.execute(
        `SELECT l.stage_id AS stageId, l.substage_id AS substageId, s.pipeline_id AS pipelineId
           FROM crm_leads l JOIN crm_lead_stages s ON s.id=l.stage_id WHERE l.id=? LIMIT 1`,
        [Number(leadId)],
    );
    if (!lead || Number(lead.pipelineId) === Number(entry.pipeline.id)) return false;
    await connection.execute(
        `UPDATE crm_leads SET stage_id=?, substage_id=?, updated_by_user_id=?, updated_at_utc=CURRENT_TIMESTAMP(6) WHERE id=?`,
        [entry.stageId, entry.substageId, actorUserId, Number(leadId)],
    );
    await connection.execute(
        `INSERT INTO crm_lead_stage_history (lead_id, from_stage_id, to_stage_id, from_substage_id, to_substage_id, changed_by_user_id, changed_at_utc)
         VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP(6))`,
        [Number(leadId), lead.stageId, entry.stageId, lead.substageId, entry.substageId, actorUserId],
    );
    return true;
}

app.put('/api/leads/actions/bulk-refer', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
    const leadIds = [...new Set((Array.isArray(req.body.leadIds) ? req.body.leadIds : []).map(Number).filter(id => Number.isInteger(id) && id > 0))];
    const employeeId = Number(req.body.employeeId), branchId = Number(req.body.branchId);
    if (!leadIds.length) return res.status(400).json({ message: 'No visible leads were supplied' });
    if (leadIds.length > 500) return res.status(400).json({ message: 'A maximum of 500 visible leads can be referred at once' });
    if (!Number.isInteger(branchId) || branchId <= 0) return res.status(400).json({ message: 'Select a referral branch' });
    if (!Number.isInteger(employeeId) || employeeId <= 0) return res.status(400).json({ message: 'Select a counsellor' });
    const [[counsellor]] = await pool.execute(
        `SELECT DISTINCT e.id,e.employee_name AS name,b.branch_name AS branchName FROM employees e
     JOIN app_users u ON u.employee_id=e.id AND u.is_active=TRUE
     JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
     JOIN crm_user_branches cub ON cub.user_id=u.id AND cub.branch_id=?
     JOIN branches b ON b.id=cub.branch_id AND b.is_active=TRUE
     LEFT JOIN crm_user_access_status cuas ON cuas.user_id=u.id
     WHERE e.id=? AND e.status='Active' AND COALESCE(cuas.is_active,1)=1
       AND r.normalized_name IN ('CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR','SUPER_ADMIN') LIMIT 1`, [branchId, employeeId]);
    if (!counsellor) return res.status(400).json({ message: 'The selected counsellor does not have active CRM access to the selected branch' });
    const placeholders = leadIds.map(() => '?').join(',');
    const scope = leadScopedWhere(req.user);
    const [accessible] = await pool.execute(
        `SELECT l.id,COALESCE(previous_owner.employee_name,'Unassigned') AS previousOwner,
            current_branch.branch_name AS previousBranch
     FROM crm_leads l
     JOIN branches current_branch ON current_branch.id=l.branch_id
     LEFT JOIN employees previous_owner ON previous_owner.id=l.owner_employee_id
     WHERE l.id IN (${placeholders}) AND l.deleted_at_utc IS NULL AND ${scope.sql}`,
        [...leadIds, ...scope.params],
    );
    if (accessible.length !== leadIds.length) return res.status(403).json({ message: 'One or more visible leads are outside your current access' });

    // Optional destination pipeline, resolved before any write.
    let entry = null;
    if (req.body.pipelineId) {
        entry = await resolvePipelineEntry(pool, Number(req.businessUnit.id), req.body.pipelineId);
        if (!entry) return res.status(400).json({ message: 'That pipeline is not available in this business unit, or has no active stage to receive the leads' });
    }

    const connection = await pool.getConnection();
    let movedCount = 0;
    try {
        await connection.beginTransaction();
        await connection.execute(`UPDATE crm_leads SET owner_employee_id=?,owner_assigned_at_utc=CURRENT_TIMESTAMP(6),referred_to_branch_id=?,referred_to_branch_name=?,referred_at_utc=CURRENT_TIMESTAMP(6),referred_by_employee_id=?,updated_by_user_id=? WHERE id IN (${placeholders}) AND deleted_at_utc IS NULL`, [employeeId, branchId, counsellor.branchName, Number(req.user.employeeId) || null, Number(req.user.id), ...leadIds]);
        if (entry) {
            for (const leadId of leadIds) {
                if (await moveLeadToPipeline(connection, leadId, entry, Number(req.user.id))) movedCount += 1;
            }
        }
        await connection.execute(`UPDATE crm_followups SET assigned_employee_id=? WHERE lead_id IN (${placeholders}) AND LOWER(status) IN ('p','pending')`, [employeeId, ...leadIds]);
        await connection.execute(
            `INSERT INTO crm_bulk_operations
       (business_unit_id,operation_type,status,created_by_user_id,total_records,successful_records,summary,details_json,completed_at_utc)
       VALUES (?,'referral','completed',?,?,?,?,?,CURRENT_TIMESTAMP(6))`,
            [Number(req.businessUnit.id), Number(req.user.id), leadIds.length, leadIds.length, `Referred to ${counsellor.name}`, JSON.stringify({
                branchId, branchName: counsellor.branchName, employeeId, employeeName: counsellor.name, leadIds,
                referrals: accessible.map(lead => ({ leadId: Number(lead.id), fromOwner: lead.previousOwner, fromBranch: lead.previousBranch, toOwner: counsellor.name, toBranch: counsellor.branchName })),
            })],
        );
        for (const leadId of leadIds) {
            await connection.execute(`INSERT INTO crm_lead_activities(lead_id,activity_type,summary,actor_user_id) VALUES(?,'referred',?,?)`, [leadId, `Lead referred to ${counsellor.name} · ${counsellor.branchName}`, Number(req.user.id)]);
            await notifyEmployee(connection, { businessUnitId: Number(req.businessUnit.id), employeeId, actorUserId: Number(req.user.id), type: 'lead_referred', title: 'Lead referred to you', message: `Lead #${leadId} · ${counsellor.branchName}`, link: `/leads?lead=${leadId}`, entityType: 'lead', entityId: leadId });
        }
        await connection.commit();
        const movedNote = entry
            ? ` · moved ${movedCount} into ${entry.pipeline.displayName}`
            : '';
        res.json({ message: `${leadIds.length} visible lead${leadIds.length === 1 ? '' : 's'} referred to ${counsellor.name} · ${counsellor.branchName}${movedNote}` });
    } catch (error) {
        await connection.rollback();
        try {
            await pool.execute(
                `INSERT INTO crm_bulk_operations
         (business_unit_id,operation_type,status,created_by_user_id,total_records,failed_records,summary,details_json,error_message,completed_at_utc)
         VALUES (?,'referral','failed',?,?,?,?,?,?,CURRENT_TIMESTAMP(6))`,
                [Number(req.businessUnit.id), Number(req.user.id), leadIds.length, leadIds.length, 'Bulk referral failed', JSON.stringify({ branchId, employeeId, leadIds }), String(error.message || error).slice(0, 1000)],
            );
        } catch (auditError) { console.warn('Bulk referral audit failed:', auditError.message); }
        throw error;
    } finally { connection.release() }
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
       AND r.normalized_name IN ('CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR','SUPER_ADMIN') AND ${scope.sql}
     LIMIT 1`,
        [employeeId, branchId, leadId, ...scope.params],
    );
    if (!counsellor) return res.status(400).json({ message: 'The selected counsellor does not have active CRM access to the selected branch' });

    /* A referral may also hand the lead to another pipeline in this unit.
       Resolved before anything is written, so an unusable pipeline stops the
       referral rather than half-applying it. */
    let entry = null;
    if (req.body.pipelineId) {
        entry = await resolvePipelineEntry(pool, Number(req.businessUnit.id), req.body.pipelineId);
        if (!entry) return res.status(400).json({ message: 'That pipeline is not available in this business unit, or has no active stage to receive the lead' });
    }

    const connection = await pool.getConnection();
    let moved = false;
    try {
        await connection.beginTransaction();
        const [result] = await connection.execute(`UPDATE crm_leads SET owner_employee_id=?,owner_assigned_at_utc=CURRENT_TIMESTAMP(6),referred_to_branch_id=?,referred_to_branch_name=?,referred_at_utc=CURRENT_TIMESTAMP(6),referred_by_employee_id=?,updated_by_user_id=? WHERE id=? AND deleted_at_utc IS NULL`, [employeeId, branchId, counsellor.branchName, Number(req.user.employeeId) || null, Number(req.user.id), leadId]);
        if (!result.affectedRows) { await connection.rollback(); return res.status(404).json({ message: 'Lead not found' }); }
        if (entry) moved = await moveLeadToPipeline(connection, leadId, entry, Number(req.user.id));
        await connection.execute(`UPDATE crm_followups SET assigned_employee_id=? WHERE lead_id=? AND LOWER(status) IN ('p','pending')`, [employeeId, leadId]);
        const where = `${counsellor.name} · ${counsellor.branchName}${moved ? ` · ${entry.pipeline.displayName}` : ''}`;
        await connection.execute(`INSERT INTO crm_lead_activities (lead_id,activity_type,summary,actor_user_id) VALUES (?,'referred',?,?)`, [leadId, `Lead referred to ${where}`, Number(req.user.id)]);
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally { connection.release(); }

    const destination = `${counsellor.name} · ${counsellor.branchName}${moved ? ` · ${entry.pipeline.displayName}` : ''}`;
    await notifyEmployee(pool, { businessUnitId: Number(req.businessUnit.id), employeeId, actorUserId: Number(req.user.id), type: 'lead_referred', title: 'Lead referred to you', message: `Lead #${leadId} · ${counsellor.branchName}`, link: `/leads?lead=${leadId}`, entityType: 'lead', entityId: leadId });
    res.json({ message: `Lead referred to ${destination}` });
});

app.put('/api/leads/:id/mark-re-enquired', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
    const leadId = Number(req.params.id);
    const scope = leadScopedWhere(req.user);
    const [result] = await pool.execute(`UPDATE crm_leads AS l SET re_enquired_at_utc=CURRENT_TIMESTAMP(6),updated_by_user_id=? WHERE l.id=? AND l.deleted_at_utc IS NULL AND ${scope.sql}`, [Number(req.user.id), leadId, ...scope.params]);
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
    const [[stage]] = await pool.execute(`SELECT id, display_name FROM crm_lead_stages WHERE id=? AND business_unit_id=? LIMIT 1`, [stageId, Number(req.businessUnit.id)]);
    const [[substage]] = await pool.execute(`SELECT id, display_name FROM crm_lead_substages WHERE id=? AND stage_id=? LIMIT 1`, [substageId, stageId]);
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
    const [[stage]] = await pool.execute(`SELECT id, display_name FROM crm_lead_stages WHERE id=? AND business_unit_id=? LIMIT 1`, [stageId, Number(req.businessUnit.id)]);
    const [[substage]] = await pool.execute(`SELECT id, display_name FROM crm_lead_substages WHERE id=? AND stage_id=? LIMIT 1`, [substageId, stageId]);
    if (!stage || !substage) return res.status(400).json({ message: 'Invalid stage or sub-stage' });
    const placeholders = leadIds.map(() => '?').join(',');
    const scope = leadScopedWhere(req.user);
    const [accessible] = await pool.execute(
        `SELECT l.id,l.stage_id,l.substage_id,old_stage.display_name AS previousStage,
            old_substage.display_name AS previousSubstage
     FROM crm_leads l
     LEFT JOIN crm_lead_stages old_stage ON old_stage.id=l.stage_id
     LEFT JOIN crm_lead_substages old_substage ON old_substage.id=l.substage_id
     WHERE l.id IN (${placeholders}) AND l.deleted_at_utc IS NULL AND ${scope.sql}`,
        [...leadIds, ...scope.params],
    );
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
        await connection.execute(
            `INSERT INTO crm_bulk_operations
       (business_unit_id,operation_type,status,created_by_user_id,total_records,successful_records,failed_records,summary,details_json,completed_at_utc)
       VALUES (?,'stage_change',?,?,?,?,?,?,?,CURRENT_TIMESTAMP(6))`,
            [Number(req.businessUnit.id), failures.length ? 'partial' : 'completed', Number(req.user.id), leadIds.length, successCount, failures.length,
            `Changed to ${stage.display_name} / ${substage.display_name}`,
            JSON.stringify({
                stageId, stageName: stage.display_name, substageId, substageName: substage.display_name, leadIds, failures,
                transitions: accessible.map(lead => ({
                    leadId: Number(lead.id), fromStage: lead.previousStage || 'Unknown', fromSubstage: lead.previousSubstage || '—',
                    toStage: stage.display_name, toSubstage: substage.display_name,
                })),
            })],
        );
        await connection.commit();
        res.json({
            message: `${successCount} lead${successCount === 1 ? '' : 's'} updated${failures.length ? ` (${failures.length} failed)` : ''}`,
            successCount,
            failedCount: failures.length,
            failures: failures.length ? failures : undefined,
        });
    } catch (error) {
        await connection.rollback();
        try {
            await pool.execute(
                `INSERT INTO crm_bulk_operations
         (business_unit_id,operation_type,status,created_by_user_id,total_records,failed_records,summary,details_json,error_message,completed_at_utc)
         VALUES (?,'stage_change','failed',?,?,?,?,?,?,CURRENT_TIMESTAMP(6))`,
                [Number(req.businessUnit.id), Number(req.user.id), leadIds.length, leadIds.length, 'Bulk stage change failed', JSON.stringify({ stageId, substageId, leadIds }), String(error.message || error).slice(0, 1000)],
            );
        } catch (auditError) { console.warn('Bulk stage change audit failed:', auditError.message); }
        throw error;
    } finally {
        connection.release();
    }
});

app.get('/api/leads/referral-options/all', authenticate, requireCrmAccess, async (req, res) => {
    const [branches] = await pool.query(`SELECT id,branch_name AS name,short_name AS shortName FROM branches WHERE is_active=TRUE ORDER BY branch_name`);
    /*
     * Who may receive a referral: CRM users of THIS business unit.
     *
     * The list used to be every CRM user in the system, so a referral could
     * hand a lead to somebody who cannot open the unit it belongs to. Scoped
     * the same way the Business Units screen scopes its own people picker --
     * an explicit unit assignment, or an administrator role that spans units.
     */
    const [employees] = await pool.execute(
        `SELECT DISTINCT e.id,e.employee_name AS name,b.id AS branchId,b.branch_name AS branchName
     FROM employees e
     JOIN app_users u ON u.employee_id=e.id AND u.is_active=TRUE
     JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
     JOIN crm_user_branches cub ON cub.user_id=u.id
     JOIN branches b ON b.id=cub.branch_id AND b.is_active=TRUE
     LEFT JOIN crm_user_access_status cuas ON cuas.user_id=u.id
     LEFT JOIN crm_user_business_units ubu ON ubu.user_id=u.id AND ubu.business_unit_id=?
     WHERE e.status='Active' AND COALESCE(cuas.is_active,1)=1
       AND r.normalized_name IN ('CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR','SUPER_ADMIN')
       AND (ubu.user_id IS NOT NULL OR EXISTS(
             SELECT 1 FROM user_roles admin_role JOIN roles admin ON admin.id=admin_role.role_id
              WHERE admin_role.user_id=u.id AND admin.normalized_name IN ('CRM_ADMIN','SUPER_ADMIN')))
    ORDER BY b.branch_name,e.employee_name`,
        [Number(req.businessUnit.id)],
    );

    /* The unit's pipelines, so a referral can also move the lead onto another
       one. The screen only asks when there is more than one to choose. */
    const [pipelines] = await pool.execute(
        `SELECT p.id, p.display_name AS displayName, p.is_default AS isDefault,
                (SELECT COUNT(*) FROM crm_lead_stages s WHERE s.pipeline_id=p.id AND s.is_active=TRUE) AS stageCount
           FROM crm_lead_pipelines p
          WHERE p.business_unit_id=? AND p.is_active=TRUE
          ORDER BY p.position, p.display_name`,
        [Number(req.businessUnit.id)],
    );
    const [[currentEmployee]] = req.user.employeeId
        ? await pool.execute(`SELECT branch_id AS branchId FROM employees WHERE id=? LIMIT 1`, [Number(req.user.employeeId)])
        : [[]];
    res.json({
        branches,
        employees,
        // A pipeline with no active stage cannot receive a lead, so it is not offered.
        pipelines: pipelines.filter(pipeline => Number(pipeline.stageCount) > 0),
        currentEmployeeId: req.user.employeeId || null,
        currentBranchId: currentEmployee?.branchId || null,
    });
});

app.delete('/api/leads/:id', authenticate, requireCrmAccess, requireLeadDelete, async (req, res) => {
    const scope = leadScopedWhere(req.user);
    const [result] = await pool.execute(`UPDATE crm_leads l SET deleted_at_utc = CURRENT_TIMESTAMP(6), updated_by_user_id = ? WHERE l.id = ? AND l.deleted_at_utc IS NULL AND ${scope.sql}`, [Number(req.user.id), Number(req.params.id), ...scope.params]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Lead not found' });
    res.json({ message: 'Lead removed successfully' });
});

const assignableCrmRoles = ['CRM_ADMIN', 'ADMISSION_MANAGER', 'COUNSELLOR', 'CRM_VIEWER'];

app.get('/api/admin/users/meta', authenticate, requireUserAdmin, async (req, res) => {
    /*
     * Only what this administrator may actually grant.
     *
     * These lists fill the branch and business-unit pickers. They used to
     * offer every branch on the grounds that requireUserAdmin was check
     * enough, but the save path has always rejected branches outside the
     * administrator's own -- so the extra entries could be picked and never
     * saved. Offering exactly what will be accepted removes that dead end and
     * stops the picker from disclosing the shape of the rest of the business.
     */
    const grantableBranches = assignableBranchIds(req.user);
    const grantableUnits = await assignableBusinessUnitIds(req.user);
    const [branches] = await pool.query(
        `SELECT b.id, b.branch_name AS name, b.short_name AS shortName
     FROM branches b WHERE b.is_active = TRUE
     ${grantableBranches ? `AND b.id IN (${grantableBranches.map(() => '?').join(',')})` : ''}
     ORDER BY b.branch_name`,
        grantableBranches || [],
    );
    const [businessUnits] = await pool.query(
        `SELECT id, display_name AS name FROM crm_business_units
      WHERE is_active = TRUE
      ${grantableUnits ? `AND id IN (${grantableUnits.map(() => '?').join(',')})` : ''}
      ORDER BY is_default DESC, display_name`,
        grantableUnits || [],
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
    res.json({ branches, businessUnits, employees, roles });
});

app.get('/api/admin/users', authenticate, requireUserAdmin, async (req, res) => {
    /*
     * Only the users this administrator may administer. Listing everyone
     * exposed the names, emails and branch assignments of staff in business
     * units the viewer has no part in, and every row carried edit controls
     * the save path would then refuse.
     */
    const visibleBranches = assignableBranchIds(req.user);
    const visibleUnits = await assignableBusinessUnitIds(req.user);
    const scopeParams = [];
    let scopeSql = '';
    if (visibleBranches || visibleUnits) {
        const clauses = [];
        // Somebody with nothing assigned yet is visible to any administrator;
        // otherwise they must overlap on whichever axis binds the viewer.
        if (visibleBranches) {
            clauses.push(`(NOT EXISTS (SELECT 1 FROM crm_user_branches sb WHERE sb.user_id = u.id)
                OR EXISTS (SELECT 1 FROM crm_user_branches sb WHERE sb.user_id = u.id
                           AND sb.branch_id IN (${visibleBranches.map(() => '?').join(',')})))`);
            scopeParams.push(...visibleBranches);
        }
        if (visibleUnits) {
            clauses.push(`(NOT EXISTS (SELECT 1 FROM crm_user_business_units su WHERE su.user_id = u.id)
                OR EXISTS (SELECT 1 FROM crm_user_business_units su WHERE su.user_id = u.id
                           AND su.business_unit_id IN (${visibleUnits.map(() => '?').join(',')})))`);
            scopeParams.push(...visibleUnits);
        }
        scopeSql = ` AND ${clauses.join(' AND ')}`;
    }
    const [rows] = await pool.query(
        `SELECT u.id, u.employee_id AS employeeId, u.email, u.is_active AS attendanceActive, COALESCE(cuas.is_active,1) AS isActive,
            COALESCE(e.employee_name,CONCAT_WS(' ',p.first_name,p.last_name),u.email) AS name,
            p.first_name AS firstName,p.last_name AS lastName,p.phone,e.employee_number AS employeeNumber,
            -- Matched against the actual CRM role set, not a 'CRM_' name
            -- prefix: COUNSELLOR and ADMISSION_MANAGER do not carry that
            -- prefix, so the prefix test reported every counsellor and
            -- admission manager as having no CRM role at all.
            GROUP_CONCAT(DISTINCT CASE WHEN r.normalized_name IN
              ('CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR','CRM_VIEWER','SUPER_ADMIN')
              THEN r.normalized_name END ORDER BY r.normalized_name) AS crmRoles,
            GROUP_CONCAT(DISTINCT cub.branch_id ORDER BY cub.branch_id) AS branchIds,
            (SELECT GROUP_CONCAT(ubu.business_unit_id ORDER BY ubu.is_default DESC, ubu.business_unit_id)
               FROM crm_user_business_units ubu WHERE ubu.user_id = u.id) AS businessUnitIds,
            GROUP_CONCAT(DISTINCT b.branch_name ORDER BY b.branch_name SEPARATOR ', ') AS branchNames,
            u.callerdesk_member_id AS callerdeskMemberId,u.callerdesk_member_name AS callerdeskMemberName,
            u.callerdesk_member_number AS callerdeskMemberNumber,u.callerdesk_call_group AS callerdeskCallGroup,
            u.callerdesk_enabled AS callerdeskEnabled,
            u.smartflo_user_id AS smartfloUserId,u.smartflo_agent_id AS smartfloAgentId,u.smartflo_agent_name AS smartfloAgentName,
            u.smartflo_agent_number AS smartfloAgentNumber,u.smartflo_department_id AS smartfloDepartmentId,u.smartflo_enabled AS smartfloEnabled,
            u.last_login_at_utc AS lastLoginAt
     FROM app_users u
     LEFT JOIN employees e ON e.id = u.employee_id
     LEFT JOIN crm_user_profiles p ON p.user_id=u.id
     LEFT JOIN crm_user_access_status cuas ON cuas.user_id=u.id
     JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     LEFT JOIN crm_user_branches cub ON cub.user_id = u.id LEFT JOIN branches b ON b.id = cub.branch_id
     WHERE r.normalized_name IN ('CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR','CRM_VIEWER','SUPER_ADMIN')
           ${scopeSql}
     GROUP BY u.id, u.employee_id, u.email, u.is_active, cuas.is_active, e.employee_name,p.first_name,p.last_name,p.phone,e.employee_number,
              u.callerdesk_member_id,u.callerdesk_member_name,u.callerdesk_member_number,u.callerdesk_call_group,u.callerdesk_enabled,
              u.smartflo_user_id,u.smartflo_agent_id,u.smartflo_agent_name,u.smartflo_agent_number,u.smartflo_department_id,u.smartflo_enabled,u.last_login_at_utc
     ORDER BY name`,
        scopeParams,
    );
    res.json({
        data: rows.map((row) => ({
            ...row, id: Number(row.id), employeeId: row.employeeId ? Number(row.employeeId) : null,
            isActive: Boolean(row.isActive), callerdeskEnabled: Boolean(row.callerdeskEnabled), smartfloEnabled: Boolean(row.smartfloEnabled),
            // A user holding only Attendance roles genuinely has no CRM role; saying
            // so is more useful than reporting the other application's ADMIN here.
            roles: row.crmRoles ? row.crmRoles.split(',') : [],
            branchIds: row.branchIds ? row.branchIds.split(',').map(Number) : [],
            businessUnitIds: row.businessUnitIds ? String(row.businessUnitIds).split(',').map(Number) : []
        }))
    });
});

async function saveCrmUser(req, res, existingUserId = null) {
    const employeeId = Number(req.body.employeeId);
    const userType = req.body.userType === 'external' ? 'external' : 'employee';
    const externalUser = userType === 'external';
    const firstName = String(req.body.firstName || '').trim().slice(0, 100);
    const lastName = String(req.body.lastName || '').trim().slice(0, 100);
    const phone = String(req.body.phone || '').replace(/[^0-9+()\-\s]/g, '').trim().slice(0, 30);
    const roleName = String(req.body.roleName || '').toUpperCase();
    const branchIds = [...new Set((req.body.branchIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    // Which business units this user may work in. Empty means "leave as is" for
    // an existing user and "the default unit" for a new one, so an administrator
    // who never opens the section cannot accidentally strip access.
    const businessUnitIds = [...new Set((req.body.businessUnitIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '');
    const callerdeskEnabled = Boolean(req.body.callerdeskEnabled);
    const callerdeskMemberId = cleanOptional(req.body.callerdeskMemberId, 100);
    const callerdeskMemberName = cleanOptional(req.body.callerdeskMemberName, 150);
    const callerdeskMemberNumber = String(req.body.callerdeskMemberNumber || '').replace(/\D/g, '').slice(-15) || null;
    const callerdeskCallGroup = cleanOptional(req.body.callerdeskCallGroup, 120);
    const smartfloEnabled = Boolean(req.body.smartfloEnabled), smartfloUserId = cleanOptional(req.body.smartfloUserId, 100), smartfloAgentId = cleanOptional(req.body.smartfloAgentId, 100), smartfloAgentName = cleanOptional(req.body.smartfloAgentName, 150), smartfloAgentNumber = cleanOptional(req.body.smartfloAgentNumber, 30), smartfloDepartmentId = cleanOptional(req.body.smartfloDepartmentId, 100);
    if (!externalUser && (!Number.isInteger(employeeId) || employeeId <= 0)) return res.status(400).json({ message: 'Select an employee' });
    if (externalUser && (!firstName || !lastName)) return res.status(400).json({ message: 'First name and last name are required' });
    if (externalUser && phone && !/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number' });
    if (externalUser && (!email || !/^\S+@\S+\.\S+$/.test(email))) return res.status(400).json({ message: 'Enter a valid login email' });
    if (!assignableCrmRoles.includes(roleName)) return res.status(400).json({ message: 'Select a valid CRM role' });
    if (!branchIds.length) return res.status(400).json({ message: 'Select at least one CRM branch' });
    if (callerdeskEnabled && (!callerdeskMemberId || !callerdeskMemberNumber)) return res.status(400).json({ message: 'Select a CallerDesk member for one-click calling' });
    if (smartfloEnabled && !smartfloAgentId) return res.status(400).json({ message: 'Select a Smartflo agent for one-click calling' });
    for (const branchId of branchIds) {
        if (!(await accessibleBranch(req.user, branchId))) return res.status(403).json({ message: 'You cannot assign one or more selected branches' });
    }
    /*
     * Business units were applied unchecked while branches were validated, so
     * an administrator confined to one unit could still hand out every other
     * one -- the wider half of the same escalation the branch check closes.
     */
    const grantableUnits = await assignableBusinessUnitIds(req.user);
    if (grantableUnits) {
        const outOfScope = businessUnitIds.filter((id) => !grantableUnits.includes(id));
        if (outOfScope.length) {
            return res.status(403).json({ message: 'You cannot assign one or more selected business units' });
        }
    }
    // Editing an existing user must respect the same boundary, or access could
    // be taken from someone the administrator has no authority over.
    if (existingUserId && !(await administersUser(req.user, existingUserId))) {
        return res.status(403).json({ message: 'This user belongs to a business unit or branch you do not administer' });
    }
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        let employeeRows = [];
        let userRows = [];
        if (externalUser) {
            if (existingUserId) [userRows] = await connection.execute(`SELECT id,email,is_active AS isActive,employee_id AS employeeId FROM app_users WHERE id=? LIMIT 1`, [Number(existingUserId)]);
        } else {
            [employeeRows] = await connection.execute(`SELECT id, email FROM employees WHERE id = ? AND status = 'Active' LIMIT 1`, [employeeId]);
            if (!employeeRows.length) { await connection.rollback(); return res.status(404).json({ message: 'Active employee not found' }); }
            [userRows] = await connection.execute(`SELECT id, email, is_active AS isActive FROM app_users WHERE employee_id = ? LIMIT 1`, [employeeId]);
        }
        let user = userRows[0];
        if (existingUserId && (!user || Number(user.id) !== Number(existingUserId))) { await connection.rollback(); return res.status(409).json({ message: externalUser ? 'External account does not match this CRM user' : 'Employee account does not match this CRM user' }); }
        if (externalUser && user?.employeeId) { await connection.rollback(); return res.status(409).json({ message: 'An employee-linked account cannot be converted to an external user' }); }
        if (!user) {
            const loginEmail = email || employeeRows[0]?.email;
            if (!loginEmail || !/^\S+@\S+\.\S+$/.test(loginEmail)) { await connection.rollback(); return res.status(400).json({ message: 'A valid login email is required for a new account' }); }
            if (password.length < 8) { await connection.rollback(); return res.status(400).json({ message: 'New accounts require a password of at least 8 characters' }); }
            const [result] = await connection.execute(
                `INSERT INTO app_users (employee_id, email, normalized_email, password_hash, security_stamp, is_active, created_at_utc)
         VALUES (?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP(6))`,
                [externalUser ? null : employeeId, loginEmail, loginEmail.toUpperCase(), hashAttendancePassword(password), crypto.randomUUID()],
            );
            user = { id: result.insertId, email: loginEmail, isActive: true };
        } else if (!user.isActive) {
            await connection.rollback(); return res.status(409).json({ message: 'The existing Attendance login is inactive. Reactivate it in Attendance before granting CRM access.' });
        }
        if (password) {
            if (password.length < 8) { await connection.rollback(); return res.status(400).json({ message: 'Password must contain at least 8 characters' }); }
            await connection.execute(`UPDATE app_users SET password_hash = ?, security_stamp = ?, failed_login_count = 0, lockout_end_utc = NULL, updated_at_utc = CURRENT_TIMESTAMP(6) WHERE id = ?`, [hashAttendancePassword(password), crypto.randomUUID(), user.id]);
        }
        if (externalUser) {
            await connection.execute(
                `INSERT INTO crm_user_profiles(user_id,first_name,last_name,phone)
         VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE first_name=VALUES(first_name),last_name=VALUES(last_name),phone=VALUES(phone)`,
                [Number(user.id), firstName, lastName, phone || null],
            );
        }
        await connection.execute(
            `DELETE ur FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ? AND r.normalized_name IN ('CRM_ADMIN','ADMISSION_MANAGER','COUNSELLOR','CRM_VIEWER')`, [user.id],
        );
        await connection.execute(
            `INSERT INTO user_roles (user_id, role_id, created_at_utc)
       SELECT ?, id, CURRENT_TIMESTAMP(6) FROM roles WHERE normalized_name = ?`, [user.id, roleName],
        );
        if (businessUnitIds.length) {
            // Replaced wholesale so unticking a unit actually removes it. The first
            // one stays the default, which is what the shell opens on.
            await connection.execute(`DELETE FROM crm_user_business_units WHERE user_id = ?`, [user.id]);
            for (const [index, unitId] of businessUnitIds.entries()) {
                await connection.execute(
                    `INSERT INTO crm_user_business_units (user_id, business_unit_id, access_level, is_default) VALUES (?,?,?,?)`,
                    [user.id, unitId, 'contribute', index === 0 ? 1 : 0],
                );
            }
        }
        await connection.execute(`DELETE FROM crm_user_branches WHERE user_id = ?`, [user.id]);
        for (const branchId of branchIds) {
            await connection.execute(`INSERT INTO crm_user_branches (user_id, branch_id, created_by_user_id) VALUES (?, ?, ?)`, [user.id, branchId, Number(req.user.id)]);
        }
        await connection.execute(`INSERT INTO crm_user_access_status(user_id,is_active,updated_by_user_id) VALUES(?,?,?) ON DUPLICATE KEY UPDATE is_active=VALUES(is_active),updated_by_user_id=VALUES(updated_by_user_id)`, [user.id, req.body.isActive === false ? 0 : 1, Number(req.user.id)]);
        await connection.execute(`UPDATE app_users SET callerdesk_member_id=?,callerdesk_member_name=?,callerdesk_member_number=?,callerdesk_call_group=?,callerdesk_enabled=? WHERE id=?`,
            [callerdeskEnabled ? callerdeskMemberId : null, callerdeskEnabled ? callerdeskMemberName : null, callerdeskEnabled ? callerdeskMemberNumber : null, callerdeskEnabled ? callerdeskCallGroup : null, callerdeskEnabled ? 1 : 0, user.id]);
        await connection.execute(`UPDATE app_users SET smartflo_user_id=?,smartflo_agent_id=?,smartflo_agent_name=?,smartflo_agent_number=?,smartflo_department_id=?,smartflo_enabled=? WHERE id=?`, [smartfloEnabled ? smartfloUserId : null, smartfloEnabled ? smartfloAgentId : null, smartfloEnabled ? smartfloAgentName : null, smartfloEnabled ? smartfloAgentNumber : null, smartfloEnabled ? smartfloDepartmentId : null, smartfloEnabled ? 1 : 0, user.id]);
        await connection.commit();
        res.status(existingUserId ? 200 : 201).json({ id: Number(user.id), message: existingUserId ? 'CRM user updated successfully' : 'CRM user added successfully' });
    } catch (error) {
        await connection.rollback();
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'That email address is already used by another account' });
        if (error.code === 'ER_BAD_FIELD_ERROR') return res.status(400).json({ message: 'Run database migrations 051_callerdesk_calling.sql and 052_smartflo_telephony.sql before mapping calling users' });
        throw error;
    } finally { connection.release(); }
}

app.post('/api/admin/users', authenticate, requireUserAdmin, (req, res) => saveCrmUser(req, res));
app.put('/api/admin/users/:id', authenticate, requireUserAdmin, (req, res) => saveCrmUser(req, res, Number(req.params.id)));

app.put('/api/admin/users/:id/status', authenticate, requireUserAdmin, async (req, res) => {
    const userId = Number(req.params.id); if (userId === Number(req.user.id) && req.body.isActive === false) return res.status(400).json({ message: 'You cannot deactivate your own CRM access' });
    if (!(await administersUser(req.user, userId))) return res.status(403).json({ message: 'This user belongs to a business unit or branch you do not administer' });
    await pool.execute(`INSERT INTO crm_user_access_status(user_id,is_active,updated_by_user_id) VALUES(?,?,?) ON DUPLICATE KEY UPDATE is_active=VALUES(is_active),updated_by_user_id=VALUES(updated_by_user_id)`, [userId, req.body.isActive ? 1 : 0, Number(req.user.id)]);
    res.json({ message: `CRM user marked ${req.body.isActive ? 'active' : 'inactive'}` });
});

app.delete('/api/admin/users/:id/access', authenticate, requireUserAdmin, async (req, res) => {
    const userId = Number(req.params.id);
    if (userId === Number(req.user.id)) return res.status(400).json({ message: 'You cannot remove your own CRM access' });
    if (!(await administersUser(req.user, userId))) return res.status(403).json({ message: 'This user belongs to a business unit or branch you do not administer' });
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
    stages: { table: 'crm_lead_stages', label: 'Stage' },
    substages: { table: 'crm_lead_substages', label: 'Sub-stage' },
    sources: { table: 'crm_lead_sources', label: 'Source' },
    campaignCategories: { table: 'crm_campaign_categories', label: 'Campaign category' },
    campaigns: { table: 'crm_campaigns', label: 'Campaign' },
    channelCategories: { table: 'crm_channel_categories', label: 'Channel category' },
    channels: { table: 'crm_lead_channels', label: 'Channel' },
};
function configCode(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 70); }

app.get('/api/admin/lead-config', authenticate, requireUserAdmin, async (_req, res) => {
    const [stages] = await pool.query(`SELECT id,name code,display_name displayName,position,is_active isActive,requires_followup requiresFollowup FROM crm_lead_stages ORDER BY position,display_name`);
    const [substages] = await pool.query(`SELECT ss.id,ss.substage_code code,ss.display_name displayName,ss.stage_id parentId,s.display_name parentName,ss.position,ss.is_active isActive FROM crm_lead_substages ss JOIN crm_lead_stages s ON s.id=ss.stage_id ORDER BY s.position,ss.position,ss.display_name`);
    const [sources] = await pool.query(`
    SELECT s.id,s.name code,s.display_name displayName,s.channel_id parentId,
           ch.display_name parentName,s.is_active isActive
    FROM crm_lead_sources s
    LEFT JOIN crm_lead_channels ch ON ch.id=s.channel_id
    ORDER BY s.display_name
  `);
    const [campaignCategories] = await pool.query(`SELECT id,category_code code,display_name displayName,is_active isActive FROM crm_campaign_categories ORDER BY display_name`);
    const [campaigns] = await pool.query(`SELECT c.id,c.campaign_code code,c.display_name displayName,c.category_id parentId,COALESCE(cc.display_name,c.category) parentName,c.is_active isActive FROM crm_campaigns c LEFT JOIN crm_campaign_categories cc ON cc.id=c.category_id ORDER BY parentName,c.display_name`);
    const [channelCategories] = await pool.query(`SELECT id,category_code code,display_name displayName,is_active isActive FROM crm_channel_categories ORDER BY display_name`);
    const [channels] = await pool.query(`SELECT c.id,c.channel_code code,c.display_name displayName,c.category_id parentId,COALESCE(cc.display_name,c.category) parentName,c.is_active isActive FROM crm_lead_channels c LEFT JOIN crm_channel_categories cc ON cc.id=c.category_id ORDER BY parentName,c.display_name`);
    res.json({ stages, substages, sources, campaignCategories, campaigns, channelCategories, channels });
});

app.post('/api/admin/lead-config/:type', authenticate, requireUserAdmin, async (req, res) => {
    const type = req.params.type; const definition = leadConfigTypes[type];
    if (!definition) return res.status(404).json({ message: 'Configuration type not found' });
    const displayName = cleanOptional(req.body.displayName, 150); const code = configCode(req.body.code || displayName);
    if (!displayName || !code) return res.status(400).json({ message: 'Name is required' });
    try {
        /* A stage always belongs to a pipeline. This older route pre-dates
           them, so it adds to the current unit's default pipeline and takes
           its position from that pipeline rather than from every stage in
           the table. */
        if (type === 'stages') {
            const [[pipeline]] = await pool.execute(
                `SELECT id FROM crm_lead_pipelines WHERE business_unit_id=? ORDER BY is_default DESC, position LIMIT 1`,
                [Number(req.businessUnit.id)]);
            if (!pipeline) return res.status(400).json({ message: 'This business unit has no lead pipeline yet' });
            await pool.execute(
                `INSERT INTO crm_lead_stages(business_unit_id,pipeline_id,name,display_name,position,color_code,requires_followup)
                 SELECT ?,?,?,?,COALESCE(MAX(position),0)+1,'#555AB1',? FROM crm_lead_stages WHERE pipeline_id=?`,
                [Number(req.businessUnit.id), pipeline.id, code, displayName, req.body.requiresFollowup ? 1 : 0, pipeline.id]);
        }
        else if (type === 'substages') await pool.execute(`INSERT INTO crm_lead_substages(stage_id,substage_code,display_name,position) SELECT ?,?,?,COALESCE(MAX(position),0)+1 FROM crm_lead_substages WHERE stage_id=?`, [Number(req.body.parentId), code, displayName, Number(req.body.parentId)]);
        else if (type === 'sources') {
            const [[channel]] = await pool.execute(`SELECT id FROM crm_lead_channels WHERE id=?`, [Number(req.body.parentId)]);
            if (!channel) return res.status(400).json({ message: 'Channel is required' });
            await pool.execute(`INSERT INTO crm_lead_sources(name,display_name,channel_id) VALUES(?,?,?)`, [code, displayName, channel.id]);
        }
        else if (type === 'campaignCategories') await pool.execute(`INSERT INTO crm_campaign_categories(category_code,display_name) VALUES(?,?)`, [code, displayName]);
        else if (type === 'campaigns') { const [[category]] = await pool.execute(`SELECT id,display_name FROM crm_campaign_categories WHERE id=?`, [Number(req.body.parentId)]); if (!category) return res.status(400).json({ message: 'Campaign category is required' }); await pool.execute(`INSERT INTO crm_campaigns(campaign_code,display_name,category,category_id) VALUES(?,?,?,?)`, [code, displayName, category.display_name, category.id]); }
        else if (type === 'channelCategories') await pool.execute(`INSERT INTO crm_channel_categories(category_code,display_name) VALUES(?,?)`, [code, displayName]);
        else if (type === 'channels') { const [[category]] = await pool.execute(`SELECT id,display_name FROM crm_channel_categories WHERE id=?`, [Number(req.body.parentId)]); if (!category) return res.status(400).json({ message: 'Channel category is required' }); await pool.execute(`INSERT INTO crm_lead_channels(channel_code,display_name,category,category_id) VALUES(?,?,?,?)`, [code, displayName, category.display_name, category.id]); }
        res.status(201).json({ message: `${definition.label} added successfully` });
    } catch (error) { if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: `A ${definition.label.toLowerCase()} with this name already exists` }); throw error; }
});

app.put('/api/admin/lead-config/:type/:id', authenticate, requireUserAdmin, async (req, res) => {
    const type = req.params.type; const definition = leadConfigTypes[type]; const id = Number(req.params.id);
    if (!definition) return res.status(404).json({ message: 'Configuration type not found' });
    const displayName = cleanOptional(req.body.displayName, 150); if (!displayName) return res.status(400).json({ message: 'Name is required' });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        let result;
        if (type === 'stages') [result] = await connection.execute(`UPDATE crm_lead_stages SET display_name=?,requires_followup=? WHERE id=?`, [displayName, req.body.requiresFollowup ? 1 : 0, id]);
        else if (type === 'substages') [result] = await connection.execute(`UPDATE crm_lead_substages SET display_name=?,stage_id=? WHERE id=?`, [displayName, Number(req.body.parentId), id]);
        else if (type === 'sources') {
            const [[channel]] = await connection.execute(`SELECT id FROM crm_lead_channels WHERE id=?`, [Number(req.body.parentId)]);
            if (!channel) { await connection.rollback(); return res.status(400).json({ message: 'Channel is required' }); }
            [result] = await connection.execute(`UPDATE crm_lead_sources SET display_name=?,channel_id=? WHERE id=?`, [displayName, channel.id, id]);
        }
        else if (type === 'campaignCategories') { [result] = await connection.execute(`UPDATE crm_campaign_categories SET display_name=? WHERE id=?`, [displayName, id]); await connection.execute(`UPDATE crm_campaigns SET category=? WHERE category_id=?`, [displayName, id]); }
        else if (type === 'campaigns') { const [[category]] = await connection.execute(`SELECT id,display_name FROM crm_campaign_categories WHERE id=?`, [Number(req.body.parentId)]); if (!category) { await connection.rollback(); return res.status(400).json({ message: 'Campaign category is required' }); } [result] = await connection.execute(`UPDATE crm_campaigns SET display_name=?,category=?,category_id=? WHERE id=?`, [displayName, category.display_name, category.id, id]); }
        else if (type === 'channelCategories') { [result] = await connection.execute(`UPDATE crm_channel_categories SET display_name=? WHERE id=?`, [displayName, id]); await connection.execute(`UPDATE crm_lead_channels SET category=? WHERE category_id=?`, [displayName, id]); }
        else if (type === 'channels') { const [[category]] = await connection.execute(`SELECT id,display_name FROM crm_channel_categories WHERE id=?`, [Number(req.body.parentId)]); if (!category) { await connection.rollback(); return res.status(400).json({ message: 'Channel category is required' }); } [result] = await connection.execute(`UPDATE crm_lead_channels SET display_name=?,category=?,category_id=? WHERE id=?`, [displayName, category.display_name, category.id, id]); }
        if (!result?.affectedRows) { await connection.rollback(); return res.status(404).json({ message: `${definition.label} not found` }); }
        await connection.commit(); res.json({ message: `${definition.label} updated successfully` });
    } catch (error) { await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: `A ${definition.label.toLowerCase()} with this name already exists` }); throw error; } finally { connection.release(); }
});

app.put('/api/admin/lead-config/:type/:id/status', authenticate, requireUserAdmin, async (req, res) => {
    const definition = leadConfigTypes[req.params.type]; if (!definition) return res.status(404).json({ message: 'Configuration type not found' });
    const [result] = await pool.execute(`UPDATE ${definition.table} SET is_active=? WHERE id=?`, [req.body.isActive ? 1 : 0, Number(req.params.id)]);
    if (!result.affectedRows) return res.status(404).json({ message: `${definition.label} not found` });
    res.json({ message: `${definition.label} marked ${req.body.isActive ? 'active' : 'inactive'}` });
});

app.delete('/api/admin/lead-config/:type/:id', authenticate, requireUserAdmin, async (req, res) => {
    const type = req.params.type, definition = leadConfigTypes[type], id = Number(req.params.id);
    if (!definition) return res.status(404).json({ message: 'Configuration type not found' });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        let linked = 0;
        if (type === 'sources') {
            const [[usage]] = await connection.execute(
                `SELECT (SELECT COUNT(*) FROM crm_leads WHERE source_id=?)+(SELECT COUNT(*) FROM crm_lead_source_history WHERE source_id=?) AS count`, [id, id],
            ); linked = Number(usage.count);
        } else if (type === 'campaigns') {
            const [[usage]] = await connection.execute(
                `SELECT (SELECT COUNT(*) FROM crm_leads WHERE campaign_id=?)+(SELECT COUNT(*) FROM crm_lead_source_history WHERE campaign_id=?) AS count`, [id, id],
            ); linked = Number(usage.count);
        } else if (type === 'channels') {
            const [[usage]] = await connection.execute(
                `SELECT
          (SELECT COUNT(*) FROM crm_leads WHERE channel_id=?)
          +(SELECT COUNT(*) FROM crm_lead_source_history WHERE channel_id=?)
          +(SELECT COUNT(*) FROM crm_leads l JOIN crm_lead_sources s ON s.id=l.source_id WHERE s.channel_id=?)
          +(SELECT COUNT(*) FROM crm_lead_source_history h JOIN crm_lead_sources s ON s.id=h.source_id WHERE s.channel_id=?) AS count`,
                [id, id, id, id],
            ); linked = Number(usage.count);
        } else if (type === 'channelCategories') {
            const [[usage]] = await connection.execute(
                `SELECT
          (SELECT COUNT(*) FROM crm_leads l JOIN crm_lead_channels c ON c.id=l.channel_id WHERE c.category_id=?)
          +(SELECT COUNT(*) FROM crm_lead_source_history h JOIN crm_lead_channels c ON c.id=h.channel_id WHERE c.category_id=?)
          +(SELECT COUNT(*) FROM crm_leads l JOIN crm_lead_sources s ON s.id=l.source_id JOIN crm_lead_channels c ON c.id=s.channel_id WHERE c.category_id=?)
          +(SELECT COUNT(*) FROM crm_lead_source_history h JOIN crm_lead_sources s ON s.id=h.source_id JOIN crm_lead_channels c ON c.id=s.channel_id WHERE c.category_id=?) AS count`,
                [id, id, id, id],
            ); linked = Number(usage.count);
        } else if (type === 'campaignCategories') {
            const [[usage]] = await connection.execute(
                `SELECT
          (SELECT COUNT(*) FROM crm_leads l JOIN crm_campaigns c ON c.id=l.campaign_id WHERE c.category_id=?)
          +(SELECT COUNT(*) FROM crm_lead_source_history h JOIN crm_campaigns c ON c.id=h.campaign_id WHERE c.category_id=?) AS count`,
                [id, id],
            ); linked = Number(usage.count);
        } else if (type === 'stages') {
            const [[usage]] = await connection.execute(`SELECT COUNT(*) AS count FROM crm_leads WHERE stage_id=?`, [id]); linked = Number(usage.count);
        } else if (type === 'substages') {
            const [[usage]] = await connection.execute(`SELECT COUNT(*) AS count FROM crm_leads WHERE substage_id=?`, [id]); linked = Number(usage.count);
        }
        if (linked) {
            await connection.rollback();
            return res.status(409).json({ message: `Cannot delete this ${definition.label.toLowerCase()} because ${linked} lead record${linked === 1 ? ' is' : 's are'} linked to it` });
        }
        if (type === 'channelCategories') {
            await connection.execute(`DELETE s FROM crm_lead_sources s JOIN crm_lead_channels c ON c.id=s.channel_id WHERE c.category_id=?`, [id]);
            await connection.execute(`DELETE FROM crm_lead_channels WHERE category_id=?`, [id]);
        } else if (type === 'channels') await connection.execute(`DELETE FROM crm_lead_sources WHERE channel_id=?`, [id]);
        else if (type === 'campaignCategories') await connection.execute(`DELETE FROM crm_campaigns WHERE category_id=?`, [id]);
        else if (type === 'stages') {
            const [[children]] = await connection.execute(`SELECT COUNT(*) AS count FROM crm_lead_substages WHERE stage_id=?`, [id]);
            if (Number(children.count)) { await connection.rollback(); return res.status(409).json({ message: 'Delete the sub-stages under this stage before deleting the stage' }); }
        }
        const [result] = await connection.execute(`DELETE FROM ${definition.table} WHERE id=?`, [id]);
        if (!result.affectedRows) { await connection.rollback(); return res.status(404).json({ message: `${definition.label} not found` }); }
        await connection.commit();
        res.json({ message: `${definition.label} and its unused child configuration deleted successfully` });
    } catch (error) {
        await connection.rollback();
        if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ message: `This ${definition.label.toLowerCase()} is linked to application history and cannot be deleted` });
        throw error;
    } finally { connection.release(); }
});

app.get('/api/saved-filters', authenticate, requireCrmAccess, async (req, res) => {
    const [rows] = await pool.execute(
        `SELECT id, name, filter_type AS type, filters_json AS filters, created_at_utc AS createdAt
     FROM crm_saved_filters
     WHERE business_unit_id = ? AND user_id = ?
     ORDER BY updated_at_utc DESC, created_at_utc DESC`,
        [Number(req.businessUnit.id), Number(req.user.id)],
    );
    res.json({ data: rows.map(row => ({ ...row, id: Number(row.id), filters: typeof row.filters === 'string' ? JSON.parse(row.filters) : row.filters })) });
});

app.post('/api/saved-filters', authenticate, requireCrmAccess, async (req, res) => {
    const name = cleanOptional(req.body.name, 150);
    const type = req.body.type === 'funnel' ? 'funnel' : 'filter';
    const filters = req.body.filters && typeof req.body.filters === 'object' ? req.body.filters : {};
    if (!name) return res.status(400).json({ message: 'Enter a name for this saved filter' });
    await pool.execute(
        `INSERT INTO crm_saved_filters (business_unit_id, user_id, name, filter_type, filters_json)
     VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE filter_type = VALUES(filter_type), filters_json = VALUES(filters_json), updated_at_utc = CURRENT_TIMESTAMP(6)`,
        [Number(req.businessUnit.id), Number(req.user.id), name, type, JSON.stringify(filters)],
    );
    res.status(201).json({ message: `${type === 'funnel' ? 'View' : 'Filter'} saved successfully` });
});

app.delete('/api/saved-filters/:id', authenticate, requireCrmAccess, async (req, res) => {
    const [result] = await pool.execute(
        `DELETE FROM crm_saved_filters WHERE id = ? AND business_unit_id = ? AND user_id = ?`,
        [Number(req.params.id), Number(req.businessUnit.id), Number(req.user.id)],
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Saved filter not found' });
    res.json({ message: 'Saved filter removed' });
});

app.get('/api/automations', authenticate, requireCrmAccess, async (req, res) => {
    const [rows] = await pool.execute(`
    SELECT w.id,w.name,w.category,w.start_at AS startAt,
           w.definition_json AS definition,w.is_active AS isActive,
           w.created_at_utc AS createdAt,COALESCE(e.employee_name,u.email) AS createdBy,
           x.lastRunAt,x.lastStatus,x.completedCount,x.failedCount,x.skippedCount,
           COALESCE(q.pendingCount,0) AS pendingCount
    FROM crm_automation_workflows w
    JOIN app_users u ON u.id=w.created_by
    LEFT JOIN employees e ON e.id=u.employee_id
    -- Run totals come from the append-only log. Reading them from
    -- crm_automation_executions reported 0 for any workflow whose rules had
    -- been edited, because that queue is cleared on every rule change.
    LEFT JOIN (
      SELECT workflow_id,MAX(executed_at_utc) AS lastRunAt,
             SUBSTRING_INDEX(GROUP_CONCAT(status ORDER BY executed_at_utc DESC, id DESC), ',', 1) AS lastStatus,
             SUM(status='completed') AS completedCount,
             SUM(status='failed') AS failedCount,
             SUM(status='skipped') AS skippedCount
      FROM crm_automation_execution_log GROUP BY workflow_id
    ) x ON x.workflow_id=w.id
    -- Still queued work only exists in the live queue.
    LEFT JOIN (
      SELECT workflow_id,SUM(status IN ('pending','running')) AS pendingCount
      FROM crm_automation_executions GROUP BY workflow_id
    ) q ON q.workflow_id=w.id
    WHERE w.business_unit_id=?
    ORDER BY w.created_at_utc DESC`, [Number(req.businessUnit.id)]);
    res.json({ data: rows.map(row => ({ ...row, id: Number(row.id), isActive: Boolean(row.isActive), completedCount: Number(row.completedCount || 0), failedCount: Number(row.failedCount || 0), skippedCount: Number(row.skippedCount || 0), pendingCount: Number(row.pendingCount || 0), definition: typeof row.definition === 'string' ? JSON.parse(row.definition) : row.definition })) });
});

async function validateAutomationDefinition(definition, organizationId) {
    const actions = Array.isArray(definition?.actions) ? definition.actions : [];
    if (!actions.length) throw Object.assign(new Error('Add at least one THEN action'), { status: 400 });
    for (const action of actions) {
        if (action.type === 'update') {
            if (!['stage', 'substage', 'owner', 'score'].includes(action.field) || action.value === '' || action.value === null || action.value === undefined) {
                throw Object.assign(new Error('Select a field and value for every update action'), { status: 400 });
            }
            continue;
        }
        if (action.type === 'whatsapp') {
            const integrationId = Number(action.integrationId);
            const templateId = Number(action.templateId);
            if (!integrationId || !templateId) {
                throw Object.assign(new Error('Select a WhatsApp account and approved template'), { status: 400 });
            }
            const [[template]] = await pool.execute(
                `SELECT t.id,t.template_name,t.body,t.language,t.status
         FROM crm_whatsapp_templates t
         JOIN crm_integrations i ON i.id=t.integration_id
         WHERE t.id=? AND t.integration_id=? AND t.organization_id=?
           AND i.organization_id=? AND i.deleted_at IS NULL
           AND t.deleted_at IS NULL AND UPPER(t.status)='APPROVED'
         LIMIT 1`,
                [templateId, integrationId, organizationId, organizationId],
            );
            if (!template) {
                throw Object.assign(new Error('The selected WhatsApp template is unavailable for this account'), { status: 400 });
            }
            action.templateName = template.template_name;
            action.templateBody = template.body;
            action.templateLanguage = template.language || 'en';
            const parameterCount = Math.max(
                0,
                ...[...String(template.body || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1])),
            );
            const parameters = Array.isArray(action.templateParams) ? action.templateParams : [];
            if (parameters.length < parameterCount || parameters.slice(0, parameterCount).some((value) => !String(value || '').trim())) {
                throw Object.assign(new Error(`Enter all ${parameterCount} fixed template parameter value(s)`), { status: 400 });
            }
            action.templateParams = parameters.slice(0, parameterCount).map((value) => String(value).trim());
            continue;
        }
        throw Object.assign(new Error(`${action.type || 'Selected'} automation actions are not configured`), { status: 400 });
    }
    return definition;
}

function stableAutomationJson(value) {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableAutomationJson(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) =>
            `${JSON.stringify(key)}:${stableAutomationJson(value[key])}`
        ).join(',')}}`;
    }
    return JSON.stringify(value);
}

app.post('/api/automations', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
    const name = cleanOptional(req.body.name, 180); const category = cleanOptional(req.body.category, 40); const definition = req.body.definition && typeof req.body.definition === 'object' ? req.body.definition : {};
    if (!name || !category) return res.status(400).json({ message: 'Automation name and category are required' });
    await validateAutomationDefinition(definition, Number(req.user.organizationId) || 1);
    const [result] = await pool.execute(`INSERT INTO crm_automation_workflows(business_unit_id,name,category,start_at,definition_json,is_active,created_by) VALUES(?,?,?,?,?,?,?)`, [Number(req.businessUnit.id), name, category, req.body.startAt || null, JSON.stringify(definition), req.body.isActive ? 1 : 0, Number(req.user.id)]);
    res.status(201).json({ message: 'Automation workflow created', id: Number(result.insertId) });
});

app.put('/api/automations/:id', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
    const name = cleanOptional(req.body.name, 180); const category = cleanOptional(req.body.category, 40); if (!name || !category) return res.status(400).json({ message: 'Automation name and category are required' });
    const definition = req.body.definition && typeof req.body.definition === 'object' ? req.body.definition : {};
    await validateAutomationDefinition(definition, Number(req.user.organizationId) || 1);
    const workflowId = Number(req.params.id);
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [[existing]] = await connection.execute(
            `SELECT start_at,definition_json FROM crm_automation_workflows WHERE id=? AND business_unit_id=? FOR UPDATE`,
            [workflowId, Number(req.businessUnit.id)],
        );
        if (!existing) {
            await connection.rollback();
            return res.status(404).json({ message: 'Automation workflow not found' });
        }
        const nextDefinition = stableAutomationJson(definition);
        const existingDefinition = stableAutomationJson(
            typeof existing.definition_json === 'string'
                ? JSON.parse(existing.definition_json)
                : existing.definition_json,
        );
        const existingStart = existing.start_at ? new Date(existing.start_at).getTime() : null;
        const nextStart = req.body.startAt ? new Date(req.body.startAt).getTime() : null;
        const executionRuleChanged =
            existingDefinition !== nextDefinition || existingStart !== nextStart;
        await connection.execute(
            `UPDATE crm_automation_workflows
       SET name=?,category=?,start_at=?,definition_json=? WHERE id=? AND business_unit_id=?`,
            [name, category, req.body.startAt || null, nextDefinition, workflowId, Number(req.businessUnit.id)],
        );
        if (executionRuleChanged) {
            await connection.execute(
                `DELETE FROM crm_automation_executions WHERE workflow_id=?`,
                [workflowId],
            );
        }
        await connection.commit();
        res.json({
            message: 'Automation workflow updated',
            executionRuleChanged,
        });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
});

app.put('/api/automations/:id/status', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
    const [result] = await pool.execute(`UPDATE crm_automation_workflows SET is_active=? WHERE id=? AND business_unit_id=?`, [req.body.isActive ? 1 : 0, Number(req.params.id), Number(req.businessUnit.id)]); if (!result.affectedRows) return res.status(404).json({ message: 'Automation workflow not found' }); res.json({ message: `Automation ${req.body.isActive ? 'activated' : 'paused'}` });
});

app.post('/api/automations/:id/run', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
    const id = Number(req.params.id);
    const [[workflow]] = await pool.execute(`SELECT id,is_active AS isActive FROM crm_automation_workflows WHERE id=? AND business_unit_id=? LIMIT 1`, [id, Number(req.businessUnit.id)]);
    if (!workflow) return res.status(404).json({ message: 'Automation workflow not found' });
    if (!workflow.isActive) return res.status(409).json({ message: 'Activate the workflow before running it' });
    const result = await automationEngine.run({ workflowId: id });
    res.json({ message: result.skipped ? result.reason : `Workflow evaluated successfully; ${result.scheduled} action(s) scheduled`, ...result });
});

app.delete('/api/automations/:id', authenticate, requireCrmAccess, requireLeadDelete, async (req, res) => {
    const [result] = await pool.execute(`DELETE FROM crm_automation_workflows WHERE id=? AND business_unit_id=?`, [Number(req.params.id), Number(req.businessUnit.id)]); if (!result.affectedRows) return res.status(404).json({ message: 'Automation workflow not found' }); res.json({ message: 'Automation workflow deleted' });
});

// ---- Automations > Assignment Rules ------------------------------------

function assignmentRuleIdList(value, label) {
    const ids = Array.isArray(value) ? [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))] : [];
    if (!ids.length) throw Object.assign(new Error(`Select at least one ${label}`), { status: 400 });
    return ids;
}

app.get('/api/assignment-rules', authenticate, requireCrmAccess, async (req, res) => {
    const [rows] = await pool.execute(
        `SELECT r.id,r.name,r.branch_ids_json AS branchIds,r.source_ids_json AS sourceIds,
            r.employee_ids_json AS employeeIds,r.is_active AS isActive,r.created_at_utc AS createdAt,
            COALESCE(e.employee_name,u.email) AS createdBy
     FROM crm_assignment_rules r
     JOIN app_users u ON u.id=r.created_by
     LEFT JOIN employees e ON e.id=u.employee_id
     WHERE r.business_unit_id=?
     ORDER BY r.created_at_utc DESC`,
        [Number(req.businessUnit.id)],
    );
    /*
     * Every active branch, not just the ones this user works in.
     *
     * A rule says where a lead should go, which is not the same question as
     * which leads this person may open -- and the branch a Meta form routes
     * to is often one the administrator writing the rule never handles. The
     * Leads screen's own branch list stays scoped; only rule authoring sees
     * the full set, and editing rules already requires automations.*.edit.
     */
    const [ruleBranches] = await pool.query(
        'SELECT id, branch_name AS name, short_name AS shortName FROM branches WHERE is_active=TRUE ORDER BY branch_name',
    );
    res.json({
        branches: ruleBranches,
        data: rows.map((row) => ({
            ...row,
            id: Number(row.id),
            isActive: Boolean(row.isActive),
            branchIds: parseJsonValue(row.branchIds, []).map(Number),
            sourceIds: parseJsonValue(row.sourceIds, []).map(Number),
            employeeIds: parseJsonValue(row.employeeIds, []).map(Number),
        })),
    });
});

app.post('/api/assignment-rules', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
    const name = cleanOptional(req.body.name, 180);
    if (!name) return res.status(400).json({ message: 'Rule name is required' });
    const branchIds = assignmentRuleIdList(req.body.branchIds, 'branch');
    const sourceIds = assignmentRuleIdList(req.body.sourceIds, 'source');
    const employeeIds = assignmentRuleIdList(req.body.employeeIds, 'user to assign leads to');
    const [result] = await pool.execute(
        `INSERT INTO crm_assignment_rules(business_unit_id,name,branch_ids_json,source_ids_json,employee_ids_json,is_active,created_by)
     VALUES(?,?,?,?,?,1,?)`,
        [Number(req.businessUnit.id), name, JSON.stringify(branchIds), JSON.stringify(sourceIds), JSON.stringify(employeeIds), Number(req.user.id)],
    );
    res.status(201).json({ message: 'Assignment rule created', id: Number(result.insertId) });
});

app.put('/api/assignment-rules/:id', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
    const name = cleanOptional(req.body.name, 180);
    if (!name) return res.status(400).json({ message: 'Rule name is required' });
    const branchIds = assignmentRuleIdList(req.body.branchIds, 'branch');
    const sourceIds = assignmentRuleIdList(req.body.sourceIds, 'source');
    const employeeIds = assignmentRuleIdList(req.body.employeeIds, 'user to assign leads to');
    const [result] = await pool.execute(
        `UPDATE crm_assignment_rules SET name=?,branch_ids_json=?,source_ids_json=?,employee_ids_json=?
     WHERE id=? AND business_unit_id=?`,
        [name, JSON.stringify(branchIds), JSON.stringify(sourceIds), JSON.stringify(employeeIds), Number(req.params.id), Number(req.businessUnit.id)],
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Assignment rule not found' });
    res.json({ message: 'Assignment rule updated' });
});

app.put('/api/assignment-rules/:id/status', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
    const [result] = await pool.execute(`UPDATE crm_assignment_rules SET is_active=? WHERE id=? AND business_unit_id=?`, [req.body.isActive ? 1 : 0, Number(req.params.id), Number(req.businessUnit.id)]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Assignment rule not found' });
    res.json({ message: `Assignment rule ${req.body.isActive ? 'enabled' : 'disabled'}` });
});

app.delete('/api/assignment-rules/:id', authenticate, requireCrmAccess, requireLeadDelete, async (req, res) => {
    const [result] = await pool.execute(`DELETE FROM crm_assignment_rules WHERE id=? AND business_unit_id=?`, [Number(req.params.id), Number(req.businessUnit.id)]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Assignment rule not found' });
    res.json({ message: 'Assignment rule deleted' });
});

function campaignScheduleDates(body) {
    const count = Math.max(1, Math.min(10, Number(body.communicationCount || 1)));
    const first = new Date(body.firstCommunicationAt);
    if (Number.isNaN(first.getTime())) throw Object.assign(new Error('Select the first communication date and time'), { status: 400 });
    if (body.ruleType === 'calendar_dates') {
        const dates = Array.isArray(body.calendarDates) ? body.calendarDates.slice(0, count).map(value => new Date(value)) : [];
        if (dates.length !== count || dates.some(date => Number.isNaN(date.getTime()))) {
            throw Object.assign(new Error(`Select all ${count} communication dates`), { status: 400 });
        }
        return dates;
    }
    if (body.ruleType === 'weekdays') {
        const weekdays = new Set((Array.isArray(body.weekdays) ? body.weekdays : []).map(Number));
        if (!weekdays.size) throw Object.assign(new Error('Select at least one communication weekday'), { status: 400 });
        const dates = [];
        const cursor = new Date(first);
        while (dates.length < count) {
            if (weekdays.has(cursor.getDay())) dates.push(new Date(cursor));
            cursor.setDate(cursor.getDate() + 1);
            if (cursor.getTime() - first.getTime() > 366 * 86_400_000) break;
        }
        return dates;
    }
    const gapDays = Math.max(1, Math.min(365, Number(body.gapDays || 1)));
    return Array.from({ length: count }, (_, index) => new Date(first.getTime() + index * gapDays * 86_400_000));
}

app.get('/api/marketing-campaigns', authenticate, requireCrmAccess, async (req, res) => {
    const [rows] = await pool.execute(`
    SELECT c.id,c.name,c.rule_type AS ruleType,c.communication_count AS communicationCount,
           c.first_communication_at AS firstCommunicationAt,c.gap_days AS gapDays,
           c.weekdays_json AS weekdays,c.calendar_dates_json AS calendarDates,
           c.status,c.retry_attempts AS retryAttempts,
           c.created_at_utc AS createdAt,COALESCE(c.updated_at_utc,c.created_at_utc) AS updatedAt,
           COALESCE(e.employee_name,u.email) AS createdBy,i.name AS integrationName,
           COALESCE(r.recipientCount,0) AS recipientCount,
           COALESCE(r.primaryCount,0) AS primaryCount,
           COALESCE(r.alternateCount,0) AS alternateCount,
           COALESCE(d.totalDeliveries,0) AS totalDeliveries,
           COALESCE(d.completedDeliveries,0) AS completedDeliveries,
           COALESCE(d.failedDeliveries,0) AS failedDeliveries,
           COALESCE(d.pendingDeliveries,0) AS pendingDeliveries,
           COALESCE(d.queuedDeliveries,0) AS queuedDeliveries,
           COALESCE(d.sentDeliveries,0) AS sentDeliveries,
           COALESCE(d.deliveredDeliveries,0) AS deliveredDeliveries,
           COALESCE(d.readDeliveries,0) AS readDeliveries
    FROM crm_marketing_campaigns c
    JOIN crm_integrations i ON i.id=c.integration_id
    JOIN app_users u ON u.id=c.created_by
    LEFT JOIN employees e ON e.id=u.employee_id
    LEFT JOIN (
      SELECT campaign_id,COUNT(*) recipientCount,
             SUM(phone_type='primary') primaryCount,
             SUM(phone_type='alternate') alternateCount
      FROM crm_marketing_campaign_recipients GROUP BY campaign_id
    ) r ON r.campaign_id=c.id
    LEFT JOIN (
      SELECT campaign_id,COUNT(*) totalDeliveries,
             SUM(status IN ('QUEUED','SENT','DELIVERED','READ')) completedDeliveries,
             SUM(status='FAILED') failedDeliveries,
             SUM(status IN ('PENDING','RUNNING')) pendingDeliveries,
             SUM(status='QUEUED') queuedDeliveries,
             SUM(status='SENT') sentDeliveries,
             SUM(status='DELIVERED') deliveredDeliveries,
             SUM(status='READ') readDeliveries
      FROM crm_marketing_campaign_deliveries GROUP BY campaign_id
    ) d ON d.campaign_id=c.id
    WHERE c.organization_id=? AND c.business_unit_id=?
    ORDER BY c.created_at_utc DESC`,
        [Number(req.user.id), Number(req.businessUnit.id)],
    );
    res.json({
        data: rows.map(row => ({
            ...row, id: Number(row.id), recipientCount: Number(row.recipientCount),
            primaryCount: Number(row.primaryCount), alternateCount: Number(row.alternateCount),
            totalDeliveries: Number(row.totalDeliveries), completedDeliveries: Number(row.completedDeliveries),
            failedDeliveries: Number(row.failedDeliveries), pendingDeliveries: Number(row.pendingDeliveries),
            queuedDeliveries: Number(row.queuedDeliveries), sentDeliveries: Number(row.sentDeliveries),
            deliveredDeliveries: Number(row.deliveredDeliveries), readDeliveries: Number(row.readDeliveries),
        }))
    });
});

app.post('/api/marketing-campaigns', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
    const name = cleanOptional(req.body.name, 180);
    const integrationId = Number(req.body.integrationId);
    const communicationCount = Math.max(1, Math.min(10, Number(req.body.communicationCount || 1)));
    const ruleType = ['days_gap', 'calendar_dates', 'weekdays'].includes(req.body.ruleType) ? req.body.ruleType : 'days_gap';
    if (!name || !integrationId) return res.status(400).json({ message: 'Campaign name and WhatsApp account are required' });
    const scheduleDates = campaignScheduleDates({ ...req.body, ruleType, communicationCount });
    const touches = Array.isArray(req.body.touches) ? req.body.touches.slice(0, communicationCount) : [];
    if (touches.length !== communicationCount) return res.status(400).json({ message: `Select ${communicationCount} approved WhatsApp templates` });
    const [[integration]] = await pool.execute(
        `SELECT id FROM crm_integrations WHERE id=? AND organization_id=? AND deleted_at IS NULL
       AND UPPER(type)='SMARTPING' LIMIT 1`,
        [integrationId, Number(req.user.id)],
    );
    if (!integration) return res.status(400).json({ message: 'Selected WhatsApp account is unavailable' });
    const canonicalTouches = [];
    for (let index = 0; index < touches.length; index += 1) {
        const touch = touches[index]; const templateId = Number(touch.templateId);
        await pool.query(`
      CREATE TABLE IF NOT EXISTS crm_whatsapp_template_user_visibility (
        template_id INT NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (template_id, user_id),
        KEY ix_whatsapp_template_visibility_user (user_id),
        CONSTRAINT fk_whatsapp_template_visibility_template FOREIGN KEY (template_id)
          REFERENCES crm_whatsapp_templates(id) ON DELETE CASCADE,
        CONSTRAINT fk_whatsapp_template_visibility_user FOREIGN KEY (user_id)
          REFERENCES app_users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
        const templateVisibilitySql = req.user.roles?.some(role => ['CRM_ADMIN', 'SUPER_ADMIN'].includes(String(role).toUpperCase()))
            ? ''
            : `AND EXISTS (SELECT 1 FROM crm_whatsapp_template_user_visibility tv WHERE tv.template_id=crm_whatsapp_templates.id AND tv.user_id=?)`;
        const templateVisibilityParams = req.user.roles?.some(role => ['CRM_ADMIN', 'SUPER_ADMIN'].includes(String(role).toUpperCase()))
            ? []
            : [Number(req.user.id)];
        const [[template]] = await pool.execute(
            `SELECT id,template_name,body,language,total_parameters,template_type,header_type
       FROM crm_whatsapp_templates
       WHERE id=? AND integration_id=? AND organization_id=?
         AND deleted_at IS NULL AND UPPER(status)='APPROVED' ${templateVisibilitySql} LIMIT 1`,
            [templateId, integrationId, Number(req.user.id), ...templateVisibilityParams],
        );
        if (!template) return res.status(400).json({ message: `Communication ${index + 1} template is unavailable` });
        const count = Math.max(Number(template.total_parameters || 0), ...[...String(template.body || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(match => Number(match[1])), 0);
        const params = Array.isArray(touch.templateParams) ? touch.templateParams.slice(0, count).map(value => String(value || '').trim()) : [];
        if (params.length < count || params.some(value => !value)) return res.status(400).json({ message: `Enter all fixed values for communication ${index + 1}` });
        const templateType = String(template.template_type || template.header_type || 'TEXT').toUpperCase();
        const requiresMedia = ['IMAGE', 'VIDEO', 'DOCUMENT', 'FILE'].includes(templateType);
        const mediaUrl = cleanOptional(touch.mediaUrl, 1000);
        const mediaFilename = cleanOptional(touch.mediaFilename, 255);
        if (requiresMedia && !mediaUrl) return res.status(400).json({ message: `Upload the required ${templateType.toLowerCase()} for communication ${index + 1}` });
        canonicalTouches.push({
            ...template, templateParams: params, scheduledAt: scheduleDates[index],
            mediaUrl: requiresMedia ? mediaUrl : null, mediaFilename: requiresMedia ? mediaFilename : null
        });
    }
    const filters = req.body.audienceFilters && typeof req.body.audienceFilters === 'object' ? req.body.audienceFilters : {};
    const scope = leadScopedWhere(req.user); const clauses = [`l.deleted_at_utc IS NULL`, scope.sql]; const params = [...scope.params];
    const requestedLeadIds = [...new Set((Array.isArray(req.body.leadIds) ? req.body.leadIds : [])
        .map(Number).filter(value => Number.isInteger(value) && value > 0))];
    if (Array.isArray(req.body.leadIds) && !requestedLeadIds.length) {
        return res.status(400).json({ message: 'No filtered leads were provided for this campaign' });
    }
    if (requestedLeadIds.length) {
        clauses.push(`l.id IN (${requestedLeadIds.map(() => '?').join(',')})`);
        params.push(...requestedLeadIds);
    }
    for (const [field, column] of [['branchIds', 'l.branch_id'], ['stageIds', 'l.stage_id'], ['sourceIds', 'l.source_id']]) {
        const values = (Array.isArray(filters[field]) ? filters[field] : []).map(Number).filter(Number.isFinite);
        if (values.length) { clauses.push(`${column} IN (${values.map(() => '?').join(',')})`); params.push(...values); }
    }
    const [leads] = await pool.execute(
        `SELECT l.id,l.phone,l.alternate_phone FROM crm_leads l WHERE ${clauses.join(' AND ')}`,
        params,
    );
    if (requestedLeadIds.length && leads.length !== requestedLeadIds.length) {
        return res.status(400).json({ message: 'One or more selected leads are unavailable. Refresh the Leads screen and select the campaign recipients again.' });
    }
    const phoneTypes = Array.isArray(req.body.phoneTypes) && req.body.phoneTypes.length ? req.body.phoneTypes : ['primary'];
    const recipients = [];
    for (const lead of leads) {
        if (phoneTypes.includes('primary') && /^(?:91)?[6-9]\d{9}$/.test(String(lead.phone || '').replace(/\D/g, ''))) recipients.push({ leadId: lead.id, phone: lead.phone, type: 'primary' });
        if (phoneTypes.includes('alternate') && /^(?:91)?[6-9]\d{9}$/.test(String(lead.alternate_phone || '').replace(/\D/g, ''))) recipients.push({ leadId: lead.id, phone: lead.alternate_phone, type: 'alternate' });
    }
    if (!recipients.length) return res.status(400).json({ message: 'No leads with valid selected mobile numbers match this audience' });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [campaignResult] = await connection.execute(
            `INSERT INTO crm_marketing_campaigns
       (business_unit_id,organization_id,name,rule_type,communication_count,first_communication_at,gap_days,
        weekdays_json,calendar_dates_json,audience_filters_json,integration_id,response_owner,
        retry_attempts,status,created_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?)`,
            [Number(req.businessUnit.id), Number(req.user.id), name, ruleType, communicationCount, scheduleDates[0],
            ruleType === 'days_gap' ? Math.max(1, Number(req.body.gapDays || 1)) : null,
            ruleType === 'weekdays' ? JSON.stringify(req.body.weekdays || []) : null,
            ruleType === 'calendar_dates' ? JSON.stringify(req.body.calendarDates || []) : null,
            JSON.stringify(filters), integrationId, req.body.responseOwner === 'lead_owner' ? 'lead_owner' : 'sender',
            Math.max(0, Math.min(5, Number(req.body.retryAttempts || 0))), Number(req.user.id)],
        );
        const campaignId = Number(campaignResult.insertId); const touchIds = [];
        for (let index = 0; index < canonicalTouches.length; index += 1) {
            const touch = canonicalTouches[index];
            const [touchResult] = await connection.execute(
                `INSERT INTO crm_marketing_campaign_touches
         (campaign_id,sequence_number,template_id,template_name,template_body,
          template_language,template_params_json,media_url,media_filename,scheduled_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
                [campaignId, index + 1, touch.id, touch.template_name, touch.body, touch.language,
                    JSON.stringify(touch.templateParams), touch.mediaUrl, touch.mediaFilename, touch.scheduledAt],
            );
            touchIds.push(Number(touchResult.insertId));
        }
        for (const recipient of recipients) {
            const [recipientResult] = await connection.execute(
                `INSERT IGNORE INTO crm_marketing_campaign_recipients
         (campaign_id,lead_id,phone,phone_type) VALUES(?,?,?,?)`,
                [campaignId, recipient.leadId, recipient.phone, recipient.type],
            );
            if (!recipientResult.insertId) continue;
            for (let index = 0; index < touchIds.length; index += 1) {
                await connection.execute(
                    `INSERT INTO crm_marketing_campaign_deliveries
           (campaign_id,recipient_id,touch_id,sequence_number,scheduled_for)
           VALUES(?,?,?,?,?)`,
                    [campaignId, recipientResult.insertId, touchIds[index], index + 1, scheduleDates[index]],
                );
            }
        }
        await connection.commit();
        res.status(201).json({ message: `Campaign scheduled for ${recipients.length} recipient(s)`, id: campaignId, recipientCount: recipients.length });
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
});

app.put('/api/marketing-campaigns/:id/status', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
    const status = String(req.body.status || '').toUpperCase();
    if (!['ACTIVE', 'PAUSED', 'CANCELLED'].includes(status)) return res.status(400).json({ message: 'Invalid campaign status' });
    const [result] = await pool.execute(
        `UPDATE crm_marketing_campaigns SET status=? WHERE id=? AND organization_id=? AND business_unit_id=?`,
        [status, Number(req.params.id), Number(req.user.id), Number(req.businessUnit.id)],
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Campaign not found' });
    if (status === 'CANCELLED') await pool.execute(
        `UPDATE crm_marketing_campaign_deliveries SET status='CANCELLED'
     WHERE campaign_id=? AND status='PENDING'`,
        [Number(req.params.id)],
    );
    res.json({ message: `Campaign ${status.toLowerCase()}` });
});

app.get('/api/leads', authenticate, requireCrmAccess, async (req, res) => {
    const search = String(req.query.search || '').trim();
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 200)
        : null;
    // The current Leads UI applies stage and advanced filters client-side, so it
    // needs the complete scoped result set. Explicit lightweight callers such as
    // Global Search can still request a bounded result set.
    //
    // includeReferred asks for the leads this user referred to someone else,
    // which an 'own' scope drops as soon as the owner changes. Only the Leads
    // screen sets it -- it is the one place with a filter for them, and the
    // dashboards counting off this route must keep counting owned work.
    const includeReferredAway = ['1', 'true', 'yes'].includes(String(req.query.includeReferred || '').toLowerCase());
    /* Each lead pipeline has its own Leads screen, so every count on this
       route is narrowed the same way the list is -- a badge that counted
       across pipelines would not match the rows underneath it. */
    const pipelineId = Number(req.query.pipelineId) || null;
    const pipelineJoin = pipelineId ? ' JOIN crm_lead_stages ps ON ps.id = l.stage_id' : '';
    const pipelineWhere = pipelineId ? ' AND ps.pipeline_id = ?' : '';
    const pipelineParams = pipelineId ? [pipelineId] : [];
    const rows = await queryLeads(req.user, search, limit, { includeReferredAway, pipelineId });
    const scope = leadScopedWhere(req.user);

    // Get actual total count from database (not page size)
    const [[totalCount]] = await pool.execute(
        `SELECT COUNT(*) AS count FROM crm_leads l${pipelineJoin}
     WHERE l.deleted_at_utc IS NULL AND ${scope.sql}${pipelineWhere}`,
        [...scope.params, ...pipelineParams],
    );

    // Get stage counts
    const [stageCountRows] = await pool.execute(
        `SELECT s.display_name AS stage, COUNT(l.id) AS count
     FROM crm_leads l
     JOIN crm_lead_stages s ON s.id = l.stage_id
     WHERE l.deleted_at_utc IS NULL AND ${scope.sql}${pipelineId ? ' AND s.pipeline_id = ?' : ''}
     GROUP BY s.id, s.display_name`,
        [...scope.params, ...pipelineParams],
    );
    const stageCounts = Object.fromEntries(
        stageCountRows.map(row => [row.stage, Number(row.count || 0)]),
    );

    // Get followups due
    // Matches the bell: a counsellor's badge counts the leads they own, so the
    // two never disagree about how much work is waiting.
    const dueOwnOnly = req.user.rbacEnforced && req.user.rbacScope === 'own';
    const dueOwnerSql = dueOwnOnly ? ' AND l.owner_employee_id = ?' : '';
    const dueOwnerParams = dueOwnOnly ? [Number(req.user.employeeId) || 0] : [];
    const [[due]] = await pool.execute(
        `SELECT COUNT(*) AS count FROM crm_leads l${pipelineJoin}
     WHERE l.deleted_at_utc IS NULL AND ${FOLLOWUP_DUE_SQL}
       AND ${scope.sql}${pipelineWhere}${dueOwnerSql}`,
        [...scope.params, ...pipelineParams, ...dueOwnerParams],
    );

    // Untouched means the current owner has not added a comment since this
    // assignment began. Keep this user-specific even for managers/admins: the
    // badge represents work waiting on the signed-in user's own desk.
    const currentEmployeeId = Number(req.user.employeeId) || 0;
    const [[untouchedAssigned]] = await pool.execute(
        `SELECT COUNT(*) AS count
     FROM crm_leads l${pipelineJoin}
     WHERE l.deleted_at_utc IS NULL
       AND l.owner_employee_id = ?
       AND ${scope.sql}${pipelineWhere}
       AND NOT EXISTS (
         SELECT 1
         FROM crm_lead_comments touch_comment
         JOIN app_users touch_user ON touch_user.id = touch_comment.created_by_user_id
         WHERE touch_comment.lead_id = l.id
           AND touch_user.employee_id = l.owner_employee_id
           AND touch_comment.created_at_utc >= COALESCE(l.owner_assigned_at_utc,l.referred_at_utc,l.created_at_utc)
       )`,
        [currentEmployeeId, ...scope.params, ...pipelineParams],
    );

    // Get re-enquired count
    const [[reEnquiredCount]] = await pool.execute(
        `SELECT COUNT(*) AS count
     FROM crm_leads l${pipelineJoin}
     WHERE l.deleted_at_utc IS NULL
       AND (
         l.re_enquired_at_utc IS NOT NULL
         OR (SELECT COUNT(*) FROM crm_lead_source_history h WHERE h.lead_id = l.id) > 1
       )
       AND ${scope.sql}${pipelineWhere}`,
        [...scope.params, ...pipelineParams],
    );

    res.json({
        data: rows,
        total: Number(totalCount.count || 0),
        stageCounts: {
            ...stageCounts,
            'Re-enquired': Number(reEnquiredCount.count || 0)
        },
        followupsTillToday: Number(due.count || 0),
        untouchedAssignedCount: Number(untouchedAssigned.count || 0)
    });
});

// ============= Bulk Upload Routes =============
app.get('/api/bulk-uploads/download-template', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
    try {
        const [metadataFields] = await pool.execute(
            `SELECT field_key AS fieldKey,display_name AS displayName,field_type AS fieldType,
              is_import_required AS isRequired,import_header AS importHeader,import_sample_value AS importSampleValue
       FROM crm_metadata_fields
       WHERE business_unit_id=? AND module_key='leads' AND is_active=TRUE AND is_importable=TRUE
       ORDER BY position`,
            [Number(req.businessUnit.id)],
        );
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

        const fallbackFields = [
            ['student_name', 'Student Name', true, 'Rahul Kumar'], ['phone', 'Phone', true, '9876543210'],
            ['class_id', 'Class ID', true, classId], ['campaign_id', 'Campaign Name', true, campaignName],
            ['substage_id', 'Sub-stage ID', true, substageId], ['owner_employee_id', 'Assign To', true, userEmail],
            ['source_id', 'Source ID', true, sourceId], ['remarks', 'Remarks', false, 'Sample lead'],
        ].map(([fieldKey, displayName, isRequired, importSampleValue]) => ({ fieldKey, displayName, isRequired, importHeader: displayName, importSampleValue }));
        const templateFields = metadataFields.length ? metadataFields : fallbackFields;
        const dynamicSample = (field) => {
            if (field.importSampleValue) return field.importSampleValue;
            const known = { class_id: classId, campaign_id: campaignName, substage_id: substageId, owner_employee_id: userEmail, source_id: sourceId };
            if (known[field.fieldKey] != null) return known[field.fieldKey];
            if (field.fieldType === 'email') return 'contact@example.com';
            if (field.fieldType === 'phone') return '9876543210';
            if (['number', 'decimal'].includes(field.fieldType)) return '1';
            if (field.fieldType === 'date') return new Date().toISOString().slice(0, 10);
            if (field.fieldType === 'boolean') return 'Yes';
            return '';
        };
        const headers = templateFields.map(field => `${field.importHeader || field.displayName}${field.isRequired ? ' *' : ''}`);
        const sampleRow = templateFields.map(dynamicSample);

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
        const templateName = req.query.template === 'google' ? 'Google_Sheets_Import_Template' : `bulk_lead_upload_template_${new Date().toISOString().split('T')[0]}`;
        res.setHeader('Content-Disposition', `attachment; filename="${templateName}.csv"`);
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
app.get('/api/admission-class-master-data', authenticate, requireUserAdmin, async (_req, res) => {
    try {
        const [[academicYears], [branches], [curricula], [admissionTypes], [classes]] = await Promise.all([
            pool.query(`SELECT id, academic_year AS academicYear, display_name AS displayName FROM crm_academic_years WHERE is_active=TRUE ORDER BY academic_year DESC`),
            pool.query(`SELECT id, branch_name AS name, short_name AS shortName FROM branches WHERE is_active=TRUE ORDER BY branch_name`),
            pool.query(`SELECT id, curriculum_code AS code, display_name AS displayName, position, is_active AS isActive FROM crm_curricula ORDER BY position, display_name`),
            pool.query(`SELECT id, type_code AS code, display_name AS displayName, is_active AS isActive FROM crm_admission_types ORDER BY display_name`),
            pool.query(`SELECT id, class_code AS code, display_name AS displayName, position, is_active AS isActive FROM crm_classes WHERE is_active=TRUE ORDER BY position, display_name`),
        ]);
        res.json({ academicYears, branches, curricula, admissionTypes, classes });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

app.get('/api/curricula', authenticate, requireUserAdmin, async (_req, res) => {
    const [rows] = await pool.query(`SELECT id, curriculum_code AS code, display_name AS displayName, position, is_active AS isActive FROM crm_curricula ORDER BY position, display_name`);
    res.json({ data: rows });
});

app.post('/api/curricula', authenticate, requireUserAdmin, async (req, res) => {
    const displayName = cleanOptional(req.body.displayName, 100);
    const code = cleanOptional(req.body.code, 30) || displayName?.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
    const position = Number(req.body.position || 0);
    if (!displayName) return res.status(400).json({ message: 'Curriculum name is required' });
    try {
        const [result] = await pool.execute(`INSERT INTO crm_curricula(curriculum_code,display_name,position,is_active) VALUES(?,?,?,?)`, [code, displayName, Number.isFinite(position) ? position : 0, req.body.isActive === false ? 0 : 1]);
        res.status(201).json({ id: result.insertId, message: 'Curriculum created successfully' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Curriculum code already exists' });
        res.status(500).json({ message: error.message });
    }
});

app.put('/api/curricula/:id', authenticate, requireUserAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const displayName = cleanOptional(req.body.displayName, 100);
    const code = cleanOptional(req.body.code, 30);
    const position = Number(req.body.position || 0);
    if (!displayName || !code) return res.status(400).json({ message: 'Curriculum code and name are required' });
    await pool.execute(`UPDATE crm_curricula SET curriculum_code=?,display_name=?,position=?,is_active=?,updated_at_utc=CURRENT_TIMESTAMP(6) WHERE id=?`, [code, displayName, Number.isFinite(position) ? position : 0, req.body.isActive === false ? 0 : 1, id]);
    res.json({ message: 'Curriculum updated successfully' });
});

app.get('/api/admission-types', authenticate, requireUserAdmin, async (_req, res) => {
    const [rows] = await pool.query(`SELECT id, type_code AS code, display_name AS displayName, is_active AS isActive FROM crm_admission_types ORDER BY display_name`);
    res.json({ data: rows });
});

app.post('/api/admission-types', authenticate, requireUserAdmin, async (req, res) => {
    const displayName = cleanOptional(req.body.displayName, 100);
    const code = cleanOptional(req.body.code, 50) || displayName?.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50);
    if (!displayName) return res.status(400).json({ message: 'Admission type name is required' });
    try {
        const [result] = await pool.execute(`INSERT INTO crm_admission_types(type_code,display_name,is_active) VALUES(?,?,?)`, [code, displayName, req.body.isActive === false ? 0 : 1]);
        res.status(201).json({ id: result.insertId, message: 'Admission type created successfully' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Admission type code already exists' });
        res.status(500).json({ message: error.message });
    }
});

app.put('/api/admission-types/:id', authenticate, requireUserAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const displayName = cleanOptional(req.body.displayName, 100);
    const code = cleanOptional(req.body.code, 50);
    if (!displayName || !code) return res.status(400).json({ message: 'Admission type code and name are required' });
    await pool.execute(`UPDATE crm_admission_types SET type_code=?,display_name=?,is_active=? WHERE id=?`, [code, displayName, req.body.isActive === false ? 0 : 1, id]);
    res.json({ message: 'Admission type updated successfully' });
});

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
      FROM crm_admission_class_configurations acc
      LEFT JOIN branches b ON b.id = acc.branch_id
      LEFT JOIN crm_curricula c ON c.id = acc.curriculum_id
      LEFT JOIN crm_admission_types aat ON aat.id = acc.admission_type_id
      LEFT JOIN crm_admission_class_configuration_details accd ON accd.configuration_id = acc.id AND accd.is_active = TRUE
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
      FROM crm_admission_class_configurations acc
      WHERE acc.id = ?
    `, [configId]);

        if (!config) return res.status(404).json({ message: 'Configuration not found' });

        const [classes] = await pool.query(`
      SELECT class_id AS classId FROM crm_admission_class_configuration_details
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
        const { academicYear, classIds } = req.body;
        const branchIds = [...new Set((Array.isArray(req.body.branchIds) ? req.body.branchIds : [req.body.branchId]).map(Number).filter(Number.isFinite))];
        const curriculumIds = [...new Set((Array.isArray(req.body.curriculumIds) ? req.body.curriculumIds : [req.body.curriculumId]).map(Number).filter(Number.isFinite))];
        const admissionTypeIds = [...new Set((Array.isArray(req.body.admissionTypeIds) ? req.body.admissionTypeIds : [req.body.admissionTypeId]).map(Number).filter(Number.isFinite))];

        if (!academicYear || !branchIds.length || !curriculumIds.length || !admissionTypeIds.length) {
            return res.status(400).json({ message: 'Academic Year, Branch, Curriculum, and Admission Type are required' });
        }

        if (!Array.isArray(classIds) || classIds.length === 0) {
            return res.status(400).json({ message: 'At least one class must be selected' });
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            let created = 0;
            let updated = 0;
            for (const branchId of branchIds) {
                for (const curriculumId of curriculumIds) {
                    for (const admissionTypeId of admissionTypeIds) {
                        const [[existing]] = await connection.execute(`
              SELECT id FROM crm_admission_class_configurations
              WHERE academic_year = ? AND branch_id = ? AND curriculum_id = ? AND admission_type_id = ?
              LIMIT 1
            `, [String(academicYear), branchId, curriculumId, admissionTypeId]);
                        const configId = existing?.id || (await connection.execute(`
              INSERT INTO crm_admission_class_configurations (academic_year, branch_id, curriculum_id, admission_type_id, is_active, created_by, updated_by)
              VALUES (?, ?, ?, ?, 1, ?, ?)
            `, [String(academicYear), branchId, curriculumId, admissionTypeId, Number(req.user.id), Number(req.user.id)]))[0].insertId;
                        if (existing) {
                            updated += 1;
                            await connection.execute(`UPDATE crm_admission_class_configurations SET is_active=1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [Number(req.user.id), configId]);
                            await connection.execute(`DELETE FROM crm_admission_class_configuration_details WHERE configuration_id = ?`, [configId]);
                        } else created += 1;
                        for (const classId of classIds) {
                            await connection.execute(`
                INSERT INTO crm_admission_class_configuration_details (configuration_id, class_id, is_active)
                VALUES (?, ?, 1)
              `, [configId, Number(classId)]);
                        }
                    }
                }
            }

            await connection.commit();
            res.status(201).json({ created, updated, message: `Configuration saved for ${created + updated} combination${created + updated === 1 ? '' : 's'}` });
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
        UPDATE crm_admission_class_configurations
        SET academic_year = ?, branch_id = ?, curriculum_id = ?, admission_type_id = ?, is_active = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [String(academicYear), branchId, curriculumId, admissionTypeId, isActive ? 1 : 0, Number(req.user.id), configId]);

            await connection.execute(`DELETE FROM crm_admission_class_configuration_details WHERE configuration_id = ?`, [configId]);

            if (Array.isArray(classIds) && classIds.length > 0) {
                for (const classId of classIds) {
                    await connection.execute(`
            INSERT INTO crm_admission_class_configuration_details (configuration_id, class_id, is_active)
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
            const [[usage]] = await connection.execute(`
        SELECT COUNT(*) AS count
        FROM crm_leads l
        JOIN crm_admission_class_configurations c ON c.id=?
        JOIN crm_admission_class_configuration_details d ON d.configuration_id=c.id AND d.class_id=l.class_id
        WHERE l.academic_year=c.academic_year
          AND l.branch_id=c.branch_id
          AND l.curriculum_id=c.curriculum_id
          AND l.admission_type_id=c.admission_type_id
      `, [configId]);
            if (Number(usage.count) > 0) {
                await connection.rollback();
                return res.status(409).json({ message: `Cannot delete this academic configuration because ${usage.count} lead${Number(usage.count) === 1 ? ' is' : 's are'} linked to it` });
            }
            await connection.execute(`DELETE FROM crm_admission_class_configuration_details WHERE configuration_id = ?`, [configId]);
            await connection.execute(`DELETE FROM crm_admission_class_configurations WHERE id = ?`, [configId]);
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
      FROM crm_admission_class_configuration_details accd
      JOIN crm_admission_class_configurations acc ON acc.id = accd.configuration_id
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
      FROM crm_admission_class_configurations acc
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
      FROM crm_admission_class_configurations acc
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
        const [[year]] = await pool.execute(`SELECT academic_year AS academicYear FROM crm_academic_years WHERE id=?`, [yearId]);
        if (!year) return res.status(404).json({ message: 'Academic Year not found' });
        const [[usage]] = await pool.execute(`
      SELECT
        (SELECT COUNT(*) FROM crm_leads WHERE academic_year=?)
        +(SELECT COUNT(*) FROM crm_lead_source_history WHERE academic_year=?) AS count
    `, [year.academicYear, year.academicYear]);
        if (Number(usage.count) > 0) {
            return res.status(409).json({ message: `Cannot delete this academic year because ${usage.count} lead record${Number(usage.count) === 1 ? ' is' : 's are'} linked to it` });
        }
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [configs] = await connection.execute(`SELECT id FROM crm_admission_class_configurations WHERE academic_year=?`, [year.academicYear]);
            for (const config of configs) {
                await connection.execute(`DELETE FROM crm_admission_class_configuration_details WHERE configuration_id=?`, [config.id]);
            }
            await connection.execute(`DELETE FROM crm_admission_class_configurations WHERE academic_year=?`, [year.academicYear]);
            await connection.execute(`DELETE FROM crm_academic_years WHERE id=?`, [yearId]);
            await connection.commit();
            res.json({ message: 'Academic Year and its unused child configuration deleted successfully' });
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

app.get('/api/bulk-operations', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
    const type = cleanOptional(req.query.type, 30);
    const status = cleanOptional(req.query.status, 20);
    const from = cleanOptional(req.query.from, 10);
    const to = cleanOptional(req.query.to, 10);
    const values = [];
    const where = ['1=1'];
    if (type) { where.push('bo.operation_type=?'); values.push(type); }
    if (status) { where.push('bo.status=?'); values.push(status); }
    if (from) { where.push('DATE(bo.created_at_utc)>=?'); values.push(from); }
    if (to) { where.push('DATE(bo.created_at_utc)<=?'); values.push(to); }
    const [rows] = await pool.execute(
        `SELECT bo.id,bo.operation_type AS operationType,bo.status,bo.total_records AS totalRecords,
            bo.successful_records AS successfulRecords,bo.failed_records AS failedRecords,
            bo.summary,bo.details_json AS details,bo.error_message AS errorMessage,
            bo.created_at_utc AS createdAt,bo.completed_at_utc AS completedAt,
            COALESCE(e.employee_name,u.email) AS createdBy
     FROM crm_bulk_operations bo
     JOIN app_users u ON u.id=bo.created_by_user_id
     LEFT JOIN employees e ON e.id=u.employee_id
    WHERE bo.business_unit_id=? AND ${where.join(' AND ')}
     ORDER BY bo.created_at_utc DESC LIMIT 250`,
        [Number(req.businessUnit.id), ...values],
    );
    const ids = rows.map(row => Number(row.id));
    const retained = new Set();
    if (ids.length) {
        const [files] = await pool.query(
            `SELECT operation_id AS id, original_bytes AS bytes FROM crm_bulk_operation_files
              WHERE operation_id IN (${ids.map(() => '?').join(',')})`, ids);
        files.forEach(file => retained.add(Number(file.id)));
        var sizeById = new Map(files.map(file => [Number(file.id), Number(file.bytes)]));
    }
    res.json({
        data: rows.map(row => ({
            ...row,
            id: Number(row.id),
            details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
            // Whether the exact file is still available to download again.
            fileRetained: retained.has(Number(row.id)),
            fileBytes: (typeof sizeById !== 'undefined' && sizeById.get(Number(row.id))) || null,
        })),
    });
});

/*
 * The most recent comments for many leads at once.
 *
 * The export needs them for every row it is about to write. Fetching them one
 * lead at a time would be a request per row, so they are collected in a
 * single query and returned keyed by lead.
 *
 * Scoped like any other lead read: a lead the caller could not open is not
 * one whose comments they can export. `leadScopedWhere` supplies the same
 * branch/ownership restriction the list uses.
 */
app.get('/api/leads/comments/recent', authenticate, requireCrmAccess, async (req, res) => {
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 5));
    const leadIds = [...new Set(String(req.query.leadIds || '').split(',')
        .map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 5000);
    if (!leadIds.length) return res.json({ data: {} });

    const scope = leadScopedWhere(req.user);
    const placeholders = leadIds.map(() => '?').join(',');
    const [rows] = await pool.execute(
        `SELECT c.lead_id AS leadId, c.comment_text AS commentText, c.created_at_utc AS createdAt,
            COALESCE(e.employee_name, email_employee.employee_name, u.email, 'CRM user') AS authorName
       FROM crm_lead_comments c
       JOIN crm_leads l ON l.id = c.lead_id
       LEFT JOIN app_users u ON u.id = c.created_by_user_id
       LEFT JOIN employees e ON e.id = u.employee_id
       LEFT JOIN employees email_employee ON u.employee_id IS NULL
            AND LOWER(email_employee.email) = LOWER(u.email)
      WHERE c.lead_id IN (${placeholders}) AND l.deleted_at_utc IS NULL AND ${scope.sql}
      ORDER BY c.lead_id, c.created_at_utc DESC`,
        [...leadIds, ...scope.params],
    );

    // Trimmed to `limit` per lead here rather than in SQL: a window function
    // would tie this to MySQL 8 for no gain at these volumes.
    const byLead = {};
    for (const row of rows) {
        const list = (byLead[row.leadId] ||= []);
        if (list.length < limit) {
            list.push({
                author: row.authorName,
                text: row.commentText,
                createdAt: row.createdAt,
            });
        }
    }
    res.json({ data: byLead });
});

/*
 * Record a download.
 *
 * Every CSV this app produces is built in the browser from data already on
 * screen, so nothing reaches the server unless the screen says so. This is
 * that report: who downloaded, from which business unit, what dataset, how
 * many rows, and what narrowed it.
 *
 * `dataset` is what makes it general. It used to be leads only -- lead ids
 * were the whole payload -- so downloads of forms, pages, audiences and the
 * review queue left no trace at all.
 *
 * requireCrmAccess rather than requireLeadWrite: downloading a list of Meta
 * forms is not a lead-writing action, and gating the record more tightly
 * than the download itself would only lose the audit trail.
 */
/* Files larger than this are recorded but not kept. 8 MB of CSV is tens of
   thousands of rows, and gzip means the stored copy is far smaller. */
const DOWNLOAD_RETENTION_LIMIT = 8 * 1024 * 1024;

app.post('/api/bulk-operations/data-export', authenticate, requireCrmAccess, async (req, res) => {
    const totalRecords = Math.max(0, Number(req.body.totalRecords) || 0);
    const dataset = cleanOptional(req.body.dataset, 80) || 'Leads';
    const fileName = cleanOptional(req.body.fileName, 255) || `export-${new Date().toISOString().slice(0, 10)}.csv`;
    const leadIds = [...new Set((Array.isArray(req.body.leadIds) ? req.body.leadIds : []).map(Number).filter(id => Number.isInteger(id) && id > 0))];
    // What the person could see when they pressed the button: which columns
    // they chose, and whatever narrowed the list.
    const context = req.body.context && typeof req.body.context === 'object' ? req.body.context : {};
    const columns = Array.isArray(req.body.columns) ? req.body.columns.map(String).slice(0, 200) : [];
    const [result] = await pool.execute(
        `INSERT INTO crm_bulk_operations
     (business_unit_id,operation_type,status,created_by_user_id,total_records,successful_records,summary,details_json,completed_at_utc)
     VALUES (?,'data_export','completed',?,?,?,?,?,CURRENT_TIMESTAMP(6))`,
        [
            Number(req.businessUnit.id), Number(req.user.id), totalRecords, totalRecords,
            `Downloaded ${totalRecords} ${dataset.toLowerCase()} record${totalRecords === 1 ? '' : 's'}`,
            JSON.stringify({ dataset, fileName, columns, context, ...(leadIds.length ? { leadIds } : {}) }),
        ],
    );
    const operationId = Number(result.insertId);

    /*
     * Keep the file itself, so it can be handed back byte for byte.
     *
     * Anything over the ceiling is recorded but not retained: the point is
     * an audit trail with a convenience attached, not a file store, and a
     * runaway export should not be able to fill the database. The screen is
     * told which it got, so a button is never offered for a file that is
     * not there.
     */
    let retained = false;
    const content = typeof req.body.content === 'string' ? req.body.content : null;
    if (content) {
        const raw = Buffer.from(content, 'utf8');
        if (raw.byteLength <= DOWNLOAD_RETENTION_LIMIT) {
            try {
                /* gzip carries about twenty bytes of header, so on a very
                   small file it costs more than it saves. Store whichever is
                   actually smaller and say which it was. */
                const packed = zlib.gzipSync(raw);
                const useGzip = packed.byteLength < raw.byteLength;
                const stored = useGzip ? packed : raw;
                await pool.execute(
                    `INSERT INTO crm_bulk_operation_files
             (operation_id,file_name,content_type,stored_bytes,original_bytes,content_encoding,content)
           VALUES (?,?,?,?,?,?,?)`,
                    [operationId, fileName, 'text/csv;charset=utf-8', stored.byteLength, raw.byteLength, useGzip ? 'gzip' : 'identity', stored],
                );
                retained = true;
            } catch (error) {
                // The record is the thing that matters; a file that would not
                // store must not fail the download that has already happened.
                console.warn(`Download ${operationId} file not retained: ${error.message}`);
            }
        }
    }
    res.status(201).json({ id: operationId, retained, message: 'Download recorded' });
});

/*
 * Hand back the exact file somebody downloaded earlier.
 *
 * Scoped to the business unit the request is made from, so one unit's
 * downloads are not reachable from another.
 */
app.get('/api/bulk-operations/:id/file', authenticate, requireCrmAccess, async (req, res) => {
    const operationId = Number(req.params.id);
    if (!Number.isInteger(operationId) || operationId <= 0) return res.status(400).json({ message: 'Invalid download' });
    const [[row]] = await pool.execute(
        `SELECT f.file_name AS fileName, f.content_type AS contentType, f.content, f.content_encoding AS encoding
       FROM crm_bulk_operation_files f
       JOIN crm_bulk_operations bo ON bo.id = f.operation_id
      WHERE f.operation_id=? AND bo.business_unit_id=? LIMIT 1`,
        [operationId, Number(req.businessUnit.id)],
    );
    if (!row) return res.status(404).json({ message: 'That file was not kept — only downloads made after file retention was switched on can be downloaded again' });
    const body = row.encoding === 'gzip' ? zlib.gunzipSync(row.content) : row.content;
    res.setHeader('Content-Type', row.contentType || 'text/csv;charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${row.fileName.replace(/"/g, '')}"`);
    res.send(body);
});

app.get('/api/bulk-operations/:id/export', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
    const operationId = Number(req.params.id);
    if (!Number.isInteger(operationId) || operationId <= 0) return res.status(400).json({ message: 'Invalid bulk operation' });
    const [[operation]] = await pool.execute(
        `SELECT id,operation_type AS operationType,details_json AS details FROM crm_bulk_operations WHERE id=? AND business_unit_id=? LIMIT 1`,
        [operationId, Number(req.businessUnit.id)],
    );
    if (!operation) return res.status(404).json({ message: 'Bulk operation not found' });
    const details = typeof operation.details === 'string' ? JSON.parse(operation.details) : operation.details || {};
    const leadIds = [...new Set((Array.isArray(details.leadIds) ? details.leadIds : []).map(Number).filter(id => Number.isInteger(id) && id > 0))];
    if (!leadIds.length) return res.status(409).json({ message: 'Lead-level history is not available for this older operation' });
    const placeholders = leadIds.map(() => '?').join(',');
    // Export the immutable membership of this business-unit operation. Applying
    // today's owner/branch scope here made older bulk actions download fewer
    // rows after a lead was reassigned, even though the operation card and its
    // stored transition history still correctly showed every affected record.
    const [rows] = await pool.execute(
        `SELECT l.id,l.lead_number AS leadNumber,l.student_name AS studentName,l.phone,
            b.branch_name AS branch,COALESCE(c.display_name,l.applying_class) AS className,
            s.display_name AS stage,COALESCE(e.employee_name,'Unassigned') AS owner
     FROM crm_leads l
     JOIN branches b ON b.id=l.branch_id
     LEFT JOIN crm_classes c ON c.id=l.class_id
     LEFT JOIN crm_lead_stages s ON s.id=l.stage_id
     LEFT JOIN employees e ON e.id=l.owner_employee_id
     WHERE l.id IN (${placeholders}) AND l.business_unit_id=?
     ORDER BY FIELD(l.id,${placeholders})`,
        [...leadIds, Number(req.businessUnit.id), ...leadIds],
    );
    const escapeCsv = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const referralByLead = new Map((details.referrals || []).map(item => [Number(item.leadId), item]));
    const transitionByLead = new Map((details.transitions || []).map(item => [Number(item.leadId), item]));
    const baseHeader = ['Lead ID', 'Student', 'Phone', 'Current Branch', 'Class'];
    let header = [...baseHeader, 'Current Stage', 'Current Owner'];
    let exportRows = rows.map(row => [row.leadNumber, row.studentName, row.phone, row.branch, row.className, row.stage, row.owner]);
    if (operation.operationType === 'referral') {
        header = [...baseHeader, 'Referred From Owner', 'Referred From Branch', 'Referred To Owner', 'Referred To Branch'];
        exportRows = rows.map(row => {
            const audit = referralByLead.get(Number(row.id)) || {};
            return [row.leadNumber, row.studentName, row.phone, row.branch, row.className, audit.fromOwner || '—', audit.fromBranch || '—', audit.toOwner || details.employeeName || '—', audit.toBranch || details.branchName || '—'];
        });
    } else if (operation.operationType === 'stage_change') {
        header = [...baseHeader, 'Previous Stage', 'Previous Sub-stage', 'Changed To Stage', 'Changed To Sub-stage'];
        exportRows = rows.map(row => {
            const audit = transitionByLead.get(Number(row.id)) || {};
            return [row.leadNumber, row.studentName, row.phone, row.branch, row.className, audit.fromStage || '—', audit.fromSubstage || '—', audit.toStage || details.stageName || '—', audit.toSubstage || details.substageName || '—'];
        });
    }
    const csv = [header, ...exportRows]
        .map(row => row.map(escapeCsv).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bulk-${operation.operationType}-${operationId}.csv"`);
    res.send(`\uFEFF${csv}`);
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
     WHERE bu.business_unit_id=? AND ${scope.sql}
     ORDER BY bu.created_at_utc DESC
     LIMIT 100`,
        [Number(req.businessUnit.id), ...scope.params]
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
     WHERE bu.id=? AND bu.business_unit_id=? AND ${scope.sql}`,
        [Number(req.params.id), Number(req.businessUnit.id), ...scope.params]
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
        records: records.map(r => ({ ...r, validationErrors: parseJsonValue(r.validationErrors, []) })),
        events
    });
});

app.get('/api/bulk-uploads/:id/download-errors', authenticate, requireCrmAccess, requireLeadWrite, async (req, res) => {
    const scope = scopedWhere(req.user, 'bu.branch_id');
    const [[upload]] = await pool.execute(
        `SELECT id FROM crm_bulk_uploads bu WHERE bu.id=? AND bu.business_unit_id=? AND ${scope.sql}`,
        [Number(req.params.id), Number(req.businessUnit.id), ...scope.params]
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
        `SELECT id,file_name AS fileName FROM crm_bulk_uploads bu WHERE bu.id=? AND bu.business_unit_id=? AND ${scope.sql}`,
        [Number(req.params.id), Number(req.businessUnit.id), ...scope.params]
    );
    if (!upload) return res.status(404).json({ message: 'Upload not found' });

    const [records] = await pool.execute(
        `SELECT bur.\`row_number\` AS rowNumber,bur.\`status\`,bur.source_data_json AS sourceData,
            l.student_name AS studentName,l.phone,l.class_id AS classId,
            camp.display_name AS campaignName,l.substage_id AS substageId,
            owner_user.email AS assignTo,l.source_id AS sourceId,l.remarks
     FROM crm_bulk_upload_records bur
     LEFT JOIN crm_leads l ON l.id=bur.lead_id
     LEFT JOIN crm_campaigns camp ON camp.id=l.campaign_id
     LEFT JOIN app_users owner_user ON owner_user.employee_id=l.owner_employee_id
     WHERE bur.bulk_upload_id=?
     ORDER BY bur.\`row_number\``,
        [Number(req.params.id)]
    );

    // New uploads retain the exact source row. Older uploads fall back to the
    // original template columns reconstructed from the created lead.
    const fallbackRow = record => ({
        'Student Name': record.studentName || '', Phone: record.phone || '', 'Class ID': record.classId || '',
        'Campaign Name': record.campaignName || '', 'Sub-stage ID': record.substageId || '',
        'Assign To': record.assignTo || '', 'Source ID': record.sourceId || '', Remarks: record.remarks || '',
    });
    const sourceRows = records.map(record => {
        const source = parseJsonValue(record.sourceData, null);
        return source && typeof source === 'object' && !Array.isArray(source) ? source : fallbackRow(record);
    });
    const headers = [...new Set(sourceRows.flatMap(row => Object.keys(row)))];
    const csvRows = [[...headers, 'Status']];
    records.forEach((record, index) => csvRows.push([...headers.map(header => sourceRows[index][header] ?? ''), record.status || '']));

    const csv = csvRows.map(row => row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    const baseName = String(upload.fileName || `bulk-upload-${Number(req.params.id)}.csv`).replace(/\.csv$/i, '').replace(/[^a-z0-9._-]+/gi, '-');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}-status.csv"`);
    res.send(`\uFEFF${csv}`);
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
            `INSERT INTO crm_bulk_uploads (business_unit_id, branch_id, file_name, uploaded_by_user_id, total_records)
       VALUES (?, ?, ?, ?, ?)`,
            [Number(req.businessUnit.id), branchId, fileName, Number(req.user.id), records.length]
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
                `INSERT INTO crm_bulk_upload_records (bulk_upload_id, \`row_number\`, \`status\`, validation_errors, source_data_json)
         VALUES (?, ?, 'pending', ?, ?)`,
                [uploadId, i + 1, JSON.stringify({}), JSON.stringify(records[i].sourceData || records[i])]
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
        /* The unit that owns this upload, and the rule it matches
           duplicates on. Read once: it is the same for every row, and the
           loop below runs thousands of times. */
        const [[uploadRow]] = await connection.execute(
            'SELECT business_unit_id AS businessUnitId FROM crm_bulk_uploads WHERE id=? LIMIT 1', [uploadId]);
        const uploadBusinessUnitId = Number(uploadRow?.businessUnitId) || null;
        const uploadDuplicateRule = await loadDuplicateRule(connection, uploadBusinessUnitId);

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
                const normalizedPhone = normalizeIndianMobile(record.phone);
                // Same rule as every other intake, so a row that would be a
                // duplicate on the Add lead form is one here too.
                const { lead: existing } = await findDuplicateLead(connection, {
                    businessUnitId: uploadBusinessUnitId,
                    record: { ...record, branchId, normalizedPhone },
                    rule: uploadDuplicateRule,
                });

                if (existing) {
                    const enquiry = await appendLeadSourceOrDetectDuplicate(connection, existing, record, 'bulk', userId);
                    if (enquiry.duplicate) duplicateCount++;
                    else successCount++;
                    await connection.execute(
                        `UPDATE crm_bulk_upload_records SET lead_id=? WHERE bulk_upload_id=? AND \`row_number\`=?`,
                        [existing.id, uploadId, rowNum]
                    );
                    continue;
                }

                // Create lead
                const temporaryNumber = `PENDING-${crypto.randomUUID()}`;
                const [result] = await connection.execute(
                    `INSERT INTO crm_leads (business_unit_id, lead_number, branch_id, student_name, phone, normalized_phone, alternate_phone, email,
           applying_class, class_id, curriculum_id, academic_year, parent_name, city, stage_id, source_id,
           owner_employee_id, channel_id, campaign_id, admission_type_id, substage_id,
           lead_score, remarks, next_followup_at_utc, created_by_user_id)
           VALUES ((SELECT business_unit_id FROM crm_bulk_uploads WHERE id=?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [uploadId, temporaryNumber, branchId, cleanOptional(record.studentName, 200), cleanOptional(record.phone, 30),
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

                await notifyEmployee(connection, {
                    businessUnitId: Number(req.businessUnit.id), employeeId: Number(record.ownerEmployeeId), actorUserId: userId,
                    type: 'lead_assigned', title: 'New lead added from bulk upload', message: `${cleanOptional(record.studentName, 200) || 'New lead'} · ${leadNumber}`,
                    link: `/leads?lead=${Number(result.insertId)}`, entityType: 'lead', entityId: Number(result.insertId)
                });

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
        ).catch(() => { });
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
             FROM crm_admission_class_configurations acc
             JOIN crm_admission_class_configuration_details accd
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
                        `SELECT id,channel_id AS channelId FROM crm_lead_sources WHERE id = ? AND is_active = TRUE LIMIT 1`,
                        [Number(record.sourceId)]
                    );
                    if (!sourceData) {
                        errors.push(`Source ID ${record.sourceId} not found or inactive`);
                    } else if (!sourceData.channelId) {
                        errors.push(`Source ID ${record.sourceId} is not mapped to a Channel in configuration`);
                    } else {
                        record.sourceId = Number(record.sourceId);
                        record.channelId = Number(sourceData.channelId);
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
                const normalizedPhone = normalizeIndianMobile(record.phone);
                if (!isValidIndianMobile(record.phone)) {
                    errors.push('Phone must be a valid Indian mobile number');
                }
                record.normalizedPhone = normalizedPhone;
            }

            // ==== STEP 6: Check for duplicates (only if all other validations pass) ====
            if (errors.length === 0 && record.normalizedPhone && record.branchId) {
                try {
                    const [[existing]] = await pool.execute(
                        `SELECT l.id FROM crm_leads l JOIN crm_lead_source_history h ON h.lead_id=l.id
             WHERE l.branch_id=? AND l.normalized_phone=? AND h.source_id=? AND l.deleted_at_utc IS NULL LIMIT 1`,
                        [record.branchId, record.normalizedPhone, Number(record.sourceId)]
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
            `INSERT INTO crm_bulk_uploads (business_unit_id, branch_id, file_name, uploaded_by_user_id, total_records, status, processing_started_at_utc)
       VALUES (?, ?, ?, ?, ?, 'Validating', CURRENT_TIMESTAMP(6))`,
            [Number(req.businessUnit.id), userBranchId, fileName, userId, records.length]
        );
        const newUploadId = result.insertId;

        // STEP 2: Run validation and save results to database
        let successCount = 0;
        let failureCount = 0;
        let duplicateCount = 0;


        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const rowNum = i + 1;
            const errors = [];


            // ==== STEP 1: Validate Class ID (Master Key) ====
            if (!record.classId) {
                errors.push('Class ID is required');
            } else {
                try {
                    const [[accData]] = await connection.execute(
                        `SELECT acc.id, acc.academic_year, acc.branch_id, acc.admission_type_id, c.id as curriculum_id
             FROM crm_admission_class_configurations acc
             JOIN crm_admission_class_configuration_details accd
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
                            `SELECT id,channel_id AS channelId FROM crm_lead_sources WHERE id = ? AND is_active = TRUE LIMIT 1`,
                            [sourceIdNum]
                        );
                        if (!sourceData) {
                            errors.push(`Source ID '${record.sourceId}' not found or inactive`);
                        } else {
                            record.sourceId = sourceIdNum;
                            if (!sourceData.channelId) errors.push(`Source ID '${record.sourceId}' is not mapped to a Channel in configuration`);
                            else record.channelId = Number(sourceData.channelId);
                        }
                    } catch (err) {
                        errors.push(`Error validating Source ID: ${err.message}`);
                    }
                }
            }


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
                const normalizedPhone = normalizeIndianMobile(record.phone);
                if (!isValidIndianMobile(record.phone)) {
                    errors.push('Phone must be a valid Indian mobile number');
                }
                record.normalizedPhone = normalizedPhone;
            }

            // ==== STEP 6: Check for duplicates (only if all other validations pass) ====
            if (errors.length === 0 && record.normalizedPhone && record.branchId) {
                try {
                    const [[existing]] = await connection.execute(
                        `SELECT l.id FROM crm_leads l JOIN crm_lead_source_history h ON h.lead_id=l.id
             WHERE l.branch_id=? AND l.normalized_phone=? AND h.source_id=? AND l.deleted_at_utc IS NULL LIMIT 1`,
                        [record.branchId, record.normalizedPhone, Number(record.sourceId)]
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
                await connection.execute(
                    `INSERT INTO crm_bulk_upload_records (bulk_upload_id, \`row_number\`, \`status\`, source_data_json)
           VALUES (?, ?, 'Pending', ?)`,
                    [newUploadId, rowNum, JSON.stringify(record.sourceData || record)]
                );
            } else {
                failureCount++;
                await connection.execute(
                    `INSERT INTO crm_bulk_upload_records (bulk_upload_id, \`row_number\`, validation_errors, \`status\`, source_data_json)
           VALUES (?, ?, ?, 'Failed', ?)`,
                    [newUploadId, rowNum, JSON.stringify(errors).slice(0, 1000), JSON.stringify(record.sourceData || record)]
                );
            }
        }


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
                `UPDATE crm_bulk_uploads SET status=?,processed_records=?,successful_records=?,failed_records=?,duplicate_records=?,
                processing_completed_at_utc=CURRENT_TIMESTAMP(6) WHERE id=?`,
                [uploadStatus, records.length, successCount, failureCount, duplicateCount, newUploadId]
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
        await connection.rollback().catch(() => { });
        console.error('Import error:', error);
        res.status(500).json({ message: `Import error: ${error.message}` });
    } finally {
        connection.release();
    }
});

// Helper function to process lead creation during import
async function processBulkUploadImport(uploadId, records, branchId, userId, pool) {
    const connection = await pool.getConnection();
    try {
        await connection.execute(`UPDATE crm_bulk_uploads SET processing_started_at_utc=CURRENT_TIMESTAMP(6) WHERE id=?`, [uploadId]);
        /* The unit that owns this upload, and the rule it matches
           duplicates on. Read once: it is the same for every row, and the
           loop below runs thousands of times. */
        const [[uploadRow]] = await connection.execute(
            'SELECT business_unit_id AS businessUnitId FROM crm_bulk_uploads WHERE id=? LIMIT 1', [uploadId]);
        const commitBusinessUnitId = Number(uploadRow?.businessUnitId) || null;
        const commitDuplicateRule = await loadDuplicateRule(connection, commitBusinessUnitId);

        // Query database for records with status='Pending' (validation passed)
        const [pendingRecords] = await connection.execute(
            `SELECT \`row_number\` FROM crm_bulk_upload_records WHERE bulk_upload_id=? AND \`status\`='Pending'`,
            [uploadId]
        );


        let successCount = 0, failureCount = 0, duplicateCount = 0;
        const errors = [];

        // Process only records that passed validation

        for (const pendingRecord of pendingRecords) {
            const rowNum = pendingRecord.row_number;
            const record = records[rowNum - 1]; // records array is 0-indexed, row_number is 1-indexed


            if (!record) {
                console.error(`[BULK-IMPORT-ERROR] Row ${rowNum}: Record data not found in memory`);
                failureCount++;
                await connection.execute(
                    `UPDATE crm_bulk_upload_records SET validation_errors=?, \`status\`='Failed'
           WHERE bulk_upload_id=? AND \`row_number\`=?`,
                    [JSON.stringify({ error: 'Internal error: record data not found' }), uploadId, rowNum]
                );
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
                const normalizedPhone = normalizeIndianMobile(record.phone);
                const { lead: existing } = await findDuplicateLead(connection, {
                    businessUnitId: commitBusinessUnitId,
                    record: { ...record, branchId, normalizedPhone },
                    rule: commitDuplicateRule,
                });

                if (existing) {
                    const enquiry = await appendLeadSourceOrDetectDuplicate(connection, existing, record, 'bulk', userId);
                    if (enquiry.duplicate) duplicateCount++;
                    else successCount++;
                    await connection.execute(
                        `UPDATE crm_bulk_upload_records SET lead_id=? WHERE bulk_upload_id=? AND \`row_number\`=?`,
                        [existing.id, uploadId, rowNum]
                    );
                    continue;
                }

                // Create lead - use pre-validated values (all required fields already verified)
                const temporaryNumber = `PENDING-${crypto.randomUUID()}`;
                const params = [uploadId, temporaryNumber, Number(record.branchId), cleanOptional(record.studentName, 200), cleanOptional(record.phone, 30),
                    record.normalizedPhone, Number(record.classId), Number(record.curriculumId),
                    record.academicYear, Number(record.stageId), Number(record.sourceId),
                    Number(record.channelId), Number(record.ownerEmployeeId), Number(record.campaignId), Number(record.admissionTypeId), Number(record.substageId),
                    cleanOptional(record.remarks, 10000), followupValidation.nextFollowupAt, userId];

                // Convert undefined to null for MySQL compatibility
                const safeParams = params.map(p => p === undefined ? null : p);


                const sqlInsert = `INSERT INTO crm_leads (business_unit_id,lead_number, branch_id, student_name, phone, normalized_phone,
           class_id, curriculum_id, academic_year, stage_id, source_id,
           channel_id, owner_employee_id, campaign_id, admission_type_id, substage_id,
           remarks, next_followup_at_utc, created_by_user_id)
           VALUES ((SELECT business_unit_id FROM crm_bulk_uploads WHERE id=?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;


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

                await notifyEmployee(connection, {
                    businessUnitId: Number(req.businessUnit.id), employeeId: Number(record.ownerEmployeeId), actorUserId: userId,
                    type: 'lead_assigned', title: 'New lead added from bulk upload', message: `${cleanOptional(record.studentName, 200) || 'New lead'} · ${leadNumber}`,
                    link: `/leads?lead=${Number(leadResult.insertId)}`, entityType: 'lead', entityId: Number(leadResult.insertId)
                });

                await connection.execute(
                    `UPDATE crm_bulk_upload_records SET lead_id=?, created_lead_number=?, processed_at_utc=CURRENT_TIMESTAMP(6)
           WHERE bulk_upload_id=? AND \`row_number\`=?`,
                    [leadResult.insertId, leadNumber, uploadId, rowNum]
                );

                // Commit transaction for this row
                await connection.commit();
                successCount++;
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
        ).catch(() => { });
        throw error;
    } finally {
        connection.release();
    }
}

// ============= Integration Hub Routes =============
app.use('/api/hub', createIntegrationHubRoutes(integrationHubService, authenticate, requireCrmAccess));
app.use('/api/platform', createBusinessPlatformRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin, hashAttendancePassword, integrationHubService));
app.use('/api/usage', createUsageRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin));
app.use('/api/callerdesk', createCallerDeskRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin));
app.use('/api/callerdesk', createCallerDeskWebhookRoutes(pool));
app.use('/api/smartflo', createSmartfloRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin));
app.use('/api/smartflo', createSmartfloWebhookRoutes(pool));
app.use('/api/jodo/payment-links', createJodoPaymentLinkRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin));
app.use('/api/jodo/payment-link-batches', createPaymentLinkBatchRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin));
app.use('/api/webhooks/jodo', createJodoWebhookRoutes(pool));
app.use('/api/rbac', createRbacRoutes(pool, authenticate, requireCrmAccess, console));
app.use('/api/branches', createBranchesRoutes(pool, authenticate, requireCrmAccess));
app.use('/api/payment-forms', createPaymentFormsRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin));
// Partner write-back (SmatBot AI qualification). Authenticated by API key,
// not by a user session, so it sits outside `authenticate` deliberately.
app.use('/api/partner', createPartnerRoutes(pool));
app.use('/api/report-data-sources', createReportDataSourceRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin));
app.use('/api/business-config', createBusinessConfigRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin));
app.use('/api/sms', createSmsTemplateRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin, integrationHubService));
app.use('/api/email', createEmailRoutes(pool, authenticate, requireCrmAccess, emailAttachmentDirectory));

// ============= Meta Lead Ads =============
// Webhook first: it is public, and mounting it ahead of the authenticated
// router keeps Meta's unauthenticated callbacks from hitting the JWT gate.
app.use('/api/meta', createMetaWebhookRoutes(pool, console));
app.use('/api/meta', createMetaRemarketingRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin, console));
app.use('/api/meta', createMetaRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin, console));

// ============= WhatsApp Template Routes =============
app.use('/api/whatsapp', createWhatsAppTemplateRoutes(pool, authenticate, console));

// ============= Webhook Routes (for AiSensy updates) =============
const whatsappWebhookRoutes = createWebhookRoutes(pool, console);
app.use('/api/webhooks', whatsappWebhookRoutes);
// Backward-compatible URL used by existing Smartping/AiSensy integrations.
app.use('/api/hub', whatsappWebhookRoutes);
app.use('/hub', whatsappWebhookRoutes);
// Smartping's webhook is registered as the bare domain, so its message
// callbacks POST to "/" with no path. Apache forwards root POSTs here
// (see deploy/apache/install-api-proxy.sh); GET "/" still serves the SPA.
app.post('/', whatsappWebhookRoutes);

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
    await ensureAutomationRuntimeSchema(pool);
    await ensureMarketingCampaignSchema(pool);
    // Sync the permission registry and seed stock roles. Deliberately not fatal:
    // a permissions problem should not stop the CRM from starting, and with
    // enforcement defaulting to audit an unseeded install still behaves exactly
    // as it did before.
    await bootstrapRbac(pool, console).catch((error) => {
        console.warn(`[rbac] bootstrap skipped: ${error.message}`);
    });
} catch (error) {
    console.error(`CRM API startup failed: ${error.message}`);
    process.exit(1);
}

let automationCycleRunning = false;
const runAutomationCycle = async () => {
    if (automationCycleRunning) return;
    automationCycleRunning = true;
    try {
        await automationEngine.run();
    } catch (error) {
        console.error('Automation workflow cycle failed:', error.message);
    } finally {
        automationCycleRunning = false;
    }
};
setInterval(runAutomationCycle, 30_000).unref();
runAutomationCycle();

let marketingCampaignCycleRunning = false;
const runMarketingCampaignCycle = async () => {
    if (marketingCampaignCycleRunning) return;
    marketingCampaignCycleRunning = true;
    try {
        await marketingCampaignEngine.run();
    } catch (error) {
        console.error('Bulk marketing campaign cycle failed:', error.message);
    } finally {
        marketingCampaignCycleRunning = false;
    }
};
setInterval(runMarketingCampaignCycle, 30_000).unref();
runMarketingCampaignCycle();

/*
 * Uploaded mobile numbers become payment links here, a chunk at a time. Kept
 * on its own cycle rather than inside the upload request: each row is a Jodo
 * call and a WhatsApp send, and the work has to survive a restart.
 */
let paymentLinkBatchCycleRunning = false;
const runPaymentLinkBatchCycle = async () => {
    if (paymentLinkBatchCycleRunning) return;
    paymentLinkBatchCycleRunning = true;
    try {
        await paymentLinkBatchEngine.run();
    } catch (error) {
        console.error('Bulk payment link cycle failed:', error.message);
    } finally {
        paymentLinkBatchCycleRunning = false;
    }
};
setInterval(runPaymentLinkBatchCycle, 30_000).unref();
runPaymentLinkBatchCycle();

/*
 * Automatic remarketing audiences.
 *
 * Claims one due audience at a time by moving its next_sync_at forward
 * before syncing, so an overrunning sync cannot be started twice. Each run
 * sends only the leads that changed -- syncAudience diffs against the
 * materialised membership rather than re-uploading the audience.
 */
let remarketingCycleRunning = false;
const runRemarketingCycle = async () => {
    if (remarketingCycleRunning) return;
    remarketingCycleRunning = true;
    try {
        const [due] = await pool.execute(
            `SELECT id, sync_type, sync_interval FROM crm_remarketing_audiences
              WHERE sync_type='automatic' AND status IN ('active','draft','error')
                AND next_sync_at_utc IS NOT NULL AND next_sync_at_utc <= CURRENT_TIMESTAMP(6)
              ORDER BY next_sync_at_utc LIMIT 5`,
        );
        for (const audience of due) {
            const [claim] = await pool.execute(
                `UPDATE crm_remarketing_audiences SET next_sync_at_utc=?
                  WHERE id=? AND next_sync_at_utc <= CURRENT_TIMESTAMP(6)`,
                [nextRemarketingSyncAt(audience), audience.id],
            );
            if (!claim.affectedRows) continue;
            try {
                await syncRemarketingAudience(pool, audience.id, { triggeredBy: 'schedule', logger: console });
            } catch (error) {
                // Already recorded on the audience and in its sync log.
                console.error(`Remarketing audience ${audience.id} sync failed: ${error.message}`);
            }
        }
    } catch (error) {
        console.error('Remarketing sync cycle failed:', error.message);
    } finally {
        remarketingCycleRunning = false;
    }
};
setInterval(runRemarketingCycle, 60_000).unref();
runRemarketingCycle();

app.listen(port, () => {
    console.log(`Admissions CRM API running at http://localhost:${port}`);
    console.log(`Data mode: ${process.env.MYSQL_DATABASE} MySQL (required)`);
});
