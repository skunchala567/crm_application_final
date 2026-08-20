/**
 * What makes two leads the same lead.
 *
 * Every path that creates a lead -- the manual form, a public enquiry form,
 * a bulk upload, a Meta Lead Ads import, a Google Sheet sync -- has to ask
 * "do we already have this person?" before inserting. That question used to
 * be hardcoded as branch + mobile number in six different places, so the
 * answer could only ever be the same for every business unit.
 *
 * Here it is one question, asked once, from a rule the unit owns.
 *
 * The rule is an ordered list of field keys ANDed together. An unset rule
 * means branch + mobile, which is what the hardcoded checks did, so a unit
 * that is never configured behaves exactly as it did before.
 */

/*
 * Fields a rule may be built from.
 *
 * `column` is read straight off crm_leads. `from` says where the value comes
 * from on the record being tested, because the creation paths speak in
 * camelCase request bodies while the table speaks in columns.
 *
 * Only fields that identify a person or the thing they are enquiring about
 * are here. Stage, owner and follow-up are deliberately absent: they change
 * over a lead's life, so including one would make a lead stop being a
 * duplicate of itself the moment someone worked on it.
 */
export const DUPLICATE_FIELDS = {
  phone: { column: 'normalized_phone', label: 'Mobile number', group: 'Contact' },
  email: { column: 'email', label: 'Email', group: 'Contact' },
  student_name: { column: 'student_name', label: 'Name', group: 'Contact' },
  branch_id: { column: 'branch_id', label: 'Branch', group: 'Branches', numeric: true },
  city: { column: 'city', label: 'City', group: 'Contact' },
  academic_year: { column: 'academic_year', label: 'Academic year', group: 'Configuration' },
  class_id: { column: 'class_id', label: 'Class', group: 'Configuration', numeric: true },
  curriculum_id: { column: 'curriculum_id', label: 'Curriculum / course', group: 'Configuration', numeric: true },
  admission_type_id: { column: 'admission_type_id', label: 'Admission type', group: 'Configuration', numeric: true },
  source_id: { column: 'source_id', label: 'Source', group: 'Configuration', numeric: true },
};

/** What a unit does when it has never been configured. */
export const DEFAULT_DUPLICATE_RULE = ['branch_id', 'phone'];

/**
 * A stored rule, cleaned up.
 *
 * Unknown keys are dropped rather than rejected: a field can be removed
 * from a unit's configuration long after a rule mentioned it, and a lead
 * import is the wrong moment to fail over that. An empty result falls back
 * to the default, because a rule matching on nothing would make every new
 * lead a duplicate of the first one.
 */
export function normalizeDuplicateRule(raw) {
  const parsed = typeof raw === 'string' ? safeParse(raw) : raw;
  if (!Array.isArray(parsed)) return DEFAULT_DUPLICATE_RULE;
  const seen = new Set();
  const fields = [];
  for (const entry of parsed) {
    const key = String(entry || '').trim();
    if (!key || seen.has(key)) continue;
    if (!DUPLICATE_FIELDS[key] && !key.startsWith('custom:')) continue;
    seen.add(key);
    fields.push(key);
  }
  return fields.length ? fields : DEFAULT_DUPLICATE_RULE;
}

function safeParse(value) {
  try { return JSON.parse(value); } catch { return null; }
}

/** The rule this business unit matches duplicates on. */
export async function loadDuplicateRule(connection, businessUnitId) {
  if (!businessUnitId) return DEFAULT_DUPLICATE_RULE;
  const [[row]] = await connection.execute(
    'SELECT duplicate_rule_json FROM crm_business_units WHERE id=? LIMIT 1',
    [Number(businessUnitId)],
  );
  return normalizeDuplicateRule(row?.duplicate_rule_json);
}

/** Reads one field's value off a record, whatever shape that record is in. */
function valueFor(key, record) {
  if (key.startsWith('custom:')) {
    const name = key.slice('custom:'.length);
    const values = record.customValues || record.custom_values || {};
    return values?.[name];
  }
  const aliases = {
    phone: ['normalizedPhone', 'normalized_phone'],
    branch_id: ['branchId', 'branch_id'],
    class_id: ['classId', 'class_id'],
    curriculum_id: ['curriculumId', 'curriculum_id'],
    admission_type_id: ['admissionTypeId', 'admission_type_id'],
    academic_year: ['academicYear', 'academic_year'],
    source_id: ['sourceId', 'source_id'],
    student_name: ['studentName', 'student_name'],
    email: ['email'],
    city: ['city'],
  };
  for (const name of aliases[key] || [key]) {
    if (record[name] !== undefined && record[name] !== null && record[name] !== '') return record[name];
  }
  return null;
}

/**
 * Build the WHERE that finds an existing lead matching this record.
 *
 * Returns null when the record cannot answer every field in the rule. That
 * is deliberate: a partial match is a different question from the one the
 * unit asked, and answering it would either merge leads that are not the
 * same person or let through ones that are. The caller treats a null as
 * "cannot tell -- insert it", which is the safe direction, and says so.
 *
 * `alias` names the crm_leads table in the caller's query.
 */
export function buildDuplicateMatch(rule, record, { alias = 'l' } = {}) {
  const fields = normalizeDuplicateRule(rule);
  const clauses = [];
  const params = [];
  const used = [];

  for (const key of fields) {
    const value = valueFor(key, record);
    if (value === null || value === undefined || value === '') return null;

    if (key.startsWith('custom:')) {
      // Custom fields live in the lead's JSON blob, not a column of their own.
      clauses.push(`JSON_UNQUOTE(JSON_EXTRACT(${alias}.custom_values_json, ?)) = ?`);
      params.push(`$."${key.slice('custom:'.length)}"`, String(value));
    } else {
      const field = DUPLICATE_FIELDS[key];
      clauses.push(`${alias}.${field.column} = ?`);
      params.push(field.numeric ? Number(value) : String(value));
    }
    used.push(key);
  }

  if (!clauses.length) return null;
  return { sql: clauses.join(' AND '), params, fields: used, describe: describeRule(used) };
}

/** "branch, mobile number and class" -- for the message a user actually reads. */
export function describeRule(fields) {
  const labels = normalizeDuplicateRule(fields).map((key) => (
    key.startsWith('custom:') ? key.slice('custom:'.length) : (DUPLICATE_FIELDS[key]?.label || key)
  ).toLowerCase());
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * The one place that answers "do we already have this lead?".
 *
 * `connection` may be a pool or an open transaction; callers inside a
 * transaction pass theirs so the check and the insert see the same snapshot.
 * forUpdate locks the matched row, which is what stops two simultaneous
 * submissions of the same enquiry both deciding they are the first.
 */
export async function findDuplicateLead(connection, { businessUnitId, record, rule = null, forUpdate = false }) {
  const fields = rule || await loadDuplicateRule(connection, businessUnitId);
  const match = buildDuplicateMatch(fields, record);
  if (!match) return { lead: null, rule: fields, matched: false, reason: 'incomplete' };

  const [[lead]] = await connection.execute(
    `SELECT l.id, l.lead_number AS leadNumber FROM crm_leads l
      WHERE l.business_unit_id = ? AND l.deleted_at_utc IS NULL AND ${match.sql}
      ORDER BY l.id LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [Number(businessUnitId), ...match.params],
  );
  return { lead: lead || null, rule: fields, matched: Boolean(lead), describe: match.describe };
}
