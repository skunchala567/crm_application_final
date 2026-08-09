import { Router } from 'express';

/**
 * Application usage tracking.
 *
 * The client counts ACTIVE seconds (it stops while the user is idle) and
 * posts deltas here. Each delta is added to that user's row for the given
 * calendar day, so reloads, extra tabs and re-logins all accumulate into a
 * single daily total.
 *
 * The date comes from the client because "today" must follow the user's own
 * calendar, not the server's timezone.
 */

/** A single heartbeat can never claim more than the interval it covers. */
const MAX_DELTA_SECONDS = 15 * 60;
/** No day can exceed 24h of active time. */
const MAX_DAY_SECONDS = 24 * 60 * 60;

const isoDate = (value) => {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
};

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createUsageRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin) {
  const router = Router();
  router.use(authenticate, requireCrmAccess);

  /**
   * Add active seconds to today's total.
   * Body: { seconds: number, date: 'YYYY-MM-DD' }
   */
  router.post('/heartbeat', wrap(async (req, res) => {
    const userId = Number(req.user.id);
    const date = isoDate(req.body?.date) || new Date().toISOString().slice(0, 10);

    // Clamp rather than reject: a laptop resuming from sleep would otherwise
    // post one enormous delta and skew the day.
    const seconds = Math.min(
      Math.max(Math.floor(Number(req.body?.seconds) || 0), 0),
      MAX_DELTA_SECONDS,
    );

    if (seconds > 0) {
      await pool.execute(
        `INSERT INTO crm_user_daily_usage
           (user_id, usage_date, active_seconds, heartbeat_count,
            first_activity_at_utc, last_activity_at_utc)
         VALUES (?,?,?,1,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))
         ON DUPLICATE KEY UPDATE
           active_seconds = LEAST(active_seconds + VALUES(active_seconds), ?),
           heartbeat_count = heartbeat_count + 1,
           last_activity_at_utc = CURRENT_TIMESTAMP(6)`,
        [userId, date, seconds, MAX_DAY_SECONDS],
      );
    }

    const [[row]] = await pool.execute(
      'SELECT active_seconds AS activeSeconds FROM crm_user_daily_usage WHERE user_id=? AND usage_date=?',
      [userId, date],
    );
    res.json({ success: true, data: { date, activeSeconds: Number(row?.activeSeconds || 0) } });
  }));

  /** Today's cumulative total, so the on-screen timer survives a reload. */
  router.get('/today', wrap(async (req, res) => {
    const date = isoDate(req.query?.date) || new Date().toISOString().slice(0, 10);
    const [[row]] = await pool.execute(
      `SELECT active_seconds AS activeSeconds, first_activity_at_utc AS firstActivityAt,
              last_activity_at_utc AS lastActivityAt
         FROM crm_user_daily_usage WHERE user_id=? AND usage_date=?`,
      [Number(req.user.id), date],
    );
    res.json({
      success: true,
      data: {
        date,
        activeSeconds: Number(row?.activeSeconds || 0),
        firstActivityAt: row?.firstActivityAt || null,
        lastActivityAt: row?.lastActivityAt || null,
      },
    });
  }));

  /**
   * Usage report. Admin-only: it exposes every user's activity.
   * Query: from, to (YYYY-MM-DD), optional userId.
   */
  router.get('/report', requireUserAdmin, wrap(async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const from = isoDate(req.query?.from) || today;
    const to = isoDate(req.query?.to) || today;
    const userId = Number(req.query?.userId) || null;

    const params = [from, to];
    let filter = '';
    if (userId) { filter = ' AND u.user_id=?'; params.push(userId); }

    const [rows] = await pool.execute(
      `SELECT u.user_id AS userId, u.usage_date AS usageDate,
              u.active_seconds AS activeSeconds, u.heartbeat_count AS heartbeatCount,
              u.first_activity_at_utc AS firstActivityAt, u.last_activity_at_utc AS lastActivityAt,
              COALESCE(e.employee_name, CONCAT_WS(' ', p.first_name, p.last_name), a.email) AS userName,
              a.email
         FROM crm_user_daily_usage u
         JOIN app_users a ON a.id = u.user_id
         LEFT JOIN employees e ON e.id = a.employee_id
         LEFT JOIN crm_user_profiles p ON p.user_id = a.id
        WHERE u.usage_date BETWEEN ? AND ?${filter}
        ORDER BY u.usage_date DESC, activeSeconds DESC`,
      params,
    );
    res.json({ success: true, data: rows });
  }));

  return router;
}
