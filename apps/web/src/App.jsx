import { useEffect, useMemo, useState } from "react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { api } from "./api";
import BusinessUnitLeadRouter from "./DynamicLeadsPage.jsx";
import SettingsPage from "./SettingsPage.jsx";
import AutomationPage from "./AutomationPage.jsx";
import OperationsPage from "./OperationsPage.jsx";
import WhatsAppInbox from "./WhatsAppInbox.jsx";
import BulkActionsPage from "./BulkActionsPage.jsx";
import OAuthCallbackPage from "./pages/OAuthCallbackPage.jsx";
import GlobalSearch from "./GlobalSearch.jsx";
import ReportBuilder, { SavedReportsDashboard, ReportVisual, buildLiveReportData, canViewSavedReport, readSavedReports, writeSavedReports } from "./ReportBuilder.jsx";
import PublicEnquiryForm from "./PublicEnquiryForm.jsx";
import PublicPaymentPage from "./pages/PublicPaymentPage.jsx";
import { BusinessUnitProvider, BusinessUnitSelector, useBusinessUnit } from "./BusinessUnitContext.jsx";
import AuthLayout from "./components/AuthLayout.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Header from "./components/Header.jsx";
import DashboardPage from "./components/DashboardPage.jsx";
import { Button, Input } from "./components/ui/index.js";
import "./SidebarTogglePosition.css";
import "./DashboardCanvas.css";
import {
  BarChart3,
  Bell,
  CalendarClock,
  ChevronDown,
  CircleHelp,
  Eye,
  EyeOff,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PhoneCall,
  Plus,
  Search,
  Settings2,
  Settings,
  Sparkles,
  Target,
  UploadCloud,
  UserRound,
  Users,
  Zap,
  Workflow,
  X,
} from "lucide-react";

const menu = [
  ["Dashboard", "/", LayoutDashboard],
  ["Leads", "/leads", Users],
  ["Tracker", "/tracker", Workflow],
  ["Bulk Actions", "/bulk-actions", UploadCloud],
  ["Reports", "/reports", BarChart3],
  ["Automations", "/automations", Zap],
];

function loadStoredUser() {
  const token = localStorage.getItem("crm_token");
  const storedUser = localStorage.getItem("crm_user");
  if (!token || !storedUser) return null;
  try {
    if (getTokenExpiry() <= Date.now()) {
      localStorage.removeItem("crm_token");
      localStorage.removeItem("crm_user");
      return null;
    }
    return JSON.parse(storedUser);
  } catch {
    localStorage.removeItem("crm_token");
    localStorage.removeItem("crm_user");
    return null;
  }
}

function getTokenExpiry() {
  const token = localStorage.getItem("crm_token");
  if (!token) return 0;
  try {
    const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    return Number(JSON.parse(atob(padded)).exp || 0) * 1000;
  } catch {
    return 0;
  }
}

function Login({ onLogin }) {
  const [email, setEmail] = useState(“”);
  const [password, setPassword] = useState(“”);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(“”);
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError(“”);
    setLoading(true);
    try {
      const result = await api(“/auth/login”, {
        method: “POST”,
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem(“crm_token”, result.token);
      localStorage.setItem(“crm_user”, JSON.stringify(result.user));
      onLogin(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} className=”space-y-6”>
        {/* Logo for mobile */}
        <div className=”md:hidden flex items-center gap-2 mb-8”>
          <div className=”flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600 text-white”>
            <Sparkles size={16} />
          </div>
          <span className=”font-bold text-lg font-display”>Orbit</span>
        </div>

        {/* Form Header */}
        <div>
          <p className=”text-sm font-semibold uppercase tracking-wider text-blue-600 mb-2”>
            Welcome back
          </p>
          <h2 className=”text-3xl font-bold text-foreground font-display mb-1”>
            Sign in to your CRM
          </h2>
          <p className=”text-sm text-secondary-600”>
            Use your existing Attendance application account.
          </p>
        </div>

        {/* Email Field */}
        <div className=”space-y-2”>
          <label className=”text-sm font-semibold text-foreground”>
            Email address
          </label>
          <Input
            type=”email”
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder=”your@email.com”
            required
          />
        </div>

        {/* Password Field */}
        <div className=”space-y-2”>
          <label className=”text-sm font-semibold text-foreground”>
            Password
          </label>
          <div className=”relative”>
            <Input
              type={showPassword ? “text” : “password”}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder=”••••••••”
              required
              className=”pr-10”
            />
            <button
              type=”button”
              onClick={() => setShowPassword(!showPassword)}
              className=”absolute right-3 top-1/2 -translate-y-1/2 text-secondary-500 hover:text-foreground transition-colors”
              aria-label={showPassword ? “Hide password” : “Show password”}
            >
              {showPassword ? (
                <EyeOff size={18} />
              ) : (
                <Eye size={18} />
              )}
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className=”p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700”>
            {error}
          </div>
        )}

        {/* Submit Button */}
        <Button
          type=”submit”
          disabled={loading}
          className=”w-full”
          size=”lg”
        >
          {loading ? “Signing in…” : “Sign in”}
        </Button>
      </form>
    </AuthLayout>
  );
}

function Shell({ user, onLogout }) {
  const { selectedId: activeBusinessUnitId } = useBusinessUnit();
  const navigate = useNavigate();
  const location = useLocation();

  const settingsMenu = [
    { label: 'User Management', path: '/settings/users' },
    { label: 'Business Units', path: '/settings/business-units' },
    { label: 'Branch Settings', path: '/settings/branches' },
    { label: 'Payment Forms', path: '/settings/payment-forms' },
    { label: 'Integrations', path: '/settings/integrations' },
    { label: 'Google Sheets', path: '/settings/google-sheets' },
    { label: 'WhatsApp', path: '/settings/whatsapp-templates' },
    { label: 'CallerDesk', path: '/settings/callerdesk' },
    { label: 'Smartflo', path: '/settings/smartflo' },
  ];

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar
        user={user}
        onLogout={onLogout}
        menu={menu}
        settings={settingsMenu}
      />

      <div className="flex flex-col flex-1 overflow-hidden">
        <GlobalSearch />

        <main className="flex-1 overflow-y-auto">
          <Routes location={location}>
            <Route path="/" element={<DashboardPage key={activeBusinessUnitId} user={user} />} />
            <Route path="/leads" element={<BusinessUnitLeadRouter key={activeBusinessUnitId} />} />
            <Route path="/tracker" element={<OperationsPage key={activeBusinessUnitId} />} />
            <Route path="/operations" element={<Navigate to="/tracker" replace />} />
            <Route path="/whatsapp-inbox" element={<WhatsAppInbox />} />
            <Route path="/bulk-actions" element={<BulkActionsPage key={activeBusinessUnitId} />} />
            <Route path="/reports" element={<ReportsPage key={activeBusinessUnitId} />} />
            <Route path="/saved-reports/new" element={<SavedReportCreatePage key={activeBusinessUnitId} />} />
            <Route path="/settings" element={<SettingsPage initialTab="users" />} />
            <Route path="/settings/users" element={<SettingsPage initialTab="users" />} />
            <Route path="/settings/business-units" element={<SettingsPage initialTab="business-units" />} />
            <Route path="/settings/branches" element={<SettingsPage initialTab="branches" />} />
            <Route path="/settings/payment-forms" element={<SettingsPage initialTab="payment-forms" />} />
            <Route path="/settings/lead-config" element={<Navigate to="/settings/business-units?tab=sources" replace />} />
            <Route path="/settings/academic-config" element={<Navigate to="/settings/business-units?tab=academic" replace />} />
            <Route path="/settings/academic-years" element={<Navigate to="/settings/business-units?tab=academic" replace />} />
            <Route path="/settings/admission-classes" element={<Navigate to="/settings/business-units?tab=academic&section=classes" replace />} />
            <Route path="/settings/integrations" element={<SettingsPage initialTab="integrations" />} />
            <Route path="/settings/google-sheets" element={<SettingsPage initialTab="google-sheets" />} />
            <Route path="/settings/whatsapp-templates" element={<SettingsPage initialTab="whatsapp-templates" />} />
            <Route path="/settings/callerdesk" element={<SettingsPage initialTab="callerdesk" />} />
            <Route path="/settings/smartflo" element={<SettingsPage initialTab="smartflo" />} />
            <Route path="/integrations" element={<Navigate to="/settings/integrations" replace />} />
            <Route path="/oauth-callback" element={<OAuthCallbackPage />} />
            <Route path="/oauth-error" element={<OAuthCallbackPage />} />
            <Route path="/automations" element={<AutomationPage key={activeBusinessUnitId} />} />
            <Route path="*" element={<ComingSoon />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function Dashboard({ user }) {
  const { selectedUnit } = useBusinessUnit();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [savedReportLeads, setSavedReportLeads] = useState([]);
  const [error, setError] = useState("");
  const [dashboardTab, setDashboardTab] = useState(location.state?.dashboardTab === "saved" ? "saved" : "overview");
  useEffect(() => {
    if (location.state?.dashboardTab === "saved") setDashboardTab("saved");
  }, [location.state?.dashboardTab]);
  useEffect(() => {
    if (!selectedUnit?.id) return;
    setData(null);
    setSavedReportLeads([]);
    setError("");
    Promise.all([api("/dashboard"), api("/leads")])
      .then(([dashboard, leadsResult]) => {
        setData(dashboard);
        setSavedReportLeads(leadsResult.data || []);
      })
      .catch((err) => setError(err.message));
  }, [selectedUnit?.id]);
  if (error) return <ErrorState message={error} />;
  if (!data) return <Loading />;
  const comparisons = data.stats.comparisons || {};
  const cards = [
    ["Total leads", data.stats.totalLeads, comparisonLabel(data.stats.totalLeads, comparisons.totalLeadsLastMonth, "since last month", `${Math.max(0, Number(data.stats.totalLeads || 0) - Number(comparisons.totalLeadsLastMonth || 0)).toLocaleString()} added this month`), Users, "violet"],
    ["New this week", data.stats.newThisWeek, comparisonLabel(data.stats.newThisWeek, comparisons.newPreviousWeek, "vs previous week", `${Number(data.stats.newThisWeek || 0).toLocaleString()} this week`), Target, "blue"],
    [
      "Follow-ups due",
      data.stats.followupsDue,
      `${Number(comparisons.followupsOverdue || 0).toLocaleString()} overdue`,
      CalendarClock,
      "orange",
    ],
    ["Admissions", data.stats.admissions, comparisonLabel(comparisons.admissionsThisMonth, comparisons.admissionsLastMonth, "vs last month", `${Number(comparisons.admissionsThisMonth || 0).toLocaleString()} this month`), GraduationCap, "green"],
  ];
  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Saturday, 18 July</span>
          <h1>Good afternoon, {user.name.split(" ")[0]}</h1>
          <p>Here’s what needs your admissions team’s attention today.</p>
        </div>
        <button className="primary" onClick={() => navigate("/leads")}>
          <Plus size={18} /> Add new lead
        </button>
      </div>
      <div className="dashboard-tabs" role="tablist" aria-label="Dashboard views">
        <button className={dashboardTab === "overview" ? "active" : ""} onClick={() => setDashboardTab("overview")}>Overview</button>
        <button className={dashboardTab === "saved" ? "active" : ""} onClick={() => setDashboardTab("saved")}>Saved Reports</button>
      </div>
      {dashboardTab === "overview" ? <DashboardOverviewCanvas data={data} leads={savedReportLeads} cards={cards} /> : <SavedReportsDashboard data={data} leads={savedReportLeads} onCreateNew={() => navigate("/saved-reports/new", { state: { createNewReportAt: Date.now(), returnTo: "dashboard-saved" } })} />}
    </main>
  );
}

function comparisonLabel(current, previous, suffix, zeroBaselineLabel) {
  const currentValue = Number(current || 0);
  const previousValue = Number(previous || 0);
  if (!previousValue) return zeroBaselineLabel;
  const change = ((currentValue - previousValue) / previousValue) * 100;
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(1)}% ${suffix}`;
}

const DASHBOARD_WIDGETS = [
  { id: "stats", title: "Performance cards", size: "full" },
  { id: "funnel", title: "Admissions funnel", size: "half" },
  { id: "tasks", title: "Today’s priorities", size: "half" },
  { id: "recent", title: "Recent leads", size: "full" },
];

function dashboardLayoutKey(unitId) {
  return `crm_dashboard_overview_layout_${unitId || "default"}`;
}

function readDashboardLayout(unitId) {
  try {
    const saved = JSON.parse(localStorage.getItem(dashboardLayoutKey(unitId)) || "null");
    if (Array.isArray(saved) && saved.length) return normalizeDashboardLayout(saved);
  } catch {}
  return DASHBOARD_WIDGETS.map(widget => ({ id: widget.id, size: widget.size, visible: true }));
}

function normalizeDashboardLayout(layout) {
  const known = new Set(DASHBOARD_WIDGETS.map(widget => widget.id));
  const validSizes = new Set(["quarter", "half", "three-quarter", "full"]);
  const cleaned = layout.filter(item => known.has(item.id) || String(item.id || "").startsWith("report:")).map(item => ({ id: item.id, size: validSizes.has(item.size) ? item.size : "half", visible: item.visible !== false }));
  const existing = new Set(cleaned.map(item => item.id));
  DASHBOARD_WIDGETS.forEach(widget => { if (!existing.has(widget.id)) cleaned.push({ id: widget.id, size: widget.size, visible: true }); });
  return cleaned;
}

function DashboardOverviewCanvas({ data, leads = [], cards, editable = false }) {
  const { selectedUnit } = useBusinessUnit();
  const [layout, setLayout] = useState(() => readDashboardLayout(selectedUnit?.id));
  const [savedReports, setSavedReports] = useState(() => readSavedReports(selectedUnit?.id));
  const [widgetPickerOpen, setWidgetPickerOpen] = useState(false);
  const [widgetSearch, setWidgetSearch] = useState("");
  useEffect(() => setLayout(readDashboardLayout(selectedUnit?.id)), [selectedUnit?.id]);
  useEffect(() => {
    const loadReports = () => setSavedReports(readSavedReports(selectedUnit?.id));
    loadReports();
    window.addEventListener("crm:saved-reports-changed", loadReports);
    return () => window.removeEventListener("crm:saved-reports-changed", loadReports);
  }, [selectedUnit?.id]);
  useEffect(() => {
    if (!widgetPickerOpen) return undefined;
    const close = event => {
      if (!event.target.closest(".dashboard-widget-picker-wrap")) {
        setWidgetPickerOpen(false);
        setWidgetSearch("");
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [widgetPickerOpen]);
  const saveLayout = next => {
    const normalized = normalizeDashboardLayout(next);
    setLayout(normalized);
    localStorage.setItem(dashboardLayoutKey(selectedUnit?.id), JSON.stringify(normalized));
  };
  const move = (id, direction) => {
    const visible = layout.filter(item => item.visible !== false);
    const targetId = dashboardMoveTarget(visible, id, direction);
    if (!targetId) return;
    const next = [...layout];
    const index = next.findIndex(item => item.id === id);
    const target = next.findIndex(item => item.id === targetId);
    [next[index], next[target]] = [next[target], next[index]];
    saveLayout(next);
  };
  const patchWidget = (id, values) => saveLayout(layout.map(item => item.id === id ? { ...item, ...values } : item));
  const patchSavedReport = (id, values) => {
    const next = savedReports.map(report => String(report.id) === String(id) ? { ...report, ...values, updatedAt: new Date().toISOString() } : report);
    writeSavedReports(selectedUnit?.id, next);
    setSavedReports(next);
  };
  const addReportWidget = report => {
    const id = `report:${report.id}`;
    saveLayout(layout.some(item => item.id === id) ? layout.map(item => item.id === id ? { ...item, visible: true } : item) : [{ id, size: "half", visible: true }, ...layout]);
  };
  const available = DASHBOARD_WIDGETS.filter(widget => !layout.some(item => item.id === widget.id && item.visible !== false));
  const visibleSavedReports = savedReports.filter(report => canViewSavedReport(report));
  const availableReports = visibleSavedReports.filter(report => !layout.some(item => item.id === `report:${report.id}` && item.visible !== false));
  const availableItems = [
    ...available.map(widget => ({ id: widget.id, type: "widget", title: widget.title, subtitle: "Dashboard widget", action: () => patchWidget(widget.id, { visible: true }) })),
    ...availableReports.map(report => ({ id: `report:${report.id}`, type: "report", title: report.title || "Untitled report", subtitle: `${report.type || "Report"} saved report`, action: () => addReportWidget(report) })),
  ].filter(item => `${item.title} ${item.subtitle}`.toLowerCase().includes(widgetSearch.toLowerCase().trim()));
  const visibleLayout = layout.filter(item => item.visible !== false);
  return <section className={`dashboard-canvas ${editable ? "editing" : ""}`}>
    {editable && <div className="dashboard-designer-toolbar panel">
      <div><Settings2 size={17} /><span><strong>Dashboard layout editor</strong><small>Add widgets and adjust how the Dashboard overview appears for this business unit.</small></span></div>
      <div className="dashboard-widget-picker-wrap">
        <button type="button" className="secondary dashboard-widget-picker-trigger" onClick={() => setWidgetPickerOpen(value => !value)}><Plus size={14} />Add widget / report<ChevronDown size={14} /></button>
        {widgetPickerOpen && <div className="dashboard-widget-picker">
          <label><Search size={14} /><input autoFocus value={widgetSearch} onChange={event => setWidgetSearch(event.target.value)} placeholder="Search widgets or saved reports..." /></label>
          <section>
            {availableItems.map(item => <button type="button" key={`${item.type}-${item.id}`} onClick={() => { item.action(); setWidgetPickerOpen(false); setWidgetSearch(""); }}>
              <span>{item.title}</span>
              <small>{item.subtitle}</small>
            </button>)}
            {!availableItems.length && <p>No hidden widgets or saved reports found.</p>}
          </section>
        </div>}
        <button type="button" className="secondary" onClick={() => { setWidgetPickerOpen(false); saveLayout(DASHBOARD_WIDGETS.map(widget => ({ id: widget.id, size: widget.size, visible: true }))); }}>Reset layout</button>
      </div>
    </div>}
    <div className="dashboard-widget-grid">
      {visibleLayout.map(item => {
        const reportId = String(item.id || "").startsWith("report:") ? String(item.id).slice(7) : "";
        const report = reportId ? visibleSavedReports.find(saved => String(saved.id) === reportId) : null;
        const definition = report ? { title: report.title || "Saved report" } : DASHBOARD_WIDGETS.find(widget => widget.id === item.id);
        if (!definition) return null;
        const moveTargets = Object.fromEntries(["left", "right", "up", "down"].map(direction => [direction, dashboardMoveTarget(visibleLayout, item.id, direction)]));
        return <article key={item.id} className={`dashboard-widget size-${item.size} ${item.visible === false ? "hidden-widget" : ""}`}>
          {editable && <div className="dashboard-widget-actions">
            <strong>{definition.title}</strong>
            <button type="button" title="Move left" aria-label={`Move ${definition.title} left`} onClick={() => move(item.id, "left")} disabled={!moveTargets.left}>←</button>
            <button type="button" title="Move right" aria-label={`Move ${definition.title} right`} onClick={() => move(item.id, "right")} disabled={!moveTargets.right}>→</button>
            <button type="button" title="Move up" aria-label={`Move ${definition.title} up`} onClick={() => move(item.id, "up")} disabled={!moveTargets.up}>↑</button>
            <button type="button" title="Move down" aria-label={`Move ${definition.title} down`} onClick={() => move(item.id, "down")} disabled={!moveTargets.down}>↓</button>
            {report?.type === "cards" && <label className="dashboard-report-columns"><span>Cards/row</span><select value={report.cardColumns || 2} onChange={event => patchSavedReport(report.id, { cardColumns: Number(event.target.value) })} aria-label={`Cards per row for ${definition.title}`}><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></label>}
            <label className="dashboard-widget-size"><span className="sr-only">Width for {definition.title}</span><select value={item.size} onChange={event => patchWidget(item.id, { size: event.target.value })} aria-label={`Width for ${definition.title}`}><option value="quarter">¼</option><option value="half">½</option><option value="three-quarter">¾</option><option value="full">Full</option></select></label>
            <button onClick={() => patchWidget(item.id, { visible: false })}>Hide</button>
          </div>}
          <DashboardWidgetContent id={item.id} data={data} leads={leads} cards={cards} report={report} />
        </article>;
      })}
    </div>
  </section>;
}

function dashboardGridPositions(items) {
  const spans = { quarter: 1, half: 2, "three-quarter": 3, full: 4 };
  let row = 0;
  let column = 0;
  return items.map(item => {
    const span = spans[item.size] || 2;
    if (column + span > 4) { row += 1; column = 0; }
    const position = { id: item.id, row, column, span, center: column + span / 2 };
    column += span;
    if (column === 4) { row += 1; column = 0; }
    return position;
  });
}

function dashboardMoveTarget(items, id, direction) {
  const positions = dashboardGridPositions(items);
  const current = positions.find(position => position.id === id);
  if (!current) return null;
  if (direction === "left" || direction === "right") {
    const candidates = positions.filter(position => position.row === current.row && (direction === "left" ? position.column < current.column : position.column > current.column));
    candidates.sort((a, b) => direction === "left" ? b.column - a.column : a.column - b.column);
    return candidates[0]?.id || null;
  }
  const candidates = positions.filter(position => direction === "up" ? position.row < current.row : position.row > current.row);
  if (!candidates.length) return null;
  const targetRow = direction === "up" ? Math.max(...candidates.map(position => position.row)) : Math.min(...candidates.map(position => position.row));
  return candidates.filter(position => position.row === targetRow).sort((a, b) => Math.abs(a.center - current.center) - Math.abs(b.center - current.center))[0]?.id || null;
}

function DashboardWidgetContent({ id, data, leads, cards, report }) {
  if (report) return <article className="panel dashboard-report-widget">
    <div className="dashboard-report-widget-head">
      <span>Saved report</span>
      <h3>{report.title || "Untitled report"}</h3>
      {report.description && <p>{report.description}</p>}
    </div>
    <ReportVisual report={report} data={buildLiveReportData(report, leads)} compact />
  </article>;
  if (id === "stats") return <section className="stats-grid dashboard-stats-widget">
    {cards.map(([label, value, trend, Icon, color]) => (
      <article className="stat-card" key={label}>
        <div className={`stat-icon ${color}`}><Icon /></div>
        <div><span>{label}</span><strong>{Number(value || 0).toLocaleString()}</strong>{trend && <small className={String(trend).includes("overdue") ? "warning" : ""}>{trend}</small>}</div>
      </article>
    ))}
  </section>;
  if (id === "funnel") return <article className="panel funnel-panel">
    <PanelTitle title="Admissions view" subtitle="Lead movement this academic year" action="Live" />
    <div className="funnel">{(data.funnel || []).map((item, index) => {
      const previous = Number(data.funnel?.[index - 1]?.value || 0);
      const conversion = index && previous ? Math.round((Number(item.value || 0) / previous) * 100) : 100;
      return <div className="funnel-row" key={item.label}><div className="funnel-label"><span>{item.label}</span><strong>{item.value}</strong></div><div className="track"><span style={{ width: `${Math.max(7, 100 - index * 14)}%`, background: item.color }} /></div><small>{index ? `${conversion}% conversion` : "100% of enquiries"}</small></div>;
    })}</div>
  </article>;
  if (id === "tasks") {
    const due = (leads || []).filter(lead => lead.nextFollowup || lead.followupAt).slice(0, 6);
    return <article className="panel tasks-panel"><PanelTitle title="Today’s priorities" subtitle="Follow-ups requiring action" action="Live" /><div className="task-list">{due.length ? due.map(lead => <div className="task" key={lead.id || lead.leadId}><span className="task-dot urgent" /><span className="avatar muted">{String(lead.studentName || "?").slice(0, 2).toUpperCase()}</span><div><strong>{lead.studentName || "Unnamed lead"}</strong><span>{[lead.stage, lead.nextFollowup || lead.followupAt].filter(Boolean).join(" · ")}</span></div></div>) : <div className="empty"><strong>No pending follow-ups</strong><span>You’re all caught up.</span></div>}</div></article>;
  }
  if (id === "recent") return <article className="panel recent"><PanelTitle title="Recent leads" subtitle="Latest enquiries across all sources" action="Live" /><LeadTable leads={(leads?.length ? leads : data.recentLeads || []).slice(0, 8)} /></article>;
  return null;
}

function ReportsPage() {
  const { selectedUnit } = useBusinessUnit();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [reportLeads, setReportLeads] = useState([]);
  const [reportMeta, setReportMeta] = useState(null);
  const [builderActive, setBuilderActive] = useState(false);
  const [reportsTab, setReportsTab] = useState("library");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!selectedUnit?.id) return;
    setData(null);
    setError("");
    Promise.all([api("/dashboard"), api("/leads"), api("/leads/meta")])
      .then(([dashboard, leadsResult, meta]) => {
        setData(dashboard);
        setReportLeads(leadsResult.data || []);
        setReportMeta(meta);
      })
      .catch((err) => setError(err.message));
  }, [selectedUnit?.id]);
  if (error) return <ErrorState message={error} />;
  if (!data) return <Loading />;
  const cards = [
    ["Total leads", data.stats.totalLeads, "Live", Users, "violet"],
    ["New this week", data.stats.newThisWeek, "Live", Target, "blue"],
    ["Follow-ups due", data.stats.followupsDue, "Live", CalendarClock, "orange"],
    ["Completed", data.stats.admissions, "Live", GraduationCap, "green"],
  ];
  return (
    <main className={`page report-page ${builderActive ? "builder-active" : ""}`}>
      {!builderActive && <div className="page-heading">
        <div>
          <span className="eyebrow">{selectedUnit.name}</span>
          <h1>Reports</h1>
          <p>Build, customize and save reusable business intelligence reports.</p>
        </div>
      </div>}
      {!builderActive && <div className="report-page-tabs" role="tablist" aria-label="Reports workspace">
        <button type="button" className={reportsTab === "library" ? "active" : ""} onClick={() => setReportsTab("library")}>Reports library</button>
        <button type="button" className={reportsTab === "dashboard" ? "active" : ""} onClick={() => setReportsTab("dashboard")}>Dashboard layout</button>
      </div>}
      {reportsTab === "dashboard" && !builderActive
        ? <DashboardOverviewCanvas data={data} leads={reportLeads} cards={cards} editable />
        : <ReportBuilder data={data} leads={reportLeads} leadFields={reportMeta?.leadFields || []} onModeChange={setBuilderActive} createNewSignal={location.state?.createNewReportAt} returnTo={location.state?.returnTo} />}
    </main>
  );
}

function SavedReportCreatePage() {
  const { selectedUnit } = useBusinessUnit();
  const location = useLocation();
  const [createSignal] = useState(() => location.state?.createNewReportAt || Date.now());
  const [data, setData] = useState(null);
  const [reportLeads, setReportLeads] = useState([]);
  const [reportMeta, setReportMeta] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!selectedUnit?.id) return;
    setData(null);
    setError("");
    Promise.all([api("/dashboard"), api("/leads"), api("/leads/meta")])
      .then(([dashboard, leadsResult, meta]) => {
        setData(dashboard);
        setReportLeads(leadsResult.data || []);
        setReportMeta(meta);
      })
      .catch((err) => setError(err.message));
  }, [selectedUnit?.id]);
  if (error) return <ErrorState message={error} />;
  if (!data) return <Loading />;
  return <main className="page report-page builder-active saved-report-create-page">
    <ReportBuilder data={data} leads={reportLeads} leadFields={reportMeta?.leadFields || []} createNewSignal={createSignal} returnTo="dashboard-saved" />
  </main>;
}

function LeadTable({ leads }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Student</th>
            <th>Lead ID</th>
            <th>Applying for</th>
            <th>Stage</th>
            <th>Score</th>
            <th>Owner</th>
            <th>Next follow-up</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id}>
              <td>
                <div className="student">
                  <span className="avatar muted">
                    {lead.studentName
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </span>
                  <span>
                    <strong>{lead.studentName}</strong>
                    <small>{lead.phone}</small>
                  </span>
                </div>
              </td>
              <td>
                <b className="lead-id">{lead.leadId}</b>
              </td>
              <td>{lead.applyingClass}</td>
              <td>
                <span
                  className={`stage ${lead.stage.toLowerCase().replace(" ", "-")}`}
                >
                  {lead.stage}
                </span>
              </td>
              <td>
                <span className="score">
                  <i style={{ width: `${lead.score}%` }} />
                  {lead.score}
                </span>
              </td>
              <td>{lead.owner}</td>
              <td>{lead.nextFollowup}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!leads.length && (
        <div className="empty">
          <UserRound />
          <strong>No leads found</strong>
          <span>Try a different search term.</span>
        </div>
      )}
    </div>
  );
}

function PanelTitle({ title, subtitle, action, link }) {
  return (
    <div className="panel-title">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <button className={link ? "text-btn" : "secondary"}>
        {action}
        {!link && <ChevronDown size={15} />}
      </button>
    </div>
  );
}
function ComingSoon() {
  return (
    <main className="page">
      <div className="empty big">
        <Sparkles />
        <strong>This module is next</strong>
        <span>
          The navigation is ready; implementation will continue module by
          module.
        </span>
      </div>
    </main>
  );
}
function Loading() {
  return (
    <div className="loading">
      <span />
      <p>Loading workspace…</p>
    </div>
  );
}
function ErrorState({ message }) {
  const navigate = useNavigate();
  return (
    <div className="empty big">
      <CircleHelp />
      <strong>Unable to load data</strong>
      <span>{message}</span>
      <button className="primary" onClick={() => navigate("/login")}>
        Return to login
      </button>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(loadStoredUser);
  const logout = () => {
    localStorage.removeItem("crm_token");
    localStorage.removeItem("crm_user");
    setUser(null);
  };
  useEffect(() => {
    const handleExpiredSession = () => setUser(null);
    window.addEventListener("crm:session-expired", handleExpiredSession);
    return () => window.removeEventListener("crm:session-expired", handleExpiredSession);
  }, []);
  useEffect(() => {
    if (!user) return undefined;
    const expiresAt = getTokenExpiry();
    const expireSession = () => {
      localStorage.removeItem("crm_token");
      localStorage.removeItem("crm_user");
      setUser(null);
    };
    if (!expiresAt || expiresAt <= Date.now()) {
      expireSession();
      return undefined;
    }
    const timer = window.setTimeout(expireSession, expiresAt - Date.now());
    return () => window.clearTimeout(timer);
  }, [user]);
  return (
    <Routes>
      <Route
        path="/public/enquiry/:formKey"
        element={<PublicEnquiryRoute />}
      />
      <Route
        path="/payment/:formKey"
        element={<PublicPaymentPage />}
      />
      <Route
        path="/login"
        element={user ? <Navigate to="/" /> : <Login onLogin={setUser} />}
      />
      <Route
        path="/*"
        element={
          user ? (
            <BusinessUnitProvider><Shell user={user} onLogout={logout} /></BusinessUnitProvider>
          ) : (
            <Navigate to="/login" />
          )
        }
      />
    </Routes>
  );
}

function PublicEnquiryRoute() {
  const { formKey } = useParams();
  return <PublicEnquiryForm formKey={formKey} />;
}
