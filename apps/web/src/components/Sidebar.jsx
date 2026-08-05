import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, LogOut, HelpCircle, Menu, X, PanelLeftOpen, PanelLeftClose, Sparkles, Settings } from 'lucide-react';
import { cn } from '../lib/utils';
import { Avatar, AvatarFallback } from './ui';
import { BusinessUnitSelector } from '../BusinessUnitContext';

export function Sidebar({ user, onLogout, menu = [], settings = [] }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    localStorage.getItem('crm_sidebar_collapsed') === 'true'
  );
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const location = useLocation();

  useEffect(() => {
    if (location.pathname.startsWith('/settings')) {
      setSettingsExpanded(true);
    }
  }, [location.pathname]);

  useEffect(() => {
    const timer = setInterval(() => setSessionSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const sessionTime = [
    Math.floor(sessionSeconds / 3600),
    Math.floor((sessionSeconds % 3600) / 60),
    sessionSeconds % 60
  ]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');

  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem('crm_sidebar_collapsed', String(next));
  };

  return (
    <>
      {/* Mobile Toggle */}
      <button
        className="md:hidden fixed top-4 left-4 z-40 p-2 rounded-lg hover:bg-secondary-100"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
      >
        <Menu size={24} className="text-foreground" />
      </button>

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 h-screen z-40 flex flex-col bg-white border-r border-border transition-all duration-300',
          'md:relative md:z-0 md:translate-x-0',
          sidebarCollapsed ? 'w-20' : 'w-64',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary-600 text-white">
                <Sparkles size={16} />
              </div>
              <span className="font-bold text-lg text-foreground font-display">Orbit</span>
            </div>
          )}
          <button
            onClick={toggleSidebar}
            className="p-1 hover:bg-secondary-100 rounded-lg transition-colors"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </button>
        </div>

        {/* Business Unit Selector */}
        <div className="px-3 py-3 border-b border-border">
          <BusinessUnitSelector compact={sidebarCollapsed} />
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {menu.map(([label, path, Icon]) => (
            <NavLink
              key={label}
              to={path}
              end={path === '/'}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors font-medium text-sm',
                  isActive || (label === 'Dashboard' && location.pathname.startsWith('/saved-reports'))
                    ? 'bg-primary-100 text-primary-700'
                    : 'text-secondary-600 hover:bg-secondary-100 hover:text-foreground'
                )
              }
            >
              <Icon size={18} className="flex-shrink-0" />
              {!sidebarCollapsed && (
                <>
                  <span>{label}</span>
                  {label === 'Follow-ups' && (
                    <span className="ml-auto bg-amber-500 text-white text-xs px-2 py-0.5 rounded-full">
                      24
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}

          {/* Settings Section */}
          <div className="pt-4 border-t border-border mt-4">
            <button
              onClick={() => setSettingsExpanded(!settingsExpanded)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors font-medium text-sm',
                location.pathname.startsWith('/settings')
                  ? 'bg-primary-100 text-primary-700'
                  : 'text-secondary-600 hover:bg-secondary-100 hover:text-foreground'
              )}
              aria-expanded={settingsExpanded}
            >
              <Settings size={18} className="flex-shrink-0" />
              {!sidebarCollapsed && (
                <>
                  <span>Settings</span>
                  <ChevronDown
                    size={16}
                    className={cn(
                      'ml-auto transition-transform',
                      settingsExpanded ? 'rotate-180' : ''
                    )}
                  />
                </>
              )}
            </button>

            {/* Settings Submenu */}
            {settingsExpanded && !sidebarCollapsed && (
              <div className="mt-1 ml-6 space-y-1">
                {settings.map(({ label, path }) => (
                  <NavLink
                    key={path}
                    to={path}
                    className={({ isActive }) =>
                      cn(
                        'block px-3 py-2 rounded-lg transition-colors text-sm',
                        isActive
                          ? 'text-primary-700 bg-primary-50'
                          : 'text-secondary-600 hover:text-foreground hover:bg-secondary-100'
                      )
                    }
                  >
                    {label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        </nav>

        {/* Help Section */}
        {!sidebarCollapsed && (
          <div className="p-3 mx-3 mb-4 rounded-lg bg-secondary-50 border border-secondary-200">
            <div className="flex items-start gap-3">
              <HelpCircle size={18} className="text-secondary-600 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-semibold text-sm text-foreground">Need a hand?</p>
                <p className="text-xs text-secondary-600">Visit the help centre</p>
              </div>
            </div>
          </div>
        )}

        {/* User Profile */}
        <div className="p-3 border-t border-border">
          <button
            onClick={onLogout}
            className={cn(
              'w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-secondary-100 transition-colors',
              sidebarCollapsed && 'justify-center'
            )}
          >
            <Avatar className="h-8 w-8 flex-shrink-0 text-xs">
              <AvatarFallback>
                {user.name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')}
              </AvatarFallback>
            </Avatar>
            {!sidebarCollapsed && (
              <div className="text-left flex-1 min-w-0">
                <p className="font-semibold text-sm text-foreground truncate">
                  {user.name}
                </p>
                <p className="text-xs text-secondary-500 truncate">{user.role}</p>
              </div>
            )}
            <LogOut size={16} className="flex-shrink-0 text-secondary-500" />
          </button>
          {!sidebarCollapsed && (
            <div className="text-xs text-secondary-500 text-center mt-2 font-mono">
              {sessionTime}
            </div>
          )}
        </div>

        {/* Mobile Close Button */}
        <button
          className="md:hidden absolute top-4 right-4 p-1 hover:bg-secondary-100 rounded-lg"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        >
          <X size={20} />
        </button>
      </aside>
    </>
  );
}

export default Sidebar;
