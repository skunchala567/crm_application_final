import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Bold, CalendarClock, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CirclePause, ClipboardCheck, Clock3,
  Columns3, FileText, IndentDecrease, IndentIncrease, List, ListChecks, ListOrdered, ListTree, Minus,
  Pencil, Plus, RefreshCw, Search, Send, Timer, Trash2, Underline, UserRound,
  Users, Workflow, X, XCircle,
} from 'lucide-react';
import { api } from '../api';
import { useBusinessUnit } from '../BusinessUnitContext';
import Toast from '../Toast.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Select, Input, Button, Tabs, TabsList, TabsTrigger, TabsContent } from './ui';
import PageContainer from './PageContainer';
import StatCard from './StatCard';
import { cn } from '../lib/utils';

const emptyTask = {
  title: '', description: '', workflowId: '', stageId: '', ownerEmployeeId: '', guestOwnerId: '', guestOwnerName: '', ownerCrmUserId: '', estimatedHours: '', estimateUnit: 'hours', dueAt: '', minutesSpent: '', timeNote: '', approvalRequired: false, approverUserIds: [],
};

const toLocal = value => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
const duration = minutes => `${Math.floor(Number(minutes || 0) / 60)}h ${Number(minutes || 0) % 60}m`;
const dateKey = value => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export default function OperationsPageModern() {
  const { selectedUnit, loading: businessUnitLoading } = useBusinessUnit();
  const [config, setConfig] = useState(null);
  const [records, setRecords] = useState([]);
  const [users, setUsers] = useState([]);
  const [guestOwners, setGuestOwners] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [momSessions, setMomSessions] = useState([]);
  const [tab, setTab] = useState('tasks');
  const [taskView, setTaskView] = useState('board');
  const [calendarCursor, setCalendarCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [search, setSearch] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [dueFilter, setDueFilter] = useState('');
  const [approvalFilter, setApprovalFilter] = useState('');
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!selectedUnit?.id) return;
    setTaskView(localStorage.getItem(`crm_tracker_view_${selectedUnit.id}`) || 'board');
  }, [selectedUnit?.id]);

  const changeTaskView = view => {
    setTaskView(view);
    if (selectedUnit?.id) localStorage.setItem(`crm_tracker_view_${selectedUnit.id}`, view);
  };

  const load = async () => {
    if (!selectedUnit?.id) return;
    const [configuration, taskResult, userResult, guestResult, approvalResult, momResult] = await Promise.all([
      api(`/platform/business-units/${selectedUnit.id}/config`),
      api(`/platform/business-units/${selectedUnit.id}/operations`),
      api(`/platform/business-units/${selectedUnit.id}/tracker-users`),
      api(`/platform/business-units/${selectedUnit.id}/tracker-guest-owners`),
      api(`/platform/business-units/${selectedUnit.id}/tracker-approvals`),
      api(`/platform/business-units/${selectedUnit.id}/mom-sessions`),
    ]);
    setConfig(configuration);
    setRecords(taskResult.data || []);
    setUsers(userResult.data || []);
    setGuestOwners(guestResult.data || []);
    setApprovals(approvalResult.data || []);
    setMomSessions(momResult.data || []);
    const defaultWorkflow = configuration.workflows.find(item => item.isDefault) || configuration.workflows[0];
    setWorkflowId(current => current || String(defaultWorkflow?.id || ''));
  };

  useEffect(() => {
    if (!selectedUnit?.id) return;
    setConfig(null);
    setRecords([]);
    setWorkflowId('');
    setStageFilter('');
    setOwnerFilter('');
    setDueFilter('');
    setApprovalFilter('');
    load().catch(error => setMessage({ type: 'error', text: error.message }));
  }, [selectedUnit?.id]);

  const workflows = config?.workflows || [];
  const stages = (config?.operationStages || []).filter(stage => !workflowId || String(stage.workflowId) === String(workflowId));
  const ownerOptions = useMemo(() => [...new Set(records.map(record => record.owner || 'Unassigned'))].sort((a, b) => a.localeCompare(b)), [records]);

  const visible = useMemo(() => {
    const now = new Date(), today = dateKey(now);
    return records.filter(record => {
      const dueDate = record.dueAt ? new Date(record.dueAt) : null;
      const dueMatches = !dueFilter ||
        (dueFilter === 'overdue' && dueDate && dueDate < now) ||
        (dueFilter === 'today' && dueDate && dateKey(dueDate) === today) ||
        (dueFilter === 'upcoming' && dueDate && dueDate > now && dateKey(dueDate) !== today) ||
        (dueFilter === 'unscheduled' && !dueDate);
      const approvalMatches = !approvalFilter ||
        (approvalFilter === 'required' && record.approvalRequired) ||
        (approvalFilter === 'not_required' && !record.approvalRequired) ||
        (record.approvalRequired && record.approvalStatus === approvalFilter);
      return (!workflowId || String(record.workflowId) === String(workflowId)) &&
        (!stageFilter || String(record.stageId) === String(stageFilter)) &&
        (!ownerFilter || (record.owner || 'Unassigned') === ownerFilter) && dueMatches && approvalMatches &&
        (!search || `${record.title} ${record.recordNumber} ${record.owner} ${record.description || ''}`.toLowerCase().includes(search.toLowerCase()));
    });
  }, [records, workflowId, stageFilter, ownerFilter, dueFilter, approvalFilter, search]);

  const pendingApprovals = approvals.filter(item => item.decision === 'pending').length;
  const terminalStageIds = useMemo(() => new Set(
    (config?.operationStages || [])
      .filter(stage => ['completed', 'cancelled'].includes(stage.stageType))
      .map(stage => String(stage.id)),
  ), [config?.operationStages]);
  const overdueRecords = useMemo(() => visible
    .filter(record => record.dueAt && new Date(record.dueAt) < new Date() && !terminalStageIds.has(String(record.stageId)))
    .sort((left, right) => new Date(left.dueAt) - new Date(right.dueAt)), [visible, terminalStageIds]);
  const overdue = overdueRecords.length;

  if (businessUnitLoading || !selectedUnit) {
    return (
      <PageContainer className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="inline-block w-12 h-12 rounded-full border-4 border-secondary-200 border-t-primary-600 animate-spin mb-4" />
          <p className="text-secondary-600">Loading business unit…</p>
        </div>
      </PageContainer>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Toast message={message} onClose={() => setMessage(null)} />

      {/* Page Header */}
      <div className="bg-white border-b border-border sticky top-0 z-10">
        <PageContainer className="py-6 flex items-start justify-between gap-6">
          <div>
            <p className="text-sm text-secondary-600 uppercase tracking-wide font-semibold mb-2">
              {selectedUnit.name}
            </p>
            <h1 className="text-3xl font-bold text-foreground font-display mb-2">
              Progress &amp; MOM Tracker
            </h1>
            <p className="text-secondary-600">
              Assign action items, record effort, monitor deadlines, and route work for approval.
            </p>
          </div>
          <Button
            onClick={load}
            variant="secondary"
            className="flex-shrink-0"
          >
            <RefreshCw size={16} />
            Refresh
          </Button>
        </PageContainer>
      </div>

      {/* Tabs */}
      <PageContainer className="py-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-3 mb-8">
            <TabsTrigger value="tasks" className="relative">
              <ListChecks size={18} className="mr-2" />
              <span>Action Items</span>
              <span className="ml-2 px-2 py-1 rounded-full bg-primary-100 text-primary-700 text-xs font-semibold">
                {records.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="mom">
              <FileText size={18} className="mr-2" />
              <span>MOM Records</span>
              <span className="ml-2 px-2 py-1 rounded-full bg-primary-100 text-primary-700 text-xs font-semibold">
                {momSessions.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="approvals">
              <ClipboardCheck size={18} className="mr-2" />
              <span>My Approvals</span>
              {pendingApprovals > 0 && (
                <span className="ml-2 px-2 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
                  {pendingApprovals}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tasks" className="space-y-6">
            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Action Items"
                value={visible.length}
                icon={Workflow}
                color="blue"
              />
              <StatCard
                label="Time Recorded"
                value={duration(visible.reduce((sum, item) => sum + Number(item.minutesSpent || 0), 0))}
                icon={Timer}
                color="emerald"
              />
              <StatCard
                label="Overdue"
                value={overdue}
                icon={CalendarClock}
                color={overdue > 0 ? "amber" : "blue"}
              />
              <StatCard
                label="Pending Approvals"
                value={records.filter(item => item.approvalStatus === 'pending').length}
                icon={ClipboardCheck}
                color="purple"
              />
            </div>

            {/* Toolbar */}
            <Card>
              <CardContent className="p-4">
                <div className="space-y-4">
                  {/* Search and Filters */}
                  <div className="flex flex-col lg:flex-row gap-4 lg:items-end">
                    {/* Search */}
                    <div className="flex-1 relative">
                      <Search size={16} className="absolute left-3 top-3 text-secondary-400 pointer-events-none" />
                      <Input
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                        placeholder="Search action items…"
                        className="pl-9"
                      />
                    </div>

                    {/* Filters */}
                    <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                      {workflows.length > 1 && (
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-secondary-600">Tracker</label>
                          <Select value={workflowId} onChange={event => { setWorkflowId(event.target.value); setStageFilter(''); }}>
                            {workflows.map(workflow => (
                              <option key={workflow.id} value={workflow.id}>{workflow.displayName}</option>
                            ))}
                          </Select>
                        </div>
                      )}
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-secondary-600">Status</label>
                        <Select value={stageFilter} onChange={event => setStageFilter(event.target.value)}>
                          <option value="">All statuses</option>
                          {stages.map(stage => (
                            <option key={stage.id} value={stage.id}>{stage.displayName}</option>
                          ))}
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-secondary-600">Owner</label>
                        <Select value={ownerFilter} onChange={event => setOwnerFilter(event.target.value)}>
                          <option value="">All owners</option>
                          {ownerOptions.map(owner => (
                            <option key={owner} value={owner}>{owner}</option>
                          ))}
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-secondary-600">Deadline</label>
                        <Select value={dueFilter} onChange={event => setDueFilter(event.target.value)}>
                          <option value="">All deadlines</option>
                          <option value="overdue">Overdue</option>
                          <option value="today">Due today</option>
                          <option value="upcoming">Upcoming</option>
                          <option value="unscheduled">Unscheduled</option>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-secondary-600">Approval</label>
                        <Select value={approvalFilter} onChange={event => setApprovalFilter(event.target.value)}>
                          <option value="">All approvals</option>
                          <option value="required">Approval required</option>
                          <option value="pending">Pending</option>
                          <option value="approved">Approved</option>
                          <option value="rejected">Rejected</option>
                          <option value="not_required">Not required</option>
                        </Select>
                      </div>
                    </div>
                  </div>

                  {/* View Toggle */}
                  <div className="flex gap-2 mt-4">
                    <Button
                      variant={taskView === 'board' ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => changeTaskView('board')}
                      title="Board view"
                    >
                      <Columns3 size={16} />
                      <span className="hidden sm:inline ml-2">Board</span>
                    </Button>
                    <Button
                      variant={taskView === 'list' ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => changeTaskView('list')}
                      title="List view"
                    >
                      <ListTree size={16} />
                      <span className="hidden sm:inline ml-2">List</span>
                    </Button>
                    <Button
                      variant={taskView === 'calendar' ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => changeTaskView('calendar')}
                      title="Calendar view"
                    >
                      <CalendarDays size={16} />
                      <span className="hidden sm:inline ml-2">Calendar</span>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* View Content */}
            {taskView === 'board' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {stages.length === 0 ? (
                  <div className="col-span-full flex items-center justify-center py-12 bg-white rounded-lg border border-border">
                    <div className="text-center text-secondary-600">
                      <Workflow size={32} className="mx-auto mb-2 opacity-50" />
                      <p className="font-medium">No Tracker statuses configured</p>
                      <p className="text-sm">Add statuses from Settings → Business Units → Tracker.</p>
                    </div>
                  </div>
                ) : (
                  stages.map(stage => {
                    const stageRecords = visible.filter(record => record.stageId === stage.id);
                    return (
                      <Card key={stage.id} className="overflow-hidden">
                        <CardHeader style={{ borderTopColor: stage.color, borderTopWidth: '4px' }}>
                          <CardTitle className="text-base">{stage.displayName}</CardTitle>
                          <CardDescription>{stageRecords.length} items</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                          <div className="space-y-2 p-4">
                            {stageRecords.length === 0 ? (
                              <div className="text-center py-6 text-secondary-600">
                                <Workflow size={24} className="mx-auto mb-1 opacity-50" />
                                <p className="text-xs">No items</p>
                              </div>
                            ) : (
                              stageRecords.map(record => (
                                <div
                                  key={record.id}
                                  className={cn(
                                    'p-3 rounded-lg border border-border hover:border-primary-300 transition-colors',
                                    record.dueAt && new Date(record.dueAt) < new Date() ? 'bg-red-50' : 'bg-secondary-50'
                                  )}
                                >
                                  <div className="flex justify-between items-start gap-2">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-mono text-primary-600 mb-1">{record.recordNumber}</p>
                                      <p className="font-medium text-sm text-foreground truncate">{record.title}</p>
                                      <p className="text-xs text-secondary-600 line-clamp-2">{record.description || 'No description'}</p>
                                    </div>
                                  </div>
                                  <div className="mt-3 space-y-1 text-xs text-secondary-600">
                                    <div className="flex items-center gap-2">
                                      <Users size={14} />
                                      <span>{record.owner}</span>
                                    </div>
                                    {record.dueAt && (
                                      <div className="flex items-center gap-2">
                                        <CalendarClock size={14} />
                                        <span>{new Date(record.dueAt).toLocaleDateString()}</span>
                                      </div>
                                    )}
                                    {record.customValues?.estimatedHours && (
                                      <div className="flex items-center gap-2">
                                        <Clock3 size={14} />
                                        <span>{record.customValues.estimatedHours}h</span>
                                      </div>
                                    )}
                                  </div>
                                  {record.approvalRequired && (
                                    <div className={cn(
                                      'mt-2 inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold',
                                      record.approvalStatus === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                                      record.approvalStatus === 'rejected' ? 'bg-red-100 text-red-700' :
                                      'bg-amber-100 text-amber-700'
                                    )}>
                                      <ClipboardCheck size={12} />
                                      {record.approvalStatus.replace(/_/g, ' ')}
                                    </div>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            )}

            {taskView === 'list' && (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-secondary-50 border-b border-border">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700">Action Item</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700">Owner</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700">Status</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700">Deadline</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700">Recorded</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700">Approval</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {visible.length === 0 ? (
                          <tr>
                            <td colSpan="6" className="px-4 py-8 text-center text-secondary-600">
                              <ListTree size={32} className="mx-auto mb-2 opacity-50" />
                              <p className="font-medium">No action items found</p>
                              <p className="text-sm">Adjust the search or filter.</p>
                            </td>
                          </tr>
                        ) : (
                          visible.map(record => (
                            <tr
                              key={record.id}
                              className={cn(
                                'hover:bg-secondary-50 transition-colors',
                                record.dueAt && new Date(record.dueAt) < new Date() ? 'bg-red-50' : ''
                              )}
                            >
                              <td className="px-4 py-3">
                                <div>
                                  <p className="font-medium text-sm text-foreground">{record.title}</p>
                                  <p className="text-xs font-mono text-primary-600">{record.recordNumber}</p>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-sm text-foreground">{record.owner}</td>
                              <td className="px-4 py-3">
                                <span className="inline-block px-2 py-1 rounded text-xs font-semibold bg-primary-100 text-primary-700">
                                  {stages.find(s => s.id === record.stageId)?.displayName}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-foreground">
                                {record.dueAt ? new Date(record.dueAt).toLocaleDateString() : '—'}
                              </td>
                              <td className="px-4 py-3 text-sm text-foreground">
                                {duration(record.minutesSpent)}
                              </td>
                              <td className="px-4 py-3">
                                {record.approvalRequired ? (
                                  <span className={cn(
                                    'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold',
                                    record.approvalStatus === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                                    record.approvalStatus === 'rejected' ? 'bg-red-100 text-red-700' :
                                    'bg-amber-100 text-amber-700'
                                  )}>
                                    {record.approvalStatus.replace(/_/g, ' ')}
                                  </span>
                                ) : (
                                  <span className="text-xs text-secondary-600">Not required</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {taskView === 'calendar' && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Calendar View</CardTitle>
                    <CardDescription>{calendarCursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setCalendarCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
                      Today
                    </Button>
                    <Button variant="secondary" size="icon" onClick={() => setCalendarCursor(date => new Date(date.getFullYear(), date.getMonth() - 1, 1))}>
                      <ChevronLeft size={16} />
                    </Button>
                    <Button variant="secondary" size="icon" onClick={() => setCalendarCursor(date => new Date(date.getFullYear(), date.getMonth() + 1, 1))}>
                      <ChevronRight size={16} />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-secondary-600 text-sm">Calendar view implementation coming soon...</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="mom" className="py-4">
            <Card>
              <CardContent className="py-12">
                <div className="text-center">
                  <FileText size={32} className="mx-auto mb-3 opacity-50 text-secondary-600" />
                  <p className="font-medium text-foreground mb-1">MOM Records</p>
                  <p className="text-secondary-600 text-sm mb-4">{momSessions.length} sessions recorded</p>
                  <Button>
                    <Plus size={16} />
                    Start New Session
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="approvals" className="py-4">
            <Card>
              <CardContent className="py-12">
                <div className="text-center">
                  <ClipboardCheck size={32} className="mx-auto mb-3 opacity-50 text-secondary-600" />
                  <p className="font-medium text-foreground mb-1">My Approvals</p>
                  <p className="text-secondary-600 text-sm">{pendingApprovals} pending approval{pendingApprovals !== 1 ? 's' : ''}</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageContainer>
    </div>
  );
}
