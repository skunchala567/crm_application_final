/**
 * Resolves who a new lead should be owned by under the Automations >
 * Assignment Rules screen, for intake paths that have no owner of their
 * own (Meta Lead Ads with no per-form default, the public enquiry form
 * with no per-form default owner). Leads added manually through the CRM,
 * or through imports that already require an explicit assignee, never
 * call this -- they keep their existing "the user picks, defaulting to
 * themselves" behaviour untouched.
 */

function parseIdArray(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed.map(Number) : [];
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {{businessUnitId:number, branchId:number|null, sourceId:number|null}} lead
 * @returns {Promise<number|null>} employee id to own the lead, or null if no active rule matches
 */
export async function resolveAssignmentRuleOwner(pool, { businessUnitId, branchId, sourceId }) {
  const unitId = Number(businessUnitId) || null;
  const branch = Number(branchId) || null;
  const source = Number(sourceId) || null;
  if (!unitId || !branch || !source) return null;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Row-locked so two leads landing at once don't read the same
    // next_assignee_index and hand both to the same person.
    const [rules] = await connection.query(
      `SELECT id, branch_ids_json AS branchIds, source_ids_json AS sourceIds,
              employee_ids_json AS employeeIds, next_assignee_index AS nextIndex
       FROM crm_assignment_rules
       WHERE business_unit_id=? AND is_active=TRUE
       ORDER BY id ASC
       FOR UPDATE`,
      [unitId],
    );
    const rule = rules.find((candidate) => {
      const branches = parseIdArray(candidate.branchIds);
      const sources = parseIdArray(candidate.sourceIds);
      return branches.includes(branch) && sources.includes(source);
    });
    if (!rule) {
      await connection.commit();
      return null;
    }

    const ruleEmployeeIds = parseIdArray(rule.employeeIds);
    if (!ruleEmployeeIds.length) {
      await connection.commit();
      return null;
    }
    // Employees can leave or lose CRM access after a rule is built; skip
    // anyone no longer eligible rather than assigning a lead to them.
    const [activeRows] = await connection.query(
      `SELECT e.id FROM employees e JOIN app_users u ON u.employee_id=e.id
       WHERE e.id IN (${ruleEmployeeIds.map(() => '?').join(',')}) AND e.status='Active' AND u.is_active=TRUE`,
      ruleEmployeeIds,
    );
    const activeIds = new Set(activeRows.map((row) => Number(row.id)));
    const eligible = ruleEmployeeIds.filter((id) => activeIds.has(id));
    if (!eligible.length) {
      await connection.commit();
      return null;
    }

    const currentIndex = Number(rule.nextIndex || 0) % eligible.length;
    const chosenEmployeeId = eligible[currentIndex];
    await connection.query(
      `UPDATE crm_assignment_rules SET next_assignee_index=? WHERE id=?`,
      [(currentIndex + 1) % eligible.length, rule.id],
    );
    await connection.commit();
    return chosenEmployeeId;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}
