import { CalendarClock, PencilLine, RefreshCw, UserCheck, UserPlus } from 'lucide-react';
import { relativeTime } from './ActivityTimeline.jsx';

/**
 * The lead's milestones as a horizontal progression.
 *
 * Runs oldest to newest, left to right, the direction a horizontal timeline
 * is read. (The Activity feed underneath is newest-first, because a feed is
 * scanned for what just happened rather than followed as a sequence.)
 */
const MILESTONES = [
  { key: 'addedAt', label: 'Added', icon: UserPlus, tone: 'emerald' },
  { key: 'updatedAt', label: 'Updated', icon: PencilLine, tone: 'slate' },
  { key: 'referredAt', label: 'Referred', icon: UserCheck, tone: 'blue' },
  { key: 'reEnquiredAt', label: 'Re-enquired', icon: RefreshCw, tone: 'violet' },
  {
    // The lead list calls this nextFollowup and the lead detail endpoint
    // calls it nextFollowupAt. This component is given whichever payload the
    // caller has, so it reads both -- looking at only one showed a scheduled
    // follow-up as "Not scheduled".
    key: 'nextFollowupAt', altKey: 'nextFollowup',
    label: 'Next follow-up', icon: CalendarClock, tone: 'amber', empty: 'Not scheduled',
  },
];

const TONES = {
  emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  blue: 'bg-blue-50 text-blue-600 ring-blue-100',
  amber: 'bg-amber-50 text-amber-600 ring-amber-100',
  violet: 'bg-violet-50 text-violet-600 ring-violet-100',
  slate: 'bg-secondary-100 text-secondary-500 ring-secondary-100',
};

const dateOnly = (value) => new Date(value).toLocaleDateString('en-IN', {
  timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric',
});
const timeOnly = (value) => new Date(value).toLocaleTimeString('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit',
});
const exact = (value) => `${dateOnly(value)}, ${timeOnly(value)}`;

export default function LeadTimeline({ lead = {} }) {
  const resolved = MILESTONES.map((milestone) => {
    const raw = lead[milestone.key] ?? (milestone.altKey ? lead[milestone.altKey] : null);
    const valid = raw && !Number.isNaN(new Date(raw).getTime());
    return { ...milestone, at: valid ? raw : null };
  });

  // Ordered by the timestamps themselves, oldest first, so the sequence
  // reflects what actually happened. A fixed order put a re-enquiry from
  // 12:50 after a referral from 13:13 simply because of how the list was
  // written. Milestones with no date have no place in the sequence, so they
  // trail the end rather than being sorted as if they were at epoch zero.
  const rows = [
    ...resolved.filter((row) => row.at).sort((a, b) => new Date(a.at) - new Date(b.at)),
    ...resolved.filter((row) => !row.at),
  ];

  return (
    // Scrolls rather than wraps: a timeline that folds onto a second line
    // stops reading as one sequence.
    <div className="flex overflow-x-auto pb-1 -mx-1">
      {rows.map((row, index) => {
        const Icon = row.icon;
        return (
          <div
            key={row.key}
            className="relative flex-1 min-w-[132px] flex flex-col items-center text-center px-2"
          >
            {/* Connector from this badge's centre to the next one's. Drawn
                behind the badge, and omitted on the last step. */}
            {index < rows.length - 1 && (
              <span className="absolute top-[15px] left-1/2 w-full h-px bg-border" aria-hidden="true" />
            )}

            <span className={`relative z-[1] grid place-items-center w-[31px] h-[31px] rounded-full ring-4 ring-white ${
              row.at ? TONES[row.tone] : 'bg-secondary-50 text-secondary-300 ring-white'
            }`}>
              <Icon size={15} />
            </span>

            <p className={`mt-2 font-semibold text-[12px] leading-tight ${
              row.at ? 'text-foreground' : 'text-secondary-400'
            }`}>
              {row.label}
            </p>

            {row.at ? (
              <p className="mt-0.5 text-[11px] text-secondary-500 leading-tight" title={exact(row.at)}>
                {dateOnly(row.at)}
                <span className="block text-secondary-400">{timeOnly(row.at)}</span>
                <span className="block text-secondary-400">{relativeTime(row.at)}</span>
              </p>
            ) : (
              <p className="mt-0.5 text-[11px] text-secondary-400 leading-tight">
                {row.empty || 'Not recorded'}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
