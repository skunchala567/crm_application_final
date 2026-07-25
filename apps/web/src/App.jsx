import { useEffect, useState } from "react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { api } from "./api";
import LeadsPage from "./LeadsPage.jsx";
import SettingsPage from "./SettingsPage.jsx";
import AutomationPage from "./AutomationPage.jsx";
import BulkActionsPage from "./BulkActionsPage.jsx";
import IntegrationHubPage from "./pages/IntegrationHubPage.jsx";
import OAuthCallbackPage from "./pages/OAuthCallbackPage.jsx";
import GlobalSearch from "./GlobalSearch.jsx";
import {
  BarChart3,
  Bell,
  CalendarClock,
  ChevronDown,
  CircleHelp,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PhoneCall,
  Plus,
  Search,
  Settings,
  Sparkles,
  Target,
  UploadCloud,
  UserRound,
  Users,
  Zap,
  X,
} from "lucide-react";

const menu = [
  ["Dashboard", "/", LayoutDashboard],
  ["Leads", "/leads", Users],
  ["Bulk Actions", "/bulk-actions", UploadCloud],
  ["Reports", "/reports", BarChart3],
  ["Automations", "/automations", Zap],
  ["Integrations", "/integrations", MessageCircle],
  ["Settings", "/settings", Settings],
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
    <main className="login-shell">
      <section className="login-brand">
        <div className="brand-lockup">
          <span className="brand-mark">
            <Sparkles size={25} />
          </span>
          <span>Orbit</span>
        </div>
        <div className="login-copy">
          <span className="eyebrow light">
            Admissions intelligence, simplified
          </span>
          <h1>Turn every enquiry into a meaningful student journey.</h1>
          <p>
            One focused workspace for admissions teams to manage leads,
            follow-ups, applications, and enrolments.
          </p>
        </div>
        <div className="quote-card">
          <p>
            “Our team now knows exactly which family needs attention and when.”
          </p>
          <span>Admissions Office · Greenwood Academy</span>
        </div>
      </section>
      <section className="login-panel">
        <form className="login-form" onSubmit={submit}>
          <span className="mobile-logo">
            <span className="brand-mark">
              <Sparkles size={22} />
            </span>{" "}
            Orbit
          </span>
          <div>
            <span className="eyebrow">Welcome back</span>
            <h2>Sign in to your CRM</h2>
            <p>Use your existing Attendance application account.</p>
          </div>
          <label>
            Email address
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
            />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
          <div className="demo-note">
            <strong>Shared secure access</strong>
            <span>Use your Attendance email and password.</span>
            <span>An approved CRM role is required.</span>
          </div>
        </form>
      </section>
    </main>
  );
}

function Shell({ user, onLogout }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("crm_sidebar_collapsed") === "true");
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const navigate = useNavigate();
  useEffect(() => {
    const timer = setInterval(() => setSessionSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const sessionTime = [Math.floor(sessionSeconds / 3600), Math.floor((sessionSeconds % 3600) / 60), sessionSeconds % 60]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  function toggleSidebar() {
    setSidebarCollapsed(current => { const next=!current; localStorage.setItem("crm_sidebar_collapsed",String(next)); return next; });
  }
  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`${mobileOpen ? "sidebar open" : "sidebar"} ${sidebarCollapsed ? "collapsed" : ""}`}>
        <button className="icon-btn mobile-only sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X/></button>
        <button className="sidebar-toggle" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>{sidebarCollapsed?<PanelLeftOpen/>:<PanelLeftClose/>}</button>
        <nav>
          {menu.map(([label, path, Icon]) => (
            <NavLink
              onClick={() => setMobileOpen(false)}
              key={label}
              to={path}
              end={path === "/"}
            >
              <Icon size={19} />
              <span>{label}</span>
              {label === "Follow-ups" && <b>24</b>}
            </NavLink>
          ))}
          {/* Settings Submenu */}
          <NavLink to="/settings/users" className="settings-submenu-item">
            <span className="submenu-indent">User Management</span>
          </NavLink>
          <NavLink to="/settings/lead-config" className="settings-submenu-item">
            <span className="submenu-indent">Lead Configuration</span>
          </NavLink>
          <NavLink to="/settings/academic-years" className="settings-submenu-item">
            <span className="submenu-indent">Academic Years</span>
          </NavLink>
          <NavLink to="/settings/admission-classes" className="settings-submenu-item">
            <span className="submenu-indent">Admission Classes</span>
          </NavLink>
          <NavLink to="/settings/whatsapp-templates" className="settings-submenu-item">
            <span className="submenu-indent">WhatsApp Templates</span>
          </NavLink>
        </nav>
        <div className="sidebar-help">
          <CircleHelp size={19} />
          <div>
            <strong>Need a hand?</strong>
            <span>Visit the help centre</span>
          </div>
        </div>
        <button className="profile" onClick={onLogout}>
          <span className="avatar">AR</span>
          <span>
            <strong>{user.name}</strong>
            <small>{user.role}</small>
          </span>
          <span className="session-clock">{sessionTime}</span>
          <LogOut size={17} />
        </button>
      </aside>
      <section className="workspace">
        <GlobalSearch />
        <button className="mobile-nav-trigger mobile-only" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu/></button>
        <Routes>
          <Route path="/" element={<Dashboard user={user} />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/bulk-actions" element={<BulkActionsPage />} />
          <Route path="/settings" element={<SettingsPage initialTab="users" />} />
          <Route path="/settings/users" element={<SettingsPage initialTab="users" />} />
          <Route path="/settings/lead-config" element={<SettingsPage initialTab="config" />} />
          <Route path="/settings/academic-years" element={<SettingsPage initialTab="academic-years" />} />
          <Route path="/settings/admission-classes" element={<SettingsPage initialTab="admission" />} />
          <Route path="/settings/whatsapp-templates" element={<SettingsPage initialTab="whatsapp-templates" />} />
          <Route path="/integrations" element={<IntegrationHubPage />} />
          <Route path="/oauth-callback" element={<OAuthCallbackPage />} />
          <Route path="/oauth-error" element={<OAuthCallbackPage />} />
          <Route path="/automations" element={<AutomationPage />} />
          <Route path="*" element={<ComingSoon />} />
        </Routes>
      </section>
    </div>
  );
}

function Dashboard({ user }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/dashboard")
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);
  if (error) return <ErrorState message={error} />;
  if (!data) return <Loading />;
  const cards = [
    ["Total leads", data.stats.totalLeads, "+12.4%", Users, "violet"],
    ["New this week", data.stats.newThisWeek, "+8.2%", Target, "blue"],
    [
      "Follow-ups due",
      data.stats.followupsDue,
      "6 overdue",
      CalendarClock,
      "orange",
    ],
    ["Admissions", data.stats.admissions, "+16.1%", GraduationCap, "green"],
  ];
  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Saturday, 18 July</span>
          <h1>Good afternoon, {user.name.split(" ")[0]}</h1>
          <p>Here’s what needs your admissions team’s attention today.</p>
        </div>
        <button className="primary">
          <Plus size={18} /> Add new lead
        </button>
      </div>
      <section className="stats-grid">
        {cards.map(([label, value, trend, Icon, color]) => (
          <article className="stat-card" key={label}>
            <div className={`stat-icon ${color}`}>
              <Icon />
            </div>
            <div>
              <span>{label}</span>
              <strong>{value.toLocaleString()}</strong>
              <small className={trend.includes("overdue") ? "warning" : ""}>
                {trend}{" "}
                <em>{trend.includes("overdue") ? "" : "vs last month"}</em>
              </small>
            </div>
          </article>
        ))}
      </section>
      <section className="dashboard-grid">
        <article className="panel funnel-panel">
          <PanelTitle
            title="Admissions view"
            subtitle="Lead movement this academic year"
            action="Last 30 days"
          />
          <div className="funnel">
            {data.funnel.map((item, index) => (
              <div className="funnel-row" key={item.label}>
                <div className="funnel-label">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
                <div className="track">
                  <span
                    style={{
                      width: `${100 - index * 14}%`,
                      background: item.color,
                    }}
                  />
                </div>
                <small>
                  {index
                    ? `${Math.round((item.value / data.funnel[index - 1].value) * 100)}% conversion`
                    : "100% of enquiries"}
                </small>
              </div>
            ))}
          </div>
        </article>
        <article className="panel tasks-panel">
          <PanelTitle
            title="Today’s priorities"
            subtitle="Follow-ups requiring action"
            action="View all"
            link
          />
          <div className="task-list">
            {[
              [
                "Call Aarav Sharma’s parent",
                "Counselling follow-up · 10:30 AM",
                "AS",
                "urgent",
              ],
              [
                "Application documents pending",
                "Diya Patel · Grade 5",
                "DP",
                "normal",
              ],
              [
                "Campus visit confirmation",
                "Sara Khan · Tomorrow at 11:00 AM",
                "SK",
                "normal",
              ],
              ["Fee reminder", "Kabir Reddy · Due in 2 days", "KR", "low"],
            ].map(([title, sub, initials, tone]) => (
              <div className="task" key={title}>
                <span className={`task-dot ${tone}`} />
                <span className="avatar muted">{initials}</span>
                <div>
                  <strong>{title}</strong>
                  <span>{sub}</span>
                </div>
                <button>•••</button>
              </div>
            ))}
          </div>
        </article>
      </section>
      <article className="panel recent">
        <PanelTitle
          title="Recent leads"
          subtitle="Latest enquiries across all sources"
          action="View all leads"
          link
        />
        <LeadTable leads={data.recentLeads} />
      </article>
    </main>
  );
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
        path="/login"
        element={user ? <Navigate to="/" /> : <Login onLogin={setUser} />}
      />
      <Route
        path="/*"
        element={
          user ? (
            <Shell user={user} onLogout={logout} />
          ) : (
            <Navigate to="/login" />
          )
        }
      />
    </Routes>
  );
}
