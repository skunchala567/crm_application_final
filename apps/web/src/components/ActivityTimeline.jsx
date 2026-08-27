import { useMemo, useRef, useState } from 'react';
import {
  CalendarClock, ChevronDown, Clock, FileText, Filter, GitBranch, Headphones, IndianRupee,
  Mail, MessageCircle, Phone, RefreshCw, Upload, UserPlus, UserCheck,
} from 'lucide-react';

/**
 * A lead's activity, newest first, as a connected timeline.
 *
 * Keyed on activity_type rather than on words found in the summary. The
 * previous version matched "payment", "bill" and "vendor" -- none of which a
 * lead activity ever says -- so every entry fell through to the same generic
 * clock icon regardless of what had happened.
 */
const ACTIVITY_TYPES = {
  created: { label: 'Lead created', icon: UserPlus, tone: 'emerald' },
  updated: { label: 'Lead updated', icon: FileText, tone: 'slate' },
  stage_change: { label: 'Stage changed', icon: GitBranch, tone: 'teal' },
  followup_updated: { label: 'Follow-up updated', icon: CalendarClock, tone: 'amber' },
  followup_created: { label: 'Follow-up scheduled', icon: CalendarClock, tone: 'amber' },
  referred: { label: 'Lead referred', icon: UserCheck, tone: 'blue' },
  re_enquired: { label: 'Re-enquiry received', icon: RefreshCw, tone: 'violet' },
  note: { label: 'Note added', icon: FileText, tone: 'slate' },
  comment: { label: 'Comment added', icon: FileText, tone: 'slate' },
  call: { label: 'Call logged', icon: Phone, tone: 'blue' },
  whatsapp: { label: 'WhatsApp message', icon: MessageCircle, tone: 'emerald' },
  message: { label: 'Message sent', icon: MessageCircle, tone: 'emerald' },
  email_sent: { label: 'Email sent', icon: Mail, tone: 'blue' },
  document: { label: 'Document uploaded', icon: Upload, tone: 'violet' },
  payment: { label: 'Payment recorded', icon: IndianRupee, tone: 'emerald' },
};

/** Soft badge colours, matching the rest of the workspace. */
const TONES = {
  emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  blue: 'bg-blue-50 text-blue-600 ring-blue-100',
  amber: 'bg-amber-50 text-amber-600 ring-amber-100',
  violet: 'bg-violet-50 text-violet-600 ring-violet-100',
  teal: 'bg-teal-50 text-teal-600 ring-teal-100',
  slate: 'bg-secondary-100 text-secondary-500 ring-secondary-100',
};

function describe(item) {
  const known = ACTIVITY_TYPES[String(item.activityType || item.type || '').toLowerCase()];
  if (known) return known;
  // Unknown type: fall back to the summary so a new activity still reads
  // sensibly instead of being labelled with something misleading.
  return { label: item.summary || 'Activity', icon: Clock, tone: 'slate' };
}

/**
 * "12 minutes ago" up to a week, then the date.
 *
 * Relative time is what makes a timeline scannable, but it stops helping once
 * something is old -- "43 days ago" is harder to place than the date itself.
 */
export function relativeTime(value) {
  if (!value) return '';
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return '';
  const seconds = Math.floor((Date.now() - then.getTime()) / 1000);

  // A scheduled follow-up is in the future, where "ago" would be nonsense.
  if (seconds < -60) {
    const ahead = Math.abs(seconds);
    const minutes = Math.floor(ahead / 60);
    if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `in ${days} day${days === 1 ? '' : 's'}`;
    return then.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return then.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function exactTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
  });
}

/** The activity_type of one entry, normalised the way describe() reads it. */
const typeKey = (item) => String(item.activityType || item.type || '').toLowerCase() || 'other';

export default function ActivityTimeline({ activities = [] }) {
  const [expandedItems, setExpandedItems] = useState({});
  const [typeFilter, setTypeFilter] = useState('all');
  const filterMenu = useRef(null);

  const sorted = useMemo(
    () => [...activities].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt)),
    [activities],
  );

  /*
   * Only the types this lead actually has, with how many of each.
   *
   * Offering the full catalogue would list a dozen kinds that never happened
   * to this lead, and every one of them would filter to nothing.
   */
  const availableTypes = useMemo(() => {
    const counts = new Map();
    for (const item of sorted) {
      const key = typeKey(item);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([key, count]) => ({
        key,
        count,
        label: ACTIVITY_TYPES[key]?.label || 'Other activity',
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [sorted]);

  const visible = useMemo(
    () => (typeFilter === 'all' ? sorted : sorted.filter((item) => typeKey(item) === typeFilter)),
    [sorted, typeFilter],
  );

  const toggle = (id) => setExpandedItems((prev) => ({ ...prev, [id]: !prev[id] }));

  if (!sorted.length) {
    return (
      <p className="text-sm text-secondary-500 py-6 text-center">
        No activity recorded for this lead yet.
      </p>
    );
  }

  return (
    <>
      {/* A filter over one kind of thing is not a filter, so it appears only
          once there is more than one kind to choose between. */}
      {availableTypes.length > 1 && (
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <span className="text-[11.5px] text-secondary-500">
            {visible.length === sorted.length
              ? `${sorted.length} ${sorted.length === 1 ? 'entry' : 'entries'}`
              : `${visible.length} of ${sorted.length} entries`}
          </span>
          <div className="inline-flex items-center gap-2 text-[11.5px] text-secondary-500">
            <Filter size={13} className="text-secondary-400" />
            <span className="sr-only sm:not-sr-only">Show</span>
            {/* This timeline is rendered inside a disabled fieldset while a
                lead is viewed. Native selects inherit that disabled state, so
                use a non-form popover which remains interactive. */}
            <details ref={filterMenu} className="relative">
              <summary aria-label="Filter activity by type" className="list-none cursor-pointer inline-flex min-w-40 items-center justify-between gap-3 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[12px] font-semibold text-foreground outline-none focus:border-primary-500">
                {typeFilter === 'all' ? `All activity (${sorted.length})` : `${ACTIVITY_TYPES[typeFilter]?.label || 'Other activity'} (${availableTypes.find((type) => type.key === typeFilter)?.count || 0})`}
                <ChevronDown size={13} />
              </summary>
              <div role="listbox" aria-label="Activity types" className="absolute right-0 z-20 mt-1 min-w-full overflow-hidden rounded-lg border border-border bg-white py-1 shadow-lg">
                {[{ key: 'all', label: 'All activity', count: sorted.length }, ...availableTypes].map((type) => (
                  <div key={type.key} role="option" aria-selected={typeFilter === type.key} tabIndex={0}
                    className={`cursor-pointer whitespace-nowrap px-3 py-2 text-[12px] hover:bg-primary-50 ${typeFilter === type.key ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-foreground'}`}
                    onClick={() => { setTypeFilter(type.key); filterMenu.current?.removeAttribute('open'); }}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setTypeFilter(type.key); filterMenu.current?.removeAttribute('open'); } }}>
                    {type.label} ({type.count})
                  </div>
                ))}
              </div>
            </details>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-secondary-500 py-6 text-center">
          No {ACTIVITY_TYPES[typeFilter]?.label?.toLowerCase() || 'matching'} activity for this lead.
        </p>
      ) : (
    <div className="relative">
      {visible.map((item, index) => {
        const { label, icon: Icon, tone } = describe(item);
        const isLast = index === visible.length - 1;
        const isExpanded = expandedItems[item.id];
        // The comment, actor and follow-up date are shown inline now, so
        // "More" appears only when there is something else worth opening.
        const extraDetailKeys = Object.keys(item.details || {}).filter(
          (key) => !['nextFollowupAt', 'followupType', 'stage', 'substage', 'recordingUrl'].includes(key),
        );
        // The recording is the reason to look at a call, so it plays from the
        // entry itself rather than from behind a "More" link.
        const recordingUrl = item.details?.recordingUrl || null;
        const hasDetails = extraDetailKeys.some((key) => item.details[key]) || Boolean(item.details?.bodyHtml);

        return (
          <div key={item.id ?? index} className="relative flex gap-3 pb-5 last:pb-0">
            {/* The connector, drawn behind the badge and stopped on the last
                entry so the line does not trail into empty space. */}
            {!isLast && (
              <span className="absolute left-[15px] top-8 bottom-0 w-px bg-border" aria-hidden="true" />
            )}

            <span className={`relative z-[1] grid place-items-center w-[31px] h-[31px] flex-none rounded-full ring-4 ring-white ${TONES[tone] || TONES.slate}`}>
              <Icon size={15} />
            </span>

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-[13.5px] text-foreground leading-snug">
                  {label}
                  {/* Who made the change, on the title line -- it was only
                      visible after expanding, which is a lot of clicking to
                      answer "who did this". */}
                  {item.actorName && (
                    <span className="font-normal text-secondary-500"> · {item.actorName}</span>
                  )}
                </p>
                {hasDetails && (
                  <button
                    type="button"
                    onClick={() => toggle(item.id)}
                    className="flex-none inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 hover:text-primary-700"
                    aria-expanded={Boolean(isExpanded)}
                  >
                    {isExpanded ? 'Less' : 'More'}
                    <ChevronDown
                      size={12}
                      className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    />
                  </button>
                )}
              </div>

              {item.summary && (
                <p className="text-[12.5px] text-secondary-600 mt-0.5 leading-relaxed">{item.summary}</p>
              )}

              {/* The comment written at the time. Shown rather than hidden:
                  it is usually the reason the activity exists. */}
              {item.commentText && (
                <p className="mt-1 pl-2.5 border-l-2 border-border text-[12.5px] text-secondary-700 italic">
                  “{item.commentText}”
                </p>
              )}

              {/* The follow-up scheduled by THIS update, recorded on the
                  activity so past entries keep their own date. */}
              {item.details?.nextFollowupAt && (
                <p className="inline-flex items-center gap-1.5 mt-1.5 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[11px] font-semibold">
                  <CalendarClock size={11} />
                  Next: {new Date(item.details.nextFollowupAt).toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
                  })}
                  {item.details.followupType ? ` · ${item.details.followupType}` : ''}
                </p>
              )}

              {/* The call recording, playable where the call is listed. */}
              {recordingUrl && (
                <div className="mt-2 p-2 rounded-lg bg-surface-3 border border-border">
                  <span className="flex items-center gap-1.5 mb-1.5 text-[11px] font-semibold text-secondary-600">
                    <Headphones size={12} /> Call recording
                  </span>
                  {/* preload="metadata" so the player shows the recording's
                      length straight away instead of 0:00 until it is played.
                      Only the file header is fetched, not the audio itself. */}
                  <audio controls preload="metadata" src={recordingUrl} className="w-full h-9">
                    Your browser cannot play this recording.
                    <a href={recordingUrl} target="_blank" rel="noopener noreferrer">Download it instead</a>
                  </audio>
                </div>
              )}

              {/* Relative for scanning, exact on hover for when it matters. */}
              <p
                className="inline-flex items-center gap-1 mt-1 text-[11px] text-secondary-400"
                title={exactTime(item.occurredAt)}
              >
                <Clock size={11} />
                {relativeTime(item.occurredAt)}
              </p>

              {isExpanded && (
                <div className="mt-2 p-3 rounded-lg bg-surface-3 border border-border space-y-2">
                  {item.details?.subject && <p className="text-xs"><span className="text-secondary-500">Subject:</span> <strong>{item.details.subject}</strong></p>}
                  {Array.isArray(item.details?.to) && <p className="text-xs"><span className="text-secondary-500">To:</span> {item.details.to.join(', ')}</p>}
                  {item.details?.bodyHtml && (
                    <div className="text-xs bg-white border rounded-lg p-3" dangerouslySetInnerHTML={{ __html: item.details.bodyHtml }} />
                  )}
                  {item.details && Object.entries(item.details)
                    .filter(([key]) => extraDetailKeys.includes(key) && !['bodyHtml','subject','to'].includes(key))
                    .map(([key, value]) => (
                    value && typeof value === 'string' && !key.toLowerCase().includes('url') ? (
                      <div key={key} className="flex gap-2 text-[11.5px]">
                        <span className="text-secondary-500 capitalize">{key.replace(/_/g, ' ')}:</span>
                        <span className="text-secondary-700 font-medium">{value}</span>
                      </div>
                    ) : null
                  ))}
                  {/* The recording used to live here, behind "More". It now
                      plays from the entry itself. */}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
      )}
    </>
  );
}
