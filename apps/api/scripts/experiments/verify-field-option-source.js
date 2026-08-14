/**
 * A lead field can take its options from a configuration section.
 *
 * Builds a throwaway section with a parent and two sub-values, points a
 * select field at each level in turn, and checks the options served by
 * /api/leads/meta come from the section and follow it when it changes.
 * Everything created here is deleted afterwards.
 *
 * Run: node --env-file=.env scripts/experiments/verify-field-option-source.js
 */
import jwt from 'jsonwebtoken';

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:3001/api';
const UNIT = Number(process.env.VERIFY_UNIT_ID || 41);

const token = jwt.sign(
  {
    id: 1, employeeId: 1, name: 'Probe', email: 'probe@local', role: 'CRM_ADMIN',
    roles: ['CRM_ADMIN', 'SUPER_ADMIN'], branchIds: [], crmActive: true, organizationId: 1,
  },
  process.env.JWT_SECRET,
  { expiresIn: '10m' },
);

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Business-Unit-Id': String(UNIT),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  let parsed; try { parsed = JSON.parse(raw); } catch { parsed = { raw: raw.slice(0, 200) }; }
  return { status: response.status, body: parsed };
}

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
};

const optionsOf = async (fieldKey) => {
  const meta = await call('GET', '/leads/meta');
  return (meta.body.leadFields || []).find(field => field.fieldKey === fieldKey)?.options || null;
};

let sectionId = null;
let fieldId = null;

try {
  // --- a section with two levels -----------------------------------------
  const section = await call('POST', '/business-config/sections', {
    displayName: 'ZZ Field Source', placeholder: 'Pick one',
    sectionType: 'hierarchy', childLabel: 'ZZ Sub', childPlaceholder: 'Pick a sub',
  });
  sectionId = section.body.data?.id;
  check('created a hierarchy section', section.status === 201 && Boolean(sectionId));

  const parentA = (await call('POST', `/business-config/sections/${sectionId}/values`, { displayName: 'Alpha' })).body.data?.id;
  await call('POST', `/business-config/sections/${sectionId}/values`, { displayName: 'Beta' });
  await call('POST', `/business-config/sections/${sectionId}/values`, { displayName: 'Alpha One', parentValueId: parentA });
  await call('POST', `/business-config/sections/${sectionId}/values`, { displayName: 'Alpha Two', parentValueId: parentA });

  // --- a field bound to the parent level ---------------------------------
  const created = await call('POST', `/platform/business-units/${UNIT}/fields`, {
    displayName: 'ZZ Bound Field', fieldType: 'single_select',
    optionsSectionId: sectionId, optionsSectionLevel: 'parent',
    options: [], isFilterable: true, isImportable: true,
  });
  fieldId = created.body.id;
  check('created a field bound to the section', created.status === 201 && Boolean(fieldId));

  const parentOptions = await optionsOf('zz_bound_field');
  check('serves the section\'s top-level values',
    JSON.stringify(parentOptions) === JSON.stringify(['Alpha', 'Beta']), JSON.stringify(parentOptions));

  // --- adding a value shows up without touching the field ----------------
  await call('POST', `/business-config/sections/${sectionId}/values`, { displayName: 'Gamma' });
  const afterAdd = await optionsOf('zz_bound_field');
  check('a value added later appears without editing the field',
    afterAdd?.includes('Gamma'), JSON.stringify(afterAdd));

  // --- switching the field to the sub-level ------------------------------
  const toChild = await call('PUT', `/platform/business-units/${UNIT}/fields/${fieldId}`, {
    displayName: 'ZZ Bound Field', optionsSectionId: sectionId, optionsSectionLevel: 'child',
    options: [], isFilterable: true, isImportable: true,
  });
  check('field can be pointed at the sub-level', toChild.status === 200);
  const childOptions = await optionsOf('zz_bound_field');
  check('serves the sub-values instead',
    JSON.stringify(childOptions) === JSON.stringify(['Alpha One', 'Alpha Two']), JSON.stringify(childOptions));

  // --- a section from another unit is refused ----------------------------
  const [otherUnitSection] = [1];
  const foreign = await call('PUT', `/platform/business-units/${UNIT}/fields/${fieldId}`, {
    displayName: 'ZZ Bound Field', optionsSectionId: 999999, options: [],
  });
  check('a section outside this business unit is refused', foreign.status === 400, foreign.body.message);

  // --- unbinding falls back to a typed list ------------------------------
  const unbound = await call('PUT', `/platform/business-units/${UNIT}/fields/${fieldId}`, {
    displayName: 'ZZ Bound Field', optionsSectionId: null,
    options: ['Typed One', 'Typed Two'], isFilterable: true, isImportable: true,
  });
  check('field can go back to a typed list', unbound.status === 200);
  const typed = await optionsOf('zz_bound_field');
  check('serves the typed list once unbound',
    JSON.stringify(typed) === JSON.stringify(['Typed One', 'Typed Two']), JSON.stringify(typed));

  // --- deleting the section leaves the field standing --------------------
  await call('PUT', `/platform/business-units/${UNIT}/fields/${fieldId}`, {
    displayName: 'ZZ Bound Field', optionsSectionId: sectionId, optionsSectionLevel: 'parent', options: ['Fallback'],
  });
  await call('DELETE', `/business-config/sections/${sectionId}`);
  sectionId = null;
  const afterDelete = await call('GET', '/leads/meta');
  const survivor = (afterDelete.body.leadFields || []).find(field => field.fieldKey === 'zz_bound_field');
  check('deleting the section does not delete the field', Boolean(survivor),
    survivor ? `options ${JSON.stringify(survivor.options)}` : 'field vanished');
} finally {
  if (fieldId) await call('DELETE', `/platform/business-units/${UNIT}/fields/${fieldId}`);
  if (sectionId) await call('DELETE', `/business-config/sections/${sectionId}`);
  const meta = await call('GET', '/leads/meta');
  const left = (meta.body.leadFields || []).filter(field => field.fieldKey.startsWith('zz_'));
  const sections = await call('GET', '/business-config/sections');
  const leftSections = (sections.body.data || []).filter(section => section.displayName.startsWith('ZZ '));
  check('cleanup left nothing behind', left.length === 0 && leftSections.length === 0,
    `${left.length} fields, ${leftSections.length} sections`);
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
