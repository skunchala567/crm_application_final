/**
 * Configurable master data for a business unit.
 *
 * School Admissions has four fixed tabs whose tables crm_leads points at with
 * real foreign keys, so those stay where they are. Every other unit describes
 * its own master data through these routes: it decides which sections exist,
 * what each is called, and what its picker says.
 *
 * Sections form a tree. Each one names its parent, or none at all, so a unit
 * can nest them as deeply as it needs and hang any number of children off the
 * same parent -- and move a section under a different one later by changing
 * that single link.
 *
 * Separately, section_type says how the values inside one section behave:
 *   list       - plain code/name values, the shape Curriculum has today.
 *   hierarchy  - two named levels, where each sub-value belongs to one parent
 *                value, the way a sub-stage belongs to a stage. Kept for the
 *                units already using it; new sections nest as sections.
 *
 * A section may also name a pipeline. One unit can run pipelines that share
 * almost nothing -- admissions, franchise sales, a solar business -- and a
 * franchise lead has no curriculum. A section with no pipeline serves all of
 * them, which is what every section was before this existed.
 *
 * Link rules are the last piece. A section on its own can only list values;
 * a rule says which sections (and optionally which branch) form a key, and
 * which section answers it -- "at this branch, for this year, these are the
 * classes on offer". That is crm_admission_class_configurations with its four
 * fixed columns replaced by whatever sections the unit actually has.
 */
import { Router } from 'express';

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const fail = (status, message) => Object.assign(new Error(message), { status });

/** "Courses Offered" -> "courses_offered", so keys stay readable in the API. */
function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 70);
}

const text = (value, max) => {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

export function createBusinessConfigRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin) {
  const router = Router();
  router.use(authenticate, requireCrmAccess);

  const unitId = req => Number(req.businessUnit?.id) || 0;

  /** A pipeline id, but only if it belongs to the caller's unit. */
  async function ownedPipeline(req, pipelineId) {
    if (pipelineId === null || pipelineId === undefined || pipelineId === '') return null;
    const [[pipeline]] = await pool.execute(
      'SELECT id FROM crm_lead_pipelines WHERE id=? AND business_unit_id=?',
      [Number(pipelineId), unitId(req)],
    );
    if (!pipeline) throw fail(400, 'That lead pipeline is not part of this business unit');
    return Number(pipeline.id);
  }

  /** Loads a section only if it belongs to the caller's business unit. */
  async function ownedSection(req, sectionId) {
    const [[section]] = await pool.execute(
      `SELECT id, business_unit_id AS businessUnitId, section_key AS sectionKey,
              display_name AS displayName, section_type AS sectionType,
              parent_section_id AS parentSectionId, pipeline_id AS pipelineId
       FROM crm_config_sections WHERE id=? AND business_unit_id=?`,
      [Number(sectionId), unitId(req)],
    );
    if (!section) throw fail(404, 'Section not found');
    return section;
  }

  /** Same check, reached through a value rather than the section id. */
  async function ownedValue(req, valueId) {
    const [[row]] = await pool.execute(
      `SELECT v.id, v.section_id AS sectionId, v.parent_value_id AS parentValueId,
              s.section_type AS sectionType
       FROM crm_config_section_values v
       JOIN crm_config_sections s ON s.id = v.section_id
       WHERE v.id=? AND s.business_unit_id=?`,
      [Number(valueId), unitId(req)],
    );
    if (!row) throw fail(404, 'Value not found');
    return row;
  }

  /**
   * Validate a proposed parent for a section.
   *
   * Returns the parent id to store, or null for a top-level section.
   *
   * Three ways this can be wrong, and all three produce a tree that cannot
   * be rendered or walked: a parent in another business unit, a section
   * chosen as its own parent, and a parent that is already somewhere below
   * the section being moved -- A under B under C under A. The last is found
   * by walking up from the proposed parent: if the section being edited
   * appears on that path, the link would close a loop.
   */
  async function resolveParentSection(req, parentSectionId, sectionId = null) {
    if (parentSectionId === undefined || parentSectionId === null || parentSectionId === '') return null;
    const parentId = Number(parentSectionId);
    if (!Number.isInteger(parentId) || parentId <= 0) throw fail(400, 'Choose a valid parent section');
    if (sectionId && parentId === Number(sectionId)) throw fail(400, 'A section cannot be its own parent');

    const [[parent]] = await pool.execute(
      'SELECT id, display_name AS displayName, parent_section_id AS parentSectionId FROM crm_config_sections WHERE id=? AND business_unit_id=?',
      [parentId, unitId(req)],
    );
    if (!parent) throw fail(400, 'That parent section belongs to a different business unit');

    if (sectionId) {
      // Walk up from the proposed parent. The visited set is a belt-and-braces
      // stop for a loop that somehow already exists in the data.
      const visited = new Set([parentId]);
      let cursor = parent.parentSectionId;
      while (cursor) {
        if (Number(cursor) === Number(sectionId)) {
          throw fail(400, `"${parent.displayName}" already sits under this section, so it cannot also be its parent`);
        }
        if (visited.has(Number(cursor))) break;
        visited.add(Number(cursor));
        const [[next]] = await pool.execute(
          'SELECT parent_section_id AS parentSectionId FROM crm_config_sections WHERE id=?', [Number(cursor)],
        );
        cursor = next?.parentSectionId || null;
      }
    }
    return parentId;
  }

  // ---- Sections ----------------------------------------------------------

  router.get('/sections', wrap(async (req, res) => {
    /* ?pipelineId=N narrows to what that pipeline sees: its own sections
       plus the unit-wide ones. Without it, everything the unit has. */
    const scope = req.query.pipelineId ? await ownedPipeline(req, req.query.pipelineId) : null;
    const [sections] = await pool.execute(
      `SELECT id, pipeline_id AS pipelineId, parent_section_id AS parentSectionId,
              section_key AS sectionKey,
              display_name AS displayName, description,
              placeholder, child_label AS childLabel, child_placeholder AS childPlaceholder,
              section_type AS sectionType, position, is_active AS isActive
       FROM crm_config_sections
       WHERE business_unit_id=?
         AND (? IS NULL OR pipeline_id IS NULL OR pipeline_id=?)
       ORDER BY position, display_name`,
      [unitId(req), scope, scope],
    );
    if (!sections.length) return res.json({ data: [] });

    const ids = sections.map(section => section.id);
    const [values] = await pool.query(
      `SELECT id, section_id AS sectionId, parent_value_id AS parentValueId,
              value_code AS code, display_name AS displayName, position, is_active AS isActive
       FROM crm_config_section_values
       WHERE section_id IN (${ids.map(() => '?').join(',')})
       ORDER BY position, display_name`,
      ids,
    );

    /* How deep each section sits, so a caller can indent a tree without
       walking the list itself. Computed from the ids in hand; a link that
       points outside this unit (or at nothing) counts as top level. */
    const byId = new Map(sections.map(section => [Number(section.id), section]));
    const depthOf = (section, seen = new Set()) => {
      let depth = 0;
      let cursor = section.parentSectionId;
      while (cursor && byId.has(Number(cursor)) && !seen.has(Number(cursor))) {
        seen.add(Number(cursor));
        depth += 1;
        cursor = byId.get(Number(cursor)).parentSectionId;
      }
      return depth;
    };

    res.json({
      data: sections.map(section => {
        const mine = values
          .filter(value => value.sectionId === section.id)
          .map(value => ({ ...value, isActive: Boolean(value.isActive) }));
        // Sent as a tree so the editor does not have to assemble one, and a
        // list section simply has no children on any of its values.
        const roots = mine.filter(value => value.parentValueId === null);
        return {
          ...section,
          parentSectionId: section.parentSectionId === null ? null : Number(section.parentSectionId),
          pipelineId: section.pipelineId === null ? null : Number(section.pipelineId),
          depth: depthOf(section),
          isActive: Boolean(section.isActive),
          values: roots.map(root => ({
            ...root,
            children: mine.filter(value => Number(value.parentValueId) === Number(root.id)),
          })),
        };
      }),
    });
  }));

  router.post('/sections', requireUserAdmin, wrap(async (req, res) => {
    const displayName = text(req.body.displayName, 150);
    if (!displayName) throw fail(400, 'Enter a section name');
    const sectionType = req.body.sectionType === 'hierarchy' ? 'hierarchy' : 'list';
    const childLabel = text(req.body.childLabel, 150);
    if (sectionType === 'hierarchy' && !childLabel) throw fail(400, 'Name the sub-level, for example "Specialisation"');

    const base = slugify(req.body.sectionKey || displayName) || 'section';
    const [existing] = await pool.execute(
      'SELECT section_key AS sectionKey FROM crm_config_sections WHERE business_unit_id=?',
      [unitId(req)],
    );
    const taken = new Set(existing.map(row => row.sectionKey));
    let sectionKey = base;
    for (let suffix = 2; taken.has(sectionKey); suffix += 1) sectionKey = `${base}_${suffix}`;

    const [[last]] = await pool.execute(
      'SELECT COALESCE(MAX(position),0) AS maxPosition FROM crm_config_sections WHERE business_unit_id=?',
      [unitId(req)],
    );
    const parentSectionId = await resolveParentSection(req, req.body.parentSectionId);
    const pipelineId = await ownedPipeline(req, req.body.pipelineId);
    const [result] = await pool.execute(
      `INSERT INTO crm_config_sections
        (business_unit_id, pipeline_id, parent_section_id, section_key, display_name, description, placeholder,
         child_label, child_placeholder, section_type, position, is_active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        unitId(req),
        pipelineId,
        parentSectionId,
        sectionKey,
        displayName,
        text(req.body.description, 500),
        text(req.body.placeholder, 200),
        sectionType === 'hierarchy' ? childLabel : null,
        sectionType === 'hierarchy' ? text(req.body.childPlaceholder, 200) : null,
        sectionType,
        Number(last.maxPosition) + 1,
        req.body.isActive === false ? 0 : 1,
      ],
    );
    res.status(201).json({ data: { id: result.insertId, sectionKey, parentSectionId, pipelineId } });
  }));

  // Declared ahead of '/sections/:id' so Express does not read "reorder" as an id.
  router.put('/sections/reorder', requireUserAdmin, wrap(async (req, res) => {
    const order = Array.isArray(req.body.order) ? req.body.order : [];
    for (const [index, id] of order.entries()) {
      await pool.execute(
        'UPDATE crm_config_sections SET position=? WHERE id=? AND business_unit_id=?',
        [index + 1, Number(id), unitId(req)],
      );
    }
    res.json({ data: { reordered: order.length } });
  }));

  router.put('/sections/:id', requireUserAdmin, wrap(async (req, res) => {
    const section = await ownedSection(req, req.params.id);
    const displayName = text(req.body.displayName, 150);
    if (!displayName) throw fail(400, 'Enter a section name');

    /*
     * The type may change. Going from a list to a hierarchy is free -- every
     * existing value simply becomes a top-level one. The other direction is
     * not: sub-values would have nowhere to live, and promoting them could
     * collide, since two parents are each allowed a sub-value of the same
     * name. Refuse it while any exist and say so.
     */
    const sectionType = req.body.sectionType === 'hierarchy' ? 'hierarchy'
      : req.body.sectionType === 'list' ? 'list'
        : section.sectionType;
    if (sectionType === 'list' && section.sectionType === 'hierarchy') {
      const [[nested]] = await pool.execute(
        `SELECT COUNT(*) AS total FROM crm_config_section_values
         WHERE section_id=? AND parent_value_id IS NOT NULL`,
        [section.id],
      );
      if (Number(nested.total)) {
        throw fail(409, `Remove the ${nested.total} sub-value${nested.total === 1 ? '' : 's'} before turning this into a simple list`);
      }
    }

    const childLabel = text(req.body.childLabel, 150);
    if (sectionType === 'hierarchy' && !childLabel) {
      throw fail(400, 'Name the sub-level, for example "Specialisation"');
    }

    /* Re-parenting is the whole point of the tree: a section created on its
       own can be moved under another later. Omitting the field leaves the
       link alone, so an edit that only renames cannot silently detach it. */
    const parentSectionId = req.body.parentSectionId === undefined
      ? section.parentSectionId
      : await resolveParentSection(req, req.body.parentSectionId, section.id);

    // Same rule as the parent link: omitted means unchanged, so renaming a
    // section cannot quietly widen it to every pipeline.
    const pipelineId = req.body.pipelineId === undefined
      ? section.pipelineId
      : await ownedPipeline(req, req.body.pipelineId);

    await pool.execute(
      `UPDATE crm_config_sections
       SET pipeline_id=?, parent_section_id=?, display_name=?, description=?, placeholder=?, child_label=?, child_placeholder=?,
           section_type=?, is_active=?, updated_at_utc=CURRENT_TIMESTAMP(6)
       WHERE id=?`,
      [
        pipelineId,
        parentSectionId,
        displayName,
        text(req.body.description, 500),
        text(req.body.placeholder, 200),
        sectionType === 'hierarchy' ? childLabel : null,
        sectionType === 'hierarchy' ? text(req.body.childPlaceholder, 200) : null,
        sectionType,
        req.body.isActive === false ? 0 : 1,
        section.id,
      ],
    );
    res.json({ data: { id: section.id, sectionType, parentSectionId, pipelineId } });
  }));

  router.delete('/sections/:id', requireUserAdmin, wrap(async (req, res) => {
    const section = await ownedSection(req, req.params.id);
    /* Refuse rather than orphan. The foreign key would set the children's
       link to NULL and quietly promote a subtree to the top level, which is
       not something anyone asked for by pressing delete on one section. */
    const [[children]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM crm_config_sections WHERE parent_section_id=?', [section.id],
    );
    if (Number(children.total)) {
      throw fail(409, `"${section.displayName}" has ${children.total} section${Number(children.total) === 1 ? '' : 's'} under it. Move or delete ${Number(children.total) === 1 ? 'it' : 'them'} first.`);
    }
    // Values reference each other, so clear the sub-values before the parents
    // rather than leaving the order to the section's cascade.
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        'DELETE FROM crm_config_section_values WHERE section_id=? AND parent_value_id IS NOT NULL',
        [section.id],
      );
      await connection.execute('DELETE FROM crm_config_section_values WHERE section_id=?', [section.id]);
      await connection.execute('DELETE FROM crm_config_sections WHERE id=?', [section.id]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    res.json({ data: { id: section.id } });
  }));

  // ---- Values ------------------------------------------------------------

  router.post('/sections/:id/values', requireUserAdmin, wrap(async (req, res) => {
    const section = await ownedSection(req, req.params.id);
    const displayName = text(req.body.displayName, 200);
    if (!displayName) throw fail(400, 'Enter a value name');

    // A sub-value names its parent; the parent must sit in this same section
    // and be a top-level value, since the nesting is exactly two deep.
    let parentValueId = null;
    if (req.body.parentValueId) {
      if (section.sectionType !== 'hierarchy') throw fail(400, 'This section does not have sub-values');
      const parent = await ownedValue(req, req.body.parentValueId);
      if (Number(parent.sectionId) !== Number(section.id)) throw fail(400, 'That parent belongs to another section');
      if (parent.parentValueId !== null) throw fail(400, 'Sub-values cannot themselves have sub-values');
      parentValueId = Number(req.body.parentValueId);
    }

    const code = slugify(req.body.code || displayName) || 'value';
    const [[duplicate]] = await pool.execute(
      `SELECT id FROM crm_config_section_values
       WHERE section_id=? AND COALESCE(parent_value_id,0)=? AND value_code=?`,
      [section.id, parentValueId || 0, code],
    );
    if (duplicate) throw fail(409, `"${code}" already exists here`);

    const [result] = await pool.execute(
      `INSERT INTO crm_config_section_values
        (section_id, parent_value_id, value_code, display_name, position, is_active)
       VALUES (?,?,?,?,?,?)`,
      [
        section.id,
        parentValueId,
        code,
        displayName,
        Number(req.body.position) || 0,
        req.body.isActive === false ? 0 : 1,
      ],
    );
    res.status(201).json({ data: { id: result.insertId, code, parentValueId } });
  }));

  router.put('/values/:id', requireUserAdmin, wrap(async (req, res) => {
    const value = await ownedValue(req, req.params.id);
    const displayName = text(req.body.displayName, 200);
    if (!displayName) throw fail(400, 'Enter a value name');
    await pool.execute(
      `UPDATE crm_config_section_values
       SET display_name=?, position=?, is_active=?, updated_at_utc=CURRENT_TIMESTAMP(6)
       WHERE id=?`,
      [displayName, Number(req.body.position) || 0, req.body.isActive === false ? 0 : 1, value.id],
    );
    res.json({ data: { id: value.id } });
  }));

  router.delete('/values/:id', requireUserAdmin, wrap(async (req, res) => {
    const value = await ownedValue(req, req.params.id);
    // Deleting a parent takes its sub-values with it. The foreign key restricts
    // rather than cascades, so remove them here -- in one transaction, so a
    // failure cannot leave sub-values behind without their parent.
    const connection = await pool.getConnection();
    let removedChildren = 0;
    try {
      await connection.beginTransaction();
      const [children] = await connection.execute(
        'DELETE FROM crm_config_section_values WHERE parent_value_id=?',
        [value.id],
      );
      removedChildren = children.affectedRows;
      await connection.execute('DELETE FROM crm_config_section_values WHERE id=?', [value.id]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    res.json({ data: { id: value.id, removedChildren } });
  }));

  // ---- Link rules --------------------------------------------------------

  /**
   * The key a row is stored under: its branch and its key values, ordered so
   * the same combination always produces the same string whatever order the
   * form sent them in. This is what stops two rows claiming one combination,
   * standing in for the fixed composite unique key the academic table could
   * declare because its columns never varied.
   */
  function keySignature(branchId, pairs) {
    const parts = pairs
      .map(pair => `${Number(pair.sectionId)}:${Number(pair.valueId)}`)
      .sort();
    return [`branch:${Number(branchId) || 0}`, ...parts].join('|').slice(0, 500);
  }

  /** Loads a rule only if it belongs to the caller's business unit. */
  async function ownedRule(req, ruleId) {
    const [[rule]] = await pool.execute(
      `SELECT id, business_unit_id AS businessUnitId, pipeline_id AS pipelineId,
              rule_key AS ruleKey, display_name AS displayName, description,
              result_section_id AS resultSectionId, includes_branch AS includesBranch,
              is_active AS isActive
       FROM crm_config_link_rules WHERE id=? AND business_unit_id=?`,
      [Number(ruleId), unitId(req)],
    );
    if (!rule) throw fail(404, 'Configuration link not found');
    return rule;
  }

  /** The key sections of a rule, in the order the form should ask for them. */
  async function ruleSections(ruleId) {
    const [rows] = await pool.execute(
      `SELECT rs.section_id AS sectionId, s.display_name AS displayName, rs.position
       FROM crm_config_link_rule_sections rs
       JOIN crm_config_sections s ON s.id = rs.section_id
       WHERE rs.rule_id=? ORDER BY rs.position`,
      [Number(ruleId)],
    );
    return rows.map(row => ({ ...row, sectionId: Number(row.sectionId) }));
  }

  router.get('/link-rules', wrap(async (req, res) => {
    const scope = req.query.pipelineId ? await ownedPipeline(req, req.query.pipelineId) : null;
    const [rules] = await pool.execute(
      `SELECT r.id, r.pipeline_id AS pipelineId, p.display_name AS pipelineName,
              r.rule_key AS ruleKey, r.display_name AS displayName, r.description,
              r.result_section_id AS resultSectionId, rs.display_name AS resultSectionName,
              r.includes_branch AS includesBranch, r.position, r.is_active AS isActive,
              (SELECT COUNT(*) FROM crm_config_link_rows lr WHERE lr.rule_id=r.id) AS rowCount
       FROM crm_config_link_rules r
       JOIN crm_config_sections rs ON rs.id = r.result_section_id
       LEFT JOIN crm_lead_pipelines p ON p.id = r.pipeline_id
       WHERE r.business_unit_id=?
         AND (? IS NULL OR r.pipeline_id IS NULL OR r.pipeline_id=?)
       ORDER BY r.position, r.display_name`,
      [unitId(req), scope, scope],
    );

    const data = [];
    for (const rule of rules) {
      data.push({
        ...rule,
        pipelineId: rule.pipelineId === null ? null : Number(rule.pipelineId),
        resultSectionId: Number(rule.resultSectionId),
        includesBranch: Boolean(rule.includesBranch),
        isActive: Boolean(rule.isActive),
        rowCount: Number(rule.rowCount),
        keySections: await ruleSections(rule.id),
      });
    }
    res.json({ data });
  }));

  /**
   * A rule needs at least one key section or a branch, and a section to
   * answer with. Without a key it would return the same values to everyone,
   * which is what a plain section already does.
   */
  async function readRuleBody(req, ruleId = null) {
    const displayName = text(req.body.displayName, 150);
    if (!displayName) throw fail(400, 'Name this configuration link');

    const resultSectionId = Number(req.body.resultSectionId);
    if (!resultSectionId) throw fail(400, 'Choose the configuration this link should offer');
    await ownedSection(req, resultSectionId);

    const includesBranch = req.body.includesBranch !== false;
    const keySectionIds = [...new Set((Array.isArray(req.body.keySectionIds) ? req.body.keySectionIds : [])
      .map(Number).filter(Number.isFinite))];
    if (!includesBranch && !keySectionIds.length) {
      throw fail(400, 'Choose a branch or at least one configuration to key this link on');
    }
    if (keySectionIds.includes(resultSectionId)) {
      throw fail(400, 'A link cannot be keyed on the same configuration it offers');
    }
    for (const sectionId of keySectionIds) await ownedSection(req, sectionId);

    return {
      displayName,
      description: text(req.body.description, 500),
      resultSectionId,
      includesBranch,
      keySectionIds,
      pipelineId: await ownedPipeline(req, req.body.pipelineId),
      isActive: req.body.isActive === false ? 0 : 1,
      ruleId,
    };
  }

  router.post('/link-rules', requireUserAdmin, wrap(async (req, res) => {
    const body = await readRuleBody(req);

    const base = slugify(req.body.ruleKey || body.displayName) || 'link';
    const [existing] = await pool.execute(
      'SELECT rule_key AS ruleKey FROM crm_config_link_rules WHERE business_unit_id=?',
      [unitId(req)],
    );
    const taken = new Set(existing.map(row => row.ruleKey));
    let ruleKey = base;
    for (let suffix = 2; taken.has(ruleKey); suffix += 1) ruleKey = `${base}_${suffix}`;

    const [[last]] = await pool.execute(
      'SELECT COALESCE(MAX(position),0) AS maxPosition FROM crm_config_link_rules WHERE business_unit_id=?',
      [unitId(req)],
    );

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute(
        `INSERT INTO crm_config_link_rules
          (business_unit_id, pipeline_id, rule_key, display_name, description,
           result_section_id, includes_branch, position, is_active)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [unitId(req), body.pipelineId, ruleKey, body.displayName, body.description,
          body.resultSectionId, body.includesBranch ? 1 : 0, Number(last.maxPosition) + 1, body.isActive],
      );
      for (const [index, sectionId] of body.keySectionIds.entries()) {
        await connection.execute(
          'INSERT INTO crm_config_link_rule_sections (rule_id, section_id, position) VALUES (?,?,?)',
          [result.insertId, sectionId, index + 1],
        );
      }
      await connection.commit();
      res.status(201).json({ data: { id: result.insertId, ruleKey } });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }));

  router.put('/link-rules/:id', requireUserAdmin, wrap(async (req, res) => {
    const rule = await ownedRule(req, req.params.id);
    const body = await readRuleBody(req, rule.id);

    /*
     * Changing the key changes what every saved row means, and a row keyed on
     * sections that are no longer part of the rule cannot be read back. The
     * rows are removed rather than silently reinterpreted -- and the count is
     * returned so the screen can say so instead of the work vanishing quietly.
     */
    const before = (await ruleSections(rule.id)).map(section => section.sectionId).sort().join(',');
    const after = [...body.keySectionIds].sort().join(',');
    const keyChanged = before !== after || Boolean(rule.includesBranch) !== body.includesBranch
      || Number(rule.resultSectionId) !== body.resultSectionId;

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      let clearedRows = 0;
      if (keyChanged) {
        const [[count]] = await connection.execute(
          'SELECT COUNT(*) AS n FROM crm_config_link_rows WHERE rule_id=?', [rule.id]);
        clearedRows = Number(count.n);
        await connection.execute('DELETE FROM crm_config_link_rows WHERE rule_id=?', [rule.id]);
        await connection.execute('DELETE FROM crm_config_link_rule_sections WHERE rule_id=?', [rule.id]);
        for (const [index, sectionId] of body.keySectionIds.entries()) {
          await connection.execute(
            'INSERT INTO crm_config_link_rule_sections (rule_id, section_id, position) VALUES (?,?,?)',
            [rule.id, sectionId, index + 1],
          );
        }
      }
      await connection.execute(
        `UPDATE crm_config_link_rules
         SET pipeline_id=?, display_name=?, description=?, result_section_id=?,
             includes_branch=?, is_active=?, updated_at_utc=CURRENT_TIMESTAMP(6)
         WHERE id=?`,
        [body.pipelineId, body.displayName, body.description, body.resultSectionId,
          body.includesBranch ? 1 : 0, body.isActive, rule.id],
      );
      await connection.commit();
      res.json({ data: { id: rule.id, clearedRows } });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }));

  router.delete('/link-rules/:id', requireUserAdmin, wrap(async (req, res) => {
    const rule = await ownedRule(req, req.params.id);
    await pool.execute('DELETE FROM crm_config_link_rules WHERE id=?', [rule.id]);
    res.json({ data: { id: rule.id } });
  }));

  // ---- Link rows ---------------------------------------------------------

  /** The saved combinations of one rule, each with its key and its result. */
  router.get('/link-rules/:id/rows', wrap(async (req, res) => {
    const rule = await ownedRule(req, req.params.id);
    const [rows] = await pool.execute(
      `SELECT lr.id, lr.branch_id AS branchId, b.branch_name AS branchName, lr.is_active AS isActive
       FROM crm_config_link_rows lr
       LEFT JOIN branches b ON b.id = lr.branch_id
       WHERE lr.rule_id=? ORDER BY b.branch_name, lr.id`,
      [rule.id],
    );
    if (!rows.length) return res.json({ data: [], keySections: await ruleSections(rule.id) });

    const ids = rows.map(row => row.id);
    const [values] = await pool.query(
      `SELECT rv.row_id AS rowId, rv.section_id AS sectionId, rv.value_id AS valueId,
              rv.role, v.display_name AS displayName
       FROM crm_config_link_row_values rv
       JOIN crm_config_section_values v ON v.id = rv.value_id
       WHERE rv.row_id IN (${ids.map(() => '?').join(',')})
       ORDER BY v.position, v.display_name`,
      ids,
    );

    res.json({
      keySections: await ruleSections(rule.id),
      data: rows.map(row => ({
        id: Number(row.id),
        branchId: row.branchId === null ? null : Number(row.branchId),
        branchName: row.branchName,
        isActive: Boolean(row.isActive),
        key: values.filter(v => v.rowId === row.id && v.role === 'key')
          .map(v => ({ sectionId: Number(v.sectionId), valueId: Number(v.valueId), displayName: v.displayName })),
        result: values.filter(v => v.rowId === row.id && v.role === 'result')
          .map(v => ({ valueId: Number(v.valueId), displayName: v.displayName })),
      })),
    });
  }));

  /**
   * Save combinations.
   *
   * The screen sends a branch list and a value list per key section, the way
   * the admission class screen does, and every combination of those is
   * written -- picking six branches and two years fills twelve rows in one
   * go rather than twelve visits to the form. An existing combination has
   * its result replaced, so re-saving is a correction and not a duplicate.
   */
  router.post('/link-rules/:id/rows', requireUserAdmin, wrap(async (req, res) => {
    const rule = await ownedRule(req, req.params.id);
    const sections = await ruleSections(rule.id);

    const resultValueIds = [...new Set((Array.isArray(req.body.resultValueIds) ? req.body.resultValueIds : [])
      .map(Number).filter(Number.isFinite))];
    if (!resultValueIds.length) throw fail(400, 'Choose at least one value this combination allows');

    const branchIds = Boolean(rule.includesBranch)
      ? [...new Set((Array.isArray(req.body.branchIds) ? req.body.branchIds : []).map(Number).filter(Number.isFinite))]
      : [null];
    if (Boolean(rule.includesBranch) && !branchIds.length) throw fail(400, 'Choose at least one branch');

    /* One list of chosen values per key section, in rule order. A section
       with nothing chosen is a gap in the key, so the combination it would
       produce is not a combination at all. */
    const chosen = [];
    for (const section of sections) {
      const picked = [...new Set((req.body.keyValueIds?.[section.sectionId] || [])
        .map(Number).filter(Number.isFinite))];
      if (!picked.length) throw fail(400, `Choose at least one ${section.displayName}`);
      chosen.push({ sectionId: section.sectionId, valueIds: picked });
    }

    // Every combination of the chosen values, one row each.
    let combinations = [[]];
    for (const section of chosen) {
      combinations = combinations.flatMap(prefix =>
        section.valueIds.map(valueId => [...prefix, { sectionId: section.sectionId, valueId }]));
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      let created = 0;
      let updated = 0;
      for (const branchId of branchIds) {
        for (const pairs of combinations) {
          const signature = keySignature(branchId, pairs);
          const [[existing]] = await connection.execute(
            'SELECT id FROM crm_config_link_rows WHERE rule_id=? AND key_signature=? LIMIT 1',
            [rule.id, signature],
          );
          let rowId = existing?.id;
          if (rowId) {
            updated += 1;
            await connection.execute(
              `UPDATE crm_config_link_rows SET is_active=1, updated_by_user_id=?,
                      updated_at_utc=CURRENT_TIMESTAMP(6) WHERE id=?`,
              [Number(req.user?.id) || null, rowId],
            );
            // The key is unchanged by definition -- it is the signature we
            // matched on -- so only the result is rewritten.
            await connection.execute(
              "DELETE FROM crm_config_link_row_values WHERE row_id=? AND role='result'", [rowId]);
          } else {
            created += 1;
            const [inserted] = await connection.execute(
              `INSERT INTO crm_config_link_rows
                (rule_id, branch_id, key_signature, is_active, created_by_user_id, updated_by_user_id)
               VALUES (?,?,?,1,?,?)`,
              [rule.id, branchId, signature, Number(req.user?.id) || null, Number(req.user?.id) || null],
            );
            rowId = inserted.insertId;
            for (const pair of pairs) {
              await connection.execute(
                "INSERT INTO crm_config_link_row_values (row_id, section_id, value_id, role) VALUES (?,?,?,'key')",
                [rowId, pair.sectionId, pair.valueId],
              );
            }
          }
          for (const valueId of resultValueIds) {
            await connection.execute(
              "INSERT INTO crm_config_link_row_values (row_id, section_id, value_id, role) VALUES (?,?,?,'result')",
              [rowId, rule.resultSectionId, valueId],
            );
          }
        }
      }
      await connection.commit();
      const total = created + updated;
      res.status(201).json({
        data: { created, updated },
        message: `Saved ${total} combination${total === 1 ? '' : 's'}`,
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }));

  router.delete('/link-rules/:ruleId/rows/:rowId', requireUserAdmin, wrap(async (req, res) => {
    const rule = await ownedRule(req, req.params.ruleId);
    const [result] = await pool.execute(
      'DELETE FROM crm_config_link_rows WHERE id=? AND rule_id=?',
      [Number(req.params.rowId), rule.id],
    );
    if (!result.affectedRows) throw fail(404, 'Combination not found');
    res.json({ data: { id: Number(req.params.rowId) } });
  }));

  /**
   * What a rule allows for one branch and one set of key values.
   *
   * This is the read the lead form makes: it is the generic form of the
   * query that narrows the class dropdown once a branch and year are known.
   * Unanswered key sections simply widen the result rather than emptying it,
   * so a half-filled form still offers something sensible.
   */
  router.get('/link-rules/:id/resolve', wrap(async (req, res) => {
    const rule = await ownedRule(req, req.params.id);
    const branchId = Number(req.query.branchId) || null;

    /*
     * Key values arrive as repeated `k=sectionId:valueId`.
     *
     * Not `key[sectionId]=valueId`: Express 5 parses the query string with
     * Node's querystring, which does not build nested objects, so a bracketed
     * name arrives as the literal key "key[12]" and every filter silently
     * disappeared -- the endpoint answered as though no key had been sent.
     * The bracketed form is still read, for any caller already using it.
     */
    const pairs = [];
    const raw = req.query.k === undefined ? [] : [].concat(req.query.k);
    for (const entry of raw) {
      const [sectionId, valueId] = String(entry).split(':');
      if (Number(sectionId) && Number(valueId)) pairs.push([Number(sectionId), Number(valueId)]);
    }
    for (const [name, value] of Object.entries(req.query)) {
      const bracketed = name.match(/^key\[(\d+)\]$/);
      if (bracketed && Number(value)) pairs.push([Number(bracketed[1]), Number(value)]);
    }
    for (const [sectionId, valueId] of Object.entries(req.query.key || {})) {
      if (Number(sectionId) && Number(valueId)) pairs.push([Number(sectionId), Number(valueId)]);
    }

    const clauses = [];
    const params = [rule.id];
    if (Boolean(rule.includesBranch) && branchId) { clauses.push('lr.branch_id = ?'); params.push(branchId); }
    for (const [sectionId, valueId] of pairs) {
      clauses.push(`EXISTS (SELECT 1 FROM crm_config_link_row_values k
                     WHERE k.row_id=lr.id AND k.role='key' AND k.section_id=? AND k.value_id=?)`);
      params.push(sectionId, valueId);
    }

    const [values] = await pool.query(
      `SELECT DISTINCT v.id AS value, v.display_name AS label, v.position
       FROM crm_config_link_rows lr
       JOIN crm_config_link_row_values rv ON rv.row_id=lr.id AND rv.role='result'
       JOIN crm_config_section_values v ON v.id=rv.value_id AND v.is_active=TRUE
       WHERE lr.rule_id=? AND lr.is_active=TRUE
         ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
       ORDER BY v.position, v.display_name`,
      params,
    );
    res.json({ data: values.map(row => ({ value: Number(row.value), label: row.label })) });
  }));

  return router;
}

export default createBusinessConfigRoutes;
