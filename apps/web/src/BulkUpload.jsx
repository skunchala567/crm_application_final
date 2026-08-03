import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './api';
import './BulkUpload.css';

export function BulkUploadButton() {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <button
        className="bulk-upload-trigger"
        title="Bulk Lead Upload"
        onClick={() => setShowModal(true)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
      </button>
      {showModal && (
        <BulkUploadModal onClose={() => setShowModal(false)} />
      )}
    </>
  );
}

/**
 * Unified Bulk Upload Modal
 *
 * Consolidated component handling entire bulk upload flow:
 * 1. File selection (initial state)
 * 2. Validation (spinner state)
 * 3. Validation results (embedded in same modal)
 * 4. Upload (if validation passes)
 * 5. Upload complete (close or show summary)
 *
 * Features:
 * - File selector always visible (can replace file even after validation)
 * - Validation results embedded in modal (no separate component)
 * - Summary cards show counts and status
 * - Failed records table shows all error details
 * - Footer buttons change based on current state
 * - Re-validation flow: upload new file to validate again
 */
function BulkUploadModal({ onClose }) {
  const navigate = useNavigate();

  // Modal flow states
  const [step, setStep] = useState('file-selection'); // 'file-selection' | 'validating' | 'validation-result' | 'uploading' | 'upload-complete'

  // File and records state
  const [fileName, setFileName] = useState('');
  const [records, setRecords] = useState([]);
  const fileInputRef = useRef(null);

  // Validation state
  const [validationResult, setValidationResult] = useState(null); // { totalRecords, validRecords, failedRecords, duplicateRecords, failedRecordsList, isSuccess }
  const [validationErrors, setValidationErrors] = useState([]); // File parsing/selection errors

  // Upload state
  const [uploadId, setUploadId] = useState(null);
  const [isDownloadingErrors, setIsDownloadingErrors] = useState(false);

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);

  // Redirect to Bulk Actions on successful upload
  useEffect(() => {
    if (step === 'upload-complete') {
      // Show success message for 2 seconds, then redirect
      const timer = setTimeout(() => {
        navigate('/bulk-actions');
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [step, navigate]);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      // Manually trigger file processing
      const event = {
        target: {
          files: [file]
        }
      };
      await handleFileSelect(event);
    }
  };

  const downloadTemplate = async () => {
    try {
      const response = await fetch('/api/bulk-uploads/download-template', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('crm_token')}`,
          ...(localStorage.getItem('crm_business_unit_id') ? {'X-Business-Unit-Id':localStorage.getItem('crm_business_unit_id')} : {})
        }
      });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bulk_lead_upload_template_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Template download error:', error);
      setValidationErrors([`Failed to download template: ${error.message}`]);
    }
  };

  const parseCSV = (text) => {
    const rows = [];
    let current = '';
    let insideQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          current += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === ',' && !insideQuotes) {
        rows.push(current);
        current = '';
      } else if ((char === '\n' || char === '\r') && !insideQuotes) {
        if (current || rows.length > 0) rows.push(current);
        if (current) {
          return { success: false, error: 'Newline inside unquoted field' };
        }
        current = '';
        if (char === '\r' && nextChar === '\n') i++;
      } else {
        current += char;
      }
    }
    if (insideQuotes) {
      return { success: false, error: 'Unclosed quoted field' };
    }
    if (current || rows.length > 0) rows.push(current);
    return { success: true, rows };
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setValidationErrors(['Only CSV files (.csv) are supported. Please upload a .csv file.']);
      fileInputRef.current.value = '';
      return;
    }

    setFileName(file.name);
    setValidationErrors([]);
    setValidationResult(null); // Clear previous validation results when new file is selected
    setStep('file-selection');

    try {
      const text = await file.text();
      const allLines = text.split(/\r?\n/);

      // Filter out comment lines and empty lines
      const lines = allLines.filter(line => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('#');
      });

      if (lines.length < 2) {
        setValidationErrors(['File must have header and at least one data row']);
        return;
      }

      const headerResult = parseCSV(lines[0]);
      if (!headerResult.success) {
        setValidationErrors([`CSV parsing error in header: ${headerResult.error}`]);
        return;
      }
      const headers = headerResult.rows.map(h => h.trim().replace(/\s*\*\s*$/, ''));
      const headerMap = {};
      headers.forEach((h, i) => {
        headerMap[h] = i;
      });

      const parsedRecords = [];
      for (let i = 1; i < lines.length; i++) {
        const rowResult = parseCSV(lines[i]);
        if (!rowResult.success) {
          setValidationErrors([`CSV parsing error in row ${i + 1}: ${rowResult.error}`]);
          return;
        }
        const values = rowResult.rows;
        const record = {
          studentName: values[headerMap['Student Name']]?.trim() || '',
          phone: values[headerMap['Phone']]?.trim() || '',
          classId: values[headerMap['Class ID']]?.trim() || '',
          campaignName: values[headerMap['Campaign Name']]?.trim() || '',
          substageId: values[headerMap['Sub-stage ID']]?.trim() || '',
          assignTo: values[headerMap['Assign To']]?.trim() || '',
          sourceId: values[headerMap['Source ID']]?.trim() || '',
          remarks: values[headerMap['Remarks']]?.trim() || '',
          // Fields populated by validation endpoint
          branchId: '',
          curriculumId: '',
          academicYear: '',
          stageId: '',
          admissionTypeId: '',
          campaignId: '',
          ownerEmployeeId: '',
          normalizedPhone: '',
        };
        // LOG: First row parsing
        if (i === 1) {
          console.log('[CSV-PARSE] Row 1 parsed record:', record);
        }
        parsedRecords.push(record);
      }

      setRecords(parsedRecords);
    } catch (error) {
      setValidationErrors([`Error parsing file: ${error.message}`]);
    }
  };

  const handleValidateFile = async () => {
    if (records.length === 0) {
      setValidationErrors(['Please select a file with data']);
      return;
    }

    setStep('validating');
    setValidationErrors([]);
    setValidationResult(null);

    try {
      // Call backend validation endpoint (synchronous, no DB writes)
      const response = await api('/bulk-leads/validate', {
        method: 'POST',
        body: JSON.stringify({
          fileName,
          records
        })
      });

      // Process validation response
      const totalRecords = records.length;
      const failedRecords = response.failedRecords || [];
      const duplicateRecords = response.duplicateRecords || 0;
      const validRecords = totalRecords - failedRecords.length - duplicateRecords;
      const isSuccess = failedRecords.length === 0 && duplicateRecords === 0 && validRecords > 0;

      setValidationResult({
        totalRecords,
        validRecords,
        failedRecords: failedRecords.length,
        duplicateRecords,
        failedRecordsList: failedRecords,
        isSuccess
      });

      setStep('validation-result');
    } catch (error) {
      console.error('Validation error:', error);
      setValidationErrors([error.message || 'Validation failed']);
      setStep('file-selection');
    }
  };

  const handleUploadRecords = async () => {
    if (!validationResult || !validationResult.isSuccess) {
      setValidationErrors(['Cannot upload records with validation failures']);
      return;
    }

    setStep('uploading');
    setValidationErrors([]);

    try {
      // LOG: Before sending to backend
      console.log('[BULK-UPLOAD-FE] Sending records to import endpoint. Sample record:', records[0]);

      // Call backend import endpoint with already-validated records
      const response = await api('/bulk-leads/import', {
        method: 'POST',
        body: JSON.stringify({
          fileName,
          records
        })
      });

      setUploadId(response.id);
      setStep('upload-complete');
    } catch (error) {
      console.error('Upload error:', error);
      setValidationErrors([error.message || 'Upload failed']);
      setStep('validation-result');
    }
  };

  const downloadErrorReport = async () => {
    if (!uploadId) return;
    try {
      setIsDownloadingErrors(true);
      const response = await fetch(`/api/bulk-uploads/${uploadId}/download-errors`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('crm_token')}`
        }
      });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `error-report-${uploadId}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error download failed:', error);
    } finally {
      setIsDownloadingErrors(false);
    }
  };

  const isProcessing = step === 'validating' || step === 'uploading';
  const hasValidationResult = validationResult !== null;
  const hasFailures = hasValidationResult && (validationResult.failedRecords > 0 || validationResult.duplicateRecords > 0);
  const canUpload = hasValidationResult && validationResult.isSuccess;

  // Render spinner state
  if (step === 'validating') {
    return (
      <div className="bulk-upload-backdrop" onClick={onClose}>
        <div className="bulk-upload-modal" onClick={e => e.stopPropagation()}>
          <div className="bulk-upload-header">
            <h2>Validating Records...</h2>
            <button className="close-btn" onClick={onClose}>×</button>
          </div>
          <div className="bulk-upload-progress">
            <div className="progress-spinner"></div>
            <p>Validating your records...</p>
          </div>
        </div>
      </div>
    );
  }

  // Render uploading state
  if (step === 'uploading') {
    return (
      <div className="bulk-upload-backdrop" onClick={onClose}>
        <div className="bulk-upload-modal" onClick={e => e.stopPropagation()}>
          <div className="bulk-upload-header">
            <h2>Uploading Records...</h2>
            <button className="close-btn" onClick={onClose}>×</button>
          </div>
          <div className="bulk-upload-progress">
            <div className="progress-spinner"></div>
            <p>Uploading your records to the database...</p>
          </div>
        </div>
      </div>
    );
  }

  // Render upload complete state
  if (step === 'upload-complete') {
    return (
      <div className="bulk-upload-backdrop" onClick={onClose}>
        <div className="bulk-upload-modal" onClick={e => e.stopPropagation()}>
          <div className="bulk-upload-header">
            <h2>Upload Successful!</h2>
            <button className="close-btn" onClick={onClose}>×</button>
          </div>
          <div className="bulk-upload-progress">
            <div className="success-checkmark">✅</div>
            <p>Import received and queued for processing</p>
            <p style={{ fontSize: '0.9em', color: '#666', marginTop: '0.5em' }}>
              Redirecting to Bulk Actions...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bulk-upload-backdrop" onClick={onClose}>
      <div className={`bulk-upload-modal ${hasValidationResult ? 'summary-modal' : ''}`} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="bulk-upload-header">
          <div className="header-content">
            <h2>Bulk Upload Leads</h2>
            {hasValidationResult && (
              <div className={`status-inline ${validationResult.isSuccess ? 'validation-success' : 'validation-failure'}`}>
                <span className="status-icon">{validationResult.isSuccess ? '✅' : '🔴'}</span>
                <span className="status-text">
                  {validationResult.isSuccess ? 'Validation Successful' : 'Validation Failed'}
                </span>
              </div>
            )}
          </div>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {/* Content */}
        <div className="bulk-upload-content">

          {/* File Upload Section (always visible) */}
          <div className="form-group">
            <label>Upload File (CSV) *</label>
            <div
              className={`file-upload-box ${isDragging ? 'dragging' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                disabled={isProcessing}
              />
              {fileName ? (
                <div className="file-selected-state">
                  <div className="file-info">
                    <span className="file-icon">📄</span>
                    <div className="file-details">
                      <span className="file-name-label">Selected File</span>
                      <span className="file-name-value">{fileName}</span>
                    </div>
                  </div>
                  <button
                    className="file-select-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessing}
                  >
                    Replace File
                  </button>
                </div>
              ) : (
                <div className="file-empty-state">
                  <span className="file-icon-large">📁</span>
                  <div className="file-prompt">
                    <span className="prompt-text">Choose a CSV file to upload</span>
                    <span className="prompt-subtext">or drag and drop here</span>
                  </div>
                  <button
                    className="file-select-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessing}
                  >
                    Choose File
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* File parsing errors */}
          {validationErrors.length > 0 && !hasValidationResult && (
            <div className="error-list">
              {validationErrors.map((err, i) => (
                <div key={i} className="error-item">{err}</div>
              ))}
            </div>
          )}

          {/* Records count (before validation) */}
          {records.length > 0 && !hasValidationResult && (
            <div className="form-group">
              <label>Records to Validate: <strong>{records.length}</strong></label>
            </div>
          )}

          {/* Validation Results Section (after validation) */}
          {hasValidationResult && (
            <>
              {/* Success message */}
              {validationResult.isSuccess && (
                <div className="validation-success-message">
                  ✅ Validation Successful - {validationResult.validRecords} records ready to import
                </div>
              )}

              {/* Summary Cards */}
              <div className="summary-cards-grid">
                <div className="summary-card">
                  <span className="card-icon">📊</span>
                  <span className="card-value">{validationResult.totalRecords}</span>
                  <span className="card-label">Total Records</span>
                </div>
                <div className="summary-card success">
                  <span className="card-icon">✓</span>
                  <span className="card-value">{validationResult.validRecords}</span>
                  <span className="card-label">Valid Records</span>
                </div>
                <div className="summary-card failure">
                  <span className="card-icon">✕</span>
                  <span className="card-value">{validationResult.failedRecords}</span>
                  <span className="card-label">Failed</span>
                </div>
                <div className="summary-card">
                  <span className="card-icon">⚠</span>
                  <span className="card-value">{validationResult.duplicateRecords}</span>
                  <span className="card-label">Duplicates</span>
                </div>
              </div>

              {/* Failed Records Table */}
              {validationResult.failedRecordsList.length > 0 && (
                <div className="failed-records-container">
                  <div className="failed-records-header">
                    <span className="header-text">
                      Failed Records ({validationResult.failedRecordsList.length})
                    </span>
                  </div>

                  <div className="failed-records-table-wrapper">
                    <table className="failed-records-table">
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Student Name</th>
                          <th>Phone</th>
                          <th>Validation Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {validationResult.failedRecordsList.map((record, idx) => (
                          <tr key={idx} className={idx % 2 === 0 ? 'even' : 'odd'}>
                            <td className="col-row">{record.row}</td>
                            <td className="col-name">{record.studentName || '—'}</td>
                            <td className="col-phone">{record.phone || '—'}</td>
                            <td className="col-error">
                              {record.errors && Array.isArray(record.errors) && record.errors.length > 0 ? (
                                <div className="error-badges">
                                  {record.errors.map((msg, i) => (
                                    <span key={i} className="error-badge">
                                      • {msg}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span>—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Download template link */}
          {!hasValidationResult && (
            <button
              className="download-template-link"
              onClick={downloadTemplate}
              disabled={isProcessing}
            >
              ↓ Download Template
            </button>
          )}
        </div>

        {/* Footer with context-aware buttons */}
        <div className={`bulk-upload-footer ${hasValidationResult ? 'summary-footer' : ''}`}>

          {/* Before validation */}
          {!hasValidationResult && (
            <>
              <button
                className="btn-cancel"
                onClick={onClose}
                disabled={isProcessing}
              >
                Cancel
              </button>
              <button
                className="btn-submit"
                onClick={handleValidateFile}
                disabled={isProcessing || records.length === 0}
              >
                Validate File
              </button>
            </>
          )}

          {/* After validation with failures */}
          {hasValidationResult && hasFailures && (
            <>
              {validationResult.failedRecords > 0 && (
                <button
                  className="btn-secondary"
                  onClick={downloadErrorReport}
                  disabled={isDownloadingErrors}
                >
                  ↓ Download Error Report
                </button>
              )}
              <button
                className="btn-cancel"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="btn-submit"
                onClick={handleValidateFile}
              >
                Validate Again
              </button>
            </>
          )}

          {/* After validation success */}
          {hasValidationResult && validationResult.isSuccess && (
            <>
              <button
                className="btn-cancel"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="btn-submit"
                onClick={handleUploadRecords}
              >
                Upload Records
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
