import { useEffect, useState } from 'react';
import { ChevronRight, Download, Eye, RotateCcw, X } from 'lucide-react';
import { api } from './api';
import './BulkActionsPage.css';

export default function BulkActionsPage() {
  const [uploads, setUploads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedUpload, setSelectedUpload] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(null);

  useEffect(() => {
    loadUploads();
    const interval = setInterval(loadUploads, 5000);
    setRefreshInterval(interval);
    return () => clearInterval(interval);
  }, []);

  const loadUploads = async () => {
    try {
      const data = await api('/bulk-uploads');
      setUploads(data.data || []);
    } catch (error) {
      console.error('Failed to load uploads:', error);
    } finally {
      setLoading(false);
    }
  };

  const openDetails = async (upload) => {
    setDetailsLoading(true);
    try {
      const data = await api(`/bulk-uploads/${upload.id}`);
      setSelectedUpload(data);
    } catch (error) {
      console.error('Failed to load details:', error);
    } finally {
      setDetailsLoading(false);
    }
  };

  const closeDetails = () => {
    setSelectedUpload(null);
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase().replace(/\s+/g, '-')) {
      case 'completed': return 'status-completed';
      case 'completed-with-errors': return 'status-warning';
      case 'failed': return 'status-failed';
      case 'in-progress':
      case 'validating':
      case 'queued': return 'status-processing';
      default: return 'status-default';
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDuration = (startedAt, completedAt) => {
    if (!startedAt || !completedAt) return '-';
    const start = new Date(startedAt);
    const end = new Date(completedAt);
    const minutes = Math.floor((end - start) / 60000);
    return `${minutes}m`;
  };

  if (selectedUpload) {
    return (
      <UploadDetailsView
        upload={selectedUpload}
        onClose={closeDetails}
        loading={detailsLoading}
        onRefresh={() => openDetails(uploads.find(u => u.id === selectedUpload.upload.id))}
      />
    );
  }

  return (
    <div className="page bulk-actions-page">
      <div className="page-heading">
        <div>
          <h1>Bulk Actions</h1>
          <p>Monitor and manage all bulk operations</p>
        </div>
        <button className="refresh-btn" onClick={loadUploads} disabled={loading}>
          Refresh
        </button>
      </div>

      <div className="bulk-actions-container">
        <div className="bulk-actions-header">
          <h2>Bulk Uploads</h2>
          <span className="upload-count">{uploads.length} uploads</span>
        </div>

        {loading && (
          <div className="empty">
            <div className="loading-spinner"></div>
            <p>Loading uploads...</p>
          </div>
        )}

        {!loading && uploads.length === 0 && (
          <div className="empty">
            <p>No bulk uploads yet. Start by clicking the <strong>Bulk Upload</strong> button on the Leads page.</p>
          </div>
        )}

        {!loading && uploads.length > 0 && (
          <div className="uploads-table-wrap">
            <table className="uploads-table">
              <thead>
                <tr>
                  <th>File Name</th>
                  <th>Upload Date</th>
                  <th>Uploaded By</th>
                  <th>Total Records</th>
                  <th>Success</th>
                  <th>Failed</th>
                  <th>Duplicates</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map(upload => (
                  <tr key={upload.id}>
                    <td className="file-name">{upload.fileName}</td>
                    <td className="date">{formatDate(upload.createdAt)}</td>
                    <td className="uploaded-by">{upload.uploadedBy}</td>
                    <td className="number">{upload.totalRecords}</td>
                    <td className="success">{upload.successfulRecords}</td>
                    <td className="failed">{upload.failedRecords}</td>
                    <td className="duplicate">{upload.duplicateRecords}</td>
                    <td>
                      <span className={`status-badge ${getStatusColor(upload.status)}`}>
                        {upload.status}
                      </span>
                    </td>
                    <td className="actions">
                      <button
                        className="action-btn view-btn"
                        title="View details"
                        onClick={() => openDetails(upload)}
                      >
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function UploadDetailsView({ upload, onClose, loading, onRefresh }) {
  const [tab, setTab] = useState('events'); // events is the default, or failed if there are failed records
  const [downloading, setDownloading] = useState(false);

  const downloadErrorReport = async () => {
    setDownloading(true);
    try {
      const response = await fetch(`/api/bulk-uploads/${upload.upload.id}/download-errors`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('crm_token')}`
        }
      });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `error-report-${upload.upload.id}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download error:', error);
    } finally {
      setDownloading(false);
    }
  };

  const downloadSuccessfulRecords = async () => {
    setDownloading(true);
    try {
      const response = await fetch(`/api/bulk-uploads/${upload.upload.id}/download-successful`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('crm_token')}`
        }
      });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `successful-records-${upload.upload.id}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download error:', error);
    } finally {
      setDownloading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase().replace(/\s+/g, '-')) {
      case 'completed': return 'status-completed';
      case 'completed-with-errors': return 'status-warning';
      case 'failed': return 'status-failed';
      case 'in-progress':
      case 'validating':
      case 'queued': return 'status-processing';
      default: return 'status-default';
    }
  };

  if (loading) {
    return (
      <div className="page bulk-actions-page">
        <div className="page-heading">
          <button className="back-btn" onClick={onClose}>← Back</button>
        </div>
        <div className="empty">
          <div className="loading-spinner"></div>
          <p>Loading upload details...</p>
        </div>
      </div>
    );
  }

  const { upload: uploadInfo, records = [], events = [] } = upload;
  const failedRecords = records.filter(r => r.status === 'Failed');
  const successRecords = records.filter(r => r.status === 'Success');

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <button className="back-btn" onClick={onClose}>← Back to Bulk Uploads</button>
          <h1>{uploadInfo.fileName}</h1>
          <p>Upload ID: {uploadInfo.id}</p>
        </div>
        <button className="refresh-btn" onClick={onRefresh}>Refresh</button>
      </div>

      <div className="upload-details-container">
        {/* Summary Cards - Single Row */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon violet">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M7 10H13M10 7V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <span>Total Records</span>
              <strong>{uploadInfo.totalRecords}</strong>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon green">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 10L9 13L14 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <span>Successfully Imported</span>
              <strong>{uploadInfo.successfulRecords}</strong>
              <small>{uploadInfo.totalRecords > 0 ? Math.round((uploadInfo.successfulRecords / uploadInfo.totalRecords) * 100) : 0}%</small>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon orange">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 6V10M10 14H10.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <span>Failed</span>
              <strong className="error-text">{uploadInfo.failedRecords}</strong>
              <small className="warning">{uploadInfo.totalRecords > 0 ? Math.round((uploadInfo.failedRecords / uploadInfo.totalRecords) * 100) : 0}%</small>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon blue">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 6V10M10 14H10.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <span>Duplicates</span>
              <strong>{uploadInfo.duplicateRecords}</strong>
            </div>
          </div>
        </div>

        {/* General Information */}
        <div className="info-section">
          <h2>General Information</h2>
          <div className="info-grid">
            <div className="info-row">
              <span className="info-label">File Name:</span>
              <span className="info-value">{uploadInfo.fileName}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Upload Date & Time:</span>
              <span className="info-value">{formatDate(uploadInfo.createdAt)}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Processing Started:</span>
              <span className="info-value">{formatDate(uploadInfo.startedAt)}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Processing Completed:</span>
              <span className="info-value">{formatDate(uploadInfo.completedAt)}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Total Processed:</span>
              <span className="info-value">{uploadInfo.processedRecords} / {uploadInfo.totalRecords}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Skipped:</span>
              <span className="info-value">{uploadInfo.skippedRecords}</span>
            </div>
          </div>
        </div>

        {/* Download Actions */}
        <div className="actions-section">
          <h2>Download Reports</h2>
          <div className="action-buttons">
            {uploadInfo.failedRecords > 0 && (
              <button
                className="action-btn error"
                onClick={downloadErrorReport}
                disabled={downloading}
              >
                <Download size={16} />
                Download Error Report ({uploadInfo.failedRecords} records)
              </button>
            )}
            {uploadInfo.successfulRecords > 0 && (
              <button
                className="action-btn success"
                onClick={downloadSuccessfulRecords}
                disabled={downloading}
              >
                <Download size={16} />
                Download Successful Records ({uploadInfo.successfulRecords} records)
              </button>
            )}
            {uploadInfo.duplicateRecords > 0 && (
              <button
                className="action-btn"
                disabled={downloading}
              >
                <Download size={16} />
                Duplicate Records ({uploadInfo.duplicateRecords} records)
              </button>
            )}
          </div>
        </div>

        {/* Tabs and Content Container */}
        <div>
          {(failedRecords.length > 0 || events.length > 0) && (
            <div className="details-tabs">
              {failedRecords.length > 0 && (
                <button
                  className={`tab ${tab === 'failed' ? 'active' : ''}`}
                  onClick={() => setTab('failed')}
                >
                  Failed Records ({failedRecords.length})
                </button>
              )}
              {events.length > 0 && (
                <button
                  className={`tab ${tab === 'events' ? 'active' : ''}`}
                  onClick={() => setTab('events')}
                >
                  Processing Log
                </button>
              )}
            </div>
          )}

        {/* Tab Content */}
        {tab === 'failed' && failedRecords.length > 0 && (
          <div className="tab-content">
            <div className="records-list">
              {failedRecords.slice(0, 50).map(record => (
                <div key={record.rowNumber} className="record-item failed">
                  <div className="record-header">
                    <strong>Row {record.rowNumber}</strong>
                    <span className="record-status">Failed</span>
                  </div>
                  {record.validationErrors && (
                    <ul className="error-messages">
                      {Object.entries(record.validationErrors).map(([key, msg]) => (
                        <li key={key}>{msg}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              {failedRecords.length > 50 && (
                <p className="more-records">... and {failedRecords.length - 50} more failed records</p>
              )}
            </div>
          </div>
        )}

        {tab === 'events' && events.length > 0 && (
          <div className="tab-content">
            <div className="events-timeline">
              {events.map((event, i) => (
                <div key={i} className="event-item">
                  <div className="event-time">{formatDate(event.createdAt)}</div>
                  <div className="event-type">{event.eventType}</div>
                  <div className="event-message">{event.message}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
        {/* End Tabs and Content Container */}
      </div>
    </div>
  );
}
