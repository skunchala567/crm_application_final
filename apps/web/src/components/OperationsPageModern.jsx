import { useEffect, useMemo, useRef, useState } from 'react';
import { Bold, CalendarClock, CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardCheck, Clock3, Columns3, Download, Eye, FileText, IndentDecrease, IndentIncrease, List, ListChecks, ListOrdered, ListTree, Pencil, Plus, RefreshCw, Search, Timer, Underline, Users, Workflow, X } from 'lucide-react';
import { api } from '../api';
import { useBusinessUnit } from '../BusinessUnitContext';
import Toast from '../Toast.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Select, Input, Button, Tabs, TabsList, TabsTrigger, TabsContent } from './ui';
import PageContainer from './PageContainer';
import StatCard from './StatCard';
import { cn } from '../lib/utils';
import { DateRangeFilterControl } from '../FilterWorkspace.jsx';
// Supplies .mom-rich-editor / .mom-editor-toolbar / .mom-editor-content.
import '../MetadataPlatform.css';
import './TrackerCalendar.css';

const emptyTask = {
  title: '', description: '', workflowId: '', stageId: '', ownerEmployeeId: '', guestOwnerId: '', guestOwnerName: '', ownerCrmUserId: '', estimatedHours: '', estimateUnit: 'hours', dueAt: '', minutesSpent: '', timeNote: '', approvalRequired: false, approverUserIds: [],
};

const toLocal = value => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';

const actionCreatedLabel = value => {
  if (!value) return 'Created date unavailable';
  const created = new Date(value);
  if (Number.isNaN(created.getTime())) return 'Created date unavailable';
  return `Created ${created.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  })}`;
};

// ---- MOM estimates -------------------------------------------------------
// The API stores a plain hour count, so the chosen unit is converted on save
// while the original number + unit are kept for display.
const ESTIMATE_UNITS = [['hours', 'Hours'], ['days', 'Days'], ['weeks', 'Weeks'], ['months', 'Months']];

const estimateInHours = (value, unit) => {
  const multipliers = { hours: 1, days: 24, weeks: 24 * 7, months: 24 * 30 };
  return Number(value || 0) * (multipliers[unit] || 1);
};

/** Deadline implied by an estimate, so the date field pre-fills sensibly. */
const addEstimateToNow = (value, unit) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  const deadline = new Date();
  if (unit === 'months') deadline.setMonth(deadline.getMonth() + amount);
  else if (unit === 'weeks') deadline.setDate(deadline.getDate() + amount * 7);
  else if (unit === 'days') deadline.setDate(deadline.getDate() + amount);
  else deadline.setHours(deadline.getHours() + amount);
  return toLocal(deadline);
};

// ---- Time remaining ------------------------------------------------------
/**
 * How long is left on a deadline, or how far past it, in hours and days.
 *
 * A date on its own does not answer the question an owner is actually
 * asking -- "08 Aug 2026, 20:58" needs today's date and some arithmetic
 * before it means anything. This turns it into "5 hours left" or "overdue by
 * 2 days".
 *
 * Grain follows the size of the gap: minutes inside an hour, hours inside two
 * days, then days. Anything finer reads as false precision on a deadline that
 * was set to the nearest hour in the first place.
 */
function formatGap(milliseconds) {
  const minutes = Math.round(Math.abs(milliseconds) / 60000);
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  if (hours < 48) {
    return remainderMinutes ? `${hours} hr ${remainderMinutes} min` : `${hours} hr`;
  }

  const days = Math.floor(hours / 24);
  const remainderHours = hours % 24;
  // Past a week the odd hours stop being useful.
  if (days >= 7 || !remainderHours) return `${days} days`;
  return `${days} days ${remainderHours} hr`;
}

/**
 * The countdown for one action item, or null when there is nothing to say.
 *
 * Returns null for items with no deadline and for ones already finished --
 * "overdue by 3 days" on a completed item is noise, and the work is done.
 */
function dueStatus(dueAt, { done = false, now = Date.now() } = {}) {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  if (done) return null;

  const remaining = due.getTime() - now;
  const gap = formatGap(remaining);
  if (remaining < 0) {
    return { overdue: true, label: `overdue by ${gap}`, short: `-${gap}`, tone: 'danger' };
  }
  return {
    overdue: false,
    label: `${gap} left`,
    short: gap,
    // Inside a day is the point at which it needs attention today.
    tone: remaining <= 24 * 60 * 60 * 1000 ? 'warning' : 'ok',
  };
}

/** Pill colours, matching the approval and stage chips already on screen. */
const DUE_TONES = {
  danger: 'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-800',
  ok: 'bg-emerald-100 text-emerald-700',
};

const richTextHasContent = value =>
  String(value || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;

/** Mirrors the server's allow-list so what is typed is what gets stored. */
const sanitizeRichText = value => {
  if (typeof window === 'undefined') return String(value || '');
  const documentValue = new DOMParser().parseFromString(String(value || ''), 'text/html');
  const allowed = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'DIV']);
  const clean = node => {
    [...node.children].forEach(child => {
      clean(child);
      if (!allowed.has(child.tagName)) child.replaceWith(...child.childNodes);
      else [...child.attributes].forEach(attribute => child.removeAttribute(attribute.name));
    });
  };
  clean(documentValue.body);
  return documentValue.body.innerHTML;
};

/** Meeting-notes editor: formatting toolbar over a contentEditable surface. */
function MomRichTextEditor({ value, onChange }) {
  const editorRef = useRef(null);
  const lastEmittedValueRef = useRef(null);
  const savedRangeRef = useRef(null);

  useEffect(() => {
    const nextValue = sanitizeRichText(value);
    // Skip the echo of our own emit, or the caret jumps to the end mid-typing.
    if (lastEmittedValueRef.current === nextValue) {
      lastEmittedValueRef.current = null;
      return;
    }
    if (editorRef.current && sanitizeRichText(editorRef.current.innerHTML) !== nextValue) {
      editorRef.current.innerHTML = nextValue;
    }
  }, [value]);

  const emitChange = () => {
    const nextValue = sanitizeRichText(editorRef.current?.innerHTML || '');
    lastEmittedValueRef.current = nextValue;
    onChange(nextValue);
  };

  const rememberSelection = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editorRef.current) return;
    const range = selection.getRangeAt(0);
    if (editorRef.current.contains(range.commonAncestorContainer)) savedRangeRef.current = range.cloneRange();
  };

  const command = (name, argument = null) => {
    if (!editorRef.current) return;
    editorRef.current.focus({ preventScroll: true });
    if (savedRangeRef.current) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(savedRangeRef.current);
    }
    document.execCommand(name, false, argument);
    rememberSelection();
    emitChange();
  };

  const tools = [
    ['bold', Bold, 'Bold'], ['underline', Underline, 'Underline'],
    ['insertUnorderedList', List, 'Bulleted list'], ['insertOrderedList', ListOrdered, 'Numbered list'],
    ['indent', IndentIncrease, 'Sub-point'], ['outdent', IndentDecrease, 'Move point out'],
  ];

  return (
    <div className="mom-rich-editor">
      <div className="mom-editor-toolbar">
        {tools.map(([name, Icon, label]) => (
          <button
            key={name} type="button" title={label} aria-label={label}
            onMouseDown={event => { event.preventDefault(); command(name); }}
          >
            <Icon />
          </button>
        ))}
      </div>
      <div
        ref={editorRef}
        className="mom-editor-content"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        tabIndex={0}
        spellCheck
        data-placeholder="Write the complete meeting discussion, decisions, observations, and notes here…"
        onInput={() => { rememberSelection(); emitChange(); }}
        onKeyUp={rememberSelection}
        onMouseUp={rememberSelection}
        onBlur={rememberSelection}
      />
    </div>
  );
}
const duration = minutes => `${Math.floor(Number(minutes || 0) / 60)}h ${Number(minutes || 0) % 60}m`;
const dateKey = value => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

// ---- Calendar view ------------------------------------------------------
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The weeks to draw for a month, padded out to whole weeks.
 *
 * Always starts on the Sunday on or before the 1st and ends on the Saturday
 * on or after the last day, so every row is seven cells. Trailing weeks that
 * belong entirely to the next month are dropped -- a six-row grid with a
 * blank last row is just empty space.
 */
function monthWeeks(cursor) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const start = new Date(year, month, 1 - new Date(year, month, 1).getDay());
  const weeks = [];
  for (let week = 0; week < 6; week += 1) {
    const days = Array.from({ length: 7 }, (_, index) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + index));
    // Stop once a whole row has run past the month.
    if (week > 3 && days.every(day => day.getMonth() !== month)) break;
    weeks.push(days);
  }
  return weeks;
}

export default function OperationsPageModern() {
  const { selectedUnit, loading: businessUnitLoading } = useBusinessUnit();
  const [config, setConfig] = useState(null);
  const [records, setRecords] = useState([]);
  const [users, setUsers] = useState([]);
  const [guestOwners, setGuestOwners] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [momSessions, setMomSessions] = useState([]);
  const [tab, setTab] = useState('tasks');
  const [taskView, setTaskView] = useState('list');
  const [calendarCursor, setCalendarCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  // The day whose items are listed under the grid, or null for none.
  const [calendarDay, setCalendarDay] = useState(null);
  const [search, setSearch] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [dueFilter, setDueFilter] = useState('');
  const [approvalFilter, setApprovalFilter] = useState('');
  const [message, setMessage] = useState(null);
  const [updatingStageId, setUpdatingStageId] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [viewingTask, setViewingTask] = useState(null);
  const [viewingTaskLoading, setViewingTaskLoading] = useState(false);
  const [approvalDetails, setApprovalDetails] = useState(null);
  const [approvalDetailsLoading, setApprovalDetailsLoading] = useState(false);
  const [approvalDecision, setApprovalDecision] = useState(null);
  const [approvalDecisionSaving, setApprovalDecisionSaving] = useState(false);
  const [approvalHistory, setApprovalHistory] = useState(null);
  const [approvalSearch, setApprovalSearch] = useState('');
  const [approvalStatusFilter, setApprovalStatusFilter] = useState('');
  const [approvalApproverFilter, setApprovalApproverFilter] = useState('');
  const [approvalDeciderFilter, setApprovalDeciderFilter] = useState('');
  const [approvalDateFrom, setApprovalDateFrom] = useState('');
  const [approvalDateTo, setApprovalDateTo] = useState('');
  const [momDateFrom, setMomDateFrom] = useState('');
  const [momDateTo, setMomDateTo] = useState('');
  const boardScrollRef = useRef(null);

  // MOM session composer. `momSession` is the session being appended to, or
  // null for a new one -- the API takes sessionId and handles both.
  const [momOpen, setMomOpen] = useState(false);
  // The MOM session whose action items are being viewed, or null.
  const [actionItemsSession, setActionItemsSession] = useState(null);
  const [momSession, setMomSession] = useState(null);
  const [momNotes, setMomNotes] = useState('');
  const [momItems, setMomItems] = useState([]);
  const [momSaving, setMomSaving] = useState(false);

  const openMomSession = (session = null) => {
    setMomSession(session && session.id ? session : null);
    setMomNotes(session?.notes ? sanitizeRichText(session.notes) : '');
    setMomItems([]);
    setMomOpen(true);
  };

  const addMomItem = () => setMomItems((items) => [
    ...items,
    { key: `${Date.now()}-${items.length}`, title: '', ownerEmployeeId: '', estimatedHours: '', estimateUnit: 'hours', dueAt: '', approvalRequired: false, approverUserIds: [] },
  ]);

  const patchMomItem = (key, values) => setMomItems((items) =>
    items.map((item) => (item.key === key ? { ...item, ...values } : item)));

  const removeMomItem = (key) => setMomItems((items) => items.filter((item) => item.key !== key));

  // Estimate and deadline move together: changing either re-derives the due
  // date, matching how the tracker computed it before.
  const updateMomEstimate = (key, value, unit) => patchMomItem(key, {
    estimatedHours: value || '',
    estimateUnit: unit || 'hours',
    dueAt: value ? addEstimateToNow(value, unit || 'hours') : '',
  });

  async function saveMomSession() {
    if (!richTextHasContent(momNotes)) {
      setMessage({ type: 'error', text: 'Meeting notes are required to save a MOM session' });
      return;
    }
    // The API rejects the whole batch if any item lacks an estimate, so catch
    // it here rather than losing the notes to a 400.
    const filled = momItems.filter((item) => item.title.trim());
    const missingEstimate = filled.find((item) => !(Number(item.estimatedHours) > 0));
    if (missingEstimate) {
      setMessage({ type: 'error', text: 'Every action item needs an estimated duration in hours' });
      return;
    }

    setMomSaving(true);
    try {
      const result = await api(`/platform/business-units/${selectedUnit.id}/operations/batch`, {
        method: 'POST',
        body: JSON.stringify({
          sessionId: momSession?.id || null,
          momNotes,
          items: filled.map((item) => ({
            title: item.title.trim(),
            ownerEmployeeId: Number(item.ownerEmployeeId) || null,
            minutesSpent: 0,
            dueAt: item.dueAt || undefined,
            approvalRequired: Boolean(item.approvalRequired),
            approverUserIds: item.approverUserIds || [],
            values: {
              estimatedHours: estimateInHours(item.estimatedHours, item.estimateUnit),
              estimatedDuration: Number(item.estimatedHours) || null,
              estimatedDurationUnit: item.estimateUnit || 'hours',
            },
          })),
        }),
      });
      setMomOpen(false);
      setMomSession(null);
      setMomNotes('');
      setMomItems([]);
      setMessage({ type: 'success', text: result.message || 'MOM session saved' });
      await load();
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setMomSaving(false);
    }
  }

  const changeTaskView = view => {
    setTaskView(view);
  };

  const scrollBoard = direction => {
    const board = boardScrollRef.current;
    if (!board) return;
    const column = board.querySelector('.tracker-board-column');
    const distance = (column?.getBoundingClientRect().width || 320) + 16;
    board.scrollBy({ left: direction * distance, behavior: 'smooth' });
  };

  const updateRecordStage = async (record, nextStageId) => {
    if (!nextStageId || String(nextStageId) === String(record.stageId)) return;
    setUpdatingStageId(record.id);
    try {
      await api(`/platform/business-units/${selectedUnit.id}/operations/${record.id}/stage`, {
        method: 'PUT',
        body: JSON.stringify({ stageId: Number(nextStageId) }),
      });
      setRecords(current => current.map(item => (
        item.id === record.id ? { ...item, stageId: Number(nextStageId) } : item
      )));
      setMessage({ type: 'success', text: 'Action status updated' });
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setUpdatingStageId(null);
    }
  };

  const openTaskEditor = record => setEditingTask({
    id: record.id,
    recordNumber: record.recordNumber,
    title: record.title || '',
    description: record.description || '',
    stageId: String(record.stageId || ''),
    ownerKey: record.ownerEmployeeId ? `employee:${record.ownerEmployeeId}` : `guest:${record.guestOwnerId}`,
    dueAt: toLocal(record.dueAt),
  });

  const saveTaskEdit = async event => {
    event.preventDefault();
    if (!editingTask) return;
    const [ownerType, ownerId] = editingTask.ownerKey.split(':');
    setEditSaving(true);
    try {
      await api(`/platform/business-units/${selectedUnit.id}/operations/${editingTask.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: editingTask.title.trim(),
          description: editingTask.description,
          stageId: Number(editingTask.stageId),
          ownerEmployeeId: ownerType === 'employee' ? Number(ownerId) : null,
          guestOwnerId: ownerType === 'guest' ? Number(ownerId) : null,
          dueAt: editingTask.dueAt,
        }),
      });
      setEditingTask(null);
      setMessage({ type: 'success', text: 'Action item updated' });
      await load();
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setEditSaving(false);
    }
  };

  const openApprovalDetails = async record => {
    setApprovalDetails({ record, approvals: [] });
    setApprovalDetailsLoading(true);
    try {
      const result = await api(`/platform/business-units/${selectedUnit.id}/operations/${record.id}`);
      setApprovalDetails({ record, approvals: result.data?.approvals || [] });
    } catch (error) {
      setApprovalDetails(null);
      setMessage({ type: 'error', text: error.message });
    } finally {
      setApprovalDetailsLoading(false);
    }
  };

  const openTaskDetails = async record => {
    setViewingTask({ record, details: null });
    setViewingTaskLoading(true);
    try {
      const result = await api(`/platform/business-units/${selectedUnit.id}/operations/${record.id}`);
      setViewingTask({ record: { ...record, ...(result.data || {}) }, details: result.data || {} });
    } catch (error) {
      setViewingTask(null);
      setMessage({ type: 'error', text: error.message });
    } finally {
      setViewingTaskLoading(false);
    }
  };

  const handleActionApprovalClick = record => {
    const related = approvals.filter(item => Number(item.recordId) === Number(record.id));
    if (record.approvalStatus === 'pending') {
      openApprovalDetails(record);
      return;
    }
    const decided = related.find(item => item.decision === record.approvalStatus)
      || related.find(item => item.decision !== 'pending');
    if (decided) {
      setApprovalHistory(decided);
      return;
    }
    // Retain a useful fallback for older records whose decision audit is not
    // visible to this login.
    openApprovalDetails(record);
  };

  const submitApprovalDecision = async event => {
    event.preventDefault();
    if (!approvalDecision) return;
    setApprovalDecisionSaving(true);
    try {
      await api(`/platform/business-units/${selectedUnit.id}/tracker-approvals/${approvalDecision.id}/decision`, {
        method: 'PUT',
        body: JSON.stringify({ decision: approvalDecision.decision, remarks: approvalDecision.remarks }),
      });
      setApprovalDecision(null);
      setMessage({ type: 'success', text: `Action item ${approvalDecision.decision}` });
      await load();
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setApprovalDecisionSaving(false);
    }
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
  const approvalApprovers = useMemo(() => [...new Set(approvals.map(item => item.approver).filter(Boolean))].sort(), [approvals]);
  const approvalDeciders = useMemo(() => [...new Set(approvals.map(item => item.decidedBy).filter(Boolean))].sort(), [approvals]);
  const visibleApprovals = useMemo(() => {
    const query = approvalSearch.trim().toLowerCase();
    return approvals.filter(item => {
      const searchable = `${item.title || ''} ${item.recordNumber || ''} ${item.owner || ''}`.toLowerCase();
      const requestedDate = item.requestedAt ? dateKey(item.requestedAt) : '';
      return (!query || searchable.includes(query)) &&
        (!approvalStatusFilter || item.decision === approvalStatusFilter) &&
        (!approvalApproverFilter || item.approver === approvalApproverFilter) &&
        (!approvalDeciderFilter || item.decidedBy === approvalDeciderFilter) &&
        (!approvalDateFrom || (requestedDate && requestedDate >= approvalDateFrom)) &&
        (!approvalDateTo || (requestedDate && requestedDate <= approvalDateTo));
    });
  }, [approvals, approvalSearch, approvalStatusFilter, approvalApproverFilter, approvalDeciderFilter, approvalDateFrom, approvalDateTo]);

  const exportApprovals = () => {
    const fields = [
      ['Record Number', 'recordNumber'], ['Action Item', 'title'], ['Owner', 'owner'],
      ['Approver', 'approver'], ['Decision Login', 'decidedBy'], ['Status', 'decision'],
      ['Request Date', 'requestedAt'], ['Decision Date', 'decidedAt'], ['Remarks', 'remarks'],
    ];
    const escapeCsv = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = visibleApprovals.map(item => fields.map(([, key]) => {
      const value = ['requestedAt', 'decidedAt'].includes(key) && item[key]
        ? new Date(item[key]).toLocaleString('en-GB') : item[key];
      return escapeCsv(value);
    }).join(','));
    const csv = [fields.map(([label]) => escapeCsv(label)).join(','), ...rows].join('\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `approvals-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const visibleMomSessions = useMemo(() => {
    return momSessions.filter(session => {
      const recordedDate = session.endedAt ? dateKey(session.endedAt) : '';
      return (!momDateFrom || (recordedDate && recordedDate >= momDateFrom)) &&
        (!momDateTo || (recordedDate && recordedDate <= momDateTo));
    });
  }, [momSessions, momDateFrom, momDateTo]);

  const exportActionItems = () => {
    const fields = [
      ['Record Number', record => record.recordNumber], ['Action Item', record => record.title],
      ['Description', record => record.description], ['Tracker', record => record.workflow],
      ['Status', record => stages.find(stage => String(stage.id) === String(record.stageId))?.displayName || record.stage],
      ['Owner', record => record.owner],
      ['Deadline', record => record.dueAt ? new Date(record.dueAt).toLocaleString('en-GB') : ''],
      ['Estimated Hours', record => record.customValues?.estimatedHours],
      ['Time Recorded', record => duration(record.minutesSpent)],
      ['Approval Required', record => record.approvalRequired ? 'Yes' : 'No'],
      ['Approval Status', record => record.approvalStatus],
    ];
    const escapeCsv = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csvRows = visible.map(record => fields.map(([, read]) => escapeCsv(read(record))).join(','));
    const csv = [fields.map(([label]) => escapeCsv(label)).join(','), ...csvRows].join('\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `action-items-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const terminalStageIds = useMemo(() => new Set(
    (config?.operationStages || [])
      .filter(stage => ['completed', 'cancelled'].includes(stage.stageType))
      .map(stage => String(stage.id)),
  ), [config?.operationStages]);
  const overdueRecords = useMemo(() => visible
    .filter(record => record.dueAt && new Date(record.dueAt) < new Date() && !terminalStageIds.has(String(record.stageId)))
    .sort((left, right) => new Date(left.dueAt) - new Date(right.dueAt)), [visible, terminalStageIds]);
  const pendingActions = useMemo(() => visible
    .filter(record => !terminalStageIds.has(String(record.stageId))).length, [visible, terminalStageIds]);
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

      {/* Content starts directly below the universal bar; the page title now
          lives in the topbar breadcrumbs. Refresh moved in beside the tabs. */}
      <PageContainer className="py-6">
        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex items-center gap-3 mb-8">
            <TabsList className="grid flex-1 grid-cols-3">
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
            <Button onClick={load} variant="secondary" className="flex-shrink-0">
              <RefreshCw size={16} />
              Refresh
            </Button>
          </div>

          <TabsContent value="tasks" className="space-y-6">
            {/* Summary Stats */}
            <div className="tracker-summary grid gap-4">
              <StatCard
                label="Action Items"
                value={visible.length}
                icon={Workflow}
                color="blue"
              />
              <StatCard
                label="Pending Actions"
                value={pendingActions}
                icon={ListChecks}
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
                <div>
                  {/* Search, filters and view controls stay in one compact row. */}
                  <div className="tracker-filter-toolbar">
                    {/* Search */}
                    <div className="tracker-toolbar-search relative">
                      <Search size={16} className="absolute left-3 top-3 text-secondary-400 pointer-events-none" />
                      <Input
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                        placeholder="Search action items…"
                        className="pl-9"
                      />
                    </div>

                    {/* Filters */}
                    <div className="tracker-filter-fields">
                      {workflows.length > 1 && (
                        <div className="tracker-filter-field tracker-workflow-filter space-y-1">
                          <label className="text-xs font-semibold text-secondary-600">Tracker</label>
                          <Select value={workflowId} onChange={event => { setWorkflowId(event.target.value); setStageFilter(''); }}>
                            {workflows.map(workflow => (
                              <option key={workflow.id} value={workflow.id}>{workflow.displayName}</option>
                            ))}
                          </Select>
                        </div>
                      )}
                      <div className="tracker-filter-field tracker-status-filter space-y-1">
                        <label className="text-xs font-semibold text-secondary-600">Status</label>
                        <Select value={stageFilter} onChange={event => setStageFilter(event.target.value)}>
                          <option value="">All statuses</option>
                          {stages.map(stage => (
                            <option key={stage.id} value={stage.id}>{stage.displayName}</option>
                          ))}
                        </Select>
                      </div>
                      <div className="tracker-filter-field tracker-owner-filter space-y-1">
                        <label className="text-xs font-semibold text-secondary-600">Owner</label>
                        <Select value={ownerFilter} onChange={event => setOwnerFilter(event.target.value)}>
                          <option value="">All owners</option>
                          {ownerOptions.map(owner => (
                            <option key={owner} value={owner}>{owner}</option>
                          ))}
                        </Select>
                      </div>
                      <div className="tracker-filter-field tracker-deadline-filter space-y-1">
                        <label className="text-xs font-semibold text-secondary-600">Deadline</label>
                        <Select value={dueFilter} onChange={event => setDueFilter(event.target.value)}>
                          <option value="">All deadlines</option>
                          <option value="overdue">Overdue</option>
                          <option value="today">Due today</option>
                          <option value="upcoming">Upcoming</option>
                          <option value="unscheduled">Unscheduled</option>
                        </Select>
                      </div>
                      <div className="tracker-filter-field tracker-approval-filter space-y-1">
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

                  {/* Compact view toggle: List is the default and appears first. */}
                  <div className="tracker-view-icons" aria-label="Tracker view">
                    <Button
                      variant={taskView === 'list' ? 'primary' : 'secondary'}
                      size="icon"
                      onClick={() => changeTaskView('list')}
                      title="List view"
                      aria-label="List view"
                    >
                      <ListTree size={16} />
                    </Button>
                    <Button
                      variant={taskView === 'board' ? 'primary' : 'secondary'}
                      size="icon"
                      onClick={() => changeTaskView('board')}
                      title="Board view"
                      aria-label="Board view"
                    >
                      <Columns3 size={16} />
                    </Button>
                    <Button
                      variant={taskView === 'calendar' ? 'primary' : 'secondary'}
                      size="icon"
                      onClick={() => changeTaskView('calendar')}
                      title="Calendar view"
                      aria-label="Calendar view"
                    >
                      <CalendarDays size={16} />
                    </Button>
                    <Button
                      variant="secondary"
                      size="icon"
                      onClick={exportActionItems}
                      disabled={!visible.length}
                      title="Export filtered action items"
                      aria-label="Export filtered action items"
                    >
                      <Download size={16} />
                    </Button>
                  </div>
                </div>
              </div>
              </CardContent>
            </Card>

            {/* View Content */}
            {taskView === 'board' && (
              <div className="tracker-board-workspace">
                <div className="tracker-board-nav" aria-label="Scroll board columns">
                  <span>Process stages</span>
                  <div>
                    <button type="button" onClick={() => scrollBoard(-1)} title="Scroll board left" aria-label="Scroll board left"><ChevronLeft size={17} /></button>
                    <button type="button" onClick={() => scrollBoard(1)} title="Scroll board right" aria-label="Scroll board right"><ChevronRight size={17} /></button>
                  </div>
                </div>
              <div className="tracker-board-scroll" ref={boardScrollRef}>
                {stages.length === 0 ? (
                  <div className="tracker-board-empty flex items-center justify-center py-12 bg-white rounded-lg border border-border">
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
                      <Card key={stage.id} className="tracker-board-column">
                        <CardHeader className="tracker-board-stage-head" style={{ borderTopColor: stage.color, borderTopWidth: '4px' }}>
                          <CardTitle className="text-base">{stage.displayName}</CardTitle>
                          <CardDescription>{stageRecords.length} items</CardDescription>
                        </CardHeader>
                        <CardContent className="tracker-board-column-body p-0">
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
                                    record.dueAt && new Date(record.dueAt) < new Date() && !terminalStageIds.has(String(record.stageId)) ? 'bg-red-50' : 'bg-secondary-50'
                                  )}
                                >
                                  <div className="flex justify-between items-start gap-2">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-mono text-primary-600 mb-1">{record.recordNumber}</p>
                                      <p className="font-medium text-sm text-foreground truncate">{record.title}</p>
                                      <p className="text-xs text-secondary-600 line-clamp-2">{record.description || 'No description'}</p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => openTaskDetails(record)}
                                      className="inline-grid place-items-center w-8 h-8 flex-none rounded-lg border border-border bg-white text-primary-700 hover:bg-primary-50"
                                      title="View action item"
                                      aria-label={`View ${record.title}`}
                                    ><Eye size={15} /></button>
                                  </div>
                                  <div className="mt-3 space-y-1 text-xs text-secondary-600">
                                    <div className="flex items-center gap-2">
                                      <Users size={14} />
                                      <span>{record.owner}</span>
                                    </div>
                                    {record.dueAt && (() => {
                                      const status = dueStatus(record.dueAt, {
                                        done: terminalStageIds.has(String(record.stageId)),
                                      });
                                      return (
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <CalendarClock size={14} />
                                          <span>{new Date(record.dueAt).toLocaleDateString()}</span>
                                          {status && (
                                            <span className={cn(
                                              'px-1.5 py-0.5 rounded text-[10.5px] font-semibold',
                                              DUE_TONES[status.tone],
                                            )}>
                                              {status.label}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })()}
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
                                  <label className="tracker-board-status-control">
                                    <span>Status</span>
                                    <select
                                      value={record.stageId}
                                      disabled={updatingStageId === record.id}
                                      onChange={event => updateRecordStage(record, event.target.value)}
                                      aria-label={`Change status for ${record.title}`}
                                    >
                                      {stages.map(option => (
                                        <option key={option.id} value={option.id}>{option.displayName}</option>
                                      ))}
                                    </select>
                                  </label>
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
              </div>
            )}

            {taskView === 'list' && (
              <Card>
                <CardContent className="p-0">
                  <div className="tracker-list-scroll">
                    <table className="w-full">
                      <thead className="tracker-list-sticky-head bg-secondary-50 border-b border-border">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700">Action Item</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700">Owner</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700">Status</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700">Deadline</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-secondary-700">Approval</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-secondary-700">Actions</th>
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
                                record.dueAt && new Date(record.dueAt) < new Date() && !terminalStageIds.has(String(record.stageId)) ? 'bg-red-50' : ''
                              )}
                            >
                              <td className="px-4 py-3">
                                <div>
                                  <p className="font-medium text-sm text-foreground">{record.title}</p>
                                  <p className="text-xs font-mono text-primary-600">{record.recordNumber}</p>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="grid gap-1">
                                  <span className="text-sm text-foreground">{record.owner}</span>
                                  <small className="text-[11px] leading-4 text-secondary-500 whitespace-nowrap">
                                    {actionCreatedLabel(record.createdAt)}
                                  </small>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                {(() => {
                                  const stage = stages.find(item => String(item.id) === String(record.stageId));
                                  const stageColor = stage?.color || '#087a52';
                                  return (
                                    <span
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold"
                                      style={{
                                        color: stageColor,
                                        borderColor: `color-mix(in srgb, ${stageColor} 38%, transparent)`,
                                        backgroundColor: `color-mix(in srgb, ${stageColor} 12%, white)`,
                                      }}
                                    >
                                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stageColor }} />
                                      {stage?.displayName || 'Unknown'}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td className="px-4 py-3 text-sm text-foreground">
                                {record.dueAt ? new Date(record.dueAt).toLocaleDateString() : '—'}
                                {(() => {
                                  const status = dueStatus(record.dueAt, {
                                    done: terminalStageIds.has(String(record.stageId)),
                                  });
                                  return status ? (
                                    <span className={cn(
                                      'block mt-0.5 text-[11px] font-semibold',
                                      status.overdue ? 'text-red-600'
                                        : status.tone === 'warning' ? 'text-amber-700' : 'text-secondary-500',
                                    )}>
                                      {status.label}
                                    </span>
                                  ) : null;
                                })()}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {!record.approvalRequired ? (
                                  <span className="text-secondary-500" title="Approval not required">—</span>
                                ) : (() => {
                                  const approvalLabel = record.approvalRequired
                                    ? `Approval ${record.approvalStatus.replace(/_/g, ' ')}`
                                    : 'Approval not required';
                                  return (
                                    <button
                                      type="button"
                                      className={cn(
                                        'inline-grid place-items-center w-8 h-8 rounded-full border shadow-sm transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary-300',
                                        record.approvalStatus === 'approved' ? 'bg-emerald-100 text-emerald-700 border-emerald-300' :
                                        record.approvalStatus === 'rejected' ? 'bg-red-100 text-red-700 border-red-300' :
                                        'bg-amber-100 text-amber-700 border-amber-300'
                                      )}
                                      title={approvalLabel}
                                      aria-label={approvalLabel}
                                      onClick={() => handleActionApprovalClick(record)}
                                    >
                                      {record.approvalStatus === 'rejected' ? <X size={16} /> :
                                        record.approvalStatus === 'pending' ? <Clock3 size={16} /> :
                                        <ClipboardCheck size={16} />}
                                    </button>
                                  );
                                })()}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <Button variant="secondary" size="icon" onClick={() => openTaskDetails(record)} title="View action item" aria-label={`View ${record.title}`}>
                                    <Eye size={15} />
                                  </Button>
                                  <Button variant="secondary" size="icon" onClick={() => openTaskEditor(record)} title="Edit action item" aria-label={`Edit ${record.title}`}>
                                    <Pencil size={15} />
                                  </Button>
                                </div>
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
                  {(() => {
                    /*
                     * Action items placed on the day they are due.
                     *
                     * Built from `visible`, so the search box and the four
                     * filters above narrow the calendar exactly as they narrow
                     * the board and the list -- a calendar that ignored them
                     * would disagree with the view beside it.
                     */
                    const weeks = monthWeeks(calendarCursor);
                    const month = calendarCursor.getMonth();
                    const todayKey = dateKey(new Date());

                    const byDay = new Map();
                    let unscheduled = 0;
                    for (const record of visible) {
                      if (!record.dueAt) { unscheduled += 1; continue; }
                      const key = dateKey(record.dueAt);
                      if (!key) { unscheduled += 1; continue; }
                      if (!byDay.has(key)) byDay.set(key, []);
                      byDay.get(key).push(record);
                    }
                    for (const list of byDay.values()) {
                      list.sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
                    }

                    const inMonth = [...byDay.entries()]
                      .filter(([key]) => Number(key.slice(5, 7)) - 1 === month && Number(key.slice(0, 4)) === calendarCursor.getFullYear())
                      .reduce((sum, [, list]) => sum + list.length, 0);

                    const chipTone = (record) => {
                      const done = terminalStageIds.has(String(record.stageId));
                      if (done) return 'bg-secondary-100 text-secondary-500 line-through';
                      const status = dueStatus(record.dueAt, { done });
                      if (status?.overdue) return 'bg-red-100 text-red-700';
                      if (status?.tone === 'warning') return 'bg-amber-100 text-amber-800';
                      return 'bg-primary-50 text-primary-700';
                    };

                    const selected = calendarDay ? (byDay.get(calendarDay) || []) : [];

                    return (
                      <div className="grid gap-4 items-start xl:grid-cols-[minmax(0,1fr)_290px]">
                        <div className="min-w-0">
                        <div className="grid grid-cols-7 gap-px mb-px">
                          {WEEKDAYS.map(day => (
                            <div key={day} className="px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-secondary-500">
                              {day}
                            </div>
                          ))}
                        </div>

                        <div className="grid grid-cols-7 gap-px bg-border border border-border rounded-lg overflow-hidden">
                          {weeks.flat().map(day => {
                            const key = dateKey(day);
                            const items = byDay.get(key) || [];
                            const outside = day.getMonth() !== month;
                            const isToday = key === todayKey;
                            const isSelected = key === calendarDay;
                            return (
                              <button
                                type="button"
                                key={key}
                                onClick={() => setCalendarDay(current => (current === key ? null : key))}
                                aria-pressed={isSelected}
                                aria-label={`${day.toDateString()}, ${items.length} action item${items.length === 1 ? '' : 's'}`}
                                className={cn(
                                  'tracker-cal-day transition-colors',
                                  outside ? 'bg-surface-3' : 'bg-white hover:bg-surface-3',
                                  isSelected && 'ring-2 ring-inset ring-primary-500',
                                )}
                              >
                                <span className={cn(
                                  'inline-grid place-items-center w-6 h-6 rounded-full text-[11.5px] font-semibold mb-1',
                                  isToday ? 'bg-primary-600 text-white'
                                    : outside ? 'text-secondary-300' : 'text-secondary-600',
                                )}>
                                  {day.getDate()}
                                </span>

                                <span className="block space-y-0.5">
                                  {items.slice(0, 3).map(record => (
                                    <span
                                      key={record.id}
                                      title={`${record.title} · ${record.owner || 'Unassigned'}`}
                                      className={cn(
                                        'tracker-cal-chip block px-1.5 py-0.5 rounded text-[10.5px] font-semibold truncate',
                                        chipTone(record),
                                      )}
                                    >
                                      {record.title}
                                    </span>
                                  ))}
                                  {items.length > 3 && (
                                    <span className="block px-1.5 text-[10.5px] font-semibold text-secondary-500">
                                      +{items.length - 3} more
                                    </span>
                                  )}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        <div className="flex items-center justify-between gap-3 flex-wrap mt-3 text-xs text-secondary-600">
                          <span>
                            {inMonth} action item{inMonth === 1 ? '' : 's'} due in {calendarCursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                          </span>
                          {/* Items with no deadline never appear on a calendar,
                              so say how many are missing rather than let them
                              vanish between the views. */}
                          {unscheduled > 0 && (
                            <span className="text-secondary-500">
                              {unscheduled} unscheduled item{unscheduled === 1 ? '' : 's'} not shown
                            </span>
                          )}
                        </div>

                        {calendarDay && (
                          <div className="mt-4 pt-3 border-t border-border">
                            <div className="flex items-center justify-between gap-3 mb-2">
                              <h4 className="font-semibold text-sm text-foreground">
                                {new Date(calendarDay).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                              </h4>
                              <button
                                type="button"
                                className="text-xs font-semibold text-primary-600 hover:text-primary-700"
                                onClick={() => setCalendarDay(null)}
                              >
                                Clear
                              </button>
                            </div>
                            {selected.length === 0 ? (
                              <p className="text-sm text-secondary-500 py-2">Nothing due on this day.</p>
                            ) : (
                              <div className="space-y-2">
                                {selected.map(record => {
                                  const done = terminalStageIds.has(String(record.stageId));
                                  const status = dueStatus(record.dueAt, { done });
                                  return (
                                    <div key={record.id} className="flex items-start justify-between gap-3 p-2.5 rounded-lg border border-border bg-surface-3">
                                      <div className="min-w-0">
                                        <p className="font-mono text-[11px] text-primary-600">{record.recordNumber}</p>
                                        <p className="font-medium text-sm text-foreground truncate">{record.title}</p>
                                        <p className="text-xs text-secondary-600">
                                          {record.owner || 'Unassigned'}
                                          {' · '}
                                          {new Date(record.dueAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                      </div>
                                      <div className="flex items-center gap-1.5 flex-none">
                                        {status && (
                                          <span className={cn('px-2 py-0.5 rounded-full text-[10.5px] font-semibold', DUE_TONES[status.tone])}>
                                            {status.label}
                                          </span>
                                        )}
                                        <span className="px-2 py-0.5 rounded text-[10.5px] font-semibold bg-primary-100 text-primary-700">
                                          {stages.find(s => s.id === record.stageId)?.displayName}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                        </div>

                        {/* Overdue, beside the month rather than inside it.
                            Anything late is by definition on a day the grid
                            may have scrolled past, so the one list that must
                            stay in view does not move with the cursor. */}
                        <aside className="rounded-xl border border-border overflow-hidden">
                          <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border-b border-border">
                            <CalendarClock size={15} className="text-red-600 flex-none" />
                            <h4 className="font-semibold text-[13px] text-red-700">Overdue</h4>
                            <span className="ml-auto px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-bold">
                              {overdueRecords.length}
                            </span>
                          </div>

                          {overdueRecords.length === 0 ? (
                            <p className="px-3 py-5 text-sm text-secondary-500 text-center">
                              Nothing overdue.
                            </p>
                          ) : (
                            // Oldest first: the longer something has been late,
                            // the more it wants doing.
                            <div className="max-h-[520px] overflow-y-auto divide-y divide-border">
                              {overdueRecords.map(record => {
                                const status = dueStatus(record.dueAt, { done: false });
                                const key = dateKey(record.dueAt);
                                return (
                                  <button
                                    type="button"
                                    key={record.id}
                                    // Jumps the grid to the month it was due in
                                    // and selects that day.
                                    onClick={() => {
                                      const due = new Date(record.dueAt);
                                      setCalendarCursor(new Date(due.getFullYear(), due.getMonth(), 1));
                                      setCalendarDay(key);
                                    }}
                                    className="tracker-overdue-row w-full text-left px-3 py-2.5 hover:bg-surface-3 transition-colors"
                                  >
                                    <span className="block font-mono text-[10.5px] text-primary-600">{record.recordNumber}</span>
                                    <span className="block font-medium text-[13px] text-foreground truncate">{record.title}</span>
                                    <span className="block text-[11.5px] text-secondary-600 truncate">
                                      {record.owner || 'Unassigned'}
                                    </span>
                                    <span className="flex items-center gap-1.5 mt-1 flex-wrap">
                                      <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10.5px] font-bold">
                                        {status?.label || 'overdue'}
                                      </span>
                                      <span className="text-[10.5px] text-secondary-500">
                                        due {new Date(record.dueAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                      </span>
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </aside>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="mom" className="py-4">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <p className="text-sm text-secondary-600">
                {visibleMomSessions.length} of {momSessions.length} session{momSessions.length === 1 ? '' : 's'} recorded
              </p>
              <div className="flex items-center gap-2">
                <div className="w-52">
                  <DateRangeFilterControl
                    label="Recorded Date"
                    from={momDateFrom}
                    to={momDateTo}
                    includeFuturePresets={false}
                    onChange={(from, to) => { setMomDateFrom(from); setMomDateTo(to); }}
                  />
                </div>
                <Button onClick={openMomSession} disabled={!workflows.length}>
                  <Plus size={16} />
                  Start New Session
                </Button>
              </div>
            </div>

            {!workflows.length && (
              <p className="text-xs text-danger mb-3">
                Configure at least one Tracker status before starting a MOM session.
              </p>
            )}

            {visibleMomSessions.length === 0 ? (
              <Card>
                <CardContent className="py-12">
                  <div className="text-center">
                    <FileText size={32} className="mx-auto mb-3 opacity-50 text-secondary-600" />
                    <p className="font-medium text-foreground mb-1">{momSessions.length ? 'No MOM records match this date filter' : 'No MOM records yet'}</p>
                    <p className="text-secondary-600 text-sm">
                      Record meeting notes and assign action items in one go.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {visibleMomSessions.map((session) => (
                  <Card key={session.id}>
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-foreground">{session.sessionNumber}</div>
                          <div className="text-xs text-secondary-500 mt-0.5">
                            {session.createdBy}
                            {session.endedAt && ` · ${new Date(session.endedAt).toLocaleString('en-GB', {
                              day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}`}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {/* Clickable only when there is something to show, so
                              the badge never opens an empty dialog. */}
                          {Number(session.actionItemCount) > 0 ? (
                            <button
                              type="button"
                              onClick={() => setActionItemsSession(session)}
                              title="View the action items raised in this session"
                              className="px-2.5 py-1 rounded-full bg-primary-50 text-primary-700 text-[10.5px] font-bold hover:bg-primary-100 hover:underline transition-colors"
                            >
                              {session.actionItemCount} action item{Number(session.actionItemCount) === 1 ? '' : 's'}
                            </button>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full bg-secondary-100 text-secondary-500 text-[10.5px] font-bold">
                              No action items
                            </span>
                          )}
                          <Button variant="secondary" onClick={() => openMomSession(session)}>
                            Add to session
                          </Button>
                        </div>
                      </div>
                      {session.notes && (
                        <div
                          className="mt-3 pt-3 border-t border-line-2 text-[12.5px] text-secondary-600 line-clamp-3"
                          // Notes are stored as sanitised rich text by the API.
                          dangerouslySetInnerHTML={{ __html: session.notes }}
                        />
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="approvals" className="py-4">
            {approvals.length === 0 ? (
              <Card>
                <CardContent className="py-12">
                  <div className="text-center">
                    <ClipboardCheck size={32} className="mx-auto mb-3 opacity-50 text-secondary-600" />
                    <p className="font-medium text-foreground mb-1">My Approvals</p>
                    <p className="text-secondary-600 text-sm">No approvals assigned to you</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-secondary-600">
                    {visibleApprovals.length} of {approvals.length} assigned approval{approvals.length === 1 ? '' : 's'}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">{pendingApprovals} pending</span>
                    <Button variant="secondary" size="sm" onClick={exportApprovals} disabled={!visibleApprovals.length}>
                      <Download size={14} /> Export
                    </Button>
                  </div>
                </div>
                <Card>
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                      <div className="relative flex-[1.5_0_220px] min-w-[220px]">
                        <Search size={15} className="absolute left-3 top-3 text-secondary-400" />
                        <Input value={approvalSearch} onChange={event => setApprovalSearch(event.target.value)} placeholder="Search action or record…" className="pl-9" />
                      </div>
                      <Select className="flex-[1_0_145px] min-w-[145px]" value={approvalStatusFilter} onChange={event => setApprovalStatusFilter(event.target.value)} aria-label="Filter approval status">
                        <option value="">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
                      </Select>
                      <Select className="flex-[1_0_155px] min-w-[155px]" value={approvalApproverFilter} onChange={event => setApprovalApproverFilter(event.target.value)} aria-label="Filter approver">
                        <option value="">All approvers</option>{approvalApprovers.map(name => <option key={name} value={name}>{name}</option>)}
                      </Select>
                      <Select className="flex-[1_0_165px] min-w-[165px]" value={approvalDeciderFilter} onChange={event => setApprovalDeciderFilter(event.target.value)} aria-label="Filter decision login">
                        <option value="">All decision logins</option>{approvalDeciders.map(name => <option key={name} value={name}>{name}</option>)}
                      </Select>
                      <div className="flex-[1_0_190px] min-w-[190px]">
                        <DateRangeFilterControl label="Request Date" from={approvalDateFrom} to={approvalDateTo} onChange={(from, to) => { setApprovalDateFrom(from); setApprovalDateTo(to); }} />
                      </div>
                      <Button
                        variant="secondary" size="icon" className="flex-none"
                        onClick={() => { setApprovalSearch(''); setApprovalStatusFilter(''); setApprovalApproverFilter(''); setApprovalDeciderFilter(''); setApprovalDateFrom(''); setApprovalDateTo(''); }}
                        title="Clear approval filters"
                        aria-label="Clear approval filters"
                      ><RefreshCw size={15} /></Button>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-0 overflow-x-auto">
                    <table className="w-full min-w-[1020px]">
                      <thead className="bg-secondary-50 border-b border-border">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700">Action item</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700">Owner</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700">Approver</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700">Decision Login</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700">Request Date</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-700">Status</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-secondary-700">Decision</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {visibleApprovals.length === 0 ? (
                          <tr><td colSpan="7" className="px-4 py-10 text-center text-sm text-secondary-500">No approvals match the selected filters.</td></tr>
                        ) : visibleApprovals.map(approval => (
                          <tr key={approval.id} className="hover:bg-secondary-50">
                            <td className="px-4 py-3">
                              <p className="font-semibold text-sm">{approval.title}</p>
                              <p className="text-xs font-mono text-primary-600">{approval.recordNumber}</p>
                            </td>
                            <td className="px-4 py-3 text-sm">{approval.owner}</td>
                            <td className="px-4 py-3 text-sm font-semibold">{approval.approver || '—'}</td>
                            <td className="px-4 py-3 text-sm">
                              <span className="block">{approval.decidedBy || (approval.decision === 'pending' ? 'Awaiting decision' : '—')}</span>
                              {approval.decidedAt && (
                                <span className="block mt-0.5 text-[11px] text-secondary-500">
                                  {new Date(approval.decidedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {approval.requestedAt
                                ? new Date(approval.requestedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
                                : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <span className={cn(
                                'inline-flex px-2.5 py-1 rounded-full text-xs font-semibold capitalize',
                                approval.decision === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                                approval.decision === 'rejected' ? 'bg-red-100 text-red-700' :
                                'bg-amber-100 text-amber-700'
                              )}>{approval.decision}</span>
                            </td>
                            <td className="px-4 py-3">
                              {approval.decision === 'pending' ? (
                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setApprovalDecision({ ...approval, decision: 'approved', remarks: '' })}
                                    title="Approve"
                                    aria-label={`Approve ${approval.title}`}
                                    className="inline-grid place-items-center w-8 h-8 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                                  >
                                    <Check size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setApprovalDecision({ ...approval, decision: 'rejected', remarks: '' })}
                                    title="Reject"
                                    aria-label={`Reject ${approval.title}`}
                                    className="inline-grid place-items-center w-8 h-8 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex justify-end">
                                  <button
                                    type="button"
                                    onClick={() => setApprovalHistory(approval)}
                                    title="View approval details"
                                    aria-label={`View approval details for ${approval.title}`}
                                    className="inline-grid place-items-center w-8 h-8 rounded-lg border border-border text-primary-700 hover:bg-primary-50"
                                  >
                                    <Eye size={14} />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </PageContainer>

      {/* Action items raised in one MOM session.
          Reads the points the sessions endpoint already returns, so opening it
          costs no extra request. Points without a linked record are discussion
          notes rather than action items and are left to the card's summary. */}
      {actionItemsSession && (
        <div
          className="fixed inset-0 z-[200] grid place-items-center p-6 bg-secondary-900/50"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setActionItemsSession(null); }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="mom-action-items-title"
        >
          <div className="w-full max-w-3xl max-h-[86vh] flex flex-col rounded-2xl bg-white border border-border shadow-lg overflow-hidden">
            <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-border">
              <div className="min-w-0">
                <span className="text-[11px] font-bold uppercase tracking-wider text-primary-600">MOM session</span>
                <h3 id="mom-action-items-title" className="font-display font-bold text-base text-foreground">
                  Action items
                </h3>
                <p className="text-xs text-secondary-500 mt-0.5 truncate">
                  {actionItemsSession.sessionNumber} · {actionItemsSession.createdBy}
                  {actionItemsSession.endedAt && ` · ${new Date(actionItemsSession.endedAt).toLocaleString('en-GB', {
                    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}`}
                </p>
              </div>
              <button
                onClick={() => setActionItemsSession(null)}
                className="grid place-items-center w-8 h-8 rounded-[10px] text-secondary-500 hover:bg-surface-3 hover:text-foreground transition-colors flex-shrink-0"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-6 py-5 overflow-y-auto space-y-3">
              {(() => {
                const items = (actionItemsSession.points || []).filter((point) => point.operationRecordId);
                if (!items.length) {
                  return (
                    <p className="text-sm text-secondary-600 py-6 text-center">
                      This session recorded notes but no action items.
                    </p>
                  );
                }
                return items.map((item, index) => {
                  const due = item.dueAt ? new Date(item.dueAt) : null;
                  // "Overdue" only means anything while the item is still open.
                  const done = item.statusKey === 'completed' || item.statusKey === 'cancelled';
                  const status = dueStatus(item.dueAt, { done });
                  const overdue = Boolean(status?.overdue);
                  return (
                    <div key={item.id} className="rounded-xl border border-border overflow-hidden">
                      <div className="flex items-start justify-between gap-3 flex-wrap px-4 py-3 bg-surface-3 border-b border-border">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-foreground">
                            {index + 1}. {item.actionItem || 'Untitled action item'}
                          </div>
                          {item.recordNumber && (
                            <div className="text-[11px] text-secondary-500 font-mono mt-0.5">{item.recordNumber}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {/* The countdown leads, because it is the thing that
                              decides whether this item needs doing now. */}
                          {status && (
                            <span className={cn(
                              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold',
                              DUE_TONES[status.tone],
                            )}>
                              <Timer size={11} />
                              {status.label}
                            </span>
                          )}
                          {item.statusKey && (
                            <span className="px-2 py-0.5 rounded-full bg-white border border-border text-[10.5px] font-semibold capitalize text-secondary-700">
                              {String(item.statusKey).replace(/_/g, ' ')}
                            </span>
                          )}
                          {item.approvalRequired ? (
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10.5px] font-semibold capitalize">
                              {item.approvalStatus ? String(item.approvalStatus).replace(/_/g, ' ') : 'approval needed'}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <dl className={cn('grid gap-x-4 gap-y-2 px-4 py-3 text-xs', item.approvers ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
                        <div>
                          <dt className="text-secondary-500">Owner</dt>
                          <dd className="font-semibold text-foreground mt-0.5">{item.owner || 'Unassigned'}</dd>
                        </div>
                        <div>
                          <dt className="text-secondary-500">Due</dt>
                          <dd className={cn('font-semibold mt-0.5', overdue ? 'text-red-600' : 'text-foreground')}>
                            {due
                              ? due.toLocaleString('en-GB', {
                                day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                              })
                              : 'No due date'}
                            {/* Was a bare " · overdue"; it now says by how much. */}
                            {status && (
                              <span className={cn('block font-normal mt-0.5', overdue ? 'text-red-600' : 'text-secondary-500')}>
                                {status.label}
                              </span>
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-secondary-500">Estimate</dt>
                          <dd className="font-semibold text-foreground mt-0.5">
                            {item.estimatedHours ? `${item.estimatedHours} hour${Number(item.estimatedHours) === 1 ? '' : 's'}` : '—'}
                            {Number(item.minutesSpent) > 0 && (
                              <span className="font-normal text-secondary-500"> · {item.minutesSpent} min logged</span>
                            )}
                          </dd>
                        </div>
                        {item.approvers && (
                          <div>
                            <dt className="text-secondary-500">Approval required from</dt>
                            <dd className="font-semibold text-foreground mt-0.5">{item.approvers}</dd>
                          </div>
                        )}
                      </dl>

                      {item.approvalDetails?.length > 0 && (
                        <div className="mx-4 mb-3 overflow-hidden rounded-lg border border-border">
                          <div className="grid grid-cols-[minmax(0,1fr)_100px_minmax(0,1.4fr)] gap-3 px-3 py-2 bg-secondary-50 text-[10px] font-bold uppercase tracking-wide text-secondary-500">
                            <span>Approver</span><span>Status</span><span>Comments</span>
                          </div>
                          {item.approvalDetails.map(approval => (
                            <div key={approval.id} className="grid grid-cols-[minmax(0,1fr)_100px_minmax(0,1.4fr)] items-center gap-3 px-3 py-2 border-t border-border text-xs">
                              <span className="font-semibold text-foreground truncate" title={approval.approver}>{approval.approver}</span>
                              <span className={cn(
                                'w-max px-2 py-0.5 rounded-full font-semibold capitalize',
                                approval.decision === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                                approval.decision === 'rejected' ? 'bg-red-100 text-red-700' :
                                'bg-amber-100 text-amber-700'
                              )}>{approval.decision}</span>
                              <span className="text-secondary-600">{approval.comments || (approval.decision === 'pending' ? 'Awaiting decision' : 'No comments')}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {item.description && (
                        <div className="px-4 pb-3 text-xs text-secondary-600">
                          <span className="block text-secondary-500 mb-0.5">Description</span>
                          {item.description}
                        </div>
                      )}
                      {item.notes && (
                        <div className="px-4 pb-3 text-xs text-secondary-600 border-t border-border pt-2">
                          <span className="block text-secondary-500 mb-0.5">Discussion point</span>
                          {/* Stored as sanitised rich text by the API, same as the card summary. */}
                          <div dangerouslySetInnerHTML={{ __html: item.notes }} />
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>

            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border">
              <span className="text-xs text-secondary-500">
                {(actionItemsSession.points || []).filter((point) => point.operationRecordId).length} action item(s) in this session
              </span>
              <Button variant="secondary" onClick={() => setActionItemsSession(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {approvalHistory && (
        <div className="fixed inset-0 z-[240] grid place-items-center p-4 bg-secondary-900/50" onMouseDown={event => { if (event.target === event.currentTarget) setApprovalHistory(null); }}>
          <div className="w-full max-w-lg rounded-2xl bg-white border border-border shadow-lg overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="approval-history-title">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
              <div className="min-w-0">
                <h3 id="approval-history-title" className="font-display font-bold text-base">Approval details</h3>
                <p className="truncate mt-0.5 text-xs text-primary-600 font-mono">{approvalHistory.recordNumber}</p>
              </div>
              <button type="button" onClick={() => setApprovalHistory(null)} className="grid place-items-center w-8 h-8 rounded-lg hover:bg-secondary-100" aria-label="Close approval details"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-secondary-500">Action item</p>
                  <p className="mt-0.5 font-semibold">{approvalHistory.title}</p>
                </div>
                <span className={cn(
                  'px-2.5 py-1 rounded-full text-xs font-semibold capitalize',
                  approvalHistory.decision === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                )}>{approvalHistory.decision}</span>
              </div>
              <dl className="grid sm:grid-cols-2 gap-4 text-sm">
                <div><dt className="text-xs text-secondary-500">Approver</dt><dd className="mt-1 font-semibold">{approvalHistory.approver || '—'}</dd></div>
                <div><dt className="text-xs text-secondary-500">Decision Login</dt><dd className="mt-1 font-semibold">{approvalHistory.decidedBy || '—'}</dd></div>
                <div><dt className="text-xs text-secondary-500">Request raised</dt><dd className="mt-1 font-semibold">{approvalHistory.requestedAt ? new Date(approvalHistory.requestedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</dd></div>
                <div><dt className="text-xs text-secondary-500">Decision recorded</dt><dd className="mt-1 font-semibold">{approvalHistory.decidedAt ? new Date(approvalHistory.decidedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</dd></div>
              </dl>
              <div className="rounded-xl border border-border bg-secondary-50 p-4">
                <p className="text-xs text-secondary-500">Remarks</p>
                <p className="mt-1 text-sm whitespace-pre-wrap">{approvalHistory.remarks || 'No comments'}</p>
              </div>
            </div>
            <div className="flex justify-end px-5 py-3 border-t border-border bg-secondary-50">
              <Button variant="secondary" onClick={() => setApprovalHistory(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {approvalDecision && (
        <div className="fixed inset-0 z-[240] grid place-items-center p-4 bg-secondary-900/50" onMouseDown={event => { if (event.target === event.currentTarget) setApprovalDecision(null); }}>
          <form onSubmit={submitApprovalDecision} className="w-full max-w-md rounded-2xl bg-white border border-border shadow-lg overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
              <div>
                <h3 className="font-display font-bold text-base capitalize">{approvalDecision.decision} action item</h3>
                <p className="mt-0.5 text-xs text-secondary-500">{approvalDecision.title} · Approver: {approvalDecision.approver}</p>
              </div>
              <button type="button" onClick={() => setApprovalDecision(null)} className="grid place-items-center w-8 h-8 rounded-lg hover:bg-secondary-100" aria-label="Close decision dialog"><X size={16} /></button>
            </div>
            <label className="block p-5 space-y-1.5">
              <span className="text-xs font-semibold">Decision remarks</span>
              <textarea
                required minLength={10}
                value={approvalDecision.remarks}
                onChange={event => setApprovalDecision(current => ({ ...current, remarks: event.target.value }))}
                placeholder="Provide a clear explanation (at least 10 characters)"
                className="w-full min-h-28 p-3 rounded-lg border border-border text-sm focus:outline-none focus:border-primary-400 focus:ring-4 focus:ring-primary-50"
              />
            </label>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-border bg-secondary-50">
              <Button type="button" variant="secondary" onClick={() => setApprovalDecision(null)}>Cancel</Button>
              <Button type="submit" disabled={approvalDecisionSaving} className={approvalDecision.decision === 'rejected' ? 'bg-red-600 hover:bg-red-700' : ''}>
                {approvalDecisionSaving ? 'Saving…' : `Confirm ${approvalDecision.decision}`}
              </Button>
            </div>
          </form>
        </div>
      )}

      {approvalDetails && (
        <div
          className="fixed inset-0 z-[230] grid place-items-center p-4 bg-secondary-900/50"
          onMouseDown={event => { if (event.target === event.currentTarget) setApprovalDetails(null); }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white border border-border shadow-lg overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
              <div className="min-w-0">
                <h3 className="font-display font-bold text-base">Approval details</h3>
                <p className="truncate mt-0.5 text-xs text-secondary-500">{approvalDetails.record.title}</p>
              </div>
              <button type="button" onClick={() => setApprovalDetails(null)} className="grid place-items-center w-8 h-8 rounded-lg hover:bg-secondary-100" aria-label="Close approval details">
                <X size={16} />
              </button>
            </div>
            <div className="p-5">
              {approvalDetailsLoading ? (
                <p className="py-6 text-center text-sm text-secondary-500">Loading approvers…</p>
              ) : approvalDetails.approvals.length === 0 ? (
                <p className="py-6 text-center text-sm text-secondary-500">No approvers assigned.</p>
              ) : (
                <div className="space-y-2">
                  {approvalDetails.approvals.map(approval => {
                    const actionableApproval = approvals.find(item => Number(item.id) === Number(approval.id) && item.decision === 'pending');
                    return (
                    <div key={approval.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-secondary-50">
                      <span className={cn(
                        'inline-grid place-items-center w-9 h-9 rounded-full',
                        approval.decision === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                        approval.decision === 'rejected' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      )}>
                        {approval.decision === 'rejected' ? <X size={17} /> :
                          approval.decision === 'pending' ? <Clock3 size={17} /> : <ClipboardCheck size={17} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{approval.approver}</p>
                        <p className="text-xs capitalize text-secondary-500">{approval.decision.replace(/_/g, ' ')}</p>
                      </div>
                      {actionableApproval && (
                        <span className="flex items-center gap-2 flex-none">
                          <button
                            type="button"
                            onClick={() => { setApprovalDetails(null); setApprovalDecision({ ...actionableApproval, decision: 'approved', remarks: '' }); }}
                            title="Approve"
                            aria-label={`Approve ${approvalDetails.record.title}`}
                            className="inline-grid place-items-center w-8 h-8 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                          ><Check size={14} /></button>
                          <button
                            type="button"
                            onClick={() => { setApprovalDetails(null); setApprovalDecision({ ...actionableApproval, decision: 'rejected', remarks: '' }); }}
                            title="Reject"
                            aria-label={`Reject ${approvalDetails.record.title}`}
                            className="inline-grid place-items-center w-8 h-8 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                          ><X size={14} /></button>
                        </span>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex justify-end px-5 py-3 border-t border-border bg-secondary-50">
              <Button variant="secondary" onClick={() => setApprovalDetails(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {viewingTask && (
        <div
          className="fixed inset-0 z-[230] grid place-items-center p-4 bg-secondary-900/50"
          onMouseDown={event => { if (event.target === event.currentTarget) setViewingTask(null); }}
        >
          <div className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl bg-white border border-border shadow-lg overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="action-item-details-title">
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border">
              <div className="min-w-0">
                <h3 id="action-item-details-title" className="font-display font-bold text-base">Action item details</h3>
                <p className="truncate mt-0.5 text-xs font-mono text-primary-600">{viewingTask.record.recordNumber}</p>
              </div>
              <button type="button" onClick={() => setViewingTask(null)} className="grid place-items-center w-8 h-8 rounded-lg hover:bg-secondary-100" aria-label="Close action item details"><X size={16} /></button>
            </div>
            <div className="min-h-0 overflow-y-auto p-6 space-y-5">
              {viewingTaskLoading ? (
                <p className="py-10 text-center text-sm text-secondary-500">Loading action item details…</p>
              ) : (
                <>
                  <div>
                    <p className="text-xs text-secondary-500">Action item</p>
                    <p className="mt-1 text-lg font-semibold text-foreground">{viewingTask.record.title}</p>
                  </div>
                  <dl className="grid sm:grid-cols-2 gap-4 text-sm">
                    <div><dt className="text-xs text-secondary-500">Owner</dt><dd className="mt-1 font-semibold">{viewingTask.record.owner || 'Unassigned'}</dd></div>
                    <div><dt className="text-xs text-secondary-500">Status</dt><dd className="mt-1 font-semibold">{stages.find(stage => String(stage.id) === String(viewingTask.record.stageId))?.displayName || viewingTask.record.stage || '—'}</dd></div>
                    <div><dt className="text-xs text-secondary-500">Created</dt><dd className="mt-1 font-semibold">{actionCreatedLabel(viewingTask.record.createdAt).replace(/^Created /, '')}</dd></div>
                    <div><dt className="text-xs text-secondary-500">Deadline</dt><dd className="mt-1 font-semibold">{viewingTask.record.dueAt ? new Date(viewingTask.record.dueAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : 'Not scheduled'}</dd></div>
                    <div><dt className="text-xs text-secondary-500">Approval</dt><dd className="mt-1 font-semibold capitalize">{viewingTask.record.approvalRequired ? String(viewingTask.record.approvalStatus || 'pending').replace(/_/g, ' ') : 'Not required'}</dd></div>
                    <div><dt className="text-xs text-secondary-500">Time recorded</dt><dd className="mt-1 font-semibold">{duration(viewingTask.record.minutesSpent)}</dd></div>
                  </dl>
                  <div className="rounded-xl border border-border bg-secondary-50 p-4">
                    <p className="text-xs text-secondary-500">Description</p>
                    <p className="mt-1.5 text-sm whitespace-pre-wrap">{viewingTask.record.description || 'No description'}</p>
                  </div>
                  {(viewingTask.details?.approvals || []).length > 0 && (
                    <div>
                      <h4 className="mb-2 text-xs font-semibold text-secondary-600">Approval flow</h4>
                      <div className="space-y-2">
                        {viewingTask.details.approvals.map(approval => (
                          <div key={approval.id} className="flex items-start justify-between gap-3 rounded-xl border border-border p-3 text-sm">
                            <div><p className="font-semibold">{approval.approver}</p><p className="mt-0.5 text-xs text-secondary-500">{approval.remarks || (approval.decision === 'pending' ? 'Awaiting decision' : 'No remarks')}</p></div>
                            <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold capitalize', approval.decision === 'approved' ? 'bg-emerald-100 text-emerald-700' : approval.decision === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>{approval.decision}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(viewingTask.details?.timeLogs || []).length > 0 && (
                    <div>
                      <h4 className="mb-2 text-xs font-semibold text-secondary-600">Time log</h4>
                      <div className="space-y-2">
                        {viewingTask.details.timeLogs.map(log => <div key={log.id} className="rounded-xl border border-border p-3 text-sm"><div className="flex justify-between gap-3"><strong>{log.loggedBy}</strong><span>{log.minutesSpent} min</span></div><p className="mt-1 text-xs text-secondary-500">{log.workNote || 'No note'}</p></div>)}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="flex justify-end px-6 py-4 border-t border-border bg-secondary-50">
              <Button variant="secondary" onClick={() => setViewingTask(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {editingTask && (
        <div
          className="fixed inset-0 z-[220] grid place-items-center p-4 bg-secondary-900/50"
          onMouseDown={event => { if (event.target === event.currentTarget) setEditingTask(null); }}
        >
          <form onSubmit={saveTaskEdit} className="tracker-task-dialog max-h-[90vh] overflow-y-auto rounded-2xl bg-white border border-border shadow-lg">
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border">
              <div>
                <h3 className="font-display font-bold text-base">Edit action item</h3>
                <p className="mt-0.5 text-xs font-mono text-primary-600">{editingTask.recordNumber}</p>
              </div>
              <button type="button" onClick={() => setEditingTask(null)} className="grid place-items-center w-8 h-8 rounded-lg hover:bg-secondary-100" aria-label="Close editor">
                <X size={16} />
              </button>
            </div>
            <div className="tracker-form-grid p-6">
              <label className="wide space-y-1">
                <span className="text-xs font-semibold">Action item</span>
                <Input required value={editingTask.title} onChange={event => setEditingTask(task => ({ ...task, title: event.target.value }))} />
              </label>
              <label className="wide space-y-1">
                <span className="text-xs font-semibold">Description</span>
                <textarea className="w-full min-h-24 p-3 rounded-lg border border-border text-sm" value={editingTask.description} onChange={event => setEditingTask(task => ({ ...task, description: event.target.value }))} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold">Status</span>
                <Select required value={editingTask.stageId} onChange={event => setEditingTask(task => ({ ...task, stageId: event.target.value }))}>
                  {stages.map(stage => <option key={stage.id} value={stage.id}>{stage.displayName}</option>)}
                </Select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold">Owner</span>
                <Select required value={editingTask.ownerKey} onChange={event => setEditingTask(task => ({ ...task, ownerKey: event.target.value }))}>
                  {users.filter(user => user.employeeId).map(user => <option key={`employee:${user.employeeId}`} value={`employee:${user.employeeId}`}>{user.name}</option>)}
                  {guestOwners.map(owner => <option key={`guest:${owner.id}`} value={`guest:${owner.id}`}>{owner.name}</option>)}
                </Select>
              </label>
              <label className="wide space-y-1">
                <span className="text-xs font-semibold">Deadline</span>
                <Input required type="datetime-local" value={editingTask.dueAt} onChange={event => setEditingTask(task => ({ ...task, dueAt: event.target.value }))} />
              </label>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-border bg-secondary-50">
              <Button type="button" variant="secondary" onClick={() => setEditingTask(null)}>Cancel</Button>
              <Button type="submit" disabled={editSaving}>{editSaving ? 'Saving…' : 'Save changes'}</Button>
            </div>
          </form>
        </div>
      )}

      {momOpen && (
        <div
          className="fixed inset-0 z-[200] grid place-items-center p-6 bg-secondary-900/50"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setMomOpen(false); }}
        >
          <div className="w-full max-w-6xl max-h-[86vh] flex flex-col rounded-2xl bg-white border border-border shadow-lg overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border">
              <div className="min-w-0">
                <h3 className="font-display font-bold text-base text-foreground">
                  {momSession ? 'Add to MOM session' : 'New MOM session'}
                </h3>
                {momSession && (
                  <p className="text-xs text-secondary-500 mt-0.5">{momSession.sessionNumber}</p>
                )}
              </div>
              <button
                onClick={() => setMomOpen(false)}
                className="grid place-items-center w-8 h-8 rounded-[10px] text-secondary-500 hover:bg-surface-3 hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-6 py-5 overflow-y-auto space-y-5">
              <div>
                <span className="block text-sm font-semibold mb-1.5">Meeting notes</span>
                <MomRichTextEditor value={momNotes} onChange={setMomNotes} />
              </div>

              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="text-sm font-semibold">
                    Action items {momItems.length > 0 && `(${momItems.length})`}
                  </span>
                  <Button variant="secondary" onClick={addMomItem}>
                    <Plus size={14} /> Add item
                  </Button>
                </div>

                {momItems.length === 0 ? (
                  <p className="text-xs text-secondary-500">
                    Optional — a session can be notes only.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {momItems.map((item) => (
                      <div key={item.key} className="grid gap-2 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_70px_80px_minmax(0,1.1fr)_minmax(0,1fr)_36px] items-center">
                        <input
                          value={item.title}
                          onChange={(event) => patchMomItem(item.key, { title: event.target.value })}
                          placeholder="Action item"
                          className="w-full h-10 px-3 rounded-[10px] border border-border bg-white text-sm
                                     focus:outline-none focus:border-primary-400 focus:ring-4 focus:ring-primary-50"
                        />
                        <select
                          value={item.ownerEmployeeId}
                          onChange={(event) => patchMomItem(item.key, { ownerEmployeeId: event.target.value })}
                          className="w-full h-10 px-2 rounded-[10px] border border-border bg-white text-sm
                                     focus:outline-none focus:border-primary-400 focus:ring-4 focus:ring-primary-50"
                        >
                          <option value="">Unassigned</option>
                          {users.filter((u) => u.employeeId).map((u) => (
                            <option key={u.employeeId} value={u.employeeId}>{u.name}</option>
                          ))}
                        </select>
                        <input
                          type="number" min="1" step="1"
                          value={item.estimatedHours}
                          onChange={(event) => updateMomEstimate(item.key, event.target.value, item.estimateUnit)}
                          placeholder="Time"
                          title="Estimated duration"
                          className="w-full h-10 px-2 rounded-[10px] border border-border bg-white text-sm
                                     focus:outline-none focus:border-primary-400 focus:ring-4 focus:ring-primary-50"
                        />
                        <select
                          value={item.estimateUnit || 'hours'}
                          onChange={(event) => updateMomEstimate(item.key, item.estimatedHours, event.target.value)}
                          aria-label="Estimated duration unit"
                          className="w-full h-10 px-2 rounded-[10px] border border-border bg-white text-sm
                                     focus:outline-none focus:border-primary-400 focus:ring-4 focus:ring-primary-50"
                        >
                          {ESTIMATE_UNITS.map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                        <input
                          type="datetime-local"
                          value={item.dueAt}
                          onChange={(event) => patchMomItem(item.key, { dueAt: event.target.value })}
                          aria-label="Deadline"
                          title="Deadline"
                          className="w-full h-10 px-2 rounded-[10px] border border-border bg-white text-sm
                                     focus:outline-none focus:border-primary-400 focus:ring-4 focus:ring-primary-50"
                        />
                        <select
                          value={item.approverUserIds?.[0] || ''}
                          onChange={(event) => patchMomItem(item.key, {
                            approvalRequired: Boolean(event.target.value),
                            approverUserIds: event.target.value ? [Number(event.target.value)] : [],
                          })}
                          aria-label="Approval required from"
                          title="Approval required from"
                          className="w-full h-10 px-2 rounded-[10px] border border-border bg-white text-sm
                                     focus:outline-none focus:border-primary-400 focus:ring-4 focus:ring-primary-50"
                        >
                          <option value="">No approval</option>
                          {users.map(user => (
                            <option key={user.userId} value={user.userId}>Approve: {user.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => removeMomItem(item.key)}
                          className="grid place-items-center w-9 h-9 rounded-[10px] text-secondary-500 hover:bg-danger-bg hover:text-danger transition-colors"
                          aria-label="Remove action item"
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-border bg-surface-2">
              <Button variant="secondary" onClick={() => setMomOpen(false)}>Cancel</Button>
              <Button onClick={saveMomSession} disabled={momSaving}>
                {momSaving ? 'Saving…' : momSession ? 'Save to session' : 'Save MOM session'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
