import { useState, useEffect, useRef } from 'react';
import { AlertCircle, BarChart3, Building2, CalendarRange, ChevronLeft, ChevronRight, Download, IndianRupee, Loader, MessageCircle, Send, TrendingUp, X, UserPlus} from 'lucide-react';
import { api } from './api';
import SettingsWhatsAppTemplates from './pages/SettingsWhatsAppTemplates';
import SettingsWhatsAppTemplatesCreate from './pages/SettingsWhatsAppTemplatesCreate';
import SettingsWhatsAppTemplatesView from './pages/SettingsWhatsAppTemplatesView';
import { WhatsAppMessageHistory, WhatsAppSendPanel } from './components/WhatsAppSendPanel';
import { MultiSearchSelect } from './FilterWorkspace';
import WhatsAppBranchMapping from './components/WhatsAppBranchMapping.jsx';
import WhatsAppLeadIntake from './components/WhatsAppLeadIntake.jsx';

export default function WhatsAppTemplatesSettings({ onMessage }) {
  const [integrationId, setIntegrationId] = useState('');
  const [integrations, setIntegrations] = useState([]);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState('list'); // 'list' | 'create' | 'view'
  const [viewingTemplateId, setViewingTemplateId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showSendMessage, setShowSendMessage] = useState(false);
  const [showMessageHistory, setShowMessageHistory] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');

  useEffect(() => {
    fetchSmartpingIntegration();
  }, []);

  const fetchSmartpingIntegration = async () => {
    try {
      const response = await api.get('/whatsapp/integrations?provider=SMARTPING');
      const integrations = Array.isArray(response.data) ? response.data : response.data?.data || [];
      if (!integrations.length) {
        setError('WhatsApp integration not configured. Please create a Smartping integration first.');
        setLoading(false);
        return;
      }

      setIntegrations(integrations);
      setIntegrationId('');
      setError(null);
    } catch (err) {
      setError(`Failed to load WhatsApp integration: ${err.message}`);
      console.error('Error fetching smartping integration:', err);
    } finally {
      setLoading(false);
    }
  };

  // Duplicating opens the create form prefilled, rather than writing a copy
  // straight to the account. A duplicate is a starting point, not a template
  // anyone asked to publish.
  const [prefillTemplate, setPrefillTemplate] = useState(null);

  const handleNavigate = (page, templateId = null, targetIntegrationId = null, prefill = null) => {
    setPrefillTemplate(prefill);
    if (page === 'create' && !targetIntegrationId) {
      setShowAccountPicker(true);
      return;
    }
    if (targetIntegrationId) setIntegrationId(String(targetIntegrationId));
    setCurrentPage(page);
    if (templateId) {
      setViewingTemplateId(templateId);
    }
  };

  const handleSuccess = () => {
    if (onMessage) {
      onMessage({ type: 'success', text: 'Template saved successfully!' });
    }
    // Force re-mount of templates list to reload from database
    setRefreshKey(prev => prev + 1);
    handleNavigate('list');
  };

  const handleBack = () => {
    setCurrentPage('list');
    setViewingTemplateId(null);
  };

  if (loading) {
    return (
      <main style={{ padding: '30px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '200px' }}>
          <Loader size={24} style={{ animation: 'spin 1s linear infinite' }} />
          <span style={{ marginLeft: '12px', color: 'var(--text-secondary)' }}>Loading WhatsApp Templates...</span>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main style={{ padding: '30px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          padding: '16px',
          background: '#fdeeed',
          border: '1px solid #fca5a5',
          borderRadius: '6px',
        }}>
          <AlertCircle size={20} style={{ color: '#c33d35', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <h3 style={{ margin: '0 0 4px 0', color: '#c33d35', fontSize: '14px', fontWeight: 600 }}>
              Configuration Required
            </h3>
            <p style={{ margin: 0, color: '#a33028', fontSize: '13px' }}>
              {error}
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Render appropriate page based on current page state
  switch (currentPage) {
    case 'create':
      return (
        <SettingsWhatsAppTemplatesCreate
              initialTemplate={prefillTemplate}
          integrationId={integrationId}
          onBack={handleBack}
          onSuccess={handleSuccess}
        />
      );
    case 'view':
      return (
        <SettingsWhatsAppTemplatesView
          integrationId={integrationId}
          templateId={viewingTemplateId}
          onBack={handleBack}
        />
      );
    case 'list':
    default:
      return (
        <>
          <div className="whatsapp-settings-shell">
            <nav className="whatsapp-settings-tabs">
              <button className={activeTab === 'dashboard' ? 'active' : ''} onClick={() => setActiveTab('dashboard')}><BarChart3 size={16}/> Dashboard</button>
              <button className={activeTab === 'templates' ? 'active' : ''} onClick={() => setActiveTab('templates')}><MessageCircle size={16}/> Templates</button>
              <button className={activeTab === 'branches' ? 'active' : ''} onClick={() => setActiveTab('branches')}><Building2 size={16}/> Branch mapping</button>
              <button className={activeTab === 'intake' ? 'active' : ''} onClick={() => setActiveTab('intake')}><UserPlus size={16}/> Lead intake</button>
            </nav>
            {activeTab === 'intake' ? <WhatsAppLeadIntake onMessage={onMessage} />
              : activeTab === 'branches' ? <WhatsAppBranchMapping onMessage={onMessage} />
              : activeTab === 'dashboard' ? <WhatsAppDashboard integrations={integrations} /> : <SettingsWhatsAppTemplates
              key={refreshKey}
              integrationId={integrationId}
              integrations={integrations}
              onIntegrationChange={setIntegrationId}
              onNavigate={handleNavigate}
              onMessage={onMessage}
              onSendMessage={() => setShowSendMessage(true)}
              onMessageHistory={() => setShowMessageHistory(true)}
            />}
          </div>
          {showAccountPicker && <div className="whatsapp-account-overlay" onClick={()=>setShowAccountPicker(false)}>
            <section className="whatsapp-account-picker" onClick={event=>event.stopPropagation()}>
              <header><div><MessageCircle size={20}/><span><h2>Select WhatsApp integration</h2><p>Choose the WhatsApp account where this template will be created.</p></span></div><button onClick={()=>setShowAccountPicker(false)}><X size={18}/></button></header>
              <div>{integrations.map(item=><button key={item.id} disabled={!item.has_credentials} onClick={()=>{setShowAccountPicker(false);handleNavigate('create',null,item.id);}}><MessageCircle size={18}/><span><strong>{item.integration_name}</strong><small>{item.has_credentials?'Connected and ready':'Configuration required'}</small></span><b>{item.has_credentials?'Select':'Unavailable'}</b></button>)}</div>
            </section>
          </div>}
          <WhatsAppSendPanel
            open={showSendMessage}
            initialMode="single"
            onClose={() => setShowSendMessage(false)}
            onSent={() => onMessage?.({ type: 'success', text: 'WhatsApp message request completed' })}
          />
          <WhatsAppMessageHistory open={showMessageHistory} onClose={() => setShowMessageHistory(false)} />
        </>
      );
  }

  return null;
}

function whatsappDateKey(date) {
  const value = date instanceof Date ? date : new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function recentDaysRange(days = 7) {
  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - (days - 1));
  return { from: whatsappDateKey(from), to: whatsappDateKey(today) };
}

function WhatsAppDashboard({ integrations }) {
  const [analytics, setAnalytics] = useState(null);
  const [branches, setBranches] = useState([]);
  const [integrationId, setIntegrationId] = useState('');
  const [branchIds, setBranchIds] = useState([]);
  const [range, setRange] = useState(() => recentDaysRange(7));
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // `api.get` resolves to the parsed body, not an axios `{ data }` envelope,
    // and this endpoint answers with `{ branches, employees, ... }`. Reading
    // `response.data.branches` therefore always came back empty and, resolving
    // after the dashboard request, wiped the branch list it had just loaded.
    api.get('/leads/referral-options/all')
      .then(response => {
        const list = Array.isArray(response) ? response : (response?.branches || []);
        // Only replace a populated list with another populated one; the
        // dashboard response carries the same branches.
        if (Array.isArray(list) && list.length) setBranches(list);
      })
      .catch(error => {
        console.error('Error fetching branches:', error);
      });
  }, []);

  useEffect(() => {
    setLoading(true);
    setError('');
    const query = new URLSearchParams({ from: range.from, to: range.to });
    if (integrationId) query.set('integrationId', integrationId);
    if (branchIds.length) query.set('branchId', branchIds.join(','));
    api.get(`/whatsapp/dashboard?${query.toString()}`)
      .then(response => {
        const data = response.data?.data || response.data || null;
        setAnalytics(data);
        if (data?.branches) setBranches(data.branches);
      })
      .catch(err => setError(err.message || 'Unable to load WhatsApp analytics'))
      .finally(() => setLoading(false));
  }, [integrationId, branchIds, range.from, range.to]);
  useEffect(() => setPage(1), [range.from, range.to, integrationId, branchIds]);
  const summary = analytics?.summary || {};
  const daily = analytics?.daily || [];
  const branchWise = analytics?.branchWise || [];
  const campaignWise = analytics?.campaignWise || [];
  const totalPages = Math.max(1, Math.ceil(daily.length / 7));
  const visibleDaily = daily.slice((page - 1) * 7, page * 7);
  const maxDay = Math.max(...visibleDaily.map(day => (day.utility || 0) + (day.marketing || 0)), 1);
  const maxBranch = Math.max(...branchWise.map(item => item.messages || 0), 1);
  const maxCampaign = Math.max(...campaignWise.map(item => item.messages || 0), 1);
  const money = value => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const exportDaily = () => {
    const headers = ['Date', 'Utility messages', 'Marketing messages', 'Incoming messages', 'Total messages', 'Estimated spend'];
    const rows = daily.map(day => [day.day, day.utility || 0, day.marketing || 0, day.incoming || 0, (day.utility || 0) + (day.marketing || 0) + (day.incoming || 0), Number(day.spend || 0).toFixed(2)]);
    const csv = [headers, ...rows].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `whatsapp-day-wise-usage-${range.from}-to-${range.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const branchOptions = (branches || [])
    .filter(item => item && (item.id || item.value) && (item.name || item.label))
    .map(item => ({
      label: item.name || item.label || 'Unnamed',
      value: String(item.id || item.value || '')
    }));

  return <main className="whatsapp-dashboard">
    <header className="whatsapp-dashboard-hero">
      <div><span>WHATSAPP</span></div>
      <div className="whatsapp-dashboard-filter-row">
        <select value={integrationId} onChange={event => setIntegrationId(event.target.value)}>
          <option value="">All WhatsApp accounts</option>
          {integrations.map(item => <option key={item.id} value={item.id}>{item.integration_name}</option>)}
        </select>
        <MultiSearchSelect
          label="branches"
          value={branchIds}
          options={[{ label: 'All branches', value: '' }, ...branchOptions]}
          onChange={value => setBranchIds(value.filter(v => v !== ''))}
        />
      </div>
    </header>
    {error && <div className="whatsapp-dashboard-error"><AlertCircle size={16}/>{error}</div>}
    {loading ? <div className="whatsapp-dashboard-loading"><Loader size={20}/> Loading analytics...</div> : <>
      <section className="whatsapp-metric-grid">
        <article><i><Send size={18}/></i><span>Total messages</span><strong>{Number(summary.totalMessages || 0).toLocaleString('en-IN')}</strong><small>{Number(summary.incomingMessages || 0).toLocaleString('en-IN')} incoming</small></article>
        <article><i><BarChart3 size={18}/></i><span>Utility messages</span><strong>{Number(summary.utilityMessages || 0).toLocaleString('en-IN')}</strong><small>{money(summary.utilitySpend)} estimated</small></article>
        <article><i><TrendingUp size={18}/></i><span>Marketing messages</span><strong>{Number(summary.marketingMessages || 0).toLocaleString('en-IN')}</strong><small>{money(summary.marketingSpend)} estimated</small></article>
        <article><i><IndianRupee size={18}/></i><span>Total spend</span><strong>{money(summary.estimatedSpend)}</strong><small>{Number(summary.delivered || 0).toLocaleString('en-IN')} delivered/read/sent</small></article>
      </section>
      <div className="whatsapp-chart-legend">
        <span><i className="utility" /> Utility messages</span>
        <span><i className="marketing" /> Marketing messages</span>
        <small>All metrics exclude failed messages. Spend also excludes pending messages.</small>
      </div>
      <section className="whatsapp-dashboard-grid">
        <article className="whatsapp-usage-card">
          <header className="whatsapp-usage-card-header">
            <h2>Day-wise usage</h2>
            <div>
              <WhatsAppDateRange value={range} onChange={setRange} />
              <button type="button" className="whatsapp-export-btn" onClick={exportDaily} disabled={!daily.length}><Download size={14}/> Export</button>
            </div>
          </header>
          <div>{visibleDaily.map(day => {
            const total = (day.utility || 0) + (day.marketing || 0) + (day.incoming || 0);
            return <div className="whatsapp-day-row" key={day.day}>
              <span>{day.day}</span>
              <div><i style={{ width: `${Math.max(2, (day.utility || 0) / maxDay * 100)}%` }} /><b style={{ width: `${Math.max(2, (day.marketing || 0) / maxDay * 100)}%` }} /></div>
              <strong>{total.toLocaleString('en-IN')}</strong>
              <small>{money(day.spend)}</small>
            </div>;
          })}{!daily.length && <p>No WhatsApp usage found for the selected date range.</p>}</div>
          {daily.length > 7 && <footer className="whatsapp-pagination">
            <button type="button" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}><ChevronLeft size={14}/> Prev</button>
            <span>Page {page} of {totalPages}</span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))}>Next <ChevronRight size={14}/></button>
          </footer>}
        </article>
        <article className="whatsapp-usage-card">
          <h2>Account-wise usage</h2>
          <div>{(analytics?.integrations || []).map(item => <div className="whatsapp-account-row" key={item.id}><span>{item.name}</span><strong>{Number(item.messages || 0).toLocaleString('en-IN')}</strong><small>{money(item.spend)}</small></div>)}{!analytics?.integrations?.length && <p>No account usage available.</p>}</div>
        </article>
        <article className="whatsapp-usage-card">
          <h2>Branch-wise usage</h2>
          <div className="whatsapp-breakdown-list">{branchWise.map(item => <div className="whatsapp-breakdown-row" key={item.id || item.name}>
            <span>{item.name}</span>
            <div><i style={{ width: `${Math.max(2, ((item.utility || 0) / maxBranch) * 100)}%` }} /><b style={{ width: `${Math.max(2, ((item.marketing || 0) / maxBranch) * 100)}%` }} /></div>
            <strong>{Number(item.messages || 0).toLocaleString('en-IN')}</strong>
            <small>{money(item.spend)}</small>
          </div>)}{!branchWise.length && <p>No branch usage found for the selected filters.</p>}</div>
        </article>
        <article className="whatsapp-usage-card">
          <h2>Campaign-wise usage</h2>
          <div className="whatsapp-breakdown-list">{campaignWise.map(item => <div className="whatsapp-breakdown-row" key={item.name}>
            <span>{item.name}</span>
            <div><i style={{ width: `${Math.max(2, ((item.utility || 0) / maxCampaign) * 100)}%` }} /><b style={{ width: `${Math.max(2, ((item.marketing || 0) / maxCampaign) * 100)}%` }} /></div>
            <strong>{Number(item.messages || 0).toLocaleString('en-IN')}</strong>
            <small>{money(item.spend)}</small>
          </div>)}{!campaignWise.length && <p>No campaign usage found for the selected filters.</p>}</div>
        </article>
      </section>
      <section className="whatsapp-status-strip">
        <span>Delivered / read / sent <strong>{Number(summary.delivered || 0).toLocaleString('en-IN')}</strong></span>
        <span>Pending <strong>{Number(summary.pending || 0).toLocaleString('en-IN')}</strong></span>
        <span>Failed <strong>{Number(summary.failed || 0).toLocaleString('en-IN')}</strong></span>
      </section>
    </>}
  </main>;
}

function WhatsAppDateRange({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [month, setMonth] = useState(() => new Date());
  const rootRef = useRef(null);
  useEffect(() => setDraft(value), [value.from, value.to]);
  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = event => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = event => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside, true);
    document.addEventListener('touchstart', closeOnOutside, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside, true);
      document.removeEventListener('touchstart', closeOnOutside, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [open]);
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const label = value.from && value.to ? `${value.from} → ${value.to}` : 'Recent 7 days';
  const applyPreset = days => {
    const next = recentDaysRange(days);
    setDraft(next);
    onChange(next);
    setOpen(false);
  };
  const selectDate = key => {
    setDraft(current => {
      if (!current.from || (current.from && current.to)) return { from: key, to: '' };
      return key < current.from ? { from: key, to: current.from } : { from: current.from, to: key };
    });
  };
  return <div className="whatsapp-date-range" ref={rootRef}>
    <button type="button" onClick={() => setOpen(current => !current)}><CalendarRange size={14}/><span>{label}</span></button>
    {open && <div className="whatsapp-date-popover">
      <div className="range-calendar-panel">
        <aside><strong>Choose a period</strong><button type="button" onClick={() => applyPreset(1)}>Today</button><button type="button" onClick={() => { const today = new Date(); today.setDate(today.getDate() - 1); const key = whatsappDateKey(today); onChange({ from: key, to: key }); setOpen(false); }}>Yesterday</button><button type="button" onClick={() => applyPreset(7)}>Recent 7 days</button><button type="button" onClick={() => applyPreset(30)}>Recent 30 days</button></aside>
        <div className="range-calendar-months"><WhatsAppCalendarMonth month={month} from={draft.from} to={draft.to} onSelect={selectDate} previous move={amount => setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1))}/><WhatsAppCalendarMonth month={nextMonth} from={draft.from} to={draft.to} onSelect={selectDate} next move={amount => setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1))}/></div>
      </div>
      <footer><button type="button" onClick={() => setDraft({ from: '', to: '' })}>Clear</button><button type="button" onClick={() => { onChange(draft.from && draft.to ? draft : recentDaysRange(7)); setOpen(false); }}>Apply dates</button></footer>
    </div>}
  </div>;
}

function WhatsAppCalendarMonth({ month, from, to, onSelect, previous, next, move }) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const firstDay = new Date(year, monthIndex, 1).getDay();
  return <section className="range-calendar-month"><header>{previous ? <button type="button" onClick={() => move(-1)}><ChevronLeft /></button> : <span />}<strong>{month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</strong>{next ? <button type="button" onClick={() => move(1)}><ChevronRight /></button> : <span />}</header><div className="range-weekdays">{['Su','Mo','Tu','We','Th','Fr','Sa'].map(day => <span key={day}>{day}</span>)}</div><div className="range-days">{Array.from({ length: firstDay }, (_, index) => <span key={`blank-${index}`} />)}{Array.from({ length: days }, (_, index) => { const key = whatsappDateKey(new Date(year, monthIndex, index + 1)); return <button type="button" key={key} className={`${key === from || key === to ? 'selected ' : ''}${from && to && key > from && key < to ? 'in-range' : ''}`} onClick={() => onSelect(key)}>{index + 1}</button>; })}</div></section>;
}
