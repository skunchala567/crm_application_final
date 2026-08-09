import { useEffect, useState } from 'react';

/**
 * Tracks a media query and re-renders when it changes.
 *
 * The sidebar needs this because its collapsed rail is a desktop-only idea:
 * on a phone the same state has to render as a full-width drawer, and CSS
 * alone cannot decide which of the two sets of markup to build.
 *
 * Reads synchronously on first render so there is no flash of the wrong
 * layout, and guards `window` so the module stays importable if this app is
 * ever rendered on a server.
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => (typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(query).matches
      : false),
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const list = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** The breakpoint the shell uses to switch between rail and drawer. */
export const useIsDesktop = () => useMediaQuery('(min-width: 768px)');

export default useMediaQuery;
