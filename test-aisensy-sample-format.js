import axios from 'axios';

const projectId = '6923f6a78e77a6798e5b9f23';
const apiPassword = '3adb6e0aee99ed7881743';

const baseUrl = 'https://apis.aisensy.com/project-apis/v1';

const client = axios.create({
  baseURL: baseUrl,
  timeout: 30000,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'X-AiSensy-Project-API-Pwd': apiPassword
  }
});

(async () => {
  console.log('\n🔬 Testing AiSensy sample_text format\n');

  const testCases = [
    {
      name: 'sample_text = same as body',
      payload: {
        name: 'test_sample_same_body',
        label: 'Test Sample Same Body',
        category: 'MARKETING',
        type: 'TEXT',
        language: 'English',
        text: 'Hello, this is a test message',
        sample_text: 'Hello, this is a test message'
      }
    },
    {
      name: 'sample_text = empty string',
      payload: {
        name: 'test_sample_empty',
        label: 'Test Sample Empty',
        category: 'MARKETING',
        type: 'TEXT',
        language: 'English',
        text: 'Hello, this is a test message',
        sample_text: ''
      }
    },
    {
      name: 'sample_text = simple text',
      payload: {
        name: 'test_sample_simple',
        label: 'Test Sample Simple',
        category: 'MARKETING',
        type: 'TEXT',
        language: 'English',
        text: 'Hello, this is a test message',
        sample_text: 'sample'
      }
    },
    {
      name: 'no sample_text (omitted)',
      payload: {
        name: 'test_no_sample',
        label: 'Test No Sample',
        category: 'MARKETING',
        type: 'TEXT',
        language: 'English',
        text: 'Hello, this is a test message'
      }
    }
  ];

  for (const testCase of testCases) {
    try {
      console.log(`Testing: ${testCase.name}`);
      const response = await client.post(`/project/${projectId}/wa_template`, testCase.payload);
      console.log(`  ✅ SUCCESS - Created template: ${response.data?.id}`);
    } catch (error) {
      const status = error.response?.status;
      const message = error.response?.data?.message || error.message;
      console.log(`  ❌ ${status || 'ERROR'} - ${message}`);
    }
  }

  console.log('\n');
})();
