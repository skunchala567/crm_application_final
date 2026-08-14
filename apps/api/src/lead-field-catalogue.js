/**
 * The standard lead fields a business unit can draw on.
 *
 * School Admissions was seeded with twenty-one of these; a unit created later
 * gets five. The rest were not missing by design -- there was simply no way to
 * add them, so branch, stage, sub-stage, owner and next follow-up could not be
 * put on a new unit's lead form at all.
 *
 * These are not new fields. Each `key` is one the rest of the CRM already
 * understands: /api/leads/meta serves the matching option list, and the lead
 * form, filters, reports and import templates key their behaviour off exactly
 * these names. Adding one to a unit is therefore a matter of inserting the
 * metadata row -- the plumbing behind it is already in place.
 *
 * `source` says where the values come from, and is what the UI shows so an
 * administrator can tell a live list from a fixed one:
 *   branches   - the branches this unit operates
 *   pipeline   - stages and sub-stages from Lead pipeline
 *   sources    - Source configuration (channel, source, campaign)
 *   people     - CRM users
 *   fixed      - a short built-in list
 *   none       - free text, a number or a date
 */
export const LEAD_FIELD_CATALOGUE = [
  // --- the person -------------------------------------------------------
  { key: 'student_name', label: 'Full name', type: 'text', source: 'none', group: 'Contact', width: 220, searchable: true },
  { key: 'parent_name', label: 'Secondary contact name', type: 'text', source: 'none', group: 'Contact', width: 200 },
  { key: 'alternate_phone', label: 'Alternate phone', type: 'phone', source: 'none', group: 'Contact', width: 150 },
  { key: 'city', label: 'City', type: 'text', source: 'none', group: 'Contact', width: 150, searchable: true },

  // --- where the lead sits ---------------------------------------------
  { key: 'branch_id', label: 'Branch', type: 'single_select', source: 'branches', group: 'Assignment', width: 170 },
  { key: 'owner_employee_id', label: 'Owner', type: 'user', source: 'people', group: 'Assignment', width: 180 },

  // --- pipeline ---------------------------------------------------------
  { key: 'stage_id', label: 'Stage', type: 'single_select', source: 'pipeline', group: 'Lead pipeline', width: 150 },
  { key: 'substage_id', label: 'Sub-stage', type: 'single_select', source: 'pipeline', group: 'Lead pipeline', width: 160 },
  { key: 'next_followup_at_utc', label: 'Next follow-up date', type: 'datetime', source: 'none', group: 'Lead pipeline', width: 180, filterControl: 'date_range' },
  { key: 'followup_type', label: 'Follow-up type', type: 'single_select', source: 'fixed', group: 'Lead pipeline', width: 150, options: ['Call', 'WhatsApp', 'Email', 'Visit'] },
  { key: 'lead_score', label: 'Lead score', type: 'number', source: 'none', group: 'Lead pipeline', width: 120 },

  // --- attribution ------------------------------------------------------
  { key: 'channel_id', label: 'Channel', type: 'single_select', source: 'sources', group: 'Source configuration', width: 160 },
  { key: 'source_id', label: 'Source', type: 'single_select', source: 'sources', group: 'Source configuration', width: 170 },
  { key: 'campaign_id', label: 'Campaign', type: 'single_select', source: 'sources', group: 'Source configuration', width: 180 },

  // --- notes ------------------------------------------------------------
  { key: 'remarks', label: 'Remarks', type: 'textarea', source: 'none', group: 'Notes', width: 260 },
];

export const CATALOGUE_BY_KEY = new Map(LEAD_FIELD_CATALOGUE.map(entry => [entry.key, entry]));

/** How each source is described in the picker. */
export const SOURCE_LABELS = {
  branches: 'Branches',
  pipeline: 'Lead pipeline',
  sources: 'Source configuration',
  people: 'CRM users',
  fixed: 'Built-in list',
  none: 'Entered on the form',
};
