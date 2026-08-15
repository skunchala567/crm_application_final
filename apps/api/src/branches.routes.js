import { Router } from 'express';
import { branchScopeSql, canAccessBranch } from './rbac/branch-scope.js';

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createBranchesRoutes(pool, authenticate, requireCrmAccess) {
  const router = Router();
  router.use(authenticate, requireCrmAccess);

  router.get('/', wrap(async (req, res) => {
    const scope = branchScopeSql(req.user, 'id');
    const [rows] = await pool.execute(
      `SELECT id, branch_name, jodo_payment_enabled, jodo_collector_code
       FROM branches
       WHERE is_active = 1 AND ${scope.sql}
       ORDER BY branch_name`,
      scope.params
    );
    res.json({ data: rows.map(row => ({
      id: Number(row.id),
      branch_name: row.branch_name,
      jodo_payment_enabled: Boolean(row.jodo_payment_enabled),
      jodo_collector_code: row.jodo_collector_code,
    })) });
  }));

  /*
   * Flags, not values.
   *
   * This used to return jodo_api_key, jodo_secret_key and jodo_auth_header in
   * clear text to anyone who could open Branch Settings -- live payment
   * credentials, for every branch, over the wire and into the browser. The
   * form only ever needs to know whether a secret is already stored so it can
   * show it as set; it never needs to read it back. That is the rule the same
   * fields already follow in business-platform.routes.js, and this brings the
   * one endpoint that broke it into line.
   *
   * The non-secret settings -- base URL and collector code -- are still
   * returned, because those are edited as text rather than replaced wholesale.
   */
  router.get('/:id/jodo-config', wrap(async (req, res) => {
    if (!canAccessBranch(req.user, req.params.id)) {
      return res.status(404).json({ message: 'Branch not found' });
    }
    const [[branch]] = await pool.execute(
      `SELECT jodo_payment_enabled, jodo_collector_code, jodo_base_url,
              (jodo_api_key IS NOT NULL AND jodo_api_key <> '') AS apiKeySet,
              (jodo_secret_key IS NOT NULL AND jodo_secret_key <> '') AS secretKeySet,
              (jodo_auth_header IS NOT NULL AND jodo_auth_header <> '') AS authHeaderSet
       FROM branches
       WHERE id = ? AND is_active = 1`,
      [Number(req.params.id)]
    );
    if (!branch) return res.status(404).json({ message: 'Branch not found' });

    res.json({
      data: {
        jodo_payment_enabled: Boolean(branch.jodo_payment_enabled),
        jodo_collector_code: branch.jodo_collector_code || '',
        jodo_base_url: branch.jodo_base_url || '',
        // Empty, so a save that does not retype them leaves them alone.
        jodo_api_key: '',
        jodo_secret_key: '',
        jodo_auth_header: '',
        jodo_api_key_set: Boolean(branch.apiKeySet),
        jodo_secret_key_set: Boolean(branch.secretKeySet),
        jodo_auth_header_set: Boolean(branch.authHeaderSet),
      }
    });
  }));

  router.post('/:id/jodo-config', wrap(async (req, res) => {
    const branchId = Number(req.params.id);
    const { jodo_payment_enabled, jodo_api_key, jodo_secret_key, jodo_collector_code,
            jodo_base_url, jodo_auth_header } = req.body;

    // Payment credentials for a branch you do not have are not yours to set.
    if (!canAccessBranch(req.user, branchId)) {
      return res.status(404).json({ message: 'Branch not found' });
    }
    const [[branch]] = await pool.execute(
      'SELECT id FROM branches WHERE id = ? AND is_active = 1',
      [branchId]
    );
    if (!branch) return res.status(404).json({ message: 'Branch not found' });

    // Credentials are the branch's payment CAPABILITY; whether to actually
    // charge is decided per enquiry form. They are therefore stored on their
    // own merit and never cleared as a side effect of a flag -- doing that
    // used to wipe the API key and secret on any save that omitted it.
    const trimmed = (value) => {
      const text = String(value ?? '').trim();
      return text || null;
    };

    await pool.execute(
      `UPDATE branches
          SET jodo_payment_enabled = ?,
              jodo_api_key = COALESCE(?, jodo_api_key),
              jodo_secret_key = COALESCE(?, jodo_secret_key),
              jodo_collector_code = ?,
              jodo_base_url = ?,
              -- COALESCE like the key and secret: the header is masked in the
              -- form, so a save that leaves it untouched must not erase it.
              jodo_auth_header = COALESCE(?, jodo_auth_header)
        WHERE id = ?`,
      [
        jodo_payment_enabled === undefined ? 1 : (jodo_payment_enabled ? 1 : 0),
        trimmed(jodo_api_key),
        trimmed(jodo_secret_key),
        trimmed(jodo_collector_code),
        trimmed(jodo_base_url),
        trimmed(jodo_auth_header),
        branchId
      ]
    );

    res.json({ success: true, message: 'Jodo configuration updated' });
  }));

  return router;
}
