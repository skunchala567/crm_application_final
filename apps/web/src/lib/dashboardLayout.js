/**
 * Dashboard overview layout.
 *
 * The layout is authored in the Reports > Dashboard layout editor and consumed
 * by the Dashboard overview screen, so both sides must read and write through
 * this module. Persisted per business unit in localStorage.
 */

export const DASHBOARD_WIDGETS = [
  { id: 'stats', title: 'Performance cards', size: 'half' },
  { id: 'activity', title: 'My daily CRM activity', size: 'half' },
  { id: 'funnel', title: 'Admissions funnel', size: 'half' },
  { id: 'tasks', title: 'Today’s priorities', size: 'half' },
  { id: 'recent', title: 'Recent leads', size: 'full' },
];

const DASHBOARD_SIZES = ['quarter', 'half', 'three-quarter', 'full'];

/** Fired after the layout is saved so an open Dashboard can pick it up. */
export const DASHBOARD_LAYOUT_EVENT = 'crm:dashboard-layout-changed';

export function dashboardLayoutKey(unitId) {
  return `crm_dashboard_overview_layout_${unitId || 'default'}`;
}

export function normalizeDashboardLayout(layout) {
  const known = new Set(DASHBOARD_WIDGETS.map((widget) => widget.id));
  const validSizes = new Set(DASHBOARD_SIZES);
  const source = Array.isArray(layout) ? layout : [];
  const addingActivityWidget = !source.some((item) => item.id === 'activity');
  const cleaned = source
    .filter((item) => known.has(item.id) || String(item.id || '').startsWith('report:'))
    .map((item) => ({
      id: item.id,
      size: addingActivityWidget && item.id === 'stats' && item.size === 'full' ? 'half' : (validSizes.has(item.size) ? item.size : 'half'),
      visible: item.visible !== false,
    }));

  // Widgets added to the product after a layout was saved default to visible.
  const existing = new Set(cleaned.map((item) => item.id));
  DASHBOARD_WIDGETS.forEach((widget) => {
    if (!existing.has(widget.id)) cleaned.push({ id: widget.id, size: widget.size, visible: true });
  });
  return cleaned;
}

export function defaultDashboardLayout() {
  return DASHBOARD_WIDGETS.map((widget) => ({ id: widget.id, size: widget.size, visible: true }));
}

export function readDashboardLayout(unitId) {
  try {
    const saved = JSON.parse(localStorage.getItem(dashboardLayoutKey(unitId)) || 'null');
    if (Array.isArray(saved) && saved.length) return normalizeDashboardLayout(saved);
  } catch {
    /* fall through to defaults */
  }
  return defaultDashboardLayout();
}

export function writeDashboardLayout(unitId, layout) {
  const normalized = normalizeDashboardLayout(layout);
  localStorage.setItem(dashboardLayoutKey(unitId), JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(DASHBOARD_LAYOUT_EVENT, { detail: { unitId } }));
  return normalized;
}

/** True when two layouts would render identically. */
export function isSameDashboardLayout(a, b) {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return other
      && item.id === other.id
      && item.size === other.size
      && (item.visible !== false) === (other.visible !== false);
  });
}

const SPANS = { quarter: 1, half: 2, 'three-quarter': 3, full: 4 };

function dashboardWidgetSpan(size) {
  return SPANS[size] || 2;
}

/** Row/column placement on the shared 4-column grid. */
function dashboardGridPositions(items) {
  let row = 0;
  let column = 0;
  return items.map((item) => {
    const span = dashboardWidgetSpan(item.size);
    if (column + span > 4) { row += 1; column = 0; }
    const position = { id: item.id, row, column, span, center: column + span / 2 };
    column += span;
    if (column === 4) { row += 1; column = 0; }
    return position;
  });
}

export function dashboardMoveTarget(items, id, direction) {
  const positions = dashboardGridPositions(items);
  const current = positions.find((position) => position.id === id);
  if (!current) return null;

  if (direction === 'left' || direction === 'right') {
    const candidates = positions.filter((position) => position.row === current.row
      && (direction === 'left' ? position.column < current.column : position.column > current.column));
    candidates.sort((a, b) => (direction === 'left' ? b.column - a.column : a.column - b.column));
    return candidates[0]?.id || null;
  }

  const candidates = positions.filter((position) => (direction === 'up'
    ? position.row < current.row
    : position.row > current.row));
  if (!candidates.length) return null;
  const targetRow = direction === 'up'
    ? Math.max(...candidates.map((position) => position.row))
    : Math.min(...candidates.map((position) => position.row));
  return candidates
    .filter((position) => position.row === targetRow)
    .sort((a, b) => Math.abs(a.center - current.center) - Math.abs(b.center - current.center))[0]?.id || null;
}
