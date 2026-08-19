import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight, HelpCircle, PanelLeft, Sparkles, Settings, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useIsDesktop } from '../lib/useMediaQuery';
import { BusinessUnitSelector, useBusinessUnit } from '../BusinessUnitContext';
import './Sidebar.css';

/**
 * A label that appears beside a rail icon on hover or keyboard focus.
 *
 * Rendered into document.body rather than inside the nav: the nav scrolls,
 * and an element with `overflow-y: auto` gets `overflow-x: auto` too, so
 * anything positioned outside its box is clipped or pushes a scrollbar.
 *
 * Native `title` was doing this job before. It carries about a second of
 * delay, cannot be styled, and -- because the collapsed item has no text --
 * left every nav link with an empty accessible name.
 */
function RailTooltip({ label, active, children }) {
  const [anchor, setAnchor] = useState(null);
  const ref = useRef(null);

  const show = useCallback(() => {
    if (!active || !ref.current) return;
    const row = ref.current.getBoundingClientRect();
    // Measured against the sidebar's edge, not the row's: the nav is padded,
    // so a row-relative offset put the label on top of the rail.
    const edge = ref.current.closest('aside')?.getBoundingClientRect().right ?? row.right;
    setAnchor({ top: row.top, height: row.height, left: edge });
  }, [active]);
  const hide = useCallback(() => setAnchor(null), []);

  // A rail that stops being a rail mid-hover would otherwise strand the label.
  useEffect(() => { if (!active) setAnchor(null); }, [active]);

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {anchor && createPortal(
        <span
          role="tooltip"
          className={cn(
            'sidebar-tooltip fixed z-[120] -translate-y-1/2 px-2.5 py-1.5 rounded-lg pointer-events-none',
            'bg-secondary-900 text-white text-[12px] font-semibold whitespace-nowrap shadow-lg',
          )}
          style={{ top: anchor.top + anchor.height / 2, left: anchor.left + 10 }}
        >
          {label}
        </span>,
        document.body,
      )}
    </div>
  );
}

/**
 * Sidebar laid out to the reference shell: brand block, user card, grouped
 * nav, and a footer carrying the per-unit support card.
 *
 * Three states, not two. On desktop it is either full width or a 82px icon
 * rail; below the md breakpoint it is an overlay drawer and always shows its
 * full contents, because a 82px drawer on a phone is a column of unlabelled
 * icons covering the screen for no gain.
 */
export function Sidebar({
  menu = [],
  settings = [],
  // The topbar owns both toggles, so open/collapsed state lives in the shell.
  mobileOpen = false,
  onMobileOpenChange = () => {},
  collapsed = false,
  // Collapses the rail on desktop, closes the drawer on mobile.
  onToggle = () => {},
}) {
  const setMobileOpen = onMobileOpenChange;
  const isDesktop = useIsDesktop();
  // The collapsed rail is a desktop affordance. The same stored preference
  // must not turn the mobile drawer into an icon strip.
  const rail = collapsed && isDesktop;
  const { selectedUnit, units, selectedId, selectUnit } = useBusinessUnit();

  // Branding falls back to the product lockup when a unit has none set.
  const brandTitle = selectedUnit?.brandTitle?.trim() || 'Orbit';
  const brandSubtitle = selectedUnit?.brandSubtitle?.trim() || 'Admissions CRM';
  const brandLogo = selectedUnit?.brandLogo || '';

  // Support card, configured per business unit under Business Units settings.
  // Only https, mailto: and tel: survive the server's validator, so this is
  // never a javascript: or data: destination.
  const helpUrl = selectedUnit?.helpUrl?.trim() || '';
  const helpTitle = selectedUnit?.helpTitle?.trim() || 'Need a hand?';
  const helpSubtitle = selectedUnit?.helpSubtitle?.trim() || 'Visit the help centre';
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  // Where the rail's settings flyout is anchored; null when it is closed.
  const [flyout, setFlyout] = useState(null);
  const settingsButtonRef = useRef(null);
  const flyoutRef = useRef(null);
  const location = useLocation();

  useEffect(() => {
    if (location.pathname.startsWith('/settings')) {
      setSettingsExpanded(true);
    }
  }, [location.pathname]);

  // Collapsing the rail while the flyout is open would leave it floating
  // beside a sidebar that no longer has anything to anchor it to.
  useEffect(() => { if (!rail) setFlyout(null); }, [rail]);

  // The flyout is a menu: Escape and a click elsewhere close it.
  useEffect(() => {
    if (!flyout) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') { setFlyout(null); settingsButtonRef.current?.focus(); } };
    const onDown = (event) => {
      if (flyoutRef.current?.contains(event.target)) return;
      if (settingsButtonRef.current?.contains(event.target)) return;
      setFlyout(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [flyout]);

  /*
   * The nav is grouped by business unit, not by Main/Operations.
   *
   * Which unit you are working in used to be a dropdown above the menu, so
   * the same six rows meant different data depending on a control you had to
   * remember to read. Listing each unit's screens under its own name makes
   * the scope part of the thing you click, the way Settings already lists its
   * sub-screens.
   *
   * Every unit offers the same rows: permissions are granted per user, not
   * per unit (loadUserPermissions takes a user id and nothing else), so the
   * caller has already filtered `menu` to the screens this person may open.
   */
  const items = menu.map(([label, path, Icon]) => ({ label, path, Icon }));

  const unitGroups = units.length
    ? units
    : (selectedUnit ? [selectedUnit] : [{ id: 'pending', name: 'Loading…' }]);

  /*
   * The unit you are in is open; the others are a click away. Kept in state
   * rather than derived so a second unit can be left open while you work in
   * the first, and re-opened whenever the active unit changes underneath.
   */
  const [expandedUnits, setExpandedUnits] = useState(() => new Set(selectedId ? [selectedId] : []));
  useEffect(() => {
    if (selectedId) setExpandedUnits((current) => new Set(current).add(selectedId));
  }, [selectedId]);
  const toggleUnit = (id) => setExpandedUnits((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const settingsActive = location.pathname.startsWith('/settings');

  /** The unit's logo, or the product lockup when it has none set. */
  const brandMark = brandLogo ? (
    <img
      src={brandLogo}
      alt=""
      className="w-[42px] h-[42px] flex-none rounded-[13px] object-contain bg-white border border-border"
    />
  ) : (
    <div className="grid place-items-center w-[42px] h-[42px] flex-none rounded-[13px] bg-gradient-to-br from-primary-500 to-primary-700 text-white font-display font-extrabold text-[15px] tracking-tight shadow-brand">
      <Sparkles size={18} />
    </div>
  );

  /** Shared by every nav row so the rail and the full width stay in step. */
  const rowClass = (isActive) => cn(
    'relative flex items-center py-[9.5px] rounded-[11px]',
    'text-[13.2px] font-medium whitespace-nowrap transition-colors duration-200',
    rail ? 'justify-center gap-0 px-0' : 'gap-[11px] px-[11px]',
    isActive
      // The marker hanging off the left edge is dropped in the rail: at 82px
      // it lands on the sidebar's own border as a stray sliver, and the
      // filled pill already says which item is active.
      ? cn(
        'bg-primary-600 text-white font-semibold shadow-brand',
        !rail && 'before:absolute before:-left-3 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[3px] before:rounded-r before:bg-primary-600',
      )
      : 'text-secondary-600 hover:bg-surface-3 hover:text-foreground',
  );

  /** Text beside an icon: fades and gives up its width as the rail closes.
      Clipped rather than unmounted, so the label slides away with the width
      instead of vanishing a frame before the sidebar starts moving. The
      clipping lives here and not on the row, which has to stay overflow-
      visible for the active marker hanging off its left edge. */
  const labelClass = cn(
    'overflow-hidden transition-[opacity,width] duration-200 ease-out',
    rail ? 'w-0 opacity-0' : 'w-auto opacity-100',
  );

  return (
    <>
      {/* Mobile scrim. The opener lives in the topbar; closing happens here,
          on the drawer's own close button, or by following a nav link. */}
      {/* Above the topbar, not below it. At z-30 the scrim sat under the
          sticky header, which then covered the drawer's own brand block and
          close button and stayed undimmed while the drawer was open. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-secondary-900/50 z-50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        id="app-sidebar"
        className={cn(
          'app-sidebar fixed top-0 left-0 h-screen z-[60] flex flex-col bg-white border-r border-border',
          'transition-[width,transform] duration-300 ease-out',
          'md:relative md:z-0 md:translate-x-0',
          rail ? 'w-[72px]' : 'w-[230px]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
        data-collapsed={rail ? 'true' : 'false'}
      >
        {/* ---------- Brand ---------- */}
        {/* Title, subtitle and logo come from the selected business unit's
            settings; the built-in lockup is the fallback.
            The collapse control lives here, at the end of the brand row,
            rather than out in the topbar -- the button that closes a panel
            belongs to the panel. */}
        <div className={cn(
          'flex items-center gap-3 px-[18px] pt-5 pb-[18px]',
          rail && 'justify-center px-0',
        )}>
          {rail ? (
            // In the rail the logo IS the control: hovering it turns it into
            // the panel icon and clicking it opens the sidebar. A separate
            // expand button underneath was a second thing to aim at in a
            // strip that exists to be narrow.
            <RailTooltip label="Expand navigation" active>
              <button
                type="button"
                onClick={onToggle}
                className="sidebar-brand-btn"
                aria-label="Expand navigation"
                aria-expanded={false}
                aria-controls="app-sidebar"
              >
                <span className="brand-swap-mark">{brandMark}</span>
                <span className="brand-swap-icon"><PanelLeft size={18} /></span>
              </button>
            </RailTooltip>
          ) : (
            <>
              {brandMark}
              <div className="min-w-0 flex-1">
                <h1 className="font-display font-extrabold text-[15px] text-foreground truncate">{brandTitle}</h1>
                <span className="block text-[11.5px] text-secondary-400 font-medium truncate">{brandSubtitle}</span>
              </div>
              {/* On a phone this closes the drawer, which is what the panel
                  icon would do there anyway -- but an X says it plainly. */}
              <button
                type="button"
                onClick={onToggle}
                className="sidebar-toggle-btn grid place-items-center flex-none rounded-[10px] text-secondary-500 hover:bg-surface-3 hover:text-primary-600 active:scale-95 transition-all"
                aria-label={isDesktop ? 'Collapse navigation' : 'Close navigation'}
                aria-expanded={isDesktop ? true : mobileOpen}
                aria-controls="app-sidebar"
                title={isDesktop ? 'Collapse navigation' : 'Close navigation'}
              >
                {isDesktop ? <PanelLeft size={18} /> : <X size={18} />}
              </button>
            </>
          )}
        </div>

        {/* At 82px a unit's name cannot be drawn, so the rail keeps the
            picker it always had. At full width the nav itself names every
            unit, and a dropdown saying the same thing twice is one control
            too many. */}
        {rail && (
          <div className="px-3 pb-3 border-b border-border">
            <BusinessUnitSelector compact />
          </div>
        )}

        {/* ---------- Navigation ---------- */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 pt-1 pb-[14px] flex flex-col gap-0.5" aria-label="Primary">
          {/* The rail shows the active unit's screens only: the unit headings
              it would need are exactly what does not fit at this width. */}
          {rail && items.map(({ label, path, Icon }) => (
            <RailTooltip key={label} label={label} active>
              <NavLink
                to={path}
                end={path === '/'}
                onClick={() => setMobileOpen(false)}
                aria-label={label}
                className={({ isActive }) =>
                  rowClass(isActive || (label === 'Dashboard' && location.pathname.startsWith('/saved-reports')))
                }
              >
                <Icon size={18} className="flex-shrink-0" />
                <span className={labelClass}>{label}</span>
              </NavLink>
            </RailTooltip>
          ))}

          {!rail && unitGroups.map((unit) => {
            const open = expandedUnits.has(unit.id);
            const isCurrent = unit.id === selectedId;
            return (
              <div key={unit.id} className="contents">
                <button
                  type="button"
                  onClick={() => toggleUnit(unit.id)}
                  aria-expanded={open}
                  className={cn(
                    'flex items-center gap-2 w-full px-2.5 pt-4 pb-[7px] text-[10px] font-bold tracking-[.1em] uppercase',
                    'transition-colors',
                    isCurrent ? 'text-primary-700' : 'text-secondary-400 hover:text-secondary-600',
                  )}
                >
                  {/* A filled dot marks the unit whose data every screen is
                      currently showing, so an open group is never mistaken
                      for the active one. */}
                  <span className={cn('h-1.5 w-1.5 flex-none rounded-full', isCurrent ? 'bg-primary-600' : 'bg-border')} aria-hidden="true" />
                  <span className="truncate">{unit.name}</span>
                  <ChevronDown size={13} className={cn('ml-auto flex-none transition-transform', open ? 'rotate-180' : '')} />
                </button>

                {open && items.map(({ label, path, Icon }) => (
                  <NavLink
                    key={`${unit.id}-${label}`}
                    to={path}
                    end={path === '/'}
                    /* Picking a screen is what changes unit, so the row you
                       click and the data you get are the same decision. */
                    onClick={() => {
                      if (unit.id !== selectedId) selectUnit(unit.id);
                      setMobileOpen(false);
                    }}
                    className={({ isActive }) => rowClass(
                      isCurrent
                      && (isActive || (label === 'Dashboard' && location.pathname.startsWith('/saved-reports'))),
                    )}
                  >
                    <Icon size={18} className="flex-shrink-0" />
                    <span className={labelClass}>{label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}

          {/* System group: Settings + submenu.
              The whole group is dropped when the user has no settings screen
              to reach -- the caller filters the list by permission, so an
              empty list means every entry was denied. Showing the header and
              an empty expander would only advertise screens they cannot open. */}
          {settings.length > 0 && (<>
          {rail ? (
            <div className="mx-auto my-2 h-px w-7 bg-border" aria-hidden="true" />
          ) : (
            <div className="px-2.5 pt-4 pb-[7px] text-[10px] font-bold tracking-[.1em] uppercase text-secondary-400">
              System
            </div>
          )}
          <RailTooltip label="Settings" active={rail && !flyout}>
            <button
              ref={settingsButtonRef}
              onClick={() => {
                if (rail) {
                  // In the rail the submenu has nowhere to expand into, so it
                  // opens as a flyout beside the icon instead of silently
                  // toggling a list nobody can see.
                  //
                  // Measured here rather than inside the updater: React nulls
                  // out the event's currentTarget once the handler returns,
                  // and a state updater runs after that.
                  const button = settingsButtonRef.current;
                  const row = button?.getBoundingClientRect();
                  const edge = button?.closest('aside')?.getBoundingClientRect().right ?? row?.right ?? 0;
                  setFlyout((current) => (current ? null : { top: row?.top ?? 0, left: edge }));
                  return;
                }
                setSettingsExpanded((current) => !current);
              }}
              aria-label={rail ? 'Settings' : undefined}
              className={cn(rowClass(settingsActive), 'w-full')}
              aria-expanded={rail ? Boolean(flyout) : settingsExpanded}
              aria-haspopup={rail ? 'menu' : undefined}
            >
              <Settings size={18} className="flex-shrink-0" />
              <span className={labelClass}>Settings</span>
              {!rail && (
                <ChevronDown
                  size={16}
                  className={cn('ml-auto transition-transform', settingsExpanded ? 'rotate-180' : '')}
                />
              )}
            </button>
          </RailTooltip>

          {settingsExpanded && !rail && (
            <div className="mt-1 ml-6 flex flex-col gap-0.5">
              {settings.map(({ label, path }) => (
                <NavLink
                  key={path}
                  to={path}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'block px-3 py-2 rounded-[10px] text-[12.5px] transition-colors duration-200',
                      isActive
                        ? 'text-primary-700 bg-primary-50 font-semibold'
                        : 'text-secondary-600 hover:text-foreground hover:bg-surface-3'
                    )
                  }
                >
                  {label}
                </NavLink>
              ))}
            </div>
          )}
          </>)}

        </nav>

        {/* ---------- Footer ---------- */}
        {/* Support card. Its destination and wording belong to the business
            unit, so one unit can point at a WhatsApp chat and another at a
            Zoom room. With no URL configured it stays a plain card rather
            than a link that goes nowhere. In the rail it shrinks to its icon
            so help does not disappear entirely. */}
        {rail ? (
          <RailTooltip label={helpTitle} active>
            {helpUrl ? (
              <a
                href={helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={helpTitle}
                className="mx-auto mb-3 grid place-items-center w-10 h-10 rounded-[11px] bg-primary-50 border border-border text-primary-600 hover:bg-primary-100 hover:border-primary-300 transition-colors"
              >
                <HelpCircle size={18} />
              </a>
            ) : (
              <div
                aria-label={helpTitle}
                className="mx-auto mb-3 grid place-items-center w-10 h-10 rounded-[11px] bg-primary-50 border border-border text-primary-600"
              >
                <HelpCircle size={18} />
              </div>
            )}
          </RailTooltip>
        ) : (
          helpUrl ? (
            <a
              href={helpUrl}
              target="_blank"
              // noopener/noreferrer because the destination is administrator-
              // supplied and opens in a tab that would otherwise get a handle
              // back to the CRM.
              rel="noopener noreferrer"
              className="mx-3 mb-3 p-3 rounded-lg bg-primary-50 border border-border block hover:bg-primary-100 hover:border-primary-300 transition-colors"
            >
              <div className="flex items-start gap-3">
                <HelpCircle size={18} className="text-primary-600 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-foreground">{helpTitle}</p>
                  <p className="text-xs text-secondary-600">{helpSubtitle}</p>
                </div>
              </div>
            </a>
          ) : (
            <div className="mx-3 mb-3 p-3 rounded-lg bg-primary-50 border border-border">
              <div className="flex items-start gap-3">
                <HelpCircle size={18} className="text-primary-600 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-foreground">{helpTitle}</p>
                  <p className="text-xs text-secondary-600">{helpSubtitle}</p>
                </div>
              </div>
            </div>
          )
        )}

      </aside>

      {/* The rail's settings submenu. Portalled for the same reason as the
          tooltips: the nav scrolls and would clip it. */}
      {flyout && createPortal(
        <div
          ref={flyoutRef}
          role="menu"
          aria-label="Settings"
          className="sidebar-flyout fixed z-[120] w-[212px] p-1.5 rounded-xl bg-white border border-border shadow-lg"
          style={{
            left: flyout.left + 10,
            // Kept on screen when the icon sits near the bottom of a short
            // window; the menu is 44px of chrome plus a row per item.
            top: Math.min(flyout.top, Math.max(8, window.innerHeight - (settings.length * 34 + 52))),
          }}
        >
          <p className="px-2.5 pt-1.5 pb-2 text-[10px] font-bold tracking-[.1em] uppercase text-secondary-400">
            Settings
          </p>
          {settings.map(({ label, path }) => (
            <NavLink
              key={path}
              to={path}
              role="menuitem"
              onClick={() => { setFlyout(null); setMobileOpen(false); }}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12.5px] transition-colors duration-200',
                  isActive
                    ? 'text-primary-700 bg-primary-50 font-semibold'
                    : 'text-secondary-600 hover:text-foreground hover:bg-surface-3'
                )
              }
            >
              <ChevronRight size={13} className="flex-none text-secondary-300" />
              {label}
            </NavLink>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

export default Sidebar;
