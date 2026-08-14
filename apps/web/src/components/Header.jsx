import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Bell, ChevronDown, Home, KeyRound, LogOut, Mail, Menu, Settings, X, Zap,
} from 'lucide-react';
import { api } from '../api';
import { cn } from '../lib/utils';
import { useIsDesktop } from '../lib/useMediaQuery';
import { useBusinessUnit } from '../BusinessUnitContext';
import { useLeadQuickActions } from '../LeadQuickActionsContext';
import { usePermissions } from '../PermissionContext';

/** Any one of these makes the Settings entry worth showing. */
const SETTINGS_PERMISSIONS = [
  'settings.users.view', 'settings.access_control.view', 'settings.business_units.view',
  'settings.branches.view', 'settings.payment_forms.view', 'settings.lead_config.view',
  'settings.academic_config.view', 'integrations.hub.view', 'whatsapp.templates.view',
  'email.configuration.view', 'email.templates.view',
];

/** Route -> breadcrumb trail. Keeps the topbar identical on every screen. */
const CRUMBS = {
  '/': ['Dashboard'],
  '/leads': ['Leads'],
  '/tracker': ['Tracker'],
  '/bulk-actions': ['Bulk Actions'],
  '/reports': ['Reports'],
  '/saved-reports/new': ['Reports', 'New report'],
  '/automations': ['Automations'],
  '/whatsapp-inbox': ['WhatsApp Inbox'],
};

const SETTINGS_CRUMBS = {
  '/settings/users': 'User Management',
  '/settings/business-units': 'Business Units',
  '/settings/branches': 'Branch Settings',
  '/settings/payment-forms': 'Payment Forms',
  '/settings/integrations': 'Integrations',
  '/settings/google-sheets': 'Google Sheets',
  '/settings/meta-lead-ads': 'Meta Lead Ads',
  '/settings/whatsapp-templates': 'WhatsApp',
  '/settings/email-configuration': 'Email Configuration',
  '/settings/email-templates': 'Email Templates',
  '/settings/callerdesk': 'CallerDesk',
  '/settings/smartflo': 'Smartflo',
};

/** Fallback target when there is no in-app history entry to return to. */
function parentOf(pathname) {
  if (pathname.startsWith('/settings/')) return '/settings/integrations';
  if (pathname.startsWith('/saved-reports')) return '/reports';
  return '/';
}

export function Header({ user, onLogout, onMenuClick, navCollapsed = false, mobileNavOpen = false, usageTime = '00:00:00', usageSaved = true, children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { selectedUnit } = useBusinessUnit();
  // Published by whichever screen is open; empty everywhere except Leads.
  const quickActions = useLeadQuickActions();
  const { can, canAny } = usePermissions();
  const isDesktop = useIsDesktop();
  const navLabel = isDesktop
    ? (navCollapsed ? 'Expand navigation' : 'Collapse navigation')
    : (mobileNavOpen ? 'Close navigation' : 'Open navigation');

  const [now, setNow] = useState(() => new Date());
  const [openPop, setOpenPop] = useState(null); // 'quick' | 'messages' | 'alerts' | 'profile'
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [followupsDue, setFollowupsDue] = useState(0);
  const [untouchedLeads, setUntouchedLeads] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [liveNotification, setLiveNotification] = useState(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const wrapRef = useRef(null);
  const alertedNotificationIdsRef = useRef(new Set());
  const notificationAudioRef = useRef(null);

  // Browsers only allow audible playback after a user gesture. Arm the audio
  // context on the first interaction so a later background poll can chime.
  useEffect(() => {
    const armAudio = () => {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext && !notificationAudioRef.current) notificationAudioRef.current = new AudioContext();
        notificationAudioRef.current?.resume?.();
      } catch { /* The in-app visual alert remains available without audio. */ }
    };
    window.addEventListener('pointerdown', armAudio, { once: true });
    window.addEventListener('keydown', armAudio, { once: true });
    return () => {
      window.removeEventListener('pointerdown', armAudio);
      window.removeEventListener('keydown', armAudio);
    };
  }, []);

  useEffect(() => {
    if (!liveNotification) return undefined;
    const timer = window.setTimeout(() => setLiveNotification(null), 7000);
    return () => window.clearTimeout(timer);
  }, [liveNotification]);

  // Only the date label uses this now; the usage timer ticks in the hook, so
  // a minute is plenty and the blurred header repaints far less often.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Close any popover on outside click or Escape.
  useEffect(() => {
    if (!openPop) return undefined;
    const onDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpenPop(null);
    };
    const onKey = (event) => { if (event.key === 'Escape') setOpenPop(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openPop]);

  // Badge counts come from real endpoints and refresh per business unit only,
  // so navigating between screens costs no extra requests.
  useEffect(() => {
    if (!selectedUnit?.id) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const result = await api('/hub/smartping/conversations?limit=100&incomingOnly=1');
        if (cancelled) return;
        const total = (result.data || []).reduce((sum, item) => sum + Number(item.unread_count || 0), 0);
        setUnreadMessages(total);
      } catch {
        if (!cancelled) setUnreadMessages(0);
      }
    })();

    (async () => {
      try {
        const dashboard = await api('/dashboard');
        if (!cancelled) {
          setFollowupsDue(Number(dashboard?.stats?.followupsDue || 0));
          setUntouchedLeads(Number(dashboard?.stats?.untouchedAssignedCount || 0));
        }
      } catch {
        if (!cancelled) { setFollowupsDue(0); setUntouchedLeads(0); }
      }
    })();

    return () => { cancelled = true; };
  }, [selectedUnit?.id]);

  const playNotificationSound = async () => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const context = notificationAudioRef.current || new AudioContext();
      notificationAudioRef.current=context;
      if(context.state==='suspended')await context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(880,context.currentTime);
      gain.gain.setValueAtTime(0.0001,context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.16,context.currentTime+0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001,context.currentTime+0.35);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime+0.36);
      oscillator.onended=()=>{};
    } catch { /* Sound is best-effort when browser autoplay policy allows it. */ }
  };

  const loadNotifications = async ({ announce = true } = {}) => {
    const result = await api('/notifications');
    const items=result.data||[];
    if(announce){
      const fresh=items.filter(item=>!item.readAt&&!alertedNotificationIdsRef.current.has(Number(item.id)));
      if(fresh.length){
        fresh.forEach(item=>alertedNotificationIdsRef.current.add(Number(item.id)));
        playNotificationSound().catch(()=>{});
        setLiveNotification(fresh[0]);
        if('Notification' in window&&Notification.permission==='granted'){
          const item=fresh[0];
          const systemNotice=new Notification(item.title,{body:item.message,tag:`crm-${item.id}`});
          systemNotice.onclick=()=>{window.focus();if(item.link)navigate(item.link);systemNotice.close();};
        }
      }
    }
    setNotifications(items);setUnreadNotifications(Number(result.unread||0));
  };

  useEffect(()=>{
    if(!selectedUnit?.id||!user?.id)return undefined;
    alertedNotificationIdsRef.current=new Set();
    let cancelled=false;
    const refresh=()=>loadNotifications().catch(()=>{if(!cancelled){setNotifications([]);setUnreadNotifications(0);}});
    refresh();const timer=window.setInterval(refresh,5000);
    return()=>{cancelled=true;window.clearInterval(timer);};
  },[selectedUnit?.id,user?.id]);

  const openNotifications=async()=>{
    toggle('alerts');
    try{
      const AudioContext=window.AudioContext||window.webkitAudioContext;
      if(AudioContext&&!notificationAudioRef.current)notificationAudioRef.current=new AudioContext();
      notificationAudioRef.current?.resume?.();
    }catch{/* Audio remains optional. */}
    if('Notification' in window&&Notification.permission==='default')await Notification.requestPermission().catch(()=>{});
    loadNotifications({announce:false}).catch(()=>{});
  };
  const readNotification=async item=>{
    if(!item.readAt)await api(`/notifications/${item.id}/read`,{method:'PUT'});
    setNotifications(current=>current.map(entry=>entry.id===item.id?{...entry,readAt:new Date().toISOString()}:entry));
    setUnreadNotifications(current=>Math.max(0,current-(item.readAt?0:1)));
    setOpenPop(null);if(item.link)navigate(item.link);
  };
  const readAllNotifications=async()=>{
    await api('/notifications/read-all',{method:'PUT'});
    setNotifications(current=>current.map(item=>({...item,readAt:item.readAt||new Date().toISOString()})));
    setUnreadNotifications(0);
  };

  const crumbs = useMemo(() => {
    if (location.pathname.startsWith('/settings')) {
      const leaf = SETTINGS_CRUMBS[location.pathname];
      return leaf ? ['Settings', leaf] : ['Settings'];
    }
    return CRUMBS[location.pathname] || ['Workspace'];
  }, [location.pathname]);

  const initials = String(user?.name || '?')
    .split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();

  // Root has nowhere to go back to. Elsewhere prefer real history so the
  // button returns to the actual previous screen, not a guessed parent.
  const canGoBack = location.pathname !== '/';
  const goBack = () => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate(parentOf(location.pathname));
  };

  const toggle = (name) => setOpenPop((current) => (current === name ? null : name));
  const go = (path) => { setOpenPop(null); navigate(path); };

  const badge = (count, tone) => (count > 0 ? (
    <em className={cn(
      'absolute top-1 right-0.5 min-w-4 h-4 px-1 grid place-items-center rounded-full',
      'text-[9.5px] font-bold not-italic text-white ring-2 ring-white',
      tone === 'alert' ? 'bg-danger' : 'bg-primary-600'
    )}>
      {count > 99 ? '99+' : count}
    </em>
  ) : null);

  return (
    <>
    <header className="sticky top-0 z-40 flex-none bg-white/[.88] backdrop-blur-[14px] backdrop-saturate-150 border-b border-border">
      <div className="h-[62px] flex items-center gap-2 xl:gap-[18px] px-3 sm:px-4 xl:px-[22px] min-w-0" ref={wrapRef}>
        {/* Drawer opener, mobile only. On desktop the collapse control lives
            inside the sidebar itself, where the panel it acts on is; here it
            has to stay, because an off-canvas drawer cannot carry the button
            that opens it. */}
        <button
          onClick={onMenuClick}
          className="sidebar-drawer-opener grid place-items-center w-[38px] h-[38px] flex-none rounded-[11px] text-secondary-500 hover:bg-surface-3 hover:text-primary-600 active:scale-95 transition-all"
          aria-label={navLabel}
          aria-expanded={isDesktop ? !navCollapsed : mobileNavOpen}
          aria-controls="app-sidebar"
          title={navLabel}
        >
          <Menu size={18} />
        </button>

        {/* Back: returns to whichever screen led here. Several settings
            screens are only reachable from Integrations, so this is their
            only way out. */}
        {canGoBack && (
          <button
            onClick={goBack}
            className="grid place-items-center w-[38px] h-[38px] flex-none rounded-[11px] text-secondary-500 hover:bg-surface-3 hover:text-primary-600 active:scale-95 transition-all"
            aria-label="Go back"
            title="Back"
          >
            <ArrowLeft size={18} />
          </button>
        )}

        {/* Breadcrumbs. The business unit name used to sit above them, which
            left the row two lines tall and everything beside it optically high;
            the unit is already named in the sidebar. */}
        <div className="min-w-0 flex-1 xl:flex-none hidden sm:flex items-center">
          <nav className="hidden md:flex items-center gap-1.5 text-[12.5px] text-secondary-500 whitespace-nowrap overflow-hidden" aria-label="Breadcrumb">
            <Home size={13} />
            <button onClick={() => navigate('/')} className="hover:text-primary-600 transition-colors">Home</button>
            {crumbs.map((crumb, index) => (
              <span key={crumb} className="flex items-center gap-1.5">
                <span className="text-secondary-300">/</span>
                <span className={index === crumbs.length - 1 ? 'text-primary-600 font-bold text-[13px]' : ''}>{crumb}</span>
              </span>
            ))}
          </nav>
        </div>

        {/* Search (existing global search component) */}
        <div className="ml-auto min-w-[140px] flex-1 max-w-[520px] hidden md:block">
          {children}
        </div>

        {/* Action cluster */}
        <div className="flex min-w-0 items-center gap-0.5 sm:gap-1.5 ml-auto xl:ml-0 flex-none">
          {/* Lead quick actions. Hidden unless a screen has registered some, so
              the button never opens onto actions with nothing to act on.

              The popover needs an explicit z-index: below md the search moves to
              its own row further down the header, and as a later positioned
              sibling with z-auto it would paint over this menu's top row. Kept
              under .global-search-inline-results (z-80) so an open typeahead
              still wins. */}
          {quickActions.length > 0 && (
            <div className="relative">
              <button
                onClick={() => toggle('quick')}
                className="grid place-items-center w-[38px] h-[38px] rounded-[11px] text-secondary-500 hover:bg-surface-3 hover:text-primary-600 active:scale-95 transition-all"
                aria-label="Lead actions"
                title="Lead actions"
                aria-expanded={openPop === 'quick'}
              >
                <Zap size={18} />
              </button>
              {openPop === 'quick' && (
                <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-[300px] p-2.5 rounded-lg bg-white border border-border shadow-lg">
                  <div className="grid grid-cols-3 gap-1.5">
                    {quickActions.map(({ key, label, icon: Icon, title, disabled, onSelect }) => (
                      <button
                        key={key}
                        onClick={() => { setOpenPop(null); onSelect(); }}
                        disabled={disabled}
                        title={title || label}
                        className="flex flex-col items-center gap-[7px] px-1.5 py-3 rounded-xl transition-all enabled:hover:bg-primary-50 enabled:hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Icon size={20} className="text-primary-600" />
                        <span className="text-[10.5px] font-medium text-secondary-600 text-center leading-tight">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Messages -> WhatsApp inbox. Hidden without inbox access, since
              the destination itself refuses to render for those users. */}
          {can('whatsapp.inbox.view') && (
          <button
            onClick={() => navigate('/whatsapp-inbox')}
            className="relative grid place-items-center w-[38px] h-[38px] rounded-[11px] text-secondary-500 hover:bg-surface-3 hover:text-primary-600 active:scale-95 transition-all"
            aria-label={`${unreadMessages} unread WhatsApp messages`}
            title={`${unreadMessages} unread WhatsApp messages`}
          >
            <Mail size={18} />
            {badge(unreadMessages)}
          </button>
          )}

          <div className="relative">
            <button
              onClick={openNotifications}
              className="relative grid place-items-center w-[38px] h-[38px] rounded-[11px] text-secondary-500 hover:bg-surface-3 hover:text-primary-600 active:scale-95 transition-all"
              aria-label={`${unreadNotifications} unread notifications`}
              title={`${unreadNotifications} unread notifications`}
              aria-expanded={openPop==='alerts'}
            >
              <Bell size={18} />
              {badge(unreadNotifications,'alert')}
            </button>
            {openPop==='alerts'&&(
              <div className="notification-popover">
                <div className="notification-popover-head">
                  <div><strong>Notifications</strong><p>Latest 10 for this business unit</p></div>
                  {unreadNotifications>0&&<button onClick={readAllNotifications}>Mark all read</button>}
                </div>
                <div className="notification-list">
                  {notifications.length?notifications.map(item=><button key={item.id} onClick={()=>readNotification(item)} className={cn('notification-item',!item.readAt&&'unread')}><i className={item.readAt?'read':'unread'}/><span><strong>{item.title}</strong><span>{item.message}</span><small>{new Date(item.createdAt).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'})}</small></span></button>):<p className="notification-empty">No notifications yet.</p>}
                </div>
              </div>
            )}
          </div>

          {/* Profile */}
          <div className="relative">
            <button
              onClick={() => toggle('profile')}
              className="flex min-w-0 max-w-[clamp(150px,24vw,330px)] items-center gap-[9px] pl-[5px] pr-2.5 py-[5px] rounded-xl hover:bg-surface-3 transition-colors"
              aria-expanded={openPop === 'profile'}
            >
              <span className="grid place-items-center w-8 h-8 rounded-[10px] bg-gradient-to-br from-primary-500 to-primary-700 text-white text-[12px] font-bold">
                {initials}
              </span>
              <span className="hidden min-w-0 sm:flex flex-col text-left leading-[1.25]">
                <strong className="truncate whitespace-nowrap text-[12.5px] text-foreground" title={user?.name}>{user?.name}</strong>
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <small className="text-[10.5px] text-secondary-400">{user?.role}</small>
                  <small
                    className={cn('text-[10.5px] font-bold tabular-nums', usageSaved ? 'text-primary-600' : 'text-warning')}
                    title={usageSaved
                      ? `Active time in the CRM today · ${now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`
                      : 'Active time is not being saved and will reset on next login.'}
                  >
                    · {usageTime}
                  </small>
                </span>
              </span>
              <ChevronDown size={14} className="hidden sm:block text-secondary-400" />
            </button>

            {openPop === 'profile' && (
              <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-[240px] rounded-lg bg-white border border-border shadow-lg overflow-hidden">
                {/* Name and role already sit on the trigger, so only the email
                    — the detail not shown there — is repeated here. */}
                {user?.email && (
                  <div className="px-4 py-3 bg-primary-50 border-b border-line-2 text-center">
                    <small className="block text-[11.5px] text-secondary-500 truncate">{user.email}</small>
                  </div>
                )}
                <div className="p-[7px] profile-menu-actions">
                  {/* Only shown when at least one settings screen is reachable,
                      otherwise it leads straight to a refusal. Change password
                      and Sign out below stay available to everyone. */}
                  {canAny(SETTINGS_PERMISSIONS) && (
                  <button
                    onClick={() => go('/settings')}
                    className="profile-menu-action w-full flex items-center justify-start text-left gap-[9px] px-[11px] py-[9px] rounded-[10px] text-[13px] text-secondary-700 hover:bg-surface-3 hover:text-foreground transition-colors"
                  >
                    <Settings size={16} className="text-secondary-400" />
                    Settings
                  </button>
                  )}
                  <button
                    onClick={() => { setOpenPop(null); setPasswordOpen(true); }}
                    className="profile-menu-action w-full flex items-center justify-start text-left gap-[9px] px-[11px] py-[9px] rounded-[10px] text-[13px] text-secondary-700 hover:bg-surface-3 hover:text-foreground transition-colors"
                  >
                    <KeyRound size={16} className="text-secondary-400" />
                    Change password
                  </button>
                  <div className="h-px bg-line-2 my-1.5 mx-1" />
                  <button
                    onClick={() => { setOpenPop(null); onLogout?.(); }}
                    className="profile-menu-action w-full flex items-center justify-center gap-[9px] px-[11px] py-[9px] rounded-[10px] text-[13px] text-danger hover:bg-danger-bg transition-colors"
                  >
                    <LogOut size={16} />
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Search on phones, where the header actions leave no safe inline width. */}
      <div className="md:hidden px-3 sm:px-4 pb-3">{children}</div>
    </header>

    {/* Outside <header>: its backdrop-filter would otherwise make it the
        containing block for this fixed overlay. */}
    {passwordOpen && (
      <ChangePasswordDialog onClose={() => setPasswordOpen(false)} />
    )}
    {liveNotification && (
      <div className="live-notification-toast" role="alert">
        <Bell size={19} />
        <button type="button" onClick={() => { const item = liveNotification; setLiveNotification(null); readNotification(item); }}>
          <strong>{liveNotification.title}</strong><small>{liveNotification.message}</small>
        </button>
        <button type="button" className="live-notification-close" aria-label="Dismiss notification" onClick={() => setLiveNotification(null)}><X size={17} /></button>
      </div>
    )}
    </>
  );
}

// Bare <input> gets no border: Tailwind preflight zeroes border-width and the
// design-system layer only sets radius/focus. Fields must bring their own.
const FIELD_CLASS = [
  'w-full h-11 px-3 rounded-[10px] text-sm',
  'border border-border bg-white text-foreground',
  'transition-all duration-200',
  'focus:outline-none focus:border-primary-400 focus:ring-4 focus:ring-primary-50',
].join(' ');

/**
 * Change password.
 *
 * app_users is shared with the Attendance system, so this updates the one
 * credential both applications use — the dialog says so rather than letting
 * that be a surprise.
 */
function ChangePasswordDialog({ onClose }) {
  const [fields, setFields] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (key) => (event) => setFields((prev) => ({ ...prev, [key]: event.target.value }));

  const mismatch = fields.confirm.length > 0 && fields.next !== fields.confirm;
  const tooShort = fields.next.length > 0 && fields.next.length < 8;

  async function submit(event) {
    event.preventDefault();
    setError('');

    // Validated here rather than by disabling the button: a button that is
    // greyed out without saying why is worse than one that explains itself.
    if (!fields.current) return setError('Enter your current password.');
    if (!fields.next) return setError('Enter a new password.');
    if (tooShort) return setError('New password must be at least 8 characters.');
    if (!fields.confirm) return setError('Confirm your new password.');
    if (mismatch) return setError('New password and confirmation do not match.');

    setSaving(true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: fields.current, newPassword: fields.next }),
      });
      setDone(true);
      setFields({ current: '', next: '', confirm: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] grid place-items-center p-6 bg-secondary-900/50"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white border border-border shadow-lg overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <h3 className="font-display font-bold text-base text-foreground">Change password</h3>
          <button
            onClick={onClose}
            className="grid place-items-center w-8 h-8 rounded-[10px] text-secondary-500 hover:bg-surface-3 hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {done ? (
          <div className="px-6 py-8 text-center">
            <p className="font-semibold text-foreground mb-1">Password changed</p>
            <p className="text-sm text-secondary-500 mb-5">
              Use the new password next time you sign in.
            </p>
            <button className="primary" onClick={onClose}>Done</button>
          </div>
        ) : (
          <form onSubmit={submit} className="px-6 py-5 space-y-4">
            <p className="text-xs text-secondary-500">
              This is the same login used by the Attendance application.
            </p>

            <label className="block">
              <span className="block text-sm font-semibold mb-1.5">Current password</span>
              <input
                type="password" autoComplete="current-password" className={FIELD_CLASS}
                value={fields.current} onChange={set('current')} autoFocus
              />
            </label>

            <label className="block">
              <span className="block text-sm font-semibold mb-1.5">New password</span>
              <input
                type="password" autoComplete="new-password" className={FIELD_CLASS}
                value={fields.next} onChange={set('next')}
              />
              {tooShort && (
                <span className="block mt-1 text-xs text-danger">Must be at least 8 characters.</span>
              )}
            </label>

            <label className="block">
              <span className="block text-sm font-semibold mb-1.5">Confirm new password</span>
              <input
                type="password" autoComplete="new-password" className={FIELD_CLASS}
                value={fields.confirm} onChange={set('confirm')}
              />
              {mismatch && (
                <span className="block mt-1 text-xs text-danger">Passwords do not match.</span>
              )}
            </label>

            {error && (
              <div className="p-3 rounded-lg bg-danger-bg text-danger text-sm">{error}</div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="primary" disabled={saving}>
                {saving ? 'Saving…' : 'Change password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default Header;
