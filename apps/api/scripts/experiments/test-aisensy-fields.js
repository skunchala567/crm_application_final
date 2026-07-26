import axios from 'axios';

const projectId = process.env.AISENSY_TEST_PROJECT_ID;
const apiPassword = process.env.AISENSY_TEST_API_PASSWORD;

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
  console.log('\n🔬 Testing AiSensy field names for template sample\n');

  const testCases = [
    {
      name: 'sample_text (underscore)',
      payload: {
        name: 'test_field_sample_text',
        label: 'Test Field sample_text',
        category: 'MARKETING',
        type: 'TEXT',
        language: 'English',
        text: 'Test message',
        sample_text: 'test value'
      }
    },
    {
      name: 'sample (no underscore)',
      payload: {
        name: 'test_field_sample',
        label: 'Test Field sample',
        category: 'MARKETING',
        type: 'TEXT',
        language: 'English',
        text: 'Test message',
        sample: 'test value'
      }
    },
    {
      name: 'example_text',
      payload: {
        name: 'test_field_example',
        label: 'Test Field example',
        category: 'MARKETING',
        type: 'TEXT',
        language: 'English',
        text: 'Test message',
        example_text: 'test value'
      }
    },
    {
      name: 'template_sample',
      payload: {
        name: 'test_field_template_sample',
        label: 'Test Field template_sample',
        category: 'MARKETING',
        type: 'TEXT',
        language: 'English',
        text: 'Test message',
        template_sample: 'test value'
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
