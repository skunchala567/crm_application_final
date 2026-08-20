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

  /** Loads a section only if it belongs to the caller's business unit. */
  async function ownedSection(req, sectionId) {
    const [[section]] = await pool.execute(
      `SELECT id, business_unit_id AS businessUnitId, section_key AS sectionKey,
              display_name AS displayName, section_type AS sectionType,
              parent_section_id AS parentSectionId
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
    const [sections] = await pool.execute(
      `SELECT id, parent_section_id AS parentSectionId, section_key AS sectionKey,
              display_name AS displayName, description,
              placeholder, child_label AS childLabel, child_placeholder AS childPlaceholder,
              section_type AS sectionType, position, is_active AS isActive
       FROM crm_config_sections
       WHERE business_unit_id=?
       ORDER BY position, display_name`,
      [unitId(req)],
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
    const [result] = await pool.execute(
      `INSERT INTO crm_config_sections
        (business_unit_id, parent_section_id, section_key, display_name, description, placeholder,
         child_label, child_placeholder, section_type, position, is_active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        unitId(req),
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
    res.status(201).json({ data: { id: result.insertId, sectionKey, parentSectionId } });
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

    await pool.execute(
      `UPDATE crm_config_sections
       SET parent_section_id=?, display_name=?, description=?, placeholder=?, child_label=?, child_placeholder=?,
           section_type=?, is_active=?, updated_at_utc=CURRENT_TIMESTAMP(6)
       WHERE id=?`,
      [
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
    res.json({ data: { id: section.id, sectionType, parentSectionId } });
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

  return router;
}

export default createBusinessConfigRoutes;
