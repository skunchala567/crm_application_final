import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "./api";
import BusinessUnitLeadRouter from "./DynamicLeadsPage.jsx";
import AutomationPage from "./AutomationPage.jsx";
import WhatsAppInbox from "./WhatsAppInbox.jsx";
import OAuthCallbackPage from "./pages/OAuthCallbackPage.jsx";
import GlobalSearch from "./GlobalSearch.jsx";
import ScreenErrorBoundary from "./components/ScreenErrorBoundary.jsx";
import ReportBuilder, { SavedReportsDashboard, ReportVisual, buildLiveReportData, canViewSavedReport, readSavedReports, writeSavedReports } from "./ReportBuilder.jsx";
import PublicEnquiryForm from "./PublicEnquiryForm.jsx";
import PublicPaymentPage from "./pages/PublicPaymentPage.jsx";
import { BusinessUnitProvider, useBusinessUnit } from "./BusinessUnitContext.jsx";
import { LeadQuickActionsProvider } from "./LeadQuickActionsContext.jsx";
import { PermissionProvider, usePermissions } from "./PermissionContext.jsx";
import { RequirePermission } from "./components/Can.jsx";
import { DASHBOARD_HEIGHT_LABELS, DASHBOARD_WIDGETS, dashboardMoveTarget, defaultDashboardLayout, isSameDashboardLayout, normalizeDashboardLayout, readDashboardLayout, writeDashboardLayout } from "./lib/dashboardLayout.js";
import { useDailyUsage } from "./lib/useDailyUsage.js";
import AuthLayout from "./components/AuthLayout.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Header from "./components/Header.jsx";
import IdleWarning from "./components/IdleWarning.jsx";
import DeletionPasswordDialog from "./components/DeletionPasswordDialog.jsx";
import DashboardPage, { CurriculumClassStageWidget } from "./components/DashboardPage.jsx";
import SettingsPageModern from "./components/SettingsPageModern.jsx";
import OperationsPageModern from "./components/OperationsPageModern.jsx";
import BulkActionsPageModern from "./components/BulkActionsPageModern.jsx";
import { Button, Input } from "./components/ui/index.js";
import "./SidebarTogglePosition.css";
import "./DashboardCanvas.css";
// Must stay the last stylesheet imported: it applies the reference design
// language over every legacy sheet above.
import "./styles/design-system.css";
import { BarChart3, CalendarClock, ChevronDown, CircleHelp, CreditCard, Eye, EyeOff, GraduationCap, LayoutDashboard, MessageSquare, Plus, Search, Settings2, Settings, Sparkles, Target, UploadCloud, UserCog, UserRound, Users, Zap, Workflow } from "lucide-react";

// [label, path, icon, section, permission]
// `section` drives the sidebar's group headers; `permission` decides whether
// the entry is shown at all. Navigation and routing read the same key, so a
// hidden link and a blocked route can never disagree.
const menu = [
  ["Dashboard", "/", LayoutDashboard, "Main", "dashboard.overview.view"],
  ["Leads", "/leads", Users, "Main", "leads.list.view"],
  ["Tracker", "/tracker", Workflow, "Main", "tracker.board.view"],
  ["Bulk Actions", "/bulk-actions", UploadCloud, "Operations", "bulk_actions.workspace.view"],
  ["Reports", "/reports", BarChart3, "Operations", "reports.list.view"],
  ["Automations", "/automations", Zap, "Operations", "automations.workflows.view"],
  /*
   * Listed under each business unit rather than under Settings.
   *
   * Opening one of these from a unit's section selects that unit first, so
   * the screen loads that unit's data -- which is the point of moving them.
   * Settings keeps only what is genuinely shared: Business Units itself, and
   * Integrations, which connects one account for the whole system.
   */
  ["Payments", "/payments", CreditCard, "Operations", ["payments.collections.view", "payments.forms.view", "payments.links.view", "payments.links.create", "payments.enquiry_forms.view"]],
  ["User Management", "/user-management", UserCog, "Operations", "settings.users.view"],
  ["Templates", "/templates", MessageSquare, "Operations", ["whatsapp.templates.view", "sms.templates.view", "email.templates.view"]],
];

const SETTINGS_SCREEN_PERMISSIONS = [
  'settings.users.view','settings.access_control.view','settings.business_units.view','settings.branches.view',
  'payments.collections.view','payments.forms.view','payments.links.view','payments.links.create','payments.enquiry_forms.view',
  'integrations.hub.view','integrations.google_sheets.view','integrations.meta_lead_ads.view','integrations.callerdesk.view','integrations.smartflo.view',
  'whatsapp.templates.view','sms.templates.view','email.configuration.view','email.templates.view',
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem("crm_token", result.token);
      localStorage.setItem("crm_user", JSON.stringify(result.user));
      onLogin(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} className="space-y-6">
        {/* Form Header */}
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-blue-600 mb-2">
            Welcome back
          </p>
          <h2 className="text-3xl font-bold text-foreground font-display mb-1">
            Sign in to your CRM
          </h2>
          <p className="text-sm text-secondary-600">
            Use your existing Attendance application account.
          </p>
        </div>

        {/* Email Field */}
        <div className="space-y-2">
          <label className="text-sm font-semibold text-foreground">
            Email address
          </label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
          />
        </div>

        {/* Password Field */}
        <div className="space-y-2">
          <label className="text-sm font-semibold text-foreground">
            Password
          </label>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-secondary-500 hover:text-foreground transition-colors"
              aria-label={showPassword ? "Hide password" : "Show password"}
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
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Submit Button */}
        <Button
          type="submit"
          disabled={loading}
          className="w-full"
          size="lg"
        >
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}

function Shell({ user, onLogout }) {
  const { selectedId: activeBusinessUnitId } = useBusinessUnit();
  const { can } = usePermissions();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Counts active time for the calendar day and signs out after 10 minutes
  // of inactivity, warning for the last 2. Signing out flushes first: logout clears the auth token, so
  // a pending delta posted afterwards would be rejected and the time lost.
  const {
    formatted: usageTime, flushNow, persisting: usageSaved,
    stayActive, secondsUntilLogout, idleSeconds, idleLimit,
  } = useDailyUsage({ onIdleLogout: () => onLogout() });

  // Append ?idledebug=1 to any URL to watch the idle clock live.
  // window.location, not the router's `location`, which is declared below.
  const showIdleDebug = new URLSearchParams(window.location.search).get('idledebug') === '1';
  const signOut = async () => {
    try { await flushNow(); } finally { onLogout(); }
  };
  const [navCollapsed, setNavCollapsed] = useState(
    () => localStorage.getItem("crm_sidebar_collapsed") === "true"
  );

  // The topbar button beside the screen name drives the sidebar: on desktop it
  // collapses/expands, on mobile it opens and closes the drawer. It used to
  // only ever open on mobile, so the button became inert once the drawer was
  // showing and the scrim was the only way back.
  const toggleNav = () => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      setNavCollapsed((current) => {
        const next = !current;
        localStorage.setItem("crm_sidebar_collapsed", String(next));
        return next;
      });
    } else {
      setMobileNavOpen((current) => !current);
    }
  };
  const navigate = useNavigate();
  const location = useLocation();

  // Branch Settings, Meta Lead Ads, CallerDesk and Smartflo are deliberately
  // absent: they are reached from Integrations, or from Business Units >
  // Branches & payments. Their routes still exist and still work.
  // Nav is filtered by the same permissions that guard the routes, so a link
  // is never shown to a screen the user would be refused.
  const settingsMenu = [
    { label: 'Business Units', path: '/settings/business-units', permission: 'settings.business_units.view' },
    /*
     * Integrations is the way in to every connected service. Email
     * Configuration and Google Sheets are reached by opening their tile
     * there, not by their own sidebar entries -- one door per service rather
     * than a growing list that duplicates the grid. Their routes still
     * resolve, so links and the tiles' navigation keep working.
     */
    /* No Integrations entry of its own: accounts belong to a business unit,
       so they are configured on that unit's Integrations tab, reached from
       Business Units. /settings/integrations still resolves -- it redirects
       there -- so existing links and the provider screens keep working. */
  ].filter((item) => can(item.permission));

  /*
   * One Leads entry per lead pipeline.
   *
   * A business unit can run several, and each has its own Leads screen --
   * same features, scoped to that pipeline. With a single pipeline the entry
   * stays plain "Leads" pointing at /leads, so nothing changes for a unit
   * that never splits them.
   */
  const [leadPipelines, setLeadPipelines] = useState([]);
  useEffect(() => {
    if (!activeBusinessUnitId || !can('leads.list.view')) { setLeadPipelines([]); return; }
    let cancelled = false;
    api('/leads/pipelines')
      .then((result) => { if (!cancelled) setLeadPipelines(result.data || []); })
      .catch(() => { if (!cancelled) setLeadPipelines([]); });
    return () => { cancelled = true; };
  }, [activeBusinessUnitId]);

  /*
   * The plain list, and the one with Leads split per pipeline.
   *
   * Pipelines are fetched for the unit currently selected, so expanding them
   * under every unit heading listed another unit's pipelines under its name.
   * The sidebar uses the expanded list for the active unit and the plain one
   * for the rest -- opening those switches unit, and their own pipelines
   * appear once they are the active one.
   */
  const visibleMenu = menu.filter(([, , , , permission]) => Array.isArray(permission) ? permission.some(key=>can(key)) : can(permission));
  const activeUnitMenu = visibleMenu.flatMap((entry) => {
    if (entry[1] !== '/leads' || leadPipelines.length < 2) return [entry];
    const [, , Icon, section, permission] = entry;
    return leadPipelines.map((pipeline) => [
      pipeline.displayName, `/leads/pipeline/${pipeline.id}`, Icon, section, permission,
    ]);
  });

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {showIdleDebug && (
        <div className="fixed bottom-3 left-3 z-[400] px-3 py-2 rounded-lg bg-secondary-900 text-white text-xs font-mono shadow-lg">
          idle {idleSeconds}s / {idleLimit}s
          {secondsUntilLogout !== null && ` · warning ${secondsUntilLogout}s`}
        </div>
      )}

      {secondsUntilLogout !== null && (
        <IdleWarning
          secondsLeft={secondsUntilLogout}
          onStay={stayActive}
          onSignOut={signOut}
        />
      )}

      {/* Answers the API's deletion-password challenge from anywhere in the app. */}
      <DeletionPasswordDialog />

      <Sidebar
        menu={visibleMenu}
        activeUnitMenu={activeUnitMenu}
        settings={settingsMenu}
        mobileOpen={mobileNavOpen}
        onMobileOpenChange={setMobileNavOpen}
        collapsed={navCollapsed}
        onToggle={toggleNav}
      />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* One topbar for every screen. GlobalSearch is passed through so the
            search field sits inside it rather than in a bar of its own. */}
        <Header user={user} onLogout={signOut} onMenuClick={toggleNav} navCollapsed={navCollapsed} mobileNavOpen={mobileNavOpen} usageTime={usageTime} usageSaved={usageSaved}>
          {/* Search reads across every lead the user may see, so it is gated
              like any other lead view. The API refuses /api/search without
              this permission regardless; hiding the field stops a counsellor
              typing into a box that can only answer with an error. */}
          {can('leads.search.view') && <GlobalSearch />}
        </Header>

        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
          {/* Inside <main>, so a screen that throws leaves the sidebar and
              header intact and the user can navigate away. routeKey clears the
              error when the route changes. */}
          <ScreenErrorBoundary routeKey={location.pathname}>
          <Routes location={location}>
            <Route path="/" element={<RequirePermission do="dashboard.overview.view"><DashboardPage key={activeBusinessUnitId} user={user} /></RequirePermission>} />
            <Route path="/leads" element={<RequirePermission do="leads.list.view"><BusinessUnitLeadRouter key={activeBusinessUnitId} /></RequirePermission>} />
            {/* The same screen, scoped to one pipeline. Keyed on the pipeline
                so switching between two of them starts from a clean slate
                rather than carrying the previous one's selection. */}
            <Route path="/leads/pipeline/:pipelineId" element={<RequirePermission do="leads.list.view"><BusinessUnitLeadRouter key={`${activeBusinessUnitId}-pipeline`} /></RequirePermission>} />
            <Route path="/tracker" element={<RequirePermission do="tracker.board.view"><OperationsPageModern key={activeBusinessUnitId} /></RequirePermission>} />
            <Route path="/operations" element={<Navigate to="/tracker" replace />} />
            <Route path="/whatsapp-inbox" element={<RequirePermission do="whatsapp.inbox.view"><WhatsAppInbox /></RequirePermission>} />
            <Route path="/bulk-actions" element={<RequirePermission do="bulk_actions.workspace.view"><BulkActionsPageModern key={activeBusinessUnitId} /></RequirePermission>} />
            <Route path="/reports" element={<RequirePermission do="reports.list.view"><ReportsPage key={activeBusinessUnitId} /></RequirePermission>} />
            <Route path="/saved-reports/new" element={<RequirePermission do="reports.builder.view"><SavedReportCreatePage key={activeBusinessUnitId} /></RequirePermission>} />
            <Route path="/settings" element={<RequirePermission any={SETTINGS_SCREEN_PERMISSIONS}><SettingsPageModern /></RequirePermission>} />
            {/* Moved out of Settings and under each business unit, so they
                get paths of their own -- the old ones still resolve as
                redirects, and the breadcrumb and sidebar no longer file them
                under Settings. */}
            <Route path="/user-management" element={<RequirePermission do="settings.users.view"><SettingsPageModern /></RequirePermission>} />
            <Route path="/payments" element={<RequirePermission any={["payments.collections.view","payments.forms.view","payments.links.view","payments.links.create","payments.enquiry_forms.view"]}><SettingsPageModern /></RequirePermission>} />
            <Route path="/templates" element={<RequirePermission any={["whatsapp.templates.view","sms.templates.view","email.templates.view"]}><SettingsPageModern /></RequirePermission>} />
            <Route path="/settings/users" element={<Navigate to="/user-management" replace />} />
            <Route path="/settings/business-units" element={<RequirePermission do="settings.business_units.view"><SettingsPageModern /></RequirePermission>} />
            <Route path="/settings/branches" element={<RequirePermission do="settings.branches.view"><SettingsPageModern /></RequirePermission>} />
            <Route path="/settings/payments" element={<Navigate to="/payments" replace />} />
            <Route path="/settings/payment-forms" element={<RequirePermission do="payments.forms.view"><SettingsPageModern /></RequirePermission>} />
            <Route path="/settings/payment-collections" element={<RequirePermission do="payments.collections.view"><SettingsPageModern /></RequirePermission>} />
            <Route path="/settings/lead-config" element={<Navigate to="/settings/business-units?tab=sources" replace />} />
            <Route path="/settings/academic-config" element={<Navigate to="/settings/business-units?tab=academic" replace />} />
            <Route path="/settings/academic-years" element={<Navigate to="/settings/business-units?tab=academic" replace />} />
            <Route path="/settings/admission-classes" element={<Navigate to="/settings/business-units?tab=academic&section=classes" replace />} />
            {/* Moved onto the business unit that owns the accounts. */}
            <Route path="/settings/integrations" element={<RequirePermission do="integrations.hub.view"><SettingsPageModern /></RequirePermission>} />
            <Route path="/settings/google-sheets" element={<RequirePermission do="integrations.google_sheets.view"><SettingsPageModern /></RequirePermission>} />
            <Route path="/settings/meta-lead-ads" element={<RequirePermission do="integrations.meta_lead_ads.view"><SettingsPageModern /></RequirePermission>} />
            <Route path="/settings/templates" element={<Navigate to="/templates" replace />} />
            <Route path="/settings/whatsapp-templates" element={<RequirePermission do="whatsapp.templates.view"><SettingsPageModern /></RequirePermission>} />
            <Route path="/settings/sms-templates" element={<RequirePermission do="sms.templates.view"><SettingsPageModern /></RequirePermission>} />
            <Route path="/settings/email-configuration" element={<RequirePermission do="email.configuration.view"><SettingsPageModern /></RequirePermission>} />
            <Route path="/settings/email-templates" element={<RequirePermission do="email.templates.view"><SettingsPageModern /></RequirePermission>} />
            <Route path="/settings/callerdesk" element={<RequirePermission do="integrations.callerdesk.view"><SettingsPageModern /></RequirePermission>} />
            <Route path="/settings/smartflo" element={<RequirePermission do="integrations.smartflo.view"><SettingsPageModern /></RequirePermission>} />
            <Route path="/integrations" element={<Navigate to="/settings/integrations" replace />} />
            <Route path="/oauth-callback" element={<OAuthCallbackPage />} />
            <Route path="/oauth-error" element={<OAuthCallbackPage />} />
            <Route path="/automations" element={<RequirePermission do="automations.workflows.view"><AutomationPage key={activeBusinessUnitId} /></RequirePermission>} />
            <Route path="*" element={<ComingSoon />} />
          </Routes>
          </ScreenErrorBoundary>
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

function DashboardOverviewCanvas({ data, leads = [], cards, editable = false }) {
  const { selectedUnit } = useBusinessUnit();
  const [savedLayout, setSavedLayout] = useState(() => readDashboardLayout(selectedUnit?.id));
  const [layout, setLayout] = useState(savedLayout);
  const [savedReports, setSavedReports] = useState(() => readSavedReports(selectedUnit?.id));
  const [reportColumnDrafts, setReportColumnDrafts] = useState({});
  const [widgetPickerOpen, setWidgetPickerOpen] = useState(false);
  const [widgetSearch, setWidgetSearch] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    const stored = readDashboardLayout(selectedUnit?.id);
    setSavedLayout(stored);
    setLayout(stored);
    setReportColumnDrafts({});
  }, [selectedUnit?.id]);
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
  useEffect(() => {
    if (!justSaved) return undefined;
    const timer = setTimeout(() => setJustSaved(false), 2600);
    return () => clearTimeout(timer);
  }, [justSaved]);
  // Edits stay local until Save changes is pressed, so the Dashboard overview
  // never shows a half-finished layout.
  const stageLayout = next => {
    setLayout(normalizeDashboardLayout(next));
    setJustSaved(false);
  };
  const dirty = !isSameDashboardLayout(layout, savedLayout) || Object.keys(reportColumnDrafts).length > 0;
  const commit = () => {
    setSavedLayout(writeDashboardLayout(selectedUnit?.id, layout));
    if (Object.keys(reportColumnDrafts).length) {
      const next = savedReports.map(report => (reportColumnDrafts[report.id] === undefined
        ? report
        : { ...report, cardColumns: reportColumnDrafts[report.id], updatedAt: new Date().toISOString() }));
      writeSavedReports(selectedUnit?.id, next);
      setSavedReports(next);
      setReportColumnDrafts({});
    }
    setJustSaved(true);
  };
  const discard = () => {
    setLayout(savedLayout);
    setReportColumnDrafts({});
    setJustSaved(false);
  };
  const move = (id, direction) => {
    const visible = layout.filter(item => item.visible !== false);
    const targetId = dashboardMoveTarget(visible, id, direction);
    if (!targetId) return;
    const next = [...layout];
    const index = next.findIndex(item => item.id === id);
    const target = next.findIndex(item => item.id === targetId);
    [next[index], next[target]] = [next[target], next[index]];
    stageLayout(next);
  };
  const patchWidget = (id, values) => stageLayout(layout.map(item => item.id === id ? { ...item, ...values } : item));
  const stageReportColumns = (id, cardColumns) => {
    setReportColumnDrafts(drafts => ({ ...drafts, [id]: cardColumns }));
    setJustSaved(false);
  };
  const reportColumnsFor = report => reportColumnDrafts[report.id] ?? report.cardColumns ?? 2;
  const addReportWidget = report => {
    const id = `report:${report.id}`;
    stageLayout(layout.some(item => item.id === id) ? layout.map(item => item.id === id ? { ...item, visible: true } : item) : [{ id, size: "half", height: "auto", fitToHeight: false, visible: true }, ...layout]);
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
      <div><Settings2 size={17} /><span><strong>Dashboard layout editor</strong><small>Add widgets and adjust how the Dashboard overview appears for this business unit.{dirty ? " You have unsaved changes." : ""}</small></span></div>
      <div className="dashboard-widget-picker-wrap">
        {dirty && <span className="dashboard-layout-status unsaved">Unsaved changes</span>}
        {!dirty && justSaved && <span className="dashboard-layout-status saved">Saved to Dashboard</span>}
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
        <button type="button" className="secondary" onClick={() => { setWidgetPickerOpen(false); stageLayout(defaultDashboardLayout()); }}>Reset layout</button>
        <button type="button" className="secondary" onClick={discard} disabled={!dirty}>Discard</button>
        <button type="button" onClick={commit} disabled={!dirty}>Save changes</button>
      </div>
    </div>}
    <div className="dashboard-widget-grid">
      {visibleLayout.map(item => {
        const reportId = String(item.id || "").startsWith("report:") ? String(item.id).slice(7) : "";
        const report = reportId ? visibleSavedReports.find(saved => String(saved.id) === reportId) : null;
        const definition = report ? { title: report.title || "Saved report" } : DASHBOARD_WIDGETS.find(widget => widget.id === item.id);
        if (!definition) return null;
        const moveTargets = Object.fromEntries(["left", "right", "up", "down"].map(direction => [direction, dashboardMoveTarget(visibleLayout, item.id, direction)]));
        return <article key={item.id} className={`dashboard-widget size-${item.size} height-${item.height || "auto"} ${item.fitToHeight && item.height !== "auto" ? "fit-to-height" : ""} ${item.visible === false ? "hidden-widget" : ""}`}>
          {editable && <div className="dashboard-widget-actions">
            <strong>{definition.title}</strong>
            <button type="button" title="Move left" aria-label={`Move ${definition.title} left`} onClick={() => move(item.id, "left")} disabled={!moveTargets.left}>←</button>
            <button type="button" title="Move right" aria-label={`Move ${definition.title} right`} onClick={() => move(item.id, "right")} disabled={!moveTargets.right}>→</button>
            <button type="button" title="Move up" aria-label={`Move ${definition.title} up`} onClick={() => move(item.id, "up")} disabled={!moveTargets.up}>↑</button>
            <button type="button" title="Move down" aria-label={`Move ${definition.title} down`} onClick={() => move(item.id, "down")} disabled={!moveTargets.down}>↓</button>
            {report?.type === "cards" && <label className="dashboard-report-columns"><span>Cards/row</span><select value={reportColumnsFor(report)} onChange={event => stageReportColumns(report.id, Number(event.target.value))} aria-label={`Cards per row for ${definition.title}`}><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></label>}
            <label className="dashboard-widget-size"><span className="sr-only">Width for {definition.title}</span><select value={item.size} onChange={event => patchWidget(item.id, { size: event.target.value })} aria-label={`Width for ${definition.title}`}><option value="quarter">¼</option><option value="half">½</option><option value="three-quarter">¾</option><option value="full">Full</option></select></label>
            <label className="dashboard-widget-height"><span>Height</span><select value={item.height || "auto"} onChange={event => patchWidget(item.id, { height: event.target.value })} aria-label={`Height for ${definition.title}`}>{DASHBOARD_HEIGHT_LABELS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
            <label className={`dashboard-widget-fit ${item.height === "auto" ? "disabled" : ""}`} title={item.height === "auto" ? "Select a fixed height first" : "Scale the report to the selected height"}><input type="checkbox" checked={item.fitToHeight === true} disabled={item.height === "auto"} onChange={event => patchWidget(item.id, { fitToHeight: event.target.checked })}/><span>Fit report</span></label>
            {String(item.id).startsWith("report:") && <button onClick={() => patchWidget(item.id, { visible: false })}>Remove</button>}
          </div>}
          <DashboardWidgetContent id={item.id} data={data} leads={leads} cards={cards} report={report ? { ...report, cardColumns: reportColumnsFor(report) } : null} />
        </article>;
      })}
    </div>
  </section>;
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
  if (id === "activity") return <DashboardActivityPreview trends={data.activityTrends || []} />;
  if (id === "curriculum-stage") return <CurriculumClassStageWidget leads={leads} stages={(data.funnel || []).map(item => item.label)} />;
  if (id === "funnel") return <article className="panel funnel-panel">
    <PanelTitle title="Admissions view" subtitle="Lead movement this academic year" action="Live" />
    <div className="funnel">{(() => {
      const funnel = data.funnel || [];
      const values = funnel.map(item => Math.max(0, Number(item.value) || 0));
      const maximum = Math.max(...values, 0);
      const total = values.reduce((sum, value) => sum + value, 0);
      return funnel.map((item, index) => {
        const value = values[index];
        const previous = values[index - 1] || 0;
        const width = maximum ? value / maximum * 100 : 0;
        const share = total ? Math.round(value / total * 100) : 0;
        const conversion = previous ? Math.round(value / previous * 100) : null;
        const label = `${index > 0 && conversion !== null ? conversion : share}%`;
        return <div className="funnel-row" key={item.label}><div className="funnel-label"><span>{item.label}</span><strong>{item.value}</strong></div><div className="track"><span style={{ width: `${width}%`, background: item.color }} /></div><small>{label}</small></div>;
      });
    })()}</div>
  </article>;
  return null;
}

function DashboardActivityPreview({ trends }) {
  const [metric, setMetric] = useState("crmHours");
  const options = { crmHours: ["CRM hours", "h", "var(--brand-600)"], leadsAssigned: ["Leads added to me", "", "#4e8bd8"], followupsDone: ["Follow-ups done", "", "#d9823b"] };
  const [label, suffix, color] = options[metric];
  const values = trends.map(item => Number(item[metric]) || 0);
  const maximum = Math.max(...values, 1);
  const points = values.map((value, index) => `${30 + index * (580 / Math.max(values.length - 1, 1))},${175 - value / maximum * 130}`).join(" ");
  return <article className="panel dashboard-report-widget"><div className="dashboard-report-widget-head"><span>Personal report</span><h3>My Daily CRM Activity</h3><select className="dashboard-activity-select" value={metric} onChange={event => setMetric(event.target.value)}>{Object.entries(options).map(([key, item]) => <option key={key} value={key}>{item[0]}</option>)}</select></div><div className="dashboard-activity-chart"><svg viewBox="0 0 640 210"><polyline points={points} fill="none" style={{ stroke: color }} strokeWidth="3" />{values.map((value, index) => { const x=30+index*(580/Math.max(values.length-1,1)),y=175-value/maximum*130; return <g key={index}><circle cx={x} cy={y} r="4" fill="#fff" style={{ stroke: color }} strokeWidth="3"/><text x={x} y={y-10} textAnchor="middle" className="activity-value-label">{`${metric==="crmHours"?value.toFixed(1):value}${suffix}`}</text></g>; })}</svg></div><div className="dashboard-activity-legend"><i style={{background:color}}/><span>{label}</span></div></article>;
}

function ReportsPage() {
  const { selectedUnit } = useBusinessUnit();
  const { can } = usePermissions();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [reportLeads, setReportLeads] = useState([]);
  const [reportMeta, setReportMeta] = useState(null);
  const [builderActive, setBuilderActive] = useState(false);
  const [reportsTab, setReportsTab] = useState(location.state?.reportsTab === "dashboard" ? "dashboard" : "library");
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
      {!builderActive && <div className="report-page-tabs" role="tablist" aria-label="Reports workspace">
        <button type="button" className={reportsTab === "library" ? "active" : ""} onClick={() => setReportsTab("library")}>Reports library</button>
        {can('dashboard.layout.view')&&<button type="button" className={reportsTab === "dashboard" ? "active" : ""} onClick={() => setReportsTab("dashboard")}>Dashboard layout</button>}
      </div>}
      {reportsTab === "dashboard" && can('dashboard.layout.view') && !builderActive
        ? <DashboardOverviewCanvas data={data} leads={reportLeads} cards={cards} editable={can('dashboard.layout.edit')} />
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
            <BusinessUnitProvider>
              <PermissionProvider>
                <LeadQuickActionsProvider>
                  <Shell user={user} onLogout={logout} />
                </LeadQuickActionsProvider>
              </PermissionProvider>
            </BusinessUnitProvider>
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
