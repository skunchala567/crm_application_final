import { useEffect } from 'react';
import { Clock3 } from 'lucide-react';

/**
 * Shown for the last stretch before an inactivity sign-out.
 *
 * Deliberately blocking: once it appears it stays until the user answers it.
 * Moving the mouse does not dismiss it (the usage hook ignores activity while
 * it is up), the backdrop is not click-to-close, and Escape is swallowed --
 * otherwise it could be cancelled by accident and the user would not know
 * whether the session was still counting down.
 */
export default function IdleWarning({ secondsLeft, onStay, onSignOut }) {
  // Swallow Escape so the dialog cannot be dismissed without a choice.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const seconds = Math.max(0, Number(secondsLeft) || 0);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  const countdown = minutes > 0
    ? `${minutes} min ${String(remainder).padStart(2, '0')} sec`
    : `${remainder} sec`;

  return (
    <div
      className="fixed inset-0 z-[300] grid place-items-center p-6 bg-secondary-900/50"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-warning-title"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white border border-border shadow-lg overflow-hidden">
        <div className="px-6 pt-6 pb-5 text-center">
          <span className="grid place-items-center w-12 h-12 mx-auto mb-4 rounded-xl bg-warning-bg text-warning">
            <Clock3 size={22} />
          </span>
          <h3 id="idle-warning-title" className="font-display font-bold text-base text-foreground mb-1">
            Still there?
          </h3>
          <p className="text-sm text-secondary-600">
            You will be signed out in{' '}
            <strong className="text-foreground tabular-nums">{countdown}</strong>{' '}
            due to inactivity.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2 px-6 pb-6">
          <button type="button" className="secondary" onClick={onSignOut}>
            Sign out now
          </button>
          <button type="button" className="primary" onClick={onStay} autoFocus>
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}
