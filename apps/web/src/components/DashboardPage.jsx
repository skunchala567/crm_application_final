import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, TrendingUp, Clock, CheckCircle, Users } from 'lucide-react';
import { api } from '../api';
import { useBusinessUnit } from '../BusinessUnitContext';
import StatCard from './StatCard';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Tabs, TabsList, TabsTrigger, TabsContent, Button } from './ui';
import PageContainer from './PageContainer';
import { cn } from '../lib/utils';

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

  useEffect(() => {
    if (location.state?.dashboardTab === 'saved') {
      setDashboardTab('saved');
    }
  }, [location.state?.dashboardTab]);

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
      label: 'Admissions',
      value: data.stats.admissions,
      trend: getComparisonLabel(
        comparisons.admissionsThisMonth,
        comparisons.admissionsLastMonth,
        'vs last month'
      ),
      icon: CheckCircle,
      color: 'emerald',
    },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Page Header */}
      <div className="bg-white border-b border-border sticky top-0 z-10">
        <PageContainer className="py-6">
          <div className="flex items-start justify-between gap-6">
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
            <Button
              onClick={() => navigate('/leads')}
              className="flex-shrink-0"
              size="lg"
            >
              <Plus size={18} />
              Add new lead
            </Button>
          </div>
        </PageContainer>
      </div>

      {/* Main Content */}
      <PageContainer className="flex-1 py-8">
        <Tabs defaultValue="overview" value={dashboardTab} onValueChange={setDashboardTab}>
          <TabsList className="mb-8">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="saved">Saved Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-8">
            {/* Stats Grid */}
            <div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {statCards.map((card) => (
                  <StatCard key={card.label} {...card} />
                ))}
              </div>
            </div>

            {/* Funnel Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Admissions Funnel</CardTitle>
                  <CardDescription>Lead movement this academic year</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {(data.funnel || []).map((item, index) => {
                      const previous = Number(data.funnel?.[index - 1]?.value || 0);
                      const conversion =
                        index && previous
                          ? Math.round((Number(item.value || 0) / previous) * 100)
                          : 100;

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
                                width: `${Math.max(7, 100 - index * 14)}%`,
                                backgroundColor: item.color,
                              }}
                            />
                          </div>
                          <div className="text-xs text-secondary-600">
                            {index ? `${conversion}% conversion` : '100% of enquiries'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Today's Priorities */}
              <Card>
                <CardHeader>
                  <CardTitle>Today's Priorities</CardTitle>
                  <CardDescription>Follow-ups requiring action</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {savedReportLeads
                      .filter((lead) => lead.nextFollowup || lead.followupAt)
                      .slice(0, 6)
                      .map((lead) => (
                        <div key={lead.id || lead.leadId} className="flex items-start gap-3 p-3 rounded-lg bg-secondary-50 hover:bg-secondary-100 transition-colors cursor-pointer">
                          <div
                            className="flex-shrink-0 w-2 h-2 rounded-full mt-1.5"
                            style={{
                              backgroundColor: lead.nextFollowup ? '#f59e0b' : '#ef4444',
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
                    {!savedReportLeads.filter((lead) => lead.nextFollowup || lead.followupAt).length && (
                      <div className="text-center py-8 text-secondary-600">
                        <CheckCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p className="font-medium mb-1">No pending follow-ups</p>
                        <p className="text-sm">You're all caught up.</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Recent Leads Table */}
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
                      {(savedReportLeads?.length ? savedReportLeads : data.recentLeads || [])
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
          </TabsContent>

          <TabsContent value="saved">
            <Card>
              <CardContent className="py-12">
                <div className="text-center">
                  <p className="text-secondary-600 mb-4">No saved reports yet</p>
                  <Button onClick={() => navigate('/saved-reports/new')}>
                    <Plus size={18} />
                    Create Your First Report
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageContainer>
    </div>
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
