import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { TrendingUp, Clock, CheckCircle, Users } from 'lucide-react';
import { api } from '../api';
import { useBusinessUnit } from '../BusinessUnitContext';
import StatCard from './StatCard';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Tabs, TabsList, TabsTrigger, TabsContent, Button } from './ui';
import PageContainer from './PageContainer';
import { cn } from '../lib/utils';
import { DASHBOARD_LAYOUT_EVENT, dashboardLayoutKey, readDashboardLayout } from '../lib/dashboardLayout';
import { ReportVisual, SavedReportsDashboard, buildLiveReportData, canViewSavedReport, readSavedReports } from '../ReportBuilder.jsx';

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

  const comparisons = data.stats.comparisons || {};
  const statCards = [
    {
      label: 'Total Leads',
      value: data.stats.totalLeads,
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
      value: data.stats.newThisWeek,
      trend: getComparisonLabel(
        data.stats.newThisWeek,
        comparisons.newPreviousWeek,
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
        <PageContainer className="py-6">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <p className="text-sm text-secondary-600 uppercase tracking-wide font-semibold mb-2">
                {new Date().toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
              <h1 className="text-3xl font-bold text-foreground font-display mb-2">
                Good {getGreeting()}, {user.name.split(' ')[0]}
              </h1>
              <p className="text-secondary-600">
                Here's what needs your admissions team's attention today.
              </p>
            </div>
            {/* Adding a lead lives on the Leads screen; not duplicated here. */}
            <TabsList className="flex-shrink-0 self-center">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="saved">Saved Reports</TabsTrigger>
            </TabsList>
          </div>
        </PageContainer>
      </div>

      {/* Main Content */}
      <PageContainer className="flex-1 py-8">
          <TabsContent value="overview">
            {/* Widgets, their order, width and visibility come from the
                Reports > Dashboard layout editor. */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {visibleLayout.map((item) => {
                const content = renderDashboardWidget(item, {
                  data,
                  statCards,
                  leads: savedReportLeads,
                  savedReports: visibleSavedReports,
                });
                if (!content) return null;
                return (
                  <div key={item.id} className={cn('min-w-0', COLUMN_SPAN[item.size] || COLUMN_SPAN.half)}>
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
              data={data}
              leads={savedReportLeads}
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

/** Tailwind needs literal class names, so widget widths map explicitly. */
const COLUMN_SPAN = {
  quarter: 'lg:col-span-1',
  half: 'lg:col-span-2',
  'three-quarter': 'lg:col-span-3',
  full: 'lg:col-span-4',
};

const STAT_COLUMNS = {
  quarter: 'grid-cols-1',
  half: 'grid-cols-1 sm:grid-cols-2',
  'three-quarter': 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3',
  full: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
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
  if (id === 'tasks') return <PrioritiesWidget leads={leads} />;
  if (id === 'recent') return <RecentLeadsWidget leads={leads} data={data} />;
  return null;
}

function SavedReportWidget({ report, leads }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="uppercase tracking-wide text-xs font-semibold">
          Saved report
        </CardDescription>
        <CardTitle>{report.title || 'Untitled report'}</CardTitle>
        {report.description && <CardDescription>{report.description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <ReportVisual report={report} data={buildLiveReportData(report, leads)} compact />
      </CardContent>
    </Card>
  );
}

function StatsWidget({ statCards, size }) {
  return (
    <div className={cn('grid gap-6', STAT_COLUMNS[size] || STAT_COLUMNS.full)}>
      {statCards.map((card) => (
        <StatCard key={card.label} {...card} />
      ))}
    </div>
  );
}

const ACTIVITY_SERIES = {
  crmHours: { label: 'CRM hours', color: '#0b7a4f', suffix: 'h', decimals: 1 },
  leadsAssigned: { label: 'Leads added to me', color: '#4e8bd8', suffix: '', decimals: 0 },
  followupsDone: { label: 'Follow-ups done', color: '#d9823b', suffix: '', decimals: 0 },
};

function DailyActivityWidget({ data }) {
  const [seriesKey, setSeriesKey] = useState('crmHours');
  const series = ACTIVITY_SERIES[seriesKey];
  const values = data.map(item => Math.max(0, Number(item[seriesKey]) || 0));
  const maximum = Math.max(...values, 1);
  const width = 680;
  const height = 230;
  const margin = { top: 28, right: 24, bottom: 42, left: 34 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const points = values.map((value, index) => ({
    x: margin.left + (data.length > 1 ? index / (data.length - 1) * plotWidth : plotWidth / 2),
    y: margin.top + plotHeight - value / maximum * plotHeight,
    value,
    day: data[index]?.day,
  }));
  const pointString = points.map(point => `${point.x},${point.y}`).join(' ');
  const displayValue = value => `${Number(value).toFixed(series.decimals)}${series.suffix}`;

  return <Card className="h-full">
    <CardHeader className="flex-row items-start justify-between gap-3">
      <div><CardTitle>My Daily CRM Activity</CardTitle><CardDescription>Last 14 days · signed-in user</CardDescription></div>
      <select className="dashboard-activity-select" value={seriesKey} onChange={event => setSeriesKey(event.target.value)} aria-label="Select activity report">
        {Object.entries(ACTIVITY_SERIES).map(([key, option]) => <option key={key} value={key}>{option.label}</option>)}
      </select>
    </CardHeader>
    <CardContent>
      <div className="dashboard-activity-chart" aria-label={`${series.label} by day`}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img">
          {[0, 0.5, 1].map(ratio => <line key={ratio} x1={margin.left} x2={width - margin.right} y1={margin.top + plotHeight * ratio} y2={margin.top + plotHeight * ratio} className="activity-grid-line" />)}
          {points.length > 0 && <><polyline points={pointString} fill="none" stroke={series.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />{points.map((point, index) => <g key={point.day || index}><circle cx={point.x} cy={point.y} r="4" fill="#fff" stroke={series.color} strokeWidth="3"><title>{`${point.day}: ${displayValue(point.value)}`}</title></circle><text x={point.x} y={Math.max(13, point.y - 10)} textAnchor="middle" className="activity-value-label">{displayValue(point.value)}</text>{(index % 2 === 0 || index === points.length - 1) && <text x={point.x} y={height - 14} textAnchor="middle" className="activity-day-label">{new Date(`${point.day}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</text>}</g>)}</>}
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
              <Card>
                <CardHeader>
                  <CardTitle>Admissions Funnel</CardTitle>
                  <CardDescription>Lead movement this academic year</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {funnel.map((item, index) => {
                      const value = stageValues[index];
                      const previous = stageValues[index - 1] || 0;
                      const barPercentage = maximumValue ? (value / maximumValue) * 100 : 0;
                      const share = totalValue ? Math.round((value / totalValue) * 100) : 0;
                      const conversion = previous ? Math.round((value / previous) * 100) : null;
                      const performanceLabel = index === 0
                        ? `${share}% of current leads`
                        : conversion === null
                          ? `${share}% of current leads`
                          : `${conversion}% conversion from ${funnel[index - 1].label}`;

                      return (
                        <div key={item.label} className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium text-foreground">{item.label}</span>
                            <span className="text-secondary-600">{item.value}</span>
                          </div>
                          <div className="h-2 bg-secondary-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${barPercentage}%`,
                                backgroundColor: item.color,
                              }}
                            />
                          </div>
                          <div className="text-xs text-secondary-600">
                            {performanceLabel}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
  );
}

function PrioritiesWidget({ leads }) {
  return (
              <Card>
                <CardHeader>
                  <CardTitle>Today's Priorities</CardTitle>
                  <CardDescription>Follow-ups requiring action</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {leads
                      .filter((lead) => lead.nextFollowup || lead.followupAt)
                      .slice(0, 6)
                      .map((lead) => (
                        <div key={lead.id || lead.leadId} className="flex items-start gap-3 p-3 rounded-lg bg-secondary-50 hover:bg-secondary-100 transition-colors cursor-pointer">
                          <div
                            className="flex-shrink-0 w-2 h-2 rounded-full mt-1.5"
                            style={{
                              backgroundColor: lead.nextFollowup ? '#c47f0a' : '#c33d35',
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-foreground truncate">
                              {lead.studentName || 'Unnamed lead'}
                            </p>
                            <p className="text-xs text-secondary-600">
                              {[lead.stage, lead.nextFollowup || lead.followupAt].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                        </div>
                      ))}
                    {!leads.filter((lead) => lead.nextFollowup || lead.followupAt).length && (
                      <div className="text-center py-8 text-secondary-600">
                        <CheckCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p className="font-medium mb-1">No pending follow-ups</p>
                        <p className="text-sm">You're all caught up.</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
  );
}

function RecentLeadsWidget({ leads, data }) {
  return (
            <Card>
              <CardHeader>
                <CardTitle>Recent Leads</CardTitle>
                <CardDescription>Latest enquiries across all sources</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700 uppercase tracking-wider">
                          Student
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700 uppercase tracking-wider">
                          Lead ID
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700 uppercase tracking-wider">
                          Applying for
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700 uppercase tracking-wider">
                          Stage
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700 uppercase tracking-wider">
                          Owner
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(leads?.length ? leads : data.recentLeads || [])
                        .slice(0, 8)
                        .map((lead) => (
                          <tr
                            key={lead.id}
                            className="border-b border-border hover:bg-secondary-50 transition-colors"
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary-100 text-xs font-semibold text-primary-700">
                                  {String(lead.studentName || '?')
                                    .split(' ')
                                    .map((n) => n[0])
                                    .join('')}
                                </div>
                                <div>
                                  <p className="font-medium text-sm">{lead.studentName}</p>
                                  <p className="text-xs text-secondary-600">{lead.phone}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <code className="text-xs font-mono text-primary-600 bg-primary-50 px-2 py-1 rounded">
                                {lead.leadId}
                              </code>
                            </td>
                            <td className="px-4 py-3 text-sm">{lead.applyingClass}</td>
                            <td className="px-4 py-3">
                              <span
                                className={cn(
                                  'inline-block px-2 py-1 rounded-full text-xs font-semibold',
                                  getStageColor(lead.stage)
                                )}
                              >
                                {lead.stage}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-secondary-600">
                              {lead.owner}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
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

function getStageColor(stage) {
  const stageMap = {
    new: 'bg-blue-100 text-blue-700',
    application: 'bg-emerald-100 text-emerald-700',
    admitted: 'bg-emerald-100 text-emerald-700',
    'campus-visit': 'bg-amber-100 text-amber-700',
    enrolled: 'bg-emerald-100 text-emerald-700',
  };
  return stageMap[stage?.toLowerCase()?.replace(' ', '-')] || 'bg-gray-100 text-gray-700';
}

export default DashboardPage;
