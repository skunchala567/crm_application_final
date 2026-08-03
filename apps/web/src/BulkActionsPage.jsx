import { Fragment, useEffect, useState } from 'react';
import { ChevronRight, Download, Eye, FileDown, GitBranch, PhoneCall, RefreshCw, RotateCcw, Search, UserRoundCheck, X } from 'lucide-react';
import { api } from './api';
import { useBusinessUnit } from './BusinessUnitContext.jsx';
import { DateRangeFilterControl } from './FilterWorkspace.jsx';
import './BulkActionsPage.css';

export default function BulkActionsPage() {
  const { selectedId } = useBusinessUnit();
  const [uploads, setUploads] = useState([]);
  const [operations, setOperations] = useState([]);
  const [dialerCampaigns,setDialerCampaigns]=useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('uploads');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedOperation, setExpandedOperation] = useState(null);
  const [selectedUpload, setSelectedUpload] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  useEffect(() => {
    setUploads([]);
    setOperations([]);
    setDialerCampaigns([]);
    setSelectedUpload(null);
    setExpandedOperation(null);
    setLoading(true);
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [selectedId]);

  const loadData = async () => {
    try {
      const [uploadData,operationData,dialerData] = await Promise.all([api('/bulk-uploads'),api('/bulk-operations'),api('/callerdesk/campaigns').catch(()=>({data:[]}))]);
      setUploads(uploadData.data || []);
      setOperations(operationData.data || []);
      setDialerCampaigns(dialerData.data||[]);
    } catch (error) {
      console.error('Failed to load bulk operation history:', error);
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

  const closeDetails = () => setSelectedUpload(null);

  const exportAffectedLeads = async (row) => {
    try {
      const endpoint = activeTab === 'uploads'
        ? `/api/bulk-uploads/${row.id}/download-successful`
        : `/api/bulk-operations/${row.id}/export`;
      const response = await fetch(endpoint,{headers:{Authorization:`Bearer ${localStorage.getItem('crm_token')}`,'X-Business-Unit-Id':String(selectedId)}});
      if(!response.ok){
        const errorBody=await response.json().catch(()=>({}));
        throw new Error(errorBody.message||'Export failed');
      }
      const blob=await response.blob();
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=url;
      link.download=activeTab==='uploads'?`bulk-upload-${row.id}-leads.csv`:`bulk-${activeTab}-${row.id}-leads.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch(error) {
      window.alert(error.message);
    }
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase().replace(/\s+/g, '-')) {
      case 'completed': return 'status-completed';
      case 'completed-with-errors': return 'status-warning';
      case 'partial': return 'status-warning';
      case 'failed': return 'status-failed';
      case 'in-progress':
      case 'validating':
      case 'queued': return 'status-processing';
      default: return 'status-default';
    }
  };

  const getStatusLabel = (status) =>
    status?.toLowerCase().replace(/[_\s]+/g, '-') === 'completed-with-errors'
      ? 'Completed'
      : status;

  const updateDialerStatus=async campaign=>{
    const status=campaign.status==='running'?'paused':'running';
    try{await api.patch(`/callerdesk/campaigns/${campaign.id}/status`,{status});await loadData();}
    catch(error){window.alert(error.message);}
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

  const tabs = [
    {id:'uploads',label:'Bulk uploads',icon:Download},
    {id:'data_export',label:'Data exports',icon:FileDown},
    {id:'stage_change',label:'Stage changes',icon:GitBranch},
    {id:'referral',label:'Referrals',icon:UserRoundCheck},
    {id:'dialer',label:'Dialling queues',icon:PhoneCall},
  ];
  const tabRows = activeTab === 'uploads'
    ? uploads.map(row=>({...row,createdBy:row.uploadedBy,summary:row.fileName}))
    : activeTab==='dialer'
      ? dialerCampaigns.map(row=>({...row,summary:row.name,totalRecords:row.total,successfulRecords:row.connected,failedRecords:row.finished,
          details:{mode:row.mode,pending:Number(row.pending||0),connected:Number(row.connected||0),deskphone:row.deskphone||'Default branch DID',callGroup:row.callGroup||'Default group'}}))
      : operations.filter(row=>row.operationType===activeTab);
  const normalizedStatus = value => value?.toLowerCase().replaceAll(' ','-');
  const visibleRows = tabRows.filter(row => {
    const text = `${row.summary||''} ${row.createdBy||''}`.toLowerCase();
    const created = row.createdAt ? new Date(row.createdAt).toISOString().slice(0,10) : '';
    return (!search || text.includes(search.toLowerCase()))
      && (!statusFilter || normalizedStatus(row.status)===statusFilter)
      && (!dateFrom || created>=dateFrom) && (!dateTo || created<=dateTo);
  });
  const totals = {
    records:visibleRows.reduce((sum,row)=>sum+Number(row.totalRecords||0),0),
    successful:visibleRows.reduce((sum,row)=>sum+Number(row.successfulRecords||0),0),
    failed:visibleRows.reduce((sum,row)=>sum+Number(row.failedRecords||0),0),
    completed:visibleRows.filter(row=>['completed','completed-with-errors','partial'].includes(normalizedStatus(row.status))).length,
  };

  return (
    <div className="page bulk-actions-page">
      <div className="page-heading">
        <div>
          <h1>Bulk Actions</h1>
          <p>Monitor and manage all bulk operations</p>
        </div>
        <button className="refresh-btn bulk-refresh" onClick={loadData} disabled={loading}>
          <RefreshCw size={15}/> Refresh
        </button>
      </div>

      <div className="bulk-actions-container">
        <div className="bulk-operation-tabs" role="tablist">
          {tabs.map(({id,label,icon:Icon})=>(
            <button key={id} className={activeTab===id?'active':''} onClick={()=>{setActiveTab(id);setExpandedOperation(null)}} role="tab">
              <Icon size={16}/><span>{label}</span>
              <b>{id==='uploads'?uploads.length:id==='dialer'?dialerCampaigns.length:operations.filter(row=>row.operationType===id).length}</b>
            </button>
          ))}
        </div>

        <div className="bulk-summary-grid">
          <div><span>Operations</span><strong>{visibleRows.length}</strong></div>
          <div><span>Records processed</span><strong>{totals.records}</strong></div>
          <div className="positive"><span>Successful</span><strong>{totals.successful}</strong></div>
          <div className="negative"><span>Failed</span><strong>{totals.failed}</strong></div>
          <div><span>Completed runs</span><strong>{totals.completed}</strong></div>
        </div>

        <div className="bulk-history-toolbar">
          <div className="bulk-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search history"/></div>
          <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option><option value="completed">Completed</option><option value="partial">Partial success</option>
            <option value="completed-with-errors">Completed with errors</option><option value="failed">Failed</option><option value="processing">Processing</option>
          </select>
          <div className="bulk-date-range-filter"><DateRangeFilterControl label="Created on" from={dateFrom} to={dateTo} onChange={(from,to)=>{setDateFrom(from);setDateTo(to)}}/></div>
          {(search||statusFilter||dateFrom||dateTo)&&<button className="clear-history-filters" onClick={()=>{setSearch('');setStatusFilter('');setDateFrom('');setDateTo('')}}>Clear</button>}
        </div>

        {loading ? <div className="empty"><div className="loading-spinner"/><p>Loading operation history...</p></div>
        : visibleRows.length===0 ? (
          <div className="empty bulk-empty">
            <p>No {tabs.find(tab=>tab.id===activeTab)?.label.toLowerCase()} match the current filters.</p>
          </div>
        ) : (
          <div className="uploads-table-wrap">
            <table className="uploads-table">
              <thead>
                <tr><th>{activeTab==='uploads'?'File name':'Operation details'}</th><th>Created on</th><th>Created by</th>
                  <th>Total</th><th>Success</th><th>Failed</th>{activeTab==='uploads'&&<th>Duplicates</th>}<th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {visibleRows.map(row => (
                  <Fragment key={`${activeTab}-${row.id}`}>
                    <tr key={row.id}>
                      <td className="file-name">{row.summary||row.fileName}</td><td className="date">{formatDate(row.createdAt)}</td>
                      <td className="uploaded-by">{row.createdBy||row.uploadedBy}</td><td className="number">{row.totalRecords}</td>
                      <td className="success">{row.successfulRecords}</td><td className="failed">{row.failedRecords}</td>
                      {activeTab==='uploads'&&<td className="duplicate">{row.duplicateRecords}</td>}
                      <td><span className={`status-badge ${getStatusColor(row.status)}`}>{getStatusLabel(row.status==='partial'?'Partial success':row.status)}</span></td>
                      <td className="actions">
                        <button className="action-btn view-btn" title="View details" onClick={()=>activeTab==='uploads'?openDetails(row):setExpandedOperation(expandedOperation===row.id?null:row.id)}><Eye size={16}/></button>
                        {activeTab==='dialer'?<button className="action-btn view-btn" disabled={['completed','cancelled'].includes(row.status)} title={row.status==='running'?'Pause queue':'Start queue'} onClick={()=>updateDialerStatus(row)}><PhoneCall size={16}/></button>:<button className="action-btn view-btn" title="Export affected leads" onClick={()=>exportAffectedLeads(row)}><Download size={16}/></button>}
                      </td>
                    </tr>
                    {activeTab!=='uploads'&&expandedOperation===row.id&&(
                      <tr key={`${row.id}-details`} className="operation-detail-row"><td colSpan="8">
                        <div><span>Summary</span><strong>{row.summary||'—'}</strong></div>
                        {Object.entries(row.details||{}).filter(([key])=>!['failures','leadIds'].includes(key)).map(([key,value])=><div key={key}><span>{key.replace(/([A-Z])/g,' $1')}</span><strong>{String(value??'—')}</strong></div>)}
                        {row.details?.leadIds?.length>0&&<div><span>Affected leads</span><strong>{row.details.leadIds.length} · Export available</strong></div>}
                        {row.errorMessage&&<div className="operation-error"><span>Error</span><strong>{row.errorMessage}</strong></div>}
                      </td></tr>
                    )}
                  </Fragment>
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
