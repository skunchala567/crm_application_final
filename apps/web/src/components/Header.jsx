import { Search, Bell } from 'lucide-react';
import { cn } from '../lib/utils';

export function Header({ title, subtitle, breadcrumbs, actions, searchPlaceholder, onSearch }) {
  return (
    <header className="sticky top-0 z-10 bg-white border-b border-border">
      {/* Top Bar */}
      <div className="h-16 px-6 flex items-center justify-between gap-4">
        {/* Left: Search */}
        <div className="flex-1 max-w-md hidden md:block">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary-400 pointer-events-none"
            />
            <input
              type="text"
              placeholder={searchPlaceholder || 'Search...'}
              onChange={(e) => onSearch?.(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-secondary-50 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-3 ml-auto">
          {actions?.map((action, index) => (
            <button
              key={index}
              onClick={action.onClick}
              className="p-2 hover:bg-secondary-100 rounded-lg transition-colors"
              aria-label={action.label}
            >
              {action.icon}
            </button>
          ))}
          <button className="p-2 hover:bg-secondary-100 rounded-lg transition-colors relative">
            <Bell size={20} className="text-secondary-600" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
          </button>
        </div>
      </div>

      {/* Page Header */}
      {title && (
        <div className="px-6 py-4 border-t border-border">
          {breadcrumbs && (
            <nav className="flex items-center gap-2 text-xs text-secondary-500 mb-3">
              {breadcrumbs.map((crumb, index) => (
                <div key={index} className="flex items-center gap-2">
                  {index > 0 && <span>/</span>}
                  <a href={crumb.href} className="hover:text-foreground transition-colors">
                    {crumb.label}
                  </a>
                </div>
              ))}
            </nav>
          )}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground font-display">
                {title}
              </h1>
              {subtitle && (
                <p className="text-sm text-secondary-600 mt-1">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

export default Header;
