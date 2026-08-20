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
  /**
   * Which pipelines each branch appears in.
   *
   * Returned as a flat list of pairs rather than one row per branch, so a
   * branch with no restriction simply has no pairs -- and "no rows means
   * every pipeline" stays a property of the data instead of something each
   * caller has to remember to reconstruct.
   */
  router.get('/pipelines', wrap(async (req, res) => {
    const [rows] = await pool.query(
      'SELECT branch_id AS branchId, pipeline_id AS pipelineId FROM crm_branch_pipelines');
    res.json({
      data: rows.map(row => ({ branchId: Number(row.branchId), pipelineId: Number(row.pipelineId) })),
    });
  }));

  /**
   * Replace one branch's pipelines.
   *
   * Only the branch named is touched, so two administrators editing
   * different branches cannot overwrite each other. An empty list clears the
   * restriction and returns the branch to every pipeline, which is the only
   * way back and so must not be mistaken for "hide it everywhere".
   */
  router.put('/:id/pipelines', wrap(async (req, res) => {
    const branchId = Number(req.params.id);
    if (!canAccessBranch(req.user, branchId)) {
      return res.status(403).json({ message: 'That branch is not one of yours' });
    }
    const isAdmin = req.user.roles?.some(role => ['CRM_ADMIN', 'SUPER_ADMIN'].includes(String(role).toUpperCase()));
    if (!isAdmin) return res.status(403).json({ message: 'Only a CRM administrator can change branch visibility' });

    const wanted = [...new Set((Array.isArray(req.body?.pipelineIds) ? req.body.pipelineIds : [])
      .map(Number).filter(id => Number.isInteger(id) && id > 0))];

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      // Checked against the unit, so a branch cannot be pinned to a pipeline
      // belonging to a business unit the caller is not working in.
      if (wanted.length) {
        const [valid] = await connection.query(
          `SELECT id FROM crm_lead_pipelines WHERE business_unit_id=? AND id IN (${wanted.map(() => '?').join(',')})`,
          [Number(req.businessUnit.id), ...wanted]);
        if (valid.length !== wanted.length) {
          await connection.rollback();
          return res.status(400).json({ message: 'One of those pipelines is not part of this business unit' });
        }
      }
      await connection.execute('DELETE FROM crm_branch_pipelines WHERE branch_id=?', [branchId]);
      for (const pipelineId of wanted) {
        await connection.execute(
          'INSERT INTO crm_branch_pipelines (branch_id, pipeline_id, created_by_user_id) VALUES (?,?,?)',
          [branchId, pipelineId, Number(req.user.id) || null]);
      }
      await connection.commit();
      res.json({
        data: { branchId, pipelineIds: wanted },
        message: wanted.length
          ? `Branch shown in ${wanted.length} pipeline${wanted.length === 1 ? '' : 's'}`
          : 'Branch shown in every pipeline',
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }));

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
