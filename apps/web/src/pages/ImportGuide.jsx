import { Download, CheckCircle, AlertCircle, Info } from 'lucide-react';
import './ImportGuide.css';

export default function ImportGuide() {
  const handleDownloadTemplate = () => {
    const link = document.createElement('a');
    link.href = '/Google_Sheets_Import_Template.csv';
    link.download = 'Google_Sheets_Import_Template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="import-guide">
      <div className="guide-container">
        <div className="guide-header">
          <h1>📊 Google Sheets Import Guide</h1>
          <p>Follow this guide to prepare your data for import</p>
        </div>

        {/* Download Template */}
        <div className="guide-section template-section">
          <h2>📥 Download Template</h2>
          <p>Start with our pre-formatted template file:</p>
          <button className="download-btn" onClick={handleDownloadTemplate}>
            <Download size={18} />
            Download CSV Template
          </button>
          <p className="template-hint">Then upload to Google Sheets and fill with your data</p>
        </div>

        {/* Required Columns */}
        <div className="guide-section">
          <h2>📋 Required Columns</h2>
          <p>Your Google Sheet must have these column headers in Row 1:</p>

          <div className="columns-table">
            <div className="table-header">
              <div className="col-name">Column</div>
              <div className="col-field">Field Name</div>
              <div className="col-type">Type</div>
              <div className="col-req">Required</div>
              <div className="col-rules">Rules</div>
            </div>

            {[
              { name: 'A', field: 'student_name', type: 'Text', req: '✅ Yes', rules: 'Full name (min 2 chars)' },
              { name: 'B', field: 'phone', type: 'Text', req: '✅ Yes*', rules: '10 digits, starts 6-9' },
              { name: 'C', field: 'email', type: 'Email', req: '✅ Yes*', rules: 'Valid email format' },
              { name: 'D', field: 'alternate_phone', type: 'Text', req: '❌ No', rules: '10 digits (Indian)' },
              { name: 'E', field: 'applying_class', type: 'Text', req: '❌ No', rules: 'Class/Grade name' },
              { name: 'F', field: 'parent_name', type: 'Text', req: '❌ No', rules: 'Parent name' },
              { name: 'G', field: 'city', type: 'Text', req: '❌ No', rules: 'City name' },
              { name: 'H', field: 'remarks', type: 'Text', req: '❌ No', rules: 'Additional notes' },
              { name: 'I', field: 'lead_score', type: 'Number', req: '❌ No', rules: '0-100 score' }
            ].map((col, idx) => (
              <div key={idx} className="table-row">
                <div className="col-name">{col.name}</div>
                <div className="col-field"><code>{col.field}</code></div>
                <div className="col-type">{col.type}</div>
                <div className="col-req">{col.req}</div>
                <div className="col-rules">{col.rules}</div>
              </div>
            ))}
          </div>

          <p className="table-note">
            <Info size={16} />
            * At least ONE of phone OR email is required for each row
          </p>
        </div>

        {/* Validation Rules */}
        <div className="guide-section">
          <h2>✅ Validation Rules</h2>

          <div className="rule-card valid">
            <div className="rule-title">📱 Phone Number</div>
            <div className="rule-content">
              <p><strong>Format:</strong> Exactly 10 digits</p>
              <p><strong>Starting digit:</strong> Must be 6, 7, 8, or 9</p>
              <div className="examples">
                <span className="valid-example">✅ 9876543210</span>
                <span className="invalid-example">❌ 1234567890</span>
                <span className="invalid-example">❌ 98765432</span>
              </div>
            </div>
          </div>

          <div className="rule-card valid">
            <div className="rule-title">📧 Email</div>
            <div className="rule-content">
              <p><strong>Format:</strong> Valid email address</p>
              <p><strong>Case:</strong> Case-insensitive (duplicates detected)</p>
              <div className="examples">
                <span className="valid-example">✅ student@example.com</span>
                <span className="invalid-example">❌ invalid.email</span>
              </div>
            </div>
          </div>

          <div className="rule-card valid">
            <div className="rule-title">👤 Student Name</div>
            <div className="rule-content">
              <p><strong>Required:</strong> Cannot be empty</p>
              <p><strong>Length:</strong> Minimum 2 characters</p>
              <div className="examples">
                <span className="valid-example">✅ Raj Kumar</span>
                <span className="invalid-example">❌ R</span>
              </div>
            </div>
          </div>

          <div className="rule-card valid">
            <div className="rule-title">⭐ Lead Score</div>
            <div className="rule-content">
              <p><strong>Type:</strong> Number (optional)</p>
              <p><strong>Range:</strong> 0-100</p>
              <div className="examples">
                <span className="valid-example">✅ 85</span>
                <span className="invalid-example">❌ 150</span>
              </div>
            </div>
          </div>
        </div>

        {/* Duplicate Detection */}
        <div className="guide-section">
          <h2>🔍 Duplicate Detection</h2>
          <p>The system automatically detects duplicates by:</p>
          <ul>
            <li><strong>Phone:</strong> Exact match (normalized, spaces/dashes removed)</li>
            <li><strong>Email:</strong> Case-insensitive match</li>
            <li><strong>Name:</strong> Exact match</li>
          </ul>
          <div className="duplicate-action">
            <CheckCircle size={20} className="icon-success" />
            <div>
              <p><strong>Default Action:</strong> Duplicate records are SKIPPED</p>
              <p>This prevents duplicate entries in your CRM</p>
            </div>
          </div>
        </div>

        {/* Import Steps */}
        <div className="guide-section">
          <h2>📝 Import Steps</h2>
          <div className="steps">
            {[
              { num: 1, title: 'Prepare Data', desc: 'Create/download template and fill with your data' },
              { num: 2, title: 'Upload to Google Drive', desc: 'Save the file in Google Sheets format' },
              { num: 3, title: 'Select Sheet', desc: 'Go to Settings → Select Spreadsheet' },
              { num: 4, title: 'Verify Mappings', desc: 'Check Field Mapping tab (Auto Map available)' },
              { num: 5, title: 'Import Data', desc: 'Click "Import from Google Sheets" in Sync Data tab' },
              { num: 6, title: 'Review Results', desc: 'Check imported/skipped/failed counts' }
            ].map((step, idx) => (
              <div key={idx} className="step-item">
                <div className="step-number">{step.num}</div>
                <div className="step-content">
                  <p className="step-title">{step.title}</p>
                  <p className="step-desc">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Common Issues */}
        <div className="guide-section issues-section">
          <h2>⚠️ Common Issues</h2>

          <div className="issue-card">
            <AlertCircle size={20} />
            <div>
              <p><strong>"No data in sheet"</strong></p>
              <p>Make sure you have data starting from Row 2. Headers must be in Row 1.</p>
            </div>
          </div>

          <div className="issue-card">
            <AlertCircle size={20} />
            <div>
              <p><strong>"Invalid phone number"</strong></p>
              <p>Phone must be exactly 10 digits and start with 6, 7, 8, or 9.</p>
            </div>
          </div>

          <div className="issue-card">
            <AlertCircle size={20} />
            <div>
              <p><strong>"Missing contact information"</strong></p>
              <p>Each row needs at least a phone number or email address.</p>
            </div>
          </div>

          <div className="issue-card">
            <AlertCircle size={20} />
            <div>
              <p><strong>"Duplicate detected"</strong></p>
              <p>This is normal! The system prevents duplicates. Existing records are skipped.</p>
            </div>
          </div>
        </div>

        {/* Sample Data */}
        <div className="guide-section">
          <h2>📊 Sample Data</h2>
          <p>Here's how your data should look:</p>
          <div className="sample-data">
            <table>
              <thead>
                <tr>
                  <th>student_name</th>
                  <th>phone</th>
                  <th>email</th>
                  <th>applying_class</th>
                  <th>city</th>
                  <th>lead_score</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Raj Kumar</td>
                  <td>9876543210</td>
                  <td>raj@example.com</td>
                  <td>Class 10</td>
                  <td>Mumbai</td>
                  <td>85</td>
                </tr>
                <tr>
                  <td>Priya Singh</td>
                  <td>8765432109</td>
                  <td>priya@example.com</td>
                  <td>Class 9</td>
                  <td>Delhi</td>
                  <td>75</td>
                </tr>
                <tr>
                  <td>Arjun Patel</td>
                  <td>7654321098</td>
                  <td>arjun@example.com</td>
                  <td>Class 11</td>
                  <td>Bangalore</td>
                  <td>90</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="guide-footer">
          <p>📚 For more help, contact support or check the Integration Hub documentation.</p>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
