import { useState, useEffect } from 'react';
import { Send, MessageCircle, Loader, Upload } from 'lucide-react';
import { api } from '../api';

export default function WhatsAppMessaging({ integrationId, currentLeadId }) {
  const [mode, setMode] = useState('individual'); // 'individual' or 'bulk'
  const [message, setMessage] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [bulkNumbers, setBulkNumbers] = useState([]);
  const [invalidNumbers, setInvalidNumbers] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchTemplates();
  }, [integrationId]);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const response = await api.get(
        `/hub/integrations/${integrationId}/whatsapp/templates`
      );
      setTemplates(response.data || []);
    } catch (err) {
      console.error('Error fetching templates:', err);
    } finally {
      setLoading(false);
    }
  };

  // Validate Indian phone number (10 digits, starting with 6-9)
  const validateIndianNumber = (num) => {
    const cleaned = num.replace(/\D/g, '');
    return cleaned.length === 10 && /^[6-9]/.test(cleaned);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target.result;
        const lines = text.split(/[\r\n]+/).filter(line => line.trim());
        const numbers = [];
        const invalid = [];

        // Detect delimiter (comma or tab)
        const delimiter = text.includes('\t') ? '\t' : ',';

        // Start from row 2 (index 1) to skip heading
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          // Get first column (split by comma or tab)
          const cells = line.split(delimiter);
          const firstColumn = cells[0].trim();

          // Only count non-empty cells
          if (firstColumn) {
            if (validateIndianNumber(firstColumn)) {
              numbers.push(firstColumn.replace(/\D/g, ''));
            } else {
              invalid.push(firstColumn);
            }
          }
        }

        setBulkNumbers(numbers);
        setInvalidNumbers(invalid);
        if (invalid.length > 0) {
          setError(`⚠️ ${invalid.length} invalid numbers (must be 10 digits, start with 6-9)`);
        } else {
          setError(null);
        }
      } catch (err) {
        setError('Failed to parse file. Use CSV or Excel format.');
      }
    };
    reader.readAsText(file);
  };

  const handleSend = async () => {
    if (!message.trim()) {
      setError('Message cannot be empty');
      return;
    }

    if (mode === 'individual' && !phoneNumber) {
      setError('Please enter a phone number');
      return;
    }

    if (mode === 'bulk' && bulkNumbers.length === 0) {
      setError('Please upload a file with valid Indian phone numbers');
      return;
    }

    if (!validateIndianNumber(phoneNumber) && mode === 'individual') {
      setError('Invalid number. Must be 10 digits starting with 6-9');
      return;
    }

    setSending(true);
    setError(null);
    setResult(null);

    try {
      if (mode === 'individual') {
        const formattedNumber = phoneNumber.replace(/\D/g, '');
        const response = await api.post(
          `/hub/integrations/${integrationId}/whatsapp/send`,
          {
            phoneNumber: formattedNumber,
            message: message.trim(),
            templateId: selectedTemplate || null
          }
        );
        setResult({
          type: 'success',
          message: `✅ Message sent successfully to +91${formattedNumber}`,
          data: response.data
        });
        setPhoneNumber('');
      } else {
        const response = await api.post(
          `/hub/integrations/${integrationId}/whatsapp/send-bulk`,
          {
            phoneNumbers: bulkNumbers,
            message: message.trim(),
            templateId: selectedTemplate || null
          }
        );
        setResult({
          type: 'success',
          message: `✅ Bulk message sent! Sent: ${response.data.sent}, Failed: ${response.data.failed}`,
          data: response.data
        });
        setBulkNumbers([]);
        setInvalidNumbers([]);
      }

      // Clear form
      setMessage('');
      setSelectedTemplate('');
    } catch (err) {
      setError('Failed to send message: ' + err.message);
      setResult({
        type: 'error',
        message: err.message
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>
          <MessageCircle size={20} style={{ marginRight: '8px' }} />
          WhatsApp Messaging
        </h3>
        <p style={styles.subtitle}>Send WhatsApp messages to leads</p>
      </div>

      {/* Mode Toggle */}
      <div style={styles.modeToggle}>
        <button
          style={{
            ...styles.modeBtn,
            ...(mode === 'individual' ? styles.modeBtnActive : {})
          }}
          onClick={() => setMode('individual')}
        >
          Individual Message
        </button>
        <button
          style={{
            ...styles.modeBtn,
            ...(mode === 'bulk' ? styles.modeBtnActive : {})
          }}
          onClick={() => setMode('bulk')}
        >
          Bulk Message
        </button>
      </div>

      {/* Individual Mode - Phone Number */}
      {mode === 'individual' && (
        <div style={styles.formGroup}>
          <label style={styles.label}>Phone Number *</label>
          <input
            type="tel"
            style={styles.input}
            placeholder="Enter 10-digit number (e.g., 9876543210)"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
          />
          <p style={styles.hint}>Indian mobile numbers only: 10 digits starting with 6-9</p>
        </div>
      )}

      {/* Bulk Mode - Excel Upload */}
      {mode === 'bulk' && (
        <div style={styles.formGroup}>
          <label style={styles.label}>Upload File *</label>
          <div style={styles.fileUploadBox}>
            <Upload size={32} style={{ color: '#667eea', marginBottom: '0.5rem' }} />
            <p style={styles.fileUploadText}>Drag & drop or click to upload</p>
            <p style={styles.fileUploadHint}>CSV or Excel file (column 1, starting from row 2)</p>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              style={styles.fileInput}
              onChange={handleFileUpload}
            />
          </div>

          {bulkNumbers.length > 0 && (
            <div style={styles.successBox}>
              ✅ {bulkNumbers.length} valid numbers ready to send
              {invalidNumbers.length > 0 && (
                <div style={styles.invalidList}>
                  <p style={styles.invalidTitle}>⚠️ {invalidNumbers.length} invalid:</p>
                  <p style={styles.invalidItems}>{invalidNumbers.slice(0, 5).join(', ')}{invalidNumbers.length > 5 ? '...' : ''}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Template Selection */}
      {templates.length > 0 && (
        <div style={styles.formGroup}>
          <label style={styles.label}>Message Template (Optional)</label>
          <select
            style={styles.select}
            value={selectedTemplate}
            onChange={(e) => {
              setSelectedTemplate(e.target.value);
              if (e.target.value) {
                const template = templates.find(t => t.id === e.target.value);
                setMessage(template?.content || '');
              }
            }}
          >
            <option value="">-- No Template --</option>
            {templates.map(template => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Message Input */}
      <div style={styles.formGroup}>
        <label style={styles.label}>Message</label>
        <textarea
          style={styles.textarea}
          placeholder={
            mode === 'individual'
              ? 'Type your message here...'
              : 'Type message to send to all leads with phone numbers...'
          }
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
        />
        <span style={styles.charCount}>{message.length} characters</span>
      </div>

      {/* Error Message */}
      {error && (
        <div style={styles.errorBox}>
          <p>❌ {error}</p>
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{
          ...styles.resultBox,
          ...(result.type === 'success' ? styles.successBox : styles.errorBox)
        }}>
          <p>{result.message}</p>
          {result.data && (
            <div style={styles.resultDetails}>
              {result.data.messageId && <p>Message ID: {result.data.messageId}</p>}
              {result.data.sent !== undefined && (
                <>
                  <p>Sent: {result.data.sent}</p>
                  <p>Failed: {result.data.failed}</p>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Send Button */}
      <button
        style={{
          ...styles.sendBtn,
          opacity: message.trim() && ((mode === 'individual' && phoneNumber) || (mode === 'bulk' && bulkNumbers.length > 0)) ? 1 : 0.5,
          cursor: message.trim() && ((mode === 'individual' && phoneNumber) || (mode === 'bulk' && bulkNumbers.length > 0)) ? 'pointer' : 'not-allowed'
        }}
        onClick={handleSend}
        disabled={
          sending ||
          !message.trim() ||
          (mode === 'individual' && !phoneNumber) ||
          (mode === 'bulk' && bulkNumbers.length === 0)
        }
      >
        {sending ? (
          <>
            <Loader size={16} style={{ animation: 'spin 1s linear infinite', marginRight: '8px' }} />
            Sending...
          </>
        ) : (
          <>
            <Send size={16} style={{ marginRight: '8px' }} />
            Send Message
          </>
        )}
      </button>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

const styles = {
  container: {
    padding: '1.5rem',
    background: '#fafafa',
    borderRadius: '8px',
  },
  header: {
    marginBottom: '1.5rem',
  },
  title: {
    margin: '0 0 0.5rem 0',
    fontSize: '1.1rem',
    fontWeight: 600,
    color: '#1a1a1a',
    display: 'flex',
    alignItems: 'center',
  },
  subtitle: {
    margin: 0,
    fontSize: '0.9rem',
    color: '#666',
  },
  modeToggle: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1.5rem',
  },
  modeBtn: {
    flex: 1,
    padding: '0.75rem 1rem',
    border: '1px solid #d1d5db',
    background: 'white',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 500,
    color: '#666',
    transition: 'all 0.2s ease',
  },
  modeBtnActive: {
    background: '#667eea',
    color: 'white',
    borderColor: '#667eea',
  },
  formGroup: {
    marginBottom: '1.5rem',
  },
  label: {
    display: 'block',
    fontSize: '0.85rem',
    fontWeight: 600,
    color: '#1a1a1a',
    marginBottom: '0.5rem',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  input: {
    width: '100%',
    padding: '0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.95rem',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  select: {
    width: '100%',
    padding: '0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.95rem',
    fontFamily: 'inherit',
    background: 'white',
    cursor: 'pointer',
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%',
    padding: '0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.95rem',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    resize: 'vertical',
  },
  charCount: {
    display: 'block',
    fontSize: '0.8rem',
    color: '#999',
    marginTop: '0.25rem',
  },
  errorBox: {
    padding: '1rem',
    background: '#fee2e2',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    color: '#991b1b',
    marginBottom: '1rem',
  },
  successBox: {
    padding: '1rem',
    background: '#dcfce7',
    border: '1px solid #bbf7d0',
    borderRadius: '6px',
    color: '#166534',
    marginBottom: '1rem',
  },
  resultBox: {
    padding: '1rem',
    borderRadius: '6px',
    marginBottom: '1rem',
  },
  resultDetails: {
    marginTop: '0.5rem',
    fontSize: '0.85rem',
    opacity: 0.9,
  },
  sendBtn: {
    width: '100%',
    padding: '0.875rem 1rem',
    background: '#667eea',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '1rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileUploadBox: {
    padding: '2rem',
    border: '2px dashed #d1d5db',
    borderRadius: '8px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    position: 'relative',
  },
  fileUploadText: {
    margin: '0 0 0.25rem 0',
    fontSize: '1rem',
    fontWeight: 500,
    color: '#1a1a1a',
  },
  fileUploadHint: {
    margin: 0,
    fontSize: '0.85rem',
    color: '#999',
  },
  fileInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    opacity: 0,
    cursor: 'pointer',
  },
  successBox: {
    padding: '1rem',
    background: '#dcfce7',
    border: '1px solid #bbf7d0',
    borderRadius: '6px',
    color: '#166534',
    marginTop: '1rem',
    fontSize: '0.95rem',
  },
  invalidList: {
    marginTop: '0.75rem',
    paddingTop: '0.75rem',
    borderTop: '1px solid rgba(22, 101, 52, 0.2)',
  },
  invalidTitle: {
    margin: '0 0 0.25rem 0',
    fontSize: '0.85rem',
    fontWeight: 600,
  },
  invalidItems: {
    margin: 0,
    fontSize: '0.8rem',
    opacity: 0.8,
    wordBreak: 'break-word',
  },
};
