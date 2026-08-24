import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { TrendingUp, Clock, CheckCircle, Users, ChevronDown, ChevronRight, ChevronLeft, Columns3, Rows3, CalendarRange, Maximize2, Minimize2, Filter, FilterX } from 'lucide-react';
import { api } from '../api';
import { useBusinessUnit } from '../BusinessUnitContext';
import StatCard from './StatCard';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Tabs, TabsList, TabsTrigger, TabsContent, Button } from './ui';
import PageContainer from './PageContainer';
import { cn } from '../lib/utils';
import { DASHBOARD_LAYOUT_EVENT, dashboardLayoutKey, readDashboardLayout } from '../lib/dashboardLayout';
import { ReportVisual, SavedReportsDashboard, buildLiveReportData, canViewSavedReport, readSavedReports } from '../ReportBuilder.jsx';

function dashboardIstDateKey(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

export function DashboardPage({ user }) {
  const { selectedUnit } = useBusinessUnit();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [savedReportLeads, setSavedReportLeads] = useState([]);
  const [error, setError] = useState('');
  const [dashboardTab, setDashboardTab] = useState(
    location.state?.dashboardTab === 'saved' ? 'saved' : 'overview'
  );
  const [layout, setLayout] = useState(() => readDashboardLayout(selectedUnit?.id));
  const [savedReports, setSavedReports] = useState(() => readSavedReports(selectedUnit?.id));
  const [dashboardDateField, setDashboardDateField] = useState('addedAt');
  const [dashboardDateFrom, setDashboardDateFrom] = useState('');
  const [dashboardDateTo, setDashboardDateTo] = useState('');
  const [dashboardBranchIds, setDashboardBranchIds] = useState([]);
  const [dashboardLeadFilters, setDashboardLeadFilters] = useState({ owners: [], stages: [], substages: [], channels: [], sources: [], campaigns: [] });
  const [dashboardFiltersOpen, setDashboardFiltersOpen] = useState(false);
  const [dashboardFilterFlyout, setDashboardFilterFlyout] = useState(null);
  const dashboardFilterMenuRef = useRef(null);

  useEffect(() => {
    if (!dashboardFiltersOpen) return undefined;
    const close = event => { if (!dashboardFilterMenuRef.current?.contains(event.target)) setDashboardFiltersOpen(false); };
    const escape = event => { if (event.key === 'Escape') setDashboardFiltersOpen(false); };
    document.addEventListener('mousedown', close, true);
    document.addEventListener('touchstart', close, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('mousedown', close, true);
      document.removeEventListener('touchstart', close, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [dashboardFiltersOpen]);

  useEffect(() => {
    if (location.state?.dashboardTab === 'saved') {
      setDashboardTab('saved');
    }
  }, [location.state?.dashboardTab]);

  // Pick up whatever the Reports > Dashboard layout editor last saved, whether
  // it was saved in this tab or another one.
  useEffect(() => {
    const unitId = selectedUnit?.id;
    const reload = () => {
      setLayout(readDashboardLayout(unitId));
      setSavedReports(readSavedReports(unitId));
    };
    reload();

    const onStorage = (event) => {
      if (!event.key || event.key === dashboardLayoutKey(unitId)) reload();
    };
    window.addEventListener(DASHBOARD_LAYOUT_EVENT, reload);
    window.addEventListener('crm:saved-reports-changed', reload);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(DASHBOARD_LAYOUT_EVENT, reload);
      window.removeEventListener('crm:saved-reports-changed', reload);
      window.removeEventListener('storage', onStorage);
    };
  }, [selectedUnit?.id]);

  useEffect(() => {
    if (!selectedUnit?.id) return;

    setData(null);
    setSavedReportLeads([]);
    setError('');

    Promise.all([api('/dashboard'), api('/leads')])
      .then(([dashboard, leadsResult]) => {
        setData(dashboard);
        setSavedReportLeads(leadsResult.data || []);
      })
      .catch((err) => setError(err.message));
  }, [selectedUnit?.id]);

  if (error) {
    return (
      <PageContainer className="flex items-center justify-center py-20">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-2">Unable to load data</h2>
          <p className="text-secondary-600 mb-6">{error}</p>
          <Button onClick={() => navigate('/login')}>Return to login</Button>
        </div>
      </PageContainer>
    );
  }

  if (!data) {
    return (
      <PageContainer className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="inline-block w-12 h-12 rounded-full border-4 border-secondary-200 border-t-primary-600 animate-spin mb-4" />
          <p className="text-secondary-600">Loading workspace…</p>
        </div>
      </PageContainer>
    );
  }

  const visibleSavedReports = savedReports.filter((report) => canViewSavedReport(report));
  const visibleLayout = layout.filter((item) => item.visible !== false);
  const dashboardBranches = [...new Map(savedReportLeads.filter(lead => lead.branchId != null).map(lead => [String(lead.branchId), lead.branch || `Branch ${lead.branchId}`])).entries()].sort((left, right) => left[1].localeCompare(right[1]));
  const branchScopedLeads = dashboardBranchIds.length ? savedReportLeads.filter(lead => dashboardBranchIds.includes(String(lead.branchId))) : savedReportLeads;
  const optionList = (items, idKey, labelKey, fallback) => [...new Map(items.filter(item => item[idKey] != null).map(item => [String(item[idKey]), item[labelKey] || `${fallback} ${item[idKey]}`])).entries()].map(([value, label]) => ({ value, label })).sort((left, right) => left.label.localeCompare(right.label));
  const ownerOptions = optionList(branchScopedLeads, 'ownerEmployeeId', 'owner', 'Owner');
  const stageOptions = optionList(branchScopedLeads, 'stageId', 'stage', 'Stage');
  const substageOptionLeads = dashboardLeadFilters.stages.length ? branchScopedLeads.filter(lead => dashboardLeadFilters.stages.includes(String(lead.stageId))) : branchScopedLeads;
  const substageOptions = optionList(substageOptionLeads, 'substageId', 'substage', 'Sub-stage');
  const channelOptions = optionList(branchScopedLeads, 'channelId', 'channel', 'Channel');
  const sourceOptionLeads = dashboardLeadFilters.channels.length ? branchScopedLeads.filter(lead => dashboardLeadFilters.channels.includes(String(lead.channelId))) : branchScopedLeads;
  const sourceOptions = optionList(sourceOptionLeads, 'sourceId', 'source', 'Source');
  const campaignOptionLeads = branchScopedLeads.filter(lead => (!dashboardLeadFilters.channels.length || dashboardLeadFilters.channels.includes(String(lead.channelId))) && (!dashboardLeadFilters.sources.length || dashboardLeadFilters.sources.includes(String(lead.sourceId))));
  const campaignOptions = optionList(campaignOptionLeads, 'campaignId', 'campaign', 'Campaign');
  const matchesMulti = (lead, filterKey, leadKey) => !dashboardLeadFilters[filterKey].length || dashboardLeadFilters[filterKey].includes(String(lead[leadKey]));
  const filteredDashboardLeads = savedReportLeads.filter(lead => {
    if (dashboardBranchIds.length && !dashboardBranchIds.includes(String(lead.branchId))) return false;
    if (!matchesMulti(lead, 'owners', 'ownerEmployeeId')) return false;
    if (!matchesMulti(lead, 'stages', 'stageId')) return false;
    if (!matchesMulti(lead, 'substages', 'substageId')) return false;
    if (!matchesMulti(lead, 'channels', 'channelId')) return false;
    if (!matchesMulti(lead, 'sources', 'sourceId')) return false;
    if (!matchesMulti(lead, 'campaigns', 'campaignId')) return false;
    if (!dashboardDateFrom && !dashboardDateTo) return true;
    const value = lead[dashboardDateField];
    if (!value) return false;
    const day = dashboardIstDateKey(value);
    return (!dashboardDateFrom || day >= dashboardDateFrom) && (!dashboardDateTo || day <= dashboardDateTo);
  });
  const dashboardFilterCount = [dashboardBranchIds.length > 0, dashboardDateFrom || dashboardDateTo, ...Object.values(dashboardLeadFilters).map(values => values.length > 0)].filter(Boolean).length;
  const toggleDashboardBranch = value => setDashboardBranchIds(current => current.includes(value) ? current.filter(item => item !== value) : [...current, value]);
  const toggleDashboardLeadFilter = (key, value) => setDashboardLeadFilters(current => {
    const next = { ...current, [key]: current[key].includes(value) ? current[key].filter(item => item !== value) : [...current[key], value] };
    if (key === 'stages') next.substages = [];
    if (key === 'channels') { next.sources = []; next.campaigns = []; }
    if (key === 'sources') next.campaigns = [];
    return next;
  });
  const clearDashboardFilters = () => {
    setDashboardBranchIds([]);
    setDashboardDateField('addedAt');
    setDashboardDateFrom('');
    setDashboardDateTo('');
    setDashboardLeadFilters({ owners: [], stages: [], substages: [], channels: [], sources: [], campaigns: [] });
  };
  const currentWeekStart = new Date();
  currentWeekStart.setDate(currentWeekStart.getDate() - 7);
  const previousWeekStart = new Date(currentWeekStart);
  previousWeekStart.setDate(previousWeekStart.getDate() - 7);
  const filteredNewThisWeek = filteredDashboardLeads.filter(lead => lead.addedAt && new Date(lead.addedAt) >= currentWeekStart).length;
  const filteredNewPreviousWeek = filteredDashboardLeads.filter(lead => {
    if (!lead.addedAt) return false;
    const added = new Date(lead.addedAt);
    return added >= previousWeekStart && added < currentWeekStart;
  }).length;
  const baseActivityTrends = data.activityTrends || [];
  const activityByDay = new Map(baseActivityTrends.map(item => [String(item.day), item]));
  const activityStart = dashboardDateFrom || baseActivityTrends[0]?.day;
  const activityEnd = dashboardDateTo || (dashboardDateFrom ? dashboardIstDateKey(new Date()) : baseActivityTrends.at(-1)?.day);
  const activityDays = [];
  if (activityStart && activityEnd && activityStart <= activityEnd) {
    const cursor = new Date(`${activityStart}T00:00:00Z`);
    const end = new Date(`${activityEnd}T00:00:00Z`);
    while (cursor <= end && activityDays.length < 732) {
      activityDays.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  const displayedActivityDays = dashboardDateFrom || dashboardDateTo
    ? activityDays
    : baseActivityTrends.map(item => String(item.day));
  const filteredActivityTrends = displayedActivityDays.map(day => ({
    ...(activityByDay.get(day) || { day, crmHours: 0, followupsDone: 0 }),
    day,
    leads: filteredDashboardLeads.filter(lead => {
      const selectedDate = lead[dashboardDateField];
      return selectedDate && dashboardIstDateKey(selectedDate) === day;
    }).length,
  }));
  const filteredDashboardData = {
    ...data,
    funnel: (data.funnel || []).map(item => ({ ...item, value: filteredDashboardLeads.filter(lead => lead.stage === item.label).length })),
    activityTrends: filteredActivityTrends,
  };

  const comparisons = data.stats.comparisons || {};
  const statCards = [
    {
      label: 'Total Leads',
      value: (dashboardBranchIds.length || dashboardDateFrom || dashboardDateTo) ? filteredDashboardLeads.length : data.stats.totalLeads,
      trend: getComparisonLabel(
        data.stats.totalLeads,
        comparisons.totalLeadsLastMonth,
        'since last month'
      ),
      icon: Users,
      color: 'purple',
    },
    {
      label: 'New This Week',
      value: filteredNewThisWeek,
      trend: getComparisonLabel(
        filteredNewThisWeek,
        filteredNewPreviousWeek,
        'vs previous week'
      ),
      icon: TrendingUp,
      color: 'blue',
    },
    {
      label: 'Follow-ups Due',
      value: data.stats.followupsDue,
      trend: `${Number(comparisons.followupsOverdue || 0).toLocaleString()} overdue`,
      icon: Clock,
      color: 'amber',
    },
    {
      // Leads worked on today, counted once each however many comments were
      // logged against them.
      label: 'Follow-ups Done',
      value: data.stats.followupsDoneToday,
      trend: getComparisonLabel(
        data.stats.followupsDoneToday,
        comparisons.followupsDoneYesterday,
        'vs yesterday'
      ),
      icon: CheckCircle,
      color: 'emerald',
    },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Tabs wrap the whole screen so the switcher can live in the header
          while its panels render below. */}
      <Tabs
        defaultValue="overview"
        value={dashboardTab}
        onValueChange={setDashboardTab}
        className="flex flex-col flex-1"
      >
      {/* Page Header */}
      <div className="bg-white border-b border-border sticky top-0 z-10">
        <PageContainer className="px-4 md:px-5 xl:px-6 py-2 md:py-2">
          <div className="dashboard-heading">
            <div>
              <p className="text-[10px] text-secondary-600 uppercase tracking-wide font-semibold mb-0.5">
                {new Date().toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
              <h1 className="text-base xl:text-lg font-bold text-foreground font-display mb-0.5">
                Good {getGreeting()}, {user.name.split(' ')[0]}
              </h1>
              <p className="text-xs text-secondary-600">
                Here's what needs your admissions team's attention today.
              </p>
            </div>
            <div className="dashboard-toolbar">
              <TabsList className="dashboard-tabs"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="saved">Saved Reports</TabsTrigger></TabsList>
              <div className="dashboard-filter-menu" ref={dashboardFilterMenuRef}>
                <button type="button" className={dashboardFilterCount ? 'active' : ''} onClick={() => { setDashboardFiltersOpen(value => !value); setDashboardFilterFlyout(null); }} aria-expanded={dashboardFiltersOpen} aria-label="Dashboard filters" title="Dashboard filters"><Filter size={18}/>{dashboardFilterCount > 0 && <b>{dashboardFilterCount}</b>}</button>
                {/* Only worth showing once something is actually filtered. */}
                {dashboardFilterCount > 0 && <button type="button" className="dashboard-clear-filters" onClick={clearDashboardFilters} aria-label="Clear dashboard filters" title="Clear filters"><FilterX size={18}/></button>}
                {dashboardFiltersOpen && <div className="dashboard-filter-panel"><DashboardMultiFilter filterKey="branches" label="Branch" options={dashboardBranches.map(([value, label]) => ({ value, label }))} values={dashboardBranchIds} onToggle={toggleDashboardBranch} open={dashboardFilterFlyout === 'branches'} onOpenChange={open => setDashboardFilterFlyout(open ? 'branches' : null)}/><DashboardMultiFilter filterKey="owners" label="Lead Owner" options={ownerOptions} values={dashboardLeadFilters.owners} onToggle={value => toggleDashboardLeadFilter('owners', value)} open={dashboardFilterFlyout === 'owners'} onOpenChange={open => setDashboardFilterFlyout(open ? 'owners' : null)}/><DashboardMultiFilter filterKey="stages" label="Stage" options={stageOptions} values={dashboardLeadFilters.stages} onToggle={value => toggleDashboardLeadFilter('stages', value)} open={dashboardFilterFlyout === 'stages'} onOpenChange={open => setDashboardFilterFlyout(open ? 'stages' : null)}/><DashboardMultiFilter filterKey="substages" label="Sub-stage" options={substageOptions} values={dashboardLeadFilters.substages} onToggle={value => toggleDashboardLeadFilter('substages', value)} open={dashboardFilterFlyout === 'substages'} onOpenChange={open => setDashboardFilterFlyout(open ? 'substages' : null)}/><DashboardMultiFilter filterKey="channels" label="Channel" options={channelOptions} values={dashboardLeadFilters.channels} onToggle={value => toggleDashboardLeadFilter('channels', value)} open={dashboardFilterFlyout === 'channels'} onOpenChange={open => setDashboardFilterFlyout(open ? 'channels' : null)}/><DashboardMultiFilter filterKey="sources" label="Source" options={sourceOptions} values={dashboardLeadFilters.sources} onToggle={value => toggleDashboardLeadFilter('sources', value)} open={dashboardFilterFlyout === 'sources'} onOpenChange={open => setDashboardFilterFlyout(open ? 'sources' : null)}/><DashboardMultiFilter filterKey="campaigns" label="Campaign" options={campaignOptions} values={dashboardLeadFilters.campaigns} onToggle={value => toggleDashboardLeadFilter('campaigns', value)} open={dashboardFilterFlyout === 'campaigns'} onOpenChange={open => setDashboardFilterFlyout(open ? 'campaigns' : null)}/><DashboardDateFilter field={dashboardDateField} from={dashboardDateFrom} to={dashboardDateTo} onFieldChange={setDashboardDateField} onOpen={() => setDashboardFilterFlyout(null)} onChange={(from, to) => { setDashboardDateFrom(from); setDashboardDateTo(to); }}/></div>}
              </div>
            </div>
          </div>
        </PageContainer>
      </div>

      {/* Main Content */}
      {/* dashboard-compact sets --card-pad, so every card inside is tighter
          without each widget passing a padding of its own. */}
      <PageContainer className="dashboard-compact flex-1 px-4 md:px-5 xl:px-6 py-3 md:py-3 xl:py-4">
          <TabsContent value="overview">
            {/* Widgets, their order, width and visibility come from the
                Reports > Dashboard layout editor. */}
            <div className="dashboard-runtime-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 xl:gap-4 items-stretch">
              {visibleLayout.map((item) => {
                const content = renderDashboardWidget(item, {
                  data: filteredDashboardData,
                  statCards,
                  leads: filteredDashboardLeads,
                  savedReports: visibleSavedReports,
                });
                if (!content) return null;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'dashboard-runtime-widget min-w-0',
                      widgetHeight(item) ? 'has-fixed-height' : 'height-auto',
                      // A chosen height replaces the floor rather than fighting it.
                      widgetHeight(item) || widgetMinHeight(item.id),
                      widgetHeight(item) && (item.fitToHeight ? 'overflow-hidden dashboard-fit-to-height' : 'overflow-auto'),
                      COLUMN_SPAN[item.size] || COLUMN_SPAN.half,
                    )}
                  >
                    {content}
                  </div>
                );
              })}
            </div>

            {!visibleLayout.length && (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="font-medium text-foreground mb-1">No widgets on your dashboard</p>
                  <p className="text-sm text-secondary-600 mb-4">
                    Every widget is hidden for this business unit.
                  </p>
                  <Button variant="secondary" onClick={() => navigate('/reports', { state: { reportsTab: 'dashboard' } })}>
                    Open dashboard layout editor
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="saved">
            {/* Renders the real store rather than a static empty state, and
                refreshes itself on crm:saved-reports-changed. */}
            <SavedReportsDashboard
              data={filteredDashboardData}
              leads={filteredDashboardLeads}
              onCreateNew={() => navigate('/saved-reports/new', {
                state: { returnTo: 'dashboard-saved', createNewReportAt: Date.now() },
              })}
            />
          </TabsContent>
      </PageContainer>
      </Tabs>
    </div>
  );
}

function DashboardMultiFilter({ label, options, values, onToggle, open, onOpenChange }) {
  return <details className="dashboard-multi-filter" open={open}><summary onClick={event => { event.preventDefault(); onOpenChange(!open); }}><span>{label}</span><strong>{values.length ? `${values.length} selected` : `All ${label.toLowerCase()}s`}</strong><ChevronDown size={14}/></summary><div>{options.length ? options.map(option => <label key={option.value}><input type="checkbox" checked={values.includes(option.value)} onChange={() => onToggle(option.value)}/><span>{option.label}</span></label>) : <p>No options available</p>}</div></details>;
}

const DASHBOARD_DATE_FIELDS = { addedAt: 'Lead added', updatedAt: 'Lead updated', referredAt: 'Lead referred', nextFollowup: 'Next follow-up', reEnquiredAt: 'Re-enquired' };
function DashboardCalendarMonth({ month, from, to, onSelect, onPrevious, onNext }) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const key = day => `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return <section className="range-calendar-month"><header>{onPrevious ? <button type="button" aria-label="Previous month" onClick={onPrevious}><ChevronLeft/></button> : <span/>}<strong>{month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</strong>{onNext ? <button type="button" aria-label="Next month" onClick={onNext}><ChevronRight/></button> : <span/>}</header><div className="range-weekdays">{['Su','Mo','Tu','We','Th','Fr','Sa'].map(day => <span key={day}>{day}</span>)}</div><div className="range-days">{Array.from({ length: firstDay }, (_, index) => <span key={`blank-${index}`}/>)}{Array.from({ length: days }, (_, index) => { const value = key(index + 1); return <button type="button" key={value} className={`${value === from || value === to ? 'selected ' : ''}${from && to && value > from && value < to ? 'in-range' : ''}`} onClick={() => onSelect(value)}>{index + 1}</button>; })}</div></section>;
}

function DashboardDateFilter({ field, from, to, onFieldChange, onChange, onOpen }) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = event => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close, true);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('mousedown', close, true); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const today = () => key(new Date());
  const applyDays = (startOffset, endOffset = startOffset) => {
    const start = new Date(); start.setDate(start.getDate() + startOffset);
    const end = new Date(); end.setDate(end.getDate() + endOffset);
    onChange(key(start), key(end));
  };
  const displayDate = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const label = from && to ? `${displayDate(from)} – ${displayDate(to)}` : from ? `${displayDate(from)} – select end` : to ? `Till ${displayDate(to)}` : 'All dates';
  const selectDate = value => { if (!from || to) onChange(value, ''); else if (value < from) onChange(value, from); else onChange(from, value); };
  const nextMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
  const toggleOpen = () => { const initial = from ? new Date(`${from}T00:00:00`) : new Date(); setVisibleMonth(new Date(initial.getFullYear(), initial.getMonth(), 1)); onOpen?.(); setOpen(value => !value); };
  return <div className="dashboard-date-filter" ref={rootRef}><button type="button" className={from || to ? 'active' : ''} onClick={toggleOpen} aria-expanded={open}><CalendarRange size={17}/><span><small>{DASHBOARD_DATE_FIELDS[field]}</small><strong>{label}</strong></span><ChevronDown size={14}/></button>{open && <div className="followup-range-popover leads-date-range-popover dashboard-date-popover"><div className="followup-range-header"><div className="followup-range-title"><CalendarRange size={18}/><div><strong>{DASHBOARD_DATE_FIELDS[field]}</strong><small>Select the {DASHBOARD_DATE_FIELDS[field].toLowerCase()} range</small></div></div><select value={field} onChange={event => onFieldChange(event.target.value)} className="date-type-select-popover">{Object.entries(DASHBOARD_DATE_FIELDS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></div><div className="range-calendar-panel"><aside><strong>Choose a period</strong><button type="button" onClick={() => applyDays(0)}>Today</button><button type="button" onClick={() => applyDays(-1)}>Yesterday</button><button type="button" onClick={() => onChange('', today())}>Till today</button><button type="button" onClick={() => { const date = new Date(); date.setDate(date.getDate() - 1); onChange('', key(date)); }}>Till yesterday</button><button type="button" onClick={() => applyDays(1)}>Next day</button><button type="button" onClick={() => applyDays(0, 7)}>Next 7 days</button><button type="button" onClick={() => applyDays(0, 30)}>Next 30 days</button></aside><div className="range-calendar-months"><DashboardCalendarMonth month={visibleMonth} from={from} to={to} onSelect={selectDate} onPrevious={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}/><DashboardCalendarMonth month={nextMonth} from={from} to={to} onSelect={selectDate} onNext={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}/></div></div><div className="followup-range-footer"><button type="button" className="range-clear" onClick={() => onChange('', '')}>Clear</button><button type="button" className="range-apply" onClick={() => setOpen(false)}>Apply dates</button></div></div>}</div>;
}

/** Tailwind needs literal class names, so widget widths map explicitly. */
/* Two columns from the small breakpoint up: a quarter-width widget stacked
   full-width on a laptop was the single biggest reason the page ran so long. */
const COLUMN_SPAN = {
  quarter: 'sm:col-span-1 lg:col-span-1',
  half: 'sm:col-span-2 lg:col-span-2',
  'three-quarter': 'sm:col-span-2 lg:col-span-3',
  full: 'sm:col-span-2 lg:col-span-4',
};

/**
 * Every report-style widget gets the same floor height, so a row never mixes a
 * tall chart with a card collapsed around two rows of data. The stats strip is
 * sized by its own cards and is deliberately left out.
 */
const WIDGET_MIN_HEIGHT = {
  stats: '',
  activity: 'min-h-[300px] xl:min-h-[380px]',
  funnel: 'min-h-[300px] xl:min-h-[380px]',
  'curriculum-stage': 'min-h-[300px] xl:min-h-[380px]',
  report: 'min-h-[300px] xl:min-h-[380px]',
};

const widgetMinHeight = (id) =>
  WIDGET_MIN_HEIGHT[String(id || '').startsWith('report:') ? 'report' : String(id || '')] ?? 'min-h-[300px] xl:min-h-[380px]';

/**
 * A height chosen in the layout editor, as a fixed height rather than a floor.
 *
 * The floor above is what every widget had: a minimum, so a panel could still
 * grow past it and drag the whole row with it. A chosen height has to hold,
 * or setting one on a long table would do nothing -- so the widget is pinned
 * and its content scrolls inside.
 *
 * 'auto' keeps the old behaviour exactly, which is what every saved layout
 * has until somebody changes it.
 */
/*
 * Heights, in two steps: what fits a laptop, and what a large screen can
 * afford. The single fixed height was chosen on a big monitor -- a "tall"
 * widget at 520px plus the header filled a 768px-high screen on its own, so a
 * dashboard of six widgets meant six screens of scrolling.
 *
 * Content scrolls inside a widget either way, so a shorter widget shows less
 * at once but never hides anything.
 *
 * These must match .dashboard-widget in DashboardCanvas.css, which sizes the
 * layout editor's preview -- a preview of a different size is worth nothing.
 */
const WIDGET_HEIGHT = {
  short: 'h-[190px] xl:h-[240px]',
  medium: 'h-[260px] xl:h-[330px]',
  tall: 'h-[330px] xl:h-[440px]',
  'x-tall': 'h-[420px] xl:h-[560px]',
};

const widgetHeight = (item) => WIDGET_HEIGHT[item?.height] || '';

const STAT_COLUMNS = {
  quarter: 'grid-cols-1',
  half: 'grid-cols-1 sm:grid-cols-2',
  'three-quarter': 'grid-cols-2 xl:grid-cols-3',
  full: 'grid-cols-2 md:grid-cols-4',
};

function renderDashboardWidget(item, { data, statCards, leads, savedReports }) {
  const id = String(item.id || '');

  if (id.startsWith('report:')) {
    const report = savedReports.find((saved) => String(saved.id) === id.slice(7));
    // A widget can outlive the report it points at.
    if (!report) return null;
    return <SavedReportWidget report={report} leads={leads} />;
  }
  if (id === 'stats') return <StatsWidget statCards={statCards} size={item.size} />;
  if (id === 'activity') return <DailyActivityWidget data={data.activityTrends || []} />;
  if (id === 'funnel') return <FunnelWidget data={data} />;
  if (id === 'curriculum-stage') return <CurriculumClassStageWidget leads={leads} stages={(data.funnel || []).map(item => item.label)} />;
  return null;
}

export function CurriculumClassStageWidget({ leads = [], stages = [] }) {
  const [fullscreen, setFullscreen] = useState(false);
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const [rowPickerOpen, setRowPickerOpen] = useState(false);
  const columnPickerRef = useRef(null);
  const rowPickerRef = useRef(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState(['applyingClass']);
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const [hiddenStageColumns, setHiddenStageColumns] = useState(() => new Set());
  const [showTotalColumn, setShowTotalColumn] = useState(true);
  const [showPercentageColumn, setShowPercentageColumn] = useState(true);
  useEffect(() => {
    if (!columnPickerOpen && !rowPickerOpen) return undefined;
    const close = event => {
      if (!columnPickerRef.current?.contains(event.target)) setColumnPickerOpen(false);
      if (!rowPickerRef.current?.contains(event.target)) setRowPickerOpen(false);
    };
    const escape = event => { if (event.key === 'Escape') { setColumnPickerOpen(false); setRowPickerOpen(false); } };
    document.addEventListener('mousedown', close, true);
    document.addEventListener('touchstart', close, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('mousedown', close, true);
      document.removeEventListener('touchstart', close, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [columnPickerOpen, rowPickerOpen]);
  const filteredLeads = leads;
  const rowFields = [
    { key: 'branch', label: 'Branch', value: lead => lead.branch || 'Not specified' },
    { key: 'curriculum', label: 'Curriculum', value: lead => lead.curriculum || 'Not specified' },
    { key: 'applyingClass', label: 'Class', value: lead => lead.applyingClass || 'Not specified' },
  ];
  const selectedRowFields = selectedRowKeys.map(key => rowFields.find(field => field.key === key)).filter(Boolean);
  const stageNames = [...new Set([...stages.filter(Boolean), ...filteredLeads.map(lead => lead.stage).filter(Boolean)])];
  const visibleStageNames = stageNames.filter(stage => !hiddenStageColumns.has(stage));
  const visibleStageSet = new Set(visibleStageNames);
  const visibleTotal = filteredLeads.filter(lead => visibleStageSet.has(lead.stage)).length;
  const displayedStageNames = fullscreen ? visibleStageNames : [];
  const displayedTotal = fullscreen ? visibleTotal : filteredLeads.length;
  const displayTotalColumn = fullscreen ? showTotalColumn : true;
  const displayPercentageColumn = fullscreen ? showPercentageColumn : true;
  const percentageOfTotal = value => displayedTotal ? `${(Number(value || 0) / displayedTotal * 100).toFixed(1)}%` : '0.0%';
  const visibleRowTotal = row => visibleStageNames.reduce((sum, stage) => sum + Number(row.counts[stage] || 0), 0);
  const displayedRowTotal = row => fullscreen ? visibleRowTotal(row) : row.total;
  const buildNodes = (items, depth = 0, parentKey = '') => {
    const field = selectedRowFields[depth];
    if (!field) return [];
    const groups = new Map();
    items.forEach(lead => { const value = field.value(lead); if (!groups.has(value)) groups.set(value, []); groups.get(value).push(lead); });
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([label, groupLeads]) => {
      const key = `${parentKey}/${field.key}:${label}`;
      const counts = Object.fromEntries(stageNames.map(stage => [stage, groupLeads.filter(lead => lead.stage === stage).length]));
      return { key, label, depth, counts, total: groupLeads.length, children: buildNodes(groupLeads, depth + 1, key) };
    });
  };
  const rows = buildNodes(filteredLeads);
  const allExpandableKeys = [];
  const collectExpandable = nodes => nodes.forEach(node => { if (node.children.length) { allExpandableKeys.push(node.key); collectExpandable(node.children); } });
  collectExpandable(rows);
  const flatRows = [];
  const flattenRows = nodes => nodes.forEach(node => { flatRows.push(node); if (expandedRows.has(node.key)) flattenRows(node.children); });
  flattenRows(rows);
  const totals = Object.fromEntries(stageNames.map(stage => [stage, filteredLeads.filter(lead => lead.stage === stage).length]));
  const visibleRowFieldCount = Math.max(1, ...flatRows.map(row => row.depth + 1));
  const visibleRowFields = selectedRowFields.slice(0, visibleRowFieldCount);
  const allExpanded = allExpandableKeys.length > 0 && allExpandableKeys.every(key => expandedRows.has(key));
  const toggleRow = key => setExpandedRows(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleRowField = key => setSelectedRowKeys(current => {
    if (current.includes(key)) return current.length === 1 ? current : current.filter(value => value !== key);
    return rowFields.filter(field => [...current, key].includes(field.key)).map(field => field.key);
  });
  const toggleStageColumn = stage => setHiddenStageColumns(current => {
    const next = new Set(current);
    if (next.has(stage)) next.delete(stage); else next.add(stage);
    return next;
  });
  const toggleFullscreen = () => {
    if (!fullscreen) {
      setHiddenStageColumns(new Set());
      setShowTotalColumn(true);
      setShowPercentageColumn(true);
      setColumnPickerOpen(false);
    }
    setFullscreen(value => !value);
  };

  return <Card className={`h-full curriculum-stage-widget ${fullscreen ? 'fullscreen' : ''}`}>
    <CardHeader className="curriculum-stage-header flex-row items-center justify-between gap-4">
      <div><CardTitle className="curriculum-stage-title">Leads by Branch, Curriculum, Class and Stage</CardTitle><CardDescription className="curriculum-stage-description">Lead count by configured stage</CardDescription></div>
      <div className={`curriculum-report-controls ${fullscreen ? '' : 'compact'}`}>
        <details className="dashboard-column-picker" ref={rowPickerRef} open={rowPickerOpen}><summary title="Select row fields" aria-label="Select row fields" onClick={event => { event.preventDefault(); setRowPickerOpen(value => !value); }}><Rows3 size={15}/><span>Rows</span><b>{selectedRowFields.length}</b></summary><div><strong>Display row fields</strong>{rowFields.map(field => <label key={field.key}><input type="checkbox" checked={selectedRowKeys.includes(field.key)} onChange={() => toggleRowField(field.key)}/><span>{field.label}</span></label>)}</div></details>
        <details className="dashboard-column-picker" ref={columnPickerRef} open={columnPickerOpen}><summary title="Select columns" aria-label="Select columns" onClick={event => { event.preventDefault(); setColumnPickerOpen(value => !value); }}><Columns3 size={15}/><span>Columns</span><b>{visibleStageNames.length + (showTotalColumn ? 1 : 0) + (showPercentageColumn ? 1 : 0)}</b></summary><div><strong>Display columns</strong>{stageNames.map(stage => <label key={stage}><input type="checkbox" checked={!hiddenStageColumns.has(stage)} onChange={() => toggleStageColumn(stage)}/><span>{stage}</span></label>)}<label><input type="checkbox" checked={showTotalColumn} onChange={event => setShowTotalColumn(event.target.checked)}/><span>Total leads</span></label><label><input type="checkbox" checked={showPercentageColumn} onChange={event => setShowPercentageColumn(event.target.checked)}/><span>Percentage of total</span></label></div></details>
        <button type="button" className="dashboard-report-maximize" onClick={toggleFullscreen} title={fullscreen ? 'Exit full screen' : 'View full screen'} aria-label={fullscreen ? 'Exit full screen report' : 'View report full screen'}>{fullscreen ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}</button>
      </div>
    </CardHeader>
    <CardContent className="curriculum-stage-content">
      <div className="curriculum-stage-table-wrap">
        <table className="curriculum-stage-table">
          <thead><tr>{visibleRowFields.map((field, index) => <th className="curriculum-row-field" key={field.key}>{index === 0 ? <button type="button" className="curriculum-expand-all" onClick={() => setExpandedRows(allExpanded ? new Set() : new Set(allExpandableKeys))} aria-label={allExpanded ? 'Collapse all rows' : 'Expand all rows'}>{allExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>} {field.label}</button> : field.label}</th>)}{displayedStageNames.map(stage => <th className="curriculum-value-field" key={stage}>{stage}</th>)}{displayTotalColumn && <th className="curriculum-value-field">Total</th>}{displayPercentageColumn && <th className="curriculum-value-field">% of total</th>}</tr></thead>
          <tbody>
            {flatRows.map(row => <tr key={row.key} className={row.depth ? 'curriculum-child-row' : 'curriculum-parent-row'}>{visibleRowFields.map((field, index) => <td className="curriculum-row-field" key={field.key}>{index === row.depth && <button type="button" className="curriculum-row-toggle" onClick={() => row.children.length && toggleRow(row.key)} aria-expanded={expandedRows.has(row.key)} disabled={!row.children.length}>{row.children.length ? (expandedRows.has(row.key) ? <ChevronDown size={14}/> : <ChevronRight size={14}/>) : <span className="curriculum-child-indent"/>}<strong>{row.label}</strong>{row.children.length > 0 && <small>{row.children.length} {selectedRowFields[row.depth + 1]?.label.toLowerCase()}{row.children.length === 1 ? '' : 's'}</small>}</button>}</td>)}{displayedStageNames.map(stage => <td className="curriculum-value-field" key={stage}><strong>{row.counts[stage] || 0}</strong><small className="stage-contribution">{percentageOfTotal(row.counts[stage])}</small></td>)}{displayTotalColumn && <td className="curriculum-value-field"><strong>{displayedRowTotal(row)}</strong></td>}{displayPercentageColumn && <td className="curriculum-value-field"><strong>{percentageOfTotal(displayedRowTotal(row))}</strong></td>}</tr>)}
            {!rows.length && <tr><td colSpan={displayedStageNames.length + visibleRowFields.length + (displayTotalColumn ? 1 : 0) + (displayPercentageColumn ? 1 : 0)} className="curriculum-stage-empty">No leads found for the selected filters.</td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot><tr><td className="curriculum-row-field" colSpan={visibleRowFields.length}><strong>Total</strong></td>{displayedStageNames.map(stage => <td className="curriculum-value-field" key={stage}><strong>{totals[stage] || 0}</strong><small className="stage-contribution">{percentageOfTotal(totals[stage])}</small></td>)}{displayTotalColumn && <td className="curriculum-value-field"><strong>{displayedTotal}</strong></td>}{displayPercentageColumn && <td className="curriculum-value-field"><strong>{displayedTotal ? '100.0%' : '0.0%'}</strong></td>}</tr></tfoot>}
        </table>
      </div>
    </CardContent>
  </Card>;
}

function SavedReportWidget({ report, leads }) {
  return (
    <Card className="h-full dashboard-report-widget">
      <CardHeader>
        <CardDescription className="uppercase tracking-wide text-xs font-semibold">
          Saved report
        </CardDescription>
        <CardTitle>{report.title || 'Untitled report'}</CardTitle>
        {report.description && <CardDescription>{report.description}</CardDescription>}
      </CardHeader>
      <CardContent className="dashboard-report-visual">
        <ReportVisual report={report} data={buildLiveReportData(report, leads)} compact />
      </CardContent>
    </Card>
  );
}

function StatsWidget({ statCards, size }) {
  return (
    <div className={cn('grid gap-3 xl:gap-4 h-full', STAT_COLUMNS[size] || STAT_COLUMNS.full)}>
      {statCards.map((card) => (
        <StatCard key={card.label} {...card} compact className="h-full min-h-[96px] xl:min-h-[112px]" />
      ))}
    </div>
  );
}

const ACTIVITY_SERIES = {
  crmHours: { label: 'CRM Usage', color: 'var(--brand-600)', suffix: '', decimals: 1 },
  leads: { label: 'Lead', color: '#4e8bd8', suffix: '', decimals: 0 },
};

function DailyActivityWidget({ data }) {
  const [seriesKey, setSeriesKey] = useState('crmHours');
  const chartRef = useRef(null);
  const [chartSize, setChartSize] = useState({ width: 680, height: 360 });
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const next = {
        width: Math.max(1, Math.round(chart.clientWidth)),
        height: Math.max(1, Math.round(chart.clientHeight)),
      };
      setChartSize(current => current.width === next.width && current.height === next.height ? current : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(chart);
    return () => observer.disconnect();
  }, []);
  const series = ACTIVITY_SERIES[seriesKey];
  const values = data.map(item => Math.max(0, Number(item[seriesKey]) || 0));
  const maximum = Math.max(...values, 1);
  const width = chartSize.width;
  const height = chartSize.height;
  const margin = {
    top: Math.min(42, Math.max(22, height * 0.13)),
    right: Math.min(24, Math.max(12, width * 0.025)),
    bottom: Math.min(48, Math.max(30, height * 0.16)),
    left: Math.min(34, Math.max(18, width * 0.035)),
  };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const points = values.map((value, index) => ({
    x: margin.left + (data.length > 1 ? index / (data.length - 1) * plotWidth : plotWidth / 2),
    y: margin.top + plotHeight - value / maximum * plotHeight,
    value,
    day: data[index]?.day,
  }));
  const pointString = points.map(point => `${point.x},${point.y}`).join(' ');
  const displayValue = value => {
    if (seriesKey !== 'crmHours') return `${Math.round(Number(value) || 0)}`;
    const totalMinutes = Math.max(0, Math.round((Number(value) || 0) * 60));
    return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
  };
  const displayDay = day => new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  const periodScope = seriesKey === 'crmHours' ? 'signed-in user' : 'selected filters';
  const periodLabel = data.length ? `${displayDay(data[0].day)} – ${displayDay(data.at(-1).day)} · ${periodScope}` : `No dates selected · ${periodScope}`;
  const labelStep = Math.max(1, Math.ceil(data.length / 8));

  return <Card className="h-full dashboard-activity-widget">
    <CardHeader>
      <div><CardTitle>My Daily CRM Activity</CardTitle><CardDescription>{periodLabel}</CardDescription></div>
    </CardHeader>
    <CardContent className="dashboard-activity-content">
      <div className="dashboard-activity-tabs chart-tabs" role="tablist" aria-label="Select activity report">
        {Object.entries(ACTIVITY_SERIES).map(([key, option]) => <button type="button" role="tab" aria-selected={seriesKey === key} className={seriesKey === key ? 'active' : ''} key={key} onClick={() => setSeriesKey(key)}>{option.label}</button>)}
      </div>
      <div ref={chartRef} className="dashboard-activity-chart" aria-label={`${series.label} by day`}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img">
          {[0, 0.5, 1].map(ratio => <line key={ratio} x1={margin.left} x2={width - margin.right} y1={margin.top + plotHeight * ratio} y2={margin.top + plotHeight * ratio} className="activity-grid-line" />)}
          {points.length > 0 && <><polyline points={pointString} fill="none" style={{ stroke: series.color }} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />{points.map((point, index) => <g key={point.day || index}><circle cx={point.x} cy={point.y} r="4" fill="#fff" style={{ stroke: series.color }} strokeWidth="3"><title>{`${point.day}: ${displayValue(point.value)}`}</title></circle><text x={point.x} y={Math.max(13, point.y - 10)} textAnchor="middle" className="activity-value-label">{displayValue(point.value)}</text>{(index % labelStep === 0 || index === points.length - 1) && <text x={point.x} y={height - 14} textAnchor="middle" className="activity-day-label">{displayDay(point.day)}</text>}</g>)}</>}
        </svg>
      </div>
      <div className="dashboard-activity-legend"><i style={{ background: series.color }} /><span>{series.label}</span><strong>{displayValue(values.reduce((sum, value) => sum + value, 0))} total</strong></div>
    </CardContent>
  </Card>;
}

function FunnelWidget({ data }) {
  const funnel = data.funnel || [];
  const stageValues = funnel.map(item => Math.max(0, Number(item.value) || 0));
  const maximumValue = Math.max(...stageValues, 0);
  const totalValue = stageValues.reduce((sum, value) => sum + value, 0);
  return (
              <Card className="h-full admissions-view-widget">
                <CardHeader className="flex-row items-center justify-between gap-3">
                  <div><CardTitle>Admissions view</CardTitle><CardDescription>Lead movement this academic year</CardDescription></div>
                  <span className="admissions-live-label">Live</span>
                </CardHeader>
                <CardContent className="admissions-view-content">
                  <div className="admissions-view-list">
                    {funnel.map((item, index) => {
                      const value = stageValues[index];
                      const barPercentage = maximumValue ? (value / maximumValue) * 100 : 0;
                      // Every row reads as a share of all leads, so the counts
                      // and the percentages both add up to the total row below.
                      const share = totalValue ? Math.round((value / totalValue) * 100) : 0;

                      return (
                        <div key={item.label} className="admissions-view-row">
                          <div className="admissions-view-label">
                            <span>{item.label}</span>
                          </div>
                          <div className="admissions-view-track">
                            <div
                              className="admissions-view-fill"
                              style={{
                                width: `${barPercentage}%`,
                                backgroundColor: item.color,
                              }}
                            />
                          </div>
                          <div className="admissions-view-analysis">
                            <strong>{value}</strong> <span>({share}%)</span>
                          </div>
                        </div>
                      );
                    })}
                    <div className="admissions-view-row admissions-view-total">
                      <div className="admissions-view-label"><span>Total Leads</span></div>
                      <div className="admissions-view-track">
                        <div className="admissions-view-fill" style={{ width: totalValue ? '100%' : '0%' }} />
                      </div>
                      <div className="admissions-view-analysis">
                        <strong>{totalValue}</strong> <span>({totalValue ? 100 : 0}%)</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function getComparisonLabel(current, previous, suffix, zeroBaselineLabel = '') {
  const currentValue = Number(current || 0);
  const previousValue = Number(previous || 0);
  if (!previousValue) return zeroBaselineLabel;
  const change = ((currentValue - previousValue) / previousValue) * 100;
  const sign = change > 0 ? '+' : '';
  return `${sign}${change.toFixed(1)}% ${suffix}`;
}

export default DashboardPage;
