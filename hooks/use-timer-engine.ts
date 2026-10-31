"use client";

import { useEffect } from "react";

import { APP_NAME, TIMER_PRESETS, TICK_INTERVAL_MS } from "@/lib/constants";
import { formatClock } from "@/lib/format";
import { primeAudio } from "@/lib/sound";
import { useTimerStore } from "@/store/use-timer-store";

const BASE_TITLE = `${APP_NAME} — todos, focus & flow`;

/**
 * Ms until the first second of tomorrow. A second past midnight rather than
 * exactly on it, so the local date has already turned when the check runs.
 */
function msUntilTomorrow(): number {
  const now = new Date();
  const tomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    1,
    0,
  );
  return tomorrow.getTime() - now.getTime();
}

/**
 * Keeps the timer honest: a single interval drives the countdown, the
 * browser tab title and lazy audio initialisation.
 */
export function useTimerEngine() {
  useEffect(() => {
    let lastTitle = "";

    const applyTitle = () => {
      const state = useTimerStore.getState();
      const modeLabel =
        TIMER_PRESETS[state.preset].modeLabels[state.mode].label;
      const title = state.running
        ? `${formatClock(state.remainingMs)} · ${modeLabel} — ${APP_NAME}`
        : BASE_TITLE;
      if (title !== lastTitle) {
        lastTitle = title;
        document.title = title;
      }
    };

    const tick = () => {
      useTimerStore.getState().tick();
      applyTitle();
    };

    tick();
    const interval = window.setInterval(tick, TICK_INTERVAL_MS);
    const unsubscribe = useTimerStore.subscribe(applyTitle);

    /*
     * The session count belongs to the day and the app is routinely left open
     * overnight, so something has to notice the date turning. One timeout aimed
     * at the next midnight does it: the 200ms tick would read the calendar
     * 18,000 times an hour to catch a change that happens once, and the count
     * would only be corrected the next time the user pressed Start.
     */
    let midnight = 0;
    const rollCycle = () => {
      useTimerStore.getState().rollCycleDay();
      midnight = window.setTimeout(rollCycle, msUntilTomorrow());
    };
    midnight = window.setTimeout(rollCycle, msUntilTomorrow());

    const onVisibility = () => {
      if (document.hidden) return;
      tick();
      /*
       * A machine that slept through midnight fires the timeout late, and a
       * page restored from the back/forward cache may not see it fire at all —
       * so coming back into view re-checks the day and re-aims the timer.
       */
      useTimerStore.getState().rollCycleDay();
      window.clearTimeout(midnight);
      midnight = window.setTimeout(rollCycle, msUntilTomorrow());
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onGesture = () => primeAudio();
    window.addEventListener("pointerdown", onGesture, { once: true });
    window.addEventListener("keydown", onGesture, { once: true });

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(midnight);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
      document.title = BASE_TITLE;
    };
  }, []);
}
