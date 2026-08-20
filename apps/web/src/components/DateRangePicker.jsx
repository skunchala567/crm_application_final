import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * A from/to date range, chosen from two months or a named period.
 *
 * The same popover the dashboard, the report builder and the lead filters
 * each already draw -- and each draws from its own copy. This is the shared
 * one, built on those screens' existing class names so it inherits their
 * appearance rather than introducing a fourth look at the same control. The
 * other three can move onto it whenever they are next touched.
 *
 * The popover is portalled to the body. Host screens wrap their content in
 * containers with overflow:hidden -- the payments tabs sit inside
 * .academic-config-panel, which clipped the calendar to the card it opened
 * from -- and a shared control cannot know what it will be dropped inside.
 *
 * The periods offered here look backwards -- Today, Yesterday, This Week,
 * Last Week, Last 30 Days, Last 90 Days -- because this filters a history of
 * things that have already happened. The follow-up pickers offer Next 7 days
 * and Next 30 days for the opposite reason, which is why the list is a prop
 * rather than something baked in.
 */

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** Local calendar date as YYYY-MM-DD. toISOString would shift it by the offset. */
const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const shift = days => { const date = new Date(); date.setDate(date.getDate() + days); return date; };

/** Sunday of the week containing `date`, matching the Su-first calendar. */
const weekStart = date => { const start = new Date(date); start.setDate(start.getDate() - start.getDay()); return start; };

export const PAST_PERIODS = [
  ['Today', () => [key(new Date()), key(new Date())]],
  ['Yesterday', () => [key(shift(-1)), key(shift(-1))]],
  ['This Week', () => [key(weekStart(new Date())), key(new Date())]],
  ['Last Week', () => {
    const start = weekStart(shift(-7));
    const end = new Date(start); end.setDate(end.getDate() + 6);
    return [key(start), key(end)];
  }],
  ['Last 30 Days', () => [key(shift(-29)), key(new Date())]],
  ['Last 90 Days', () => [key(shift(-89)), key(new Date())]],
];

const pretty = value => {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  return `${day} ${MONTHS[Number(month) - 1]?.slice(0, 3)} ${year}`;
};

function CalendarMonth({ month, from, to, onSelect, onMove, showPrevious, showNext, onMonthChange }) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const dayKey = day => `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const today = key(new Date());

  // A decade either side, so a range a few years back is a scroll not a hunt.
  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 21 }, (_, index) => current - 10 + index);
  }, []);

  return (
    <section className="range-calendar-month">
      <header>
        {showPrevious
          ? <button type="button" aria-label="Previous month" onClick={() => onMove(-1)}><ChevronLeft size={16}/></button>
          : <span/>}
        <div className="range-month-selects">
          <select aria-label="Year" value={year}
            onChange={event => onMonthChange(new Date(Number(event.target.value), monthIndex, 1))}>
            {years.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
          <select aria-label="Month" value={monthIndex}
            onChange={event => onMonthChange(new Date(year, Number(event.target.value), 1))}>
            {MONTHS.map((name, index) => <option key={name} value={index}>{name}</option>)}
          </select>
        </div>
        {showNext
          ? <button type="button" aria-label="Next month" onClick={() => onMove(1)}><ChevronRight size={16}/></button>
          : <span/>}
      </header>

      <div className="range-weekdays">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>

      <div className="range-days">
        {Array.from({ length: firstDay }, (_, index) => <span key={`blank-${index}`}/>)}
        {Array.from({ length: days }, (_, index) => {
          const value = dayKey(index + 1);
          const edge = value === from || value === to;
          const inside = from && to && value > from && value < to;
          return (
            <button
              type="button"
              key={value}
              className={`${edge ? 'selected ' : ''}${inside ? 'in-range ' : ''}${value === today ? 'is-today' : ''}`.trim()}
              aria-pressed={edge}
              onClick={() => onSelect(value)}
            >
              {index + 1}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function DateRangePicker({
  from, to, onChange, label = 'Date range', periods = PAST_PERIODS, placeholder = 'Any date',
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => {
    const anchor = from ? new Date(`${from}T00:00:00`) : new Date();
    return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  });
  const [position, setPosition] = useState(null);
  const rootRef = useRef(null);
  const popoverRef = useRef(null);

  /* Anchored to the trigger by measurement, because the popover no longer
     shares its offset parent. Kept inside the viewport so opening one near
     the right edge does not push it off screen. */
  const place = useCallback(() => {
    const trigger = rootRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const width = Math.min(640, window.innerWidth - 24);
    const left = Math.max(12, Math.min(trigger.right - width, window.innerWidth - width - 12));
    setPosition({ top: Math.round(trigger.bottom + 7), left: Math.round(left), width });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    place();
    // The portal is outside rootRef, so both have to be consulted before a
    // click counts as "outside".
    const close = event => {
      if (rootRef.current?.contains(event.target)) return;
      if (popoverRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const escape = event => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', place);
    // Capture, so it follows the scroll of whichever container moves.
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', close, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  /* First click starts a new range, second closes it. Clicking a day before
     the start is read as a correction rather than an error, so the two are
     swapped instead of refused. */
  const select = value => {
    if (!from || (from && to)) return onChange(value, '');
    if (value < from) return onChange(value, from);
    onChange(from, value);
  };

  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const move = amount => setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1));

  const text = from && to
    ? (from === to ? pretty(from) : `${pretty(from)} — ${pretty(to)}`)
    : from ? `From ${pretty(from)}`
      : to ? `Until ${pretty(to)}` : placeholder;

  return (
    <div className="date-range-picker" ref={rootRef}>
      <button type="button" className={`date-range-trigger${from || to ? ' active' : ''}`}
        onClick={() => setOpen(value => !value)} aria-expanded={open}>
        <CalendarRange size={15}/>
        <span>
          <small>{label}</small>
          <strong>{text}</strong>
        </span>
        <ChevronDown size={13}/>
      </button>

      {open && position && createPortal((
        <div className="followup-range-popover date-range-popover" ref={popoverRef}
          style={{ position: 'fixed', top: position.top, left: position.left, width: position.width, right: 'auto' }}>
          <div className="range-calendar-panel">
            <aside>
              <strong>Choose a Period</strong>
              {periods.map(([name, resolve]) => (
                <button type="button" key={name} onClick={() => {
                  const [start, end] = resolve();
                  onChange(start, end);
                  setMonth(new Date(new Date(`${start}T00:00:00`).getFullYear(), new Date(`${start}T00:00:00`).getMonth(), 1));
                }}>{name}</button>
              ))}
            </aside>
            <div className="range-calendar-months">
              <CalendarMonth month={month} from={from} to={to} onSelect={select} onMove={move}
                showPrevious onMonthChange={setMonth}/>
              <CalendarMonth month={nextMonth} from={from} to={to} onSelect={select} onMove={move}
                showNext onMonthChange={value => setMonth(new Date(value.getFullYear(), value.getMonth() - 1, 1))}/>
            </div>
          </div>
          <div className="followup-range-footer">
            <button type="button" className="range-clear" onClick={() => onChange('', '')}>Clear</button>
            <button type="button" className="range-apply" onClick={() => setOpen(false)}>Apply dates</button>
          </div>
        </div>
      ), document.body)}
    </div>
  );
}
