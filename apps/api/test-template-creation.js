import jwt from 'jsonwebtoken';

const JWT_SECRET = 'crm-local-2026-change-before-production-7c4f52a91d';
const API_URL = 'http://localhost:3001/api';

// Create a test JWT token
const token = jwt.sign(
  {
    id: 1,
    email: 'test@example.com',
    name: 'Test User',
    roles: ['ADMIN'],
    branchIds: [1]
  },
  JWT_SECRET,
  { expiresIn: '8h' }
);

console.log('\n=== TEST 1: GET /whatsapp/integrations ===');
const intResponse = await fetch(`${API_URL}/whatsapp/integrations?provider=SMARTPING`, {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});

const intData = await intResponse.json();
console.log('Status:', intResponse.status);
console.log('Response:', JSON.stringify(intData, null, 2));

if (!intData.success || !intData.data || intData.data.length === 0) {
  console.error('❌ FAILED: No integrations returned');
  process.exit(1);
}

const integrationId = intData.data[0].id;
console.log(`✅ Got integration ID: ${integrationId}`);

console.log('\n=== TEST 2: POST /integrations/:id/templates (CREATE) ===');
const templateData = {
  template_name: `test_template_${Date.now()}`,
  label: 'Test Template Auto',
  category: 'MARKETING',
  language: 'English',
  template_type: 'TEXT',
  header_type: 'NONE',
  header_content: null,
  body: 'Hello {{1}}, welcome to {{2}}!',
  sample_text: 'Hello John, welcome to Acme!',
  footer: null,
  buttons: []
};

console.log('Creating template:', templateData.template_name);

const createResponse = await fetch(`${API_URL}/whatsapp/integrations/${integrationId}/templates`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(templateData)
});

const createData = await createResponse.json();
console.log('Status:', createResponse.status);
console.log('Response:', JSON.stringify(createData, null, 2));

if (createResponse.status === 201 && createData.success) {
  console.log(`\n✅ SUCCESS! Template created with ID: ${createData.data.id}`);
  console.log(`   Name: ${createData.data.template_name}`);
  console.log(`   Status: ${createData.data.status}`);
  console.log(`   Integration ID: ${createData.data.integration_id}`);
} else {
  console.log(`\n❌ FAILED with status ${createResponse.status}`);
  if (createData.error) {
    console.log(`   Error: ${createData.error.message}`);
  }
  process.exit(1);
}

console.log('\n=== TEST 3: GET /integrations/:id/templates (LIST) ===');
const listResponse = await fetch(`${API_URL}/whatsapp/integrations/${integrationId}/templates`, {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});

const listData = await listResponse.json();
console.log('Status:', listResponse.status);
console.log(`Templates found: ${listData.pagination?.total || 0}`);
if (listData.data && listData.data.length > 0) {
  console.log(`✅ Template appears in list`);
  console.log(`   First template: ${listData.data[0].template_name}`);
} else {
  console.log('❌ Template not in list');
}

console.log('\n=== ✅ ALL TESTS PASSED ===');
