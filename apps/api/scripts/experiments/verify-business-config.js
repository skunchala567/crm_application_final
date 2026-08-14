/**
 * End-to-end check of the /api/business-config surface.
 *
 * Creates a throwaway section tree, exercises every route against the running
 * API, then deletes everything it made. Deleting the parent section cascades
 * to its values and their sub-values, so a failure part-way still cleans up.
 *
 * Run: node --env-file=.env scripts/verify-business-config.js
 */
import jwt from 'jsonwebtoken';

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:3001/api';
const UNIT = Number(process.env.VERIFY_UNIT_ID || 1);

const token = jwt.sign(
  {
    id: 1,
    employeeId: 1,
    name: 'Verification',
    email: 'verify@local',
    role: 'CRM_ADMIN',
    roles: ['CRM_ADMIN', 'SUPER_ADMIN'],
    branchIds: [],
    crmActive: true,
    organizationId: 1,
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
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 200) }; }
  return { status: response.status, body: parsed };
}

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
};

let courses = null;
let services = null;

try {
  const initial = await call('GET', '/business-config/sections');
  check('GET sections', initial.status === 200 && Array.isArray(initial.body.data), `status ${initial.status}`);
  const before = initial.body.data?.length ?? 0;

  // --- simple list ------------------------------------------------------
  const createServices = await call('POST', '/business-config/sections', {
    displayName: 'ZZ Verify Service Type', placeholder: 'Select service', sectionType: 'list',
  });
  services = createServices.body.data?.id;
  check('POST list section', createServices.status === 201 && Boolean(services));

  for (const name of ['On-site', 'Remote']) {
    await call('POST', `/business-config/sections/${services}/values`, { displayName: name });
  }
  const dupe = await call('POST', `/business-config/sections/${services}/values`, { displayName: 'On-site' });
  check('duplicate value rejected', dupe.status === 409, `status ${dupe.status}`);

  // --- hierarchy section -----------------------------------------------
  const missingChild = await call('POST', '/business-config/sections', {
    displayName: 'ZZ Verify No Sub Name', sectionType: 'hierarchy',
  });
  check('hierarchy without a sub-level name rejected', missingChild.status === 400, missingChild.body.message);

  const createCourses = await call('POST', '/business-config/sections', {
    displayName: 'ZZ Verify Courses Offered', placeholder: 'Select course',
    sectionType: 'hierarchy', childLabel: 'Specialisation', childPlaceholder: 'Select specialisation',
  });
  courses = createCourses.body.data?.id;
  check('POST hierarchy section', createCourses.status === 201 && Boolean(courses));

  // Parents
  const btech = (await call('POST', `/business-config/sections/${courses}/values`, { displayName: 'B.Tech' })).body.data?.id;
  const mba = (await call('POST', `/business-config/sections/${courses}/values`, { displayName: 'MBA' })).body.data?.id;
  check('POST parent values', Boolean(btech && mba));

  // Sub-values under each parent
  const cse = await call('POST', `/business-config/sections/${courses}/values`, { displayName: 'CSE', parentValueId: btech });
  await call('POST', `/business-config/sections/${courses}/values`, { displayName: 'ECE', parentValueId: btech });
  await call('POST', `/business-config/sections/${courses}/values`, { displayName: 'Finance', parentValueId: mba });
  check('POST sub-values under a parent', cse.status === 201 && Boolean(cse.body.data?.id));

  // The same sub-value name may repeat under a different parent.
  const repeated = await call('POST', `/business-config/sections/${courses}/values`, { displayName: 'CSE', parentValueId: mba });
  check('same sub-value name allowed under another parent', repeated.status === 201, `status ${repeated.status}`);

  const dupChild = await call('POST', `/business-config/sections/${courses}/values`, { displayName: 'CSE', parentValueId: btech });
  check('duplicate sub-value under the same parent rejected', dupChild.status === 409, `status ${dupChild.status}`);

  const tooDeep = await call('POST', `/business-config/sections/${courses}/values`, {
    displayName: 'Semester 1', parentValueId: cse.body.data.id,
  });
  check('nesting stops at two levels', tooDeep.status === 400, tooDeep.body.message);

  const crossSection = await call('POST', `/business-config/sections/${courses}/values`, {
    displayName: 'Stray', parentValueId: (await call('GET', '/business-config/sections')).body.data
      .find(s => s.id === services).values[0].id,
  });
  check('parent from another section rejected', crossSection.status === 400, crossSection.body.message);

  const subOnList = await call('POST', `/business-config/sections/${services}/values`, {
    displayName: 'Nope', parentValueId: btech,
  });
  check('a list section refuses sub-values', subOnList.status === 400, subOnList.body.message);

  // --- tree comes back shaped -------------------------------------------
  const tree = await call('GET', '/business-config/sections');
  const courseSection = tree.body.data.find(s => s.id === courses);
  const btechNode = courseSection.values.find(v => v.id === btech);
  const mbaNode = courseSection.values.find(v => v.id === mba);
  check('GET returns parents with their own children',
    courseSection.values.length === 2 && btechNode.children.length === 2 && mbaNode.children.length === 2,
    `${courseSection.values.length} parents; B.Tech ${btechNode.children.length}, MBA ${mbaNode.children.length}`);
  check('sub-level naming round-trips',
    courseSection.childLabel === 'Specialisation' && courseSection.childPlaceholder === 'Select specialisation');

  const listSection = tree.body.data.find(s => s.id === services);
  check('list values carry no children', listSection.values.every(v => v.children.length === 0));

  // --- rename and cascade ----------------------------------------------
  const rename = await call('PUT', `/business-config/sections/${courses}`, {
    displayName: 'ZZ Verify Programmes', placeholder: 'Pick a programme', childLabel: 'Stream',
  });
  check('PUT renames section and sub-level', rename.status === 200);

  const dropChildName = await call('PUT', `/business-config/sections/${courses}`, { displayName: 'ZZ Verify Programmes' });
  check('hierarchy cannot lose its sub-level name', dropChildName.status === 400, dropChildName.body.message);

  // --- switching section type ------------------------------------------
  const toHierarchy = await call('PUT', `/business-config/sections/${services}`, {
    displayName: 'ZZ Verify Service Type', sectionType: 'hierarchy', childLabel: 'Tier',
  });
  check('list can become a hierarchy', toHierarchy.status === 200 && toHierarchy.body.data?.sectionType === 'hierarchy');

  const keptValues = (await call('GET', '/business-config/sections')).body.data.find(s => s.id === services);
  check('its values survive as parents', keptValues.values.length === 2 && keptValues.values.every(v => v.children.length === 0),
    `${keptValues.values.length} parents`);

  const backToList = await call('PUT', `/business-config/sections/${services}`, {
    displayName: 'ZZ Verify Service Type', sectionType: 'list',
  });
  check('hierarchy with no sub-values can become a list again', backToList.status === 200 && backToList.body.data?.sectionType === 'list');

  const blockedSwitch = await call('PUT', `/business-config/sections/${courses}`, {
    displayName: 'ZZ Verify Programmes', sectionType: 'list',
  });
  check('hierarchy holding sub-values refuses the switch', blockedSwitch.status === 409, blockedSwitch.body.message);

  const deleteParent = await call('DELETE', `/business-config/values/${mba}`);
  check('deleting a parent removes its sub-values', deleteParent.body.data?.removedChildren === 2,
    `removed ${deleteParent.body.data?.removedChildren}`);

  const foreign = await call('GET', '/business-config/sections');
  check('sections scoped to the unit', foreign.body.data.length === before + 2, `${foreign.body.data.length} sections`);
} finally {
  for (const id of [courses, services].filter(Boolean)) {
    await call('DELETE', `/business-config/sections/${id}`);
  }
  const after = await call('GET', '/business-config/sections');
  const leftovers = (after.body.data || []).filter(section => section.displayName.startsWith('ZZ Verify'));
  check('cleanup left nothing behind', leftovers.length === 0, `${leftovers.length} leftovers`);
}

const failed = results.filter(result => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
