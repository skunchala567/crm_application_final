/**
 * App-wide instant tooltips.
 *
 * `title` is the browser's own tooltip: it waits about a second before
 * appearing, cannot be styled, and is clipped to nothing inside embedded
 * browsers. This replaces it with a single fixed-position layer that appears
 * the moment the pointer lands on a control.
 *
 * A control opts in three ways, in priority order:
 *
 *   1. `data-tooltip="..."`  explicit copy, always shown
 *   2. `title="..."`         moved to data-tooltip on first hover, so the
 *                            native tooltip never gets a chance to fire
 *   3. `aria-label="..."`    icon-only controls only -- a tooltip that just
 *                            repeats a visible label is noise
 *
 * Positioned below the control, flipped above when there is no room, and
 * clamped to the viewport. Being fixed and attached to <body>, it is never
 * clipped by an `overflow: hidden` ancestor and never loses a z-index fight.
 */

const ANCHOR_SELECTOR = 'button,summary,a,label,input,textarea,[role="button"],[role="tab"],[data-tooltip],[title]';
const GAP = 8;
const EDGE = 8;

let layer = null;
let anchor = null;

function getLayer() {
  if (layer?.isConnected) return layer;
  layer = document.createElement('div');
  layer.className = 'app-tooltip';
  layer.setAttribute('role', 'tooltip');
  layer.hidden = true;
  document.body.appendChild(layer);
  return layer;
}

/** Visible text, ignoring anything only screen readers read. */
function visibleText(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll('.sr-only,[aria-hidden="true"],svg').forEach(node => node.remove());
  return clone.textContent.trim();
}

function tooltipFor(element) {
  const explicit = element.getAttribute('data-tooltip');
  if (explicit) return explicit;

  // Adopt the native tooltip once, then remove it so both never show.
  const title = element.getAttribute('title');
  if (title && title.trim()) {
    element.setAttribute('data-tooltip', title.trim());
    element.removeAttribute('title');
    // `title` also names an otherwise unnamed control. Keep that.
    if (!element.getAttribute('aria-label') && !visibleText(element)) {
      element.setAttribute('aria-label', title.trim());
    }
    return title.trim();
  }

  const label = element.getAttribute('aria-label');
  if (label && label.trim() && !visibleText(element)) return label.trim();
  return '';
}

function place(element, text) {
  const tip = getLayer();
  tip.textContent = text;
  tip.hidden = false;

  const box = element.getBoundingClientRect();
  const size = tip.getBoundingClientRect();
  let top = box.bottom + GAP;
  if (top + size.height > window.innerHeight - EDGE) {
    const above = box.top - size.height - GAP;
    if (above >= EDGE) top = above;
  }
  const left = Math.min(
    Math.max(EDGE, box.left + box.width / 2 - size.width / 2),
    Math.max(EDGE, window.innerWidth - size.width - EDGE),
  );
  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

function hide() {
  anchor = null;
  if (layer) {
    layer.hidden = true;
    layer.textContent = '';
  }
}

function show(element) {
  if (!element || element === anchor) return;
  if (element.disabled && element.tagName !== 'SUMMARY') {
    // A disabled control still explains itself; the browser fires no pointer
    // events on it, so this only runs when a wrapper carries the copy.
  }
  const text = tooltipFor(element);
  if (!text) return hide();
  anchor = element;
  place(element, text);
}

function onPointerOver(event) {
  const element = event.target?.closest?.(ANCHOR_SELECTOR);
  if (!element) return hide();
  // Selects, options and file inputs draw their own native UI.
  if (/^(OPTION|OPTGROUP|SELECT)$/.test(element.tagName)) return hide();
  show(element);
}

function onFocusIn(event) {
  const element = event.target?.closest?.(ANCHOR_SELECTOR);
  // Only for keyboard users; a click focuses too, and a tooltip pinned to the
  // control you just pressed is in the way.
  if (element && element.matches(':focus-visible')) show(element);
  else hide();
}

export function initTooltips() {
  if (typeof document === 'undefined' || document.__crmTooltips) return;
  document.__crmTooltips = true;

  document.addEventListener('pointerover', onPointerOver, true);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', hide, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); }, true);
  // A scrolled-away anchor would leave the tooltip floating on its own.
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
}
