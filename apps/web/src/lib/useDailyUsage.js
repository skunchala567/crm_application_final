import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

/**
 * Tracks how long the signed-in user is actively using the app during the
 * current calendar day, and signs them out after a period of inactivity.
 *
 * Only ACTIVE time counts: the per-second tick stops while the user is idle
 * or the tab is hidden, so leaving a tab open overnight does not inflate the
 * total. Seconds accumulate locally and are flushed to the server as deltas,
 * which keeps the write rate low while surviving reloads, extra tabs and
 * re-logins -- the API adds each delta to one row per (user, day).
 *
 * Callers must await `flushNow()` before tearing down the session, otherwise
 * the pending delta is posted after the auth token is gone and is lost.
 */

// Overridable so the flow can be exercised in seconds instead of minutes:
//   localStorage.setItem('crm_idle_limit', '30')
//   localStorage.setItem('crm_idle_warn', '20')
// Remove the keys to restore the real 10 min / 2 min behaviour.
const readOverride = (key, fallback) => {
  const raw = Number(localStorage.getItem(key));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};
const IDLE_LIMIT_SECONDS = readOverride('crm_idle_limit', 10 * 60);
const IDLE_WARNING_SECONDS = readOverride('crm_idle_warn', 2 * 60);
// Bounds how much is lost if a keepalive flush never lands (crash, network
// drop). Two writes per minute per user is negligible load.
const FLUSH_INTERVAL_SECONDS = 30;
// mousemove is handled separately: a stationary cursor still receives it
// whenever content repaints beneath it, which would reset the idle clock on
// every tick and mean the session never goes idle.
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'];

const localDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

function formatUsage(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

export function useDailyUsage({ enabled = true, onIdleLogout } = {}) {
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [idle, setIdle] = useState(false);
  const [persisting, setPersisting] = useState(true);
  // Seconds left before the automatic sign-out, or null outside the warning
  // window. Drives the countdown shown to the user.
  const [secondsUntilLogout, setSecondsUntilLogout] = useState(null);
  // Exposed so the idle state can be inspected on screen while testing.
  const [idleSeconds, setIdleSeconds] = useState(0);

  const lastActivityRef = useRef(Date.now());
  const unflushedRef = useRef(0);       // counted locally, not yet persisted
  const dateRef = useRef(localDate());
  const warnedRef = useRef(false);
  // Once the countdown is on screen it must be answered explicitly, so plain
  // activity no longer dismisses it.
  const warningActiveRef = useRef(false);
  const idleLogoutRef = useRef(onIdleLogout);
  idleLogoutRef.current = onIdleLogout;

  // Silent failure here means the timer looks fine but nothing is stored, and
  // the total resets on the next login. Say so once instead of swallowing it.
  const reportBroken = useCallback((error) => {
    setPersisting(false);
    if (warnedRef.current) return;
    warnedRef.current = true;
    console.warn(
      '[usage] Daily usage is not being saved, so the timer will reset on next login. '
      + 'Run the API migrations (npm run migrate in apps/api) if crm_user_daily_usage is missing. '
      + `Cause: ${error?.message || error}`,
    );
  }, []);

  /**
   * Post the pending delta. Safe to call repeatedly; no-ops when empty.
   *
   * `beacon` marks the call as surviving page teardown. A normal fetch is
   * aborted when the document unloads, which is why a refresh used to drop
   * everything counted since the last flush. keepalive is used rather than
   * navigator.sendBeacon because the endpoint needs the Authorization header.
   */
  const flushNow = useCallback(async ({ beacon = false } = {}) => {
    const pending = unflushedRef.current;
    if (pending <= 0) return;
    unflushedRef.current = 0;
    try {
      const result = await api('/usage/heartbeat', {
        method: 'POST',
        keepalive: beacon,
        body: JSON.stringify({ seconds: pending, date: dateRef.current }),
      });
      // Trust the server's total: it reconciles other tabs and the daily cap.
      const serverTotal = Number(result?.data?.activeSeconds);
      if (Number.isFinite(serverTotal)) setActiveSeconds(serverTotal);
      setPersisting(true);
    } catch (error) {
      unflushedRef.current += pending; // retry on the next flush
      reportBroken(error);
    }
  }, [reportBroken]);

  // Seed from the server so a reload or re-login continues the day's total.
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const result = await api(`/usage/today?date=${dateRef.current}`);
        if (cancelled) return;
        setActiveSeconds(Number(result?.data?.activeSeconds || 0));
        setPersisting(true);
      } catch (error) {
        if (!cancelled) reportBroken(error);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, reportBroken]);

  /** Explicit "I'm still here": the only thing that clears the countdown. */
  const stayActive = useCallback(() => {
    warningActiveRef.current = false;
    lastActivityRef.current = Date.now();
    setIdle(false);
    setSecondsUntilLogout(null);
  }, []);

  // Real interaction marks the user active again.
  //
  // visibilitychange is deliberately NOT treated as activity: it fires in both
  // directions, so switching tabs away and back used to reset the idle clock
  // twice and the warning never arrived. Time spent on another tab is idle
  // time -- idle is measured from timestamps, so background throttling of the
  // interval delays detection but never the measurement.
  useEffect(() => {
    if (!enabled) return undefined;
    const mark = () => {
      // While the countdown is up, moving the mouse must not silently cancel
      // it -- the user has to choose Stay signed in or Sign out now.
      if (warningActiveRef.current) return;
      lastActivityRef.current = Date.now();
      setIdle((wasIdle) => (wasIdle ? false : wasIdle));
      setSecondsUntilLogout((current) => (current === null ? current : null));
    };

    // Only count the pointer as activity when it actually moved.
    let lastX = null;
    let lastY = null;
    const markPointer = (event) => {
      if (event.clientX === lastX && event.clientY === lastY) return;
      lastX = event.clientX;
      lastY = event.clientY;
      mark();
    };

    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, mark, { passive: true }));
    window.addEventListener('mousemove', markPointer, { passive: true });
    return () => {
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, mark));
      window.removeEventListener('mousemove', markPointer);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;

    const timer = setInterval(() => {
      const idleSeconds = (Date.now() - lastActivityRef.current) / 1000;

      // Inspect in the console with __crmIdle to see why a session is or is
      // not going idle.
      window.__crmIdle = {
        idleSeconds: Math.round(idleSeconds),
        signOutAfter: IDLE_LIMIT_SECONDS,
        warnsWithin: IDLE_WARNING_SECONDS,
        lastActivity: new Date(lastActivityRef.current).toLocaleTimeString(),
      };
      setIdleSeconds(Math.round(idleSeconds));

      if (idleSeconds >= IDLE_LIMIT_SECONDS) {
        setIdle(true);
        setSecondsUntilLogout(0);
        // Bank the time before the session ends, or it is lost.
        flushNow().finally(() => idleLogoutRef.current?.());
        return;
      }

      // Count down through the final stretch so the user can intervene.
      const remaining = Math.ceil(IDLE_LIMIT_SECONDS - idleSeconds);
      if (remaining <= IDLE_WARNING_SECONDS) warningActiveRef.current = true;
      setSecondsUntilLogout((current) => {
        const next = remaining <= IDLE_WARNING_SECONDS ? remaining : null;
        return current === next ? current : next;
      });

      // Rolled past midnight: bank the old day, then start the new one.
      const today = localDate();
      if (today !== dateRef.current) {
        flushNow().finally(() => {
          dateRef.current = today;
          setActiveSeconds(0);
        });
        return;
      }

      // Hidden tabs and idle stretches do not count as usage.
      if (document.visibilityState === 'hidden' || idleSeconds > 60) return;

      unflushedRef.current += 1;
      setActiveSeconds((current) => current + 1);

      if (unflushedRef.current >= FLUSH_INTERVAL_SECONDS) flushNow();
    }, 1000);

    // Refresh, tab close and navigation away: send with keepalive so the
    // request completes even though the document is going away.
    const onHide = () => { if (document.visibilityState === 'hidden') flushNow({ beacon: true }); };
    const onPageHide = () => flushNow({ beacon: true });
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      flushNow({ beacon: true });
    };
  }, [enabled, flushNow]);

  return {
    activeSeconds, idle, persisting, flushNow, stayActive, secondsUntilLogout, idleSeconds,
    idleLimit: IDLE_LIMIT_SECONDS,
    formatted: formatUsage(activeSeconds),
  };
}

export default useDailyUsage;
