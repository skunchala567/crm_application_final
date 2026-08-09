import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Ban, CheckCircle, Download, FileSpreadsheet, History, ListChecks, Plus, RefreshCw, Search, Settings2, Trash2, X } from 'lucide-react';
import { api } from '../api';
import FieldMappingPanel from './FieldMappingPanel';
import SpreadsheetPicker from './SpreadsheetPicker';
import './GoogleSheetsSettings.css';

function SheetSources({ integrationId, googleIntegrations, onSelectIntegration, onMessage }) {
  const [sources, setSources] = useState([]);
  const [branches, setBranches] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [pendingSheet, setPendingSheet] = useState(null);
  const [branchId, setBranchId] = useState('');
  const [busyId, setBusyId] = useState('');
  const [mappingSource, setMappingSource] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const [showConnectionPicker, setShowConnectionPicker] = useState(false);

  const load = async () => {
    const eligible = googleIntegrations.filter(item =>
      (item.status === 'active' || item.status === 'connected') &&
      (!integrationId || String(item.id) === String(integrationId))
    );
    const [sourceResponses, branchResponse] = await Promise.all([
      Promise.all(eligible.map(item => api.get(`/hub/integrations/${item.id}/sheet-sources`).then(response =>
        (response.data || []).map(source => ({ ...source, integrationId: item.id, integrationName: item.integration_name }))
      ))),
      api.get('/branches')
    ]);
    setSources(sourceResponses.flat());
    setBranches(branchResponse.data || branchResponse || []);
  };
  useEffect(() => { load().catch(error => onMessage?.({ type: 'error', text: error.message })); }, [integrationId, googleIntegrations.length]);

  const confirmConnection = async integration => {
    try {
      const authorized = integration.status === 'active' || integration.status === 'connected';
      const response = await api.post('/hub/oauth/initiate', {
        integrationId: integration.id, providerName: 'google_sheets',
        returnTo: '/settings/google-sheets', confirmAccount: authorized
      });
      if (response.data?.authUrl) {
        sessionStorage.setItem('googleSheetsAddIntegrationId', String(integration.id));
        window.location.href = response.data.authUrl;
      }
    } catch (error) { onMessage?.({ type: 'error', text: error.message }); }
  };

  const addSource = async () => {
    if (!pendingSheet || !branchId) return;
    try {
      setBusyId('add');
      const response = await api.post(`/hub/integrations/${integrationId}/sheet-sources`, { sheetId: pendingSheet.id, sheetName: pendingSheet.name, branchId: Number(branchId) });
      setMappingSource(response.data);
      setPendingSheet(null); setBranchId(''); await load();
      onMessage?.({ type: 'success', text: 'Sheet added. Complete field mapping to activate continuous import.' });
    } catch (error) { onMessage?.({ type: 'error', text: error.message }); }
    finally { setBusyId(''); }
  };

  const removeSource = async source => {
    if (!window.confirm(`Remove "${source.sheetName}" from ${source.branchName}?`)) return;
    try {
      setBusyId(source.id);
      await api.delete(`/hub/integrations/${source.integrationId || integrationId}/sheet-sources/${source.id}`);
      await load();
    } catch (error) { onMessage?.({ type: 'error', text: error.message }); }
    finally { setBusyId(''); }
  };

  if (showSkipped) return <SkippedLeadsScreen integrationId={integrationId} googleIntegrations={googleIntegrations} onBack={() => setShowSkipped(false)}/>;

  return <section className="google-workspace-card sheet-sources-card">
    <div className="google-section-heading"><div><h2>Lead import sources</h2><p>Add one Google Sheet per branch, then import its rows into Leads.</p></div><div className="google-source-actions"><select className="google-source-filter" value={integrationId} onChange={event=>onSelectIntegration(event.target.value)}><option value="">All integrations</option>{googleIntegrations.map(item=><option key={item.id} value={item.id}>{item.integration_name}</option>)}</select><button className="google-skipped-button" onClick={() => setShowSkipped(true)}><Ban size={15}/> Skipped Leads</button><button className="google-add-source" onClick={() => setShowConnectionPicker(true)}><Plus size={16}/> Add Google Sheet</button></div></div>
    {pendingSheet && <div className="sheet-source-composer">
      <div><span>Selected spreadsheet</span><strong>{pendingSheet.name}</strong></div>
      <label>Import leads into branch<select value={branchId} onChange={event => setBranchId(event.target.value)}><option value="">Select branch</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <button className="primary" disabled={!branchId || busyId === 'add'} onClick={addSource}>{busyId === 'add' ? 'Adding…' : 'Add source'}</button>
      <button className="secondary" onClick={() => { setPendingSheet(null); setBranchId(''); }}>Cancel</button>
    </div>}
    {mappingSource && <div className="source-mapping-setup">
      <div className="source-mapping-title"><div><strong>Complete setup for {mappingSource.sheetName}</strong><span>Map the required lead fields to activate continuous import into {mappingSource.branchName}.</span></div><button onClick={() => setMappingSource(null)}>Close</button></div>
      <FieldMappingPanel integrationId={integrationId} sheetId={mappingSource.sheetId} sourceId={mappingSource.id} onSaved={async () => {
        await api.post(`/hub/integrations/${integrationId}/sheet-sources/${mappingSource.id}/import`);
        setMappingSource(null);
        await load();
        onMessage?.({ type: 'success', text: 'Sheet connected and imported. Continuous sync is active.' });
      }}/>
    </div>}
    {sources.length === 0 ? <div className="google-state">No sheet sources configured. Add a spreadsheet and assign its destination branch.</div> : <div className="sheet-source-list">{sources.map(source => <article key={`${source.integrationId}-${source.id}`}>
      <span className="sheet-source-icon"><FileSpreadsheet size={18}/></span><div><strong>{source.sheetName}</strong><small>{source.status === 'active' ? `Continuous import to ${source.branchName}` : `Mapping required · ${source.branchName}`}</small></div>
      <div className="sheet-source-tools">
        <button onClick={() => setWorkspace({source,view:'configuration',integrationId:source.integrationId})} title="Configuration"><Settings2 size={16}/></button>
        <button className={source.status !== 'active' ? 'attention' : ''} onClick={() => setWorkspace({source,view:'mapping',integrationId:source.integrationId})} title="Field mapping"><ListChecks size={16}/></button>
        <button disabled={source.status !== 'active'} onClick={() => setWorkspace({source,view:'sync',integrationId:source.integrationId})} title="Sync data"><RefreshCw size={16}/></button>
        <button onClick={() => setWorkspace({source,view:'logs',integrationId:source.integrationId})} title="Sync logs"><History size={16}/></button>
      </div>
      <button className="sheet-remove-button" disabled={busyId === source.id} onClick={() => removeSource(source)} title="Remove source"><Trash2 size={15}/></button>
    </article>)}</div>}
    {workspace && <div className="sheet-workspace-overlay" onClick={() => setWorkspace(null)}><aside className="sheet-workspace-drawer" onClick={event => event.stopPropagation()}>
      <header><div><span>{workspace.source.branchName}</span><h2>{workspace.source.sheetName}</h2></div><button onClick={() => setWorkspace(null)}><X size={18}/></button></header>
      <nav>{[['configuration',Settings2,'Configuration'],['mapping',ListChecks,'Field mapping'],['sync',RefreshCw,'Sync data'],['logs',History,'Sync logs']].map(([view,Icon,label])=><button key={view} className={workspace.view===view?'active':''} onClick={()=>setWorkspace({...workspace,view})} title={label}><Icon size={16}/><span>{label}</span></button>)}</nav>
      <div className="sheet-workspace-body">
        {workspace.view==='configuration'&&<SheetConfiguration integrationId={workspace.integrationId} source={workspace.source}/>}
        {workspace.view==='mapping'&&<section className="google-workspace-card"><FieldMappingPanel integrationId={workspace.integrationId} sheetId={workspace.source.sheetId} sourceId={workspace.source.id} onSaved={async()=>{await load();setWorkspace(current=>({...current,source:{...current.source,status:'active'}}));}}/></section>}
        {workspace.view==='sync'&&<SheetSync integrationId={workspace.integrationId} source={workspace.source} onMessage={onMessage}/>}
        {workspace.view==='logs'&&<SyncLogs integrationId={workspace.integrationId} source={workspace.source}/>}
      </div>
    </aside></div>}
    {showPicker && <SpreadsheetPicker integrationId={integrationId} persistSelection={false} onClose={() => setShowPicker(false)} onSelect={sheet => { setPendingSheet(sheet); setShowPicker(false); }}/>}
    {showConnectionPicker && <div className="google-connection-overlay" onClick={()=>setShowConnectionPicker(false)}><section className="google-connection-picker" onClick={event=>event.stopPropagation()}>
      <header><div><h2>Select Google Sheets integration</h2><p>Choose the Google account connection to use for this sheet.</p></div><button onClick={()=>setShowConnectionPicker(false)}><X size={18}/></button></header>
      <div className="google-connection-list">{googleIntegrations.map(integration => {
        const authorized = integration.status === 'active' || integration.status === 'connected';
        return <button key={integration.id} onClick={()=>confirmConnection(integration)}><span className="google-title-icon"><FileSpreadsheet size={18}/></span><span><strong>{integration.integration_name}</strong><small>{authorized ? `Authorized${integration.config?.googleAccountEmail ? ` · ${integration.config.googleAccountEmail}` : ''}` : 'Authorization pending'}</small></span><b className={authorized?'authorized':'pending'}>{authorized?'Confirm account':'Authorize'}</b></button>;
      })}</div>
      {!googleIntegrations.length&&<div className="google-state">No Google Sheets integrations are configured.</div>}
    </section></div>}
  </section>;
}

function SkippedLeadsScreen({ integrationId, googleIntegrations, onBack }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', branch: '', sheet: '', reason: '', from: '', to: '' });
  const load = async () => {
    try {
      setLoading(true);
      const eligible = googleIntegrations.filter(item =>
        (item.status === 'active' || item.status === 'connected') &&
        (!integrationId || String(item.id) === String(integrationId))
      );
      const responses = await Promise.all(eligible.map(item => api.get(`/hub/integrations/${item.id}/skipped-leads`)));
      setRecords(responses.flatMap(response => response.data || []));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [integrationId]);
  const branches = [...new Set(records.map(item => item.branchName).filter(Boolean))].sort();
  const sheets = [...new Set(records.map(item => item.sheetName).filter(Boolean))].sort();
  const reasonTypes = [...new Set(records.map(item => item.reason?.split(';')[0]).filter(Boolean))].sort();
  const filtered = records.filter(item => {
    const query = filters.search.trim().toLowerCase();
    const attempted = new Date(item.lastSeenAt);
    return (!query || [item.studentName, item.phone, item.existingLeadNumber, item.reason].some(value => String(value || '').toLowerCase().includes(query)))
      && (!filters.branch || item.branchName === filters.branch)
      && (!filters.sheet || item.sheetName === filters.sheet)
      && (!filters.reason || item.reason?.startsWith(filters.reason))
      && (!filters.from || attempted >= new Date(`${filters.from}T00:00:00`))
      && (!filters.to || attempted <= new Date(`${filters.to}T23:59:59.999`));
  });
  const exportCsv = () => {
    const rows = [
      ['Last Attempted','Branch','Sheet','Row','Student','Phone','Reason','Existing Lead','Skip Count'],
      ...filtered.map(item => [new Date(item.lastSeenAt).toLocaleString(),item.branchName,item.sheetName,item.rowNumber,item.studentName,item.phone,item.reason,item.existingLeadNumber,item.occurrenceCount])
    ];
    const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `google-sheets-skipped-leads-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const setFilter = (name, value) => setFilters(current => ({ ...current, [name]: value }));

  return <section className="skipped-leads-screen">
      <header className="skipped-screen-header"><div><button onClick={onBack}><ArrowLeft size={17}/></button><span><h2>Skipped Leads</h2><p>Review Google Sheet rows that were not imported and their exact reason.</p></span></div><div><button onClick={load}><RefreshCw size={15}/> Refresh</button><button className="primary" disabled={!filtered.length} onClick={exportCsv}><Download size={15}/> Export CSV</button></div></header>
      <div className="skipped-summary"><div><strong>{filtered.length}</strong><span>Filtered records</span></div><div><strong>{records.length}</strong><span>Total skipped leads</span></div><div><strong>{branches.length}</strong><span>Affected branches</span></div></div>
      <div className="skipped-filters">
        <label className="skipped-search"><Search size={15}/><input value={filters.search} onChange={event=>setFilter('search',event.target.value)} placeholder="Search student, phone, lead or reason"/></label>
        <select value={filters.branch} onChange={event=>setFilter('branch',event.target.value)}><option value="">All branches</option>{branches.map(value=><option key={value}>{value}</option>)}</select>
        <select value={filters.sheet} onChange={event=>setFilter('sheet',event.target.value)}><option value="">All sheets</option>{sheets.map(value=><option key={value}>{value}</option>)}</select>
        <select value={filters.reason} onChange={event=>setFilter('reason',event.target.value)}><option value="">All reasons</option>{reasonTypes.map(value=><option key={value}>{value}</option>)}</select>
        <label><span>From</span><input type="date" value={filters.from} onChange={event=>setFilter('from',event.target.value)}/></label>
        <label><span>To</span><input type="date" value={filters.to} onChange={event=>setFilter('to',event.target.value)}/></label>
        <button className="clear-skipped-filters" onClick={()=>setFilters({search:'',branch:'',sheet:'',reason:'',from:'',to:''})}>Clear filters</button>
      </div>
      <div className="skipped-leads-content">
        {loading ? <div className="google-state">Loading skipped leads...</div> : !filtered.length ? <div className="google-state">No skipped leads match the selected filters.</div> :
          <div className="google-table-wrap"><table><thead><tr><th>Last attempted</th><th>Branch / Sheet</th><th>Row</th><th>Student</th><th>Phone</th><th>Reason</th></tr></thead><tbody>
            {filtered.map(record => <tr key={record.id}>
              <td>{new Date(record.lastSeenAt).toLocaleString()}</td>
              <td><strong>{record.branchName || '—'}</strong><small>{record.sheetName || '—'}</small></td>
              <td>{record.rowNumber}</td><td>{record.studentName || '—'}</td><td>{record.phone || '—'}</td>
              <td><span className="skipped-reason">{record.reason}</span>{record.occurrenceCount > 1 && <small>Skipped {record.occurrenceCount} times</small>}</td>
            </tr>)}
          </tbody></table></div>}
      </div>
    </section>;
}

function SyncLogs({ integrationId, source }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/hub/integrations/${integrationId}/sheet-sources/${source.id}/history`);
      setLogs(response.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [integrationId, source.id]);

  return (
    <section className="google-workspace-card">
      <div className="google-section-heading">
        <div><h2>Sync logs</h2><p>Recent continuous and manual imports for {source.sheetName}.</p></div>
        <button className="google-icon-button" onClick={load} title="Refresh sync history"><RefreshCw size={16} /></button>
      </div>
      {loading ? <div className="google-state">Loading sync history…</div> : logs.length === 0 ? (
        <div className="google-state">No sync activity has been recorded yet.</div>
      ) : (
        <div className="google-table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Status</th><th>Records</th><th>Duration</th></tr></thead>
            <tbody>{logs.map(log => (
              <tr key={log.id}>
                <td>{new Date(log.created_at).toLocaleString()}</td>
                <td>{log.sync_type}</td>
                <td><span className={`google-log-status ${log.status}`}>{log.status}</span></td>
                <td>{log.records_processed ?? 0}</td>
                <td>{log.completed_at && log.started_at ? `${Math.max(0, Math.round((new Date(log.completed_at)-new Date(log.started_at))/1000))}s` : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SheetConfiguration({ integrationId, source }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/hub/integrations/${integrationId}/spreadsheets/${source.sheetId}/preview`);
      setPreview(response.data);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [integrationId, source.sheetId]);
  return <section className="google-workspace-card">
    <div className="google-section-heading"><div><h2>Configuration</h2><p>Sheet and destination settings for this source.</p></div><button className="google-icon-button" onClick={load}><RefreshCw size={16}/></button></div>
    <div className="sheet-config-summary"><div><span>Spreadsheet</span><strong>{source.sheetName}</strong></div><div><span>Destination branch</span><strong>{source.branchName}</strong></div><div><span>Sync mode</span><strong>Continuous · every minute</strong></div><div><span>Status</span><strong>{source.status === 'active' ? 'Active' : 'Mapping required'}</strong></div></div>
    {loading ? <div className="google-state">Loading sheet preview…</div> : preview?.headers?.length ? <div className="google-table-wrap"><table><thead><tr>{preview.headers.map((header,index)=><th key={index}>{header}</th>)}</tr></thead><tbody>{(preview.rows||[]).map((row,index)=><tr key={index}>{preview.headers.map((_,cell)=><td key={cell}>{row[cell] || '—'}</td>)}</tr>)}</tbody></table></div> : <div className="google-state">No preview data is available.</div>}
  </section>;
}

function SheetSync({ integrationId, source, onMessage }) {
  const [syncing, setSyncing] = useState(false);
  const run = async () => {
    try {
      setSyncing(true);
      const response = await api.post(`/hub/integrations/${integrationId}/sheet-sources/${source.id}/import`);
      const result = response.data?.result || response.data || {};
      onMessage?.({ type:'success', text: result.message || `Sync completed for ${source.sheetName}` });
    } catch(error) { onMessage?.({ type:'error', text:error.message }); }
    finally { setSyncing(false); }
  };
  return <section className="google-workspace-card sheet-sync-card"><div className="google-section-heading"><div><h2>Sync data</h2><p>Continuous imports run every minute for this sheet.</p></div></div><div className="sheet-sync-status"><RefreshCw size={22}/><div><strong>Continuous import is {source.status === 'active' ? 'active' : 'waiting for mapping'}</strong><span>New rows are deduplicated and added to {source.branchName} in Leads.</span></div><button className="primary" disabled={syncing || source.status !== 'active'} onClick={run}>{syncing ? 'Importing…' : 'Import now'}</button></div></section>;
}

export default function GoogleSheetsSettings({ onMessage }) {
  const [integrations, setIntegrations] = useState([]);
  const [integrationId, setIntegrationId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const oauthParams = new URLSearchParams(window.location.search);

  const loadIntegrations = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await api.get('/hub/integrations');
      const googleConnections = (response.data || []).filter(item => item.provider_name === 'google_sheets');
      setIntegrations(googleConnections);
      setIntegrationId(current =>
        googleConnections.some(item => String(item.id) === String(current))
          ? current
          : ''
      );
      if (oauthParams.get('oauth') === 'success') sessionStorage.removeItem('googleSheetsAddIntegrationId');
    } catch (err) {
      setError(err.message || 'Failed to load Google Sheets connections');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadIntegrations(); }, []);
  const selectedIntegration = integrations.find(item => String(item.id) === String(integrationId));

  return (
    <main className="google-sheets-settings">
      <header className="google-sheets-header">
        <div className="google-header-actions">
          <button className="google-refresh" onClick={() => navigate('/settings/integrations?add=1')}><Plus size={16}/> Add Integration</button>
          <button className="google-refresh" onClick={loadIntegrations}><RefreshCw size={16} /> Refresh</button>
        </div>
      </header>

      {loading ? <div className="google-page-state">Loading Google Sheets…</div> : error ? (
        <div className="google-page-state error"><AlertCircle /><strong>Unable to load Google Sheets</strong><span>{error}</span></div>
      ) : integrations.length === 0 ? (
        <div className="google-page-state">
          <FileSpreadsheet size={34} />
          <strong>No authorized Google Sheets connection</strong>
          <span>Authorize Google Sheets from Integrations before configuring sheets and sync.</span>
          <button className="primary" onClick={() => navigate('/settings/integrations')}>Open Integrations</button>
        </div>
      ) : (
        <>
          <section className="google-connection-strip">
            <div><CheckCircle size={17} /><span>{selectedIntegration ? (selectedIntegration.status === 'active' || selectedIntegration.status === 'connected' ? 'Connected' : 'Authorization pending') : 'Google Sheets connections'}</span></div>
            <strong>{selectedIntegration?.integration_name || `${integrations.filter(item => item.status === 'active' || item.status === 'connected').length} authorized`}</strong>
            <small>{selectedIntegration ? 'Authorized Google Sheets integration' : 'Showing sources from all integrations'}</small>
          </section>
          <div className="google-settings-content">
            <SheetSources integrationId={integrationId} googleIntegrations={integrations} onSelectIntegration={setIntegrationId} onMessage={onMessage} />
          </div>
        </>
      )}
    </main>
  );
}
