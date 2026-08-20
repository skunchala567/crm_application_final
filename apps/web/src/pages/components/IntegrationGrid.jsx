import { ArrowRight, PhoneCall, Plug, RefreshCw, Radio } from 'lucide-react';

/**
 * Integration tiles.
 *
 * Brand marks are inline SVG rather than remote images: the app must render
 * offline and without reaching a third-party CDN.
 */

/*
 * Every status the API can return needs an entry here.
 *
 * The API normalises the stored ENUM to lowercase: INACTIVE -> 'inactive',
 * CONNECTED -> 'active', and some paths return 'pending_auth' directly.
 * 'inactive' and 'pending_auth' had no entry and fell through to the
 * fallback, so an integration that was switched off reported itself as
 * "Pending" -- which reads as "half-way through connecting" rather than
 * "not connected".
 */
const STATUS = {
  active: { label: 'Connected', dot: 'bg-primary-500', chip: 'bg-primary-50 text-primary-700' },
  error: { label: 'Error', dot: 'bg-danger', chip: 'bg-danger-bg text-danger' },
  pending: { label: 'Pending', dot: 'bg-warning', chip: 'bg-warning-bg text-warning' },
  pending_auth: { label: 'Pending', dot: 'bg-warning', chip: 'bg-warning-bg text-warning' },
  inactive: { label: 'Not connected', dot: 'bg-secondary-300', chip: 'bg-surface-3 text-secondary-500' },
  disconnected: { label: 'Disconnected', dot: 'bg-secondary-300', chip: 'bg-surface-3 text-secondary-500' },
};

function WhatsAppMark() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.29-.77.95-.94 1.15-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.65-2.05-.17-.29-.02-.45.13-.6.13-.13.3-.35.44-.52.15-.17.2-.29.3-.49.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.29-1.04 1.01-1.04 2.47s1.06 2.87 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35z" />
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm0 18.02h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.17 8.17 0 0 1-1.25-4.35c0-4.54 3.7-8.23 8.24-8.23a8.2 8.2 0 0 1 8.23 8.24c0 4.54-3.69 8.2-8.23 8.2z" />
    </svg>
  );
}

function GoogleSheetsMark() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm0 2.5L17.5 8H14V4.5z" opacity=".35" />
      <path d="M8 11h8v2h-3v2h3v2H8v-2h3v-2H8v-2z" />
    </svg>
  );
}

function MetaMark() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.52 1.5-3.91 3.77-3.91 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.45 2.91h-2.33V22c4.78-.76 8.44-4.92 8.44-9.94z" />
    </svg>
  );
}

/** provider_name (lowercased) -> mark + brand tint. */
const PROVIDERS = [
  { match: ['smartping', 'aisensy', 'whatsapp'], Mark: WhatsAppMark, tone: 'bg-primary-50 text-primary-600' },
  { match: ['google_sheets', 'google sheets', 'google'], Mark: GoogleSheetsMark, tone: 'bg-primary-50 text-primary-700' },
  { match: ['meta', 'facebook', 'instagram'], Mark: MetaMark, tone: 'bg-blue-50 text-blue-600' },
  { match: ['callerdesk'], Mark: () => <PhoneCall size={22} />, tone: 'bg-violet-50 text-violet-600' },
  { match: ['smartflo', 'tata'], Mark: () => <Radio size={22} />, tone: 'bg-teal-50 text-teal-600' },
];

function providerVisual(providerName) {
  const key = String(providerName || '').toLowerCase();
  const hit = PROVIDERS.find((entry) => entry.match.some((token) => key.includes(token)));
  return hit || { Mark: () => <Plug size={22} />, tone: 'bg-surface-3 text-secondary-500' };
}

function formatStamp(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function IntegrationGrid({ integrations, onSync, onSettings, loading }) {
  if (loading) {
    return (
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(310px,1fr))]">
        {[0, 1, 2].map((key) => (
          <div key={key} className="h-[214px] rounded-2xl border border-border bg-white animate-pulse" />
        ))}
      </div>
    );
  }

  if (!integrations.length) {
    return (
      <div className="rounded-2xl border border-border bg-white p-12 text-center">
        <p className="font-semibold text-foreground mb-1">No integrations found</p>
        <p className="text-sm text-secondary-500">Try a different search or status filter.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(310px,1fr))]">
      {integrations.map((integration) => {
        // An unrecognised status must not silently borrow another's label.
        const status = STATUS[integration.status]
          || { label: integration.status || 'Unknown', dot: 'bg-secondary-300', chip: 'bg-surface-3 text-secondary-500' };
        const { Mark, tone } = providerVisual(integration.provider_name);

        return (
          <article
            key={integration.id}
            className="group relative flex flex-col rounded-2xl border border-border bg-white p-5 shadow-sm
                       transition-[transform,box-shadow,border-color] duration-300 ease-[cubic-bezier(.16,1,.3,1)]
                       hover:-translate-y-1 hover:shadow-md hover:border-primary-200"
          >
            {/* Head: brand mark + status chip */}
            <div className="flex items-start justify-between gap-3">
              <span className={`grid place-items-center w-12 h-12 flex-none rounded-xl ${tone}`}>
                <Mark />
              </span>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold ${status.chip}`}>
                <i className={`w-[5px] h-[5px] rounded-full ${status.dot}`} />
                {status.label}
              </span>
            </div>

            <h3 className="mt-4 font-display font-bold text-[15px] text-foreground truncate">
              {integration.integration_name}
            </h3>
            <p className="mt-1 text-[12.5px] text-secondary-500 line-clamp-2">
              {integration.description || `Connected service via ${integration.provider_name}.`}
            </p>

            <dl className="mt-4 pt-4 border-t border-line-2 space-y-2 text-[12px]">
              <div className="flex justify-between gap-3">
                <dt className="text-secondary-400">Provider</dt>
                <dd className="font-semibold text-secondary-700 truncate">{integration.provider_name}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-secondary-400">Last sync</dt>
                <dd className="font-semibold text-secondary-700 tabular-nums">
                  {formatStamp(integration.last_synced_at)}
                </dd>
              </div>
            </dl>

            <div className="mt-5 flex items-center gap-2">
              <button
                onClick={() => onSync(integration)}
                className="grid place-items-center w-9 h-9 flex-none rounded-[10px] border border-border text-secondary-500
                           hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200 active:scale-95 transition-all"
                title="Sync now"
                aria-label={`Sync ${integration.integration_name}`}
              >
                <RefreshCw size={15} />
              </button>
              <button
                onClick={() => onSettings(integration)}
                className="ml-auto inline-flex items-center gap-1.5 px-3.5 h-9 rounded-[10px] bg-primary-600 text-white
                           text-[12.5px] font-semibold shadow-brand hover:bg-primary-700 active:scale-95 transition-all"
              >
                Manage
                <ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
