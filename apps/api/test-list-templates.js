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

console.log('\n=== TEST: GET /whatsapp/integrations/1/templates (LIST) ===\n');

const response = await fetch(`${API_URL}/whatsapp/integrations/1/templates`, {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});

const data = await response.json();
console.log('Status:', response.status);
console.log('Total templates:', data.pagination?.total || 0);
console.log('\n');

if (data.data && data.data.length > 0) {
  console.log('✅ Templates found:');
  data.data.forEach((t, i) => {
    console.log(`\n  ${i + 1}. ${t.template_name}`);
    console.log(`     ID: ${t.id}`);
    console.log(`     Category: ${t.category || 'N/A'}`);
    console.log(`     Language: ${t.language || 'N/A'}`);
    console.log(`     Status: ${t.status}`);
    console.log(`     Body: ${t.body?.substring(0, 50)}...`);
  });
} else {
  console.log('❌ No templates returned');
  console.log('Full response:', JSON.stringify(data, null, 2));
}
