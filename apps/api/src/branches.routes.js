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
      `SELECT jodo_payment_enabled, jodo_api_key, jodo_secret_key, jodo_collector_code
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
      }
    });
  }));

  router.post('/:id/jodo-config', wrap(async (req, res) => {
    const branchId = Number(req.params.id);
    const { jodo_payment_enabled, jodo_api_key, jodo_secret_key, jodo_collector_code } = req.body;

    const [[branch]] = await pool.execute(
      'SELECT id FROM branches WHERE id = ? AND is_active = 1',
      [branchId]
    );
    if (!branch) return res.status(404).json({ message: 'Branch not found' });

    if (jodo_payment_enabled && (!jodo_api_key || !jodo_secret_key)) {
      return res.status(400).json({ message: 'API key and secret key are required when Jodo is enabled' });
    }

    await pool.execute(
      `UPDATE branches
       SET jodo_payment_enabled = ?, jodo_api_key = ?, jodo_secret_key = ?, jodo_collector_code = ?
       WHERE id = ?`,
      [
        Boolean(jodo_payment_enabled) ? 1 : 0,
        jodo_payment_enabled ? (String(jodo_api_key).trim() || null) : null,
        jodo_payment_enabled ? (String(jodo_secret_key).trim() || null) : null,
        jodo_payment_enabled ? (String(jodo_collector_code).trim() || null) : null,
        branchId
      ]
    );

    res.json({ success: true, message: 'Jodo configuration updated' });
  }));

  return router;
}
