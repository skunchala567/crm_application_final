import { Router } from 'express';

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createBranchesRoutes(pool, authenticate, requireCrmAccess) {
  const router = Router();
  router.use(authenticate, requireCrmAccess);

  router.get('/', wrap(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT id, branch_name, jodo_payment_enabled, jodo_collector_code
       FROM branches
       WHERE is_active = 1
       ORDER BY branch_name`
    );
    res.json({ data: rows.map(row => ({
      id: Number(row.id),
      branch_name: row.branch_name,
      jodo_payment_enabled: Boolean(row.jodo_payment_enabled),
      jodo_collector_code: row.jodo_collector_code,
    })) });
  }));

  router.get('/:id/jodo-config', wrap(async (req, res) => {
    const [[branch]] = await pool.execute(
      `SELECT jodo_payment_enabled, jodo_api_key, jodo_secret_key, jodo_collector_code,
              jodo_base_url, jodo_auth_header
       FROM branches
       WHERE id = ? AND is_active = 1`,
      [Number(req.params.id)]
    );
    if (!branch) return res.status(404).json({ message: 'Branch not found' });

    res.json({
      data: {
        jodo_payment_enabled: Boolean(branch.jodo_payment_enabled),
        jodo_api_key: branch.jodo_api_key || '',
        jodo_secret_key: branch.jodo_secret_key || '',
        jodo_collector_code: branch.jodo_collector_code || '',
        jodo_base_url: branch.jodo_base_url || '',
        jodo_auth_header: branch.jodo_auth_header || '',
      }
    });
  }));

  router.post('/:id/jodo-config', wrap(async (req, res) => {
    const branchId = Number(req.params.id);
    const { jodo_payment_enabled, jodo_api_key, jodo_secret_key, jodo_collector_code,
            jodo_base_url, jodo_auth_header } = req.body;

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
