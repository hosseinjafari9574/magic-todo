import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { TIMER_PRESETS } from "@/lib/constants";
import { dayKey } from "@/lib/format";
import { browserStorage, normalizeTimer } from "@/lib/persist";
import { playSound } from "@/lib/sound";
import type { TimerMode, TimerPresetId } from "@/lib/types";
import { useTodoStore } from "@/store/use-todo-store";
import { useUiStore } from "@/store/use-ui-store";

/**
 * A presentational phase hand-off. The store transitions instantly; this
 * event only tells the UI *what just happened* so Focus Mode and the
 * Pomodoro card can stage a short, skippable beat around it.
 */
export interface PhaseEvent {
  id: number;
  from: TimerMode;
  to: TimerMode;
  kind: "session" | "cycle";
}

let phaseEventSeq = 0;

interface TimerState {
  preset: TimerPresetId;
  mode: TimerMode;
  running: boolean;
  /** Epoch ms at which the current session ends (while running). */
  endsAt: number | null;
  remainingMs: number;
  /** Focus sessions completed today (0..4); the next long break is the fourth. */
  sessions: number;
  /** Local day the count above belongs to — a new day starts the cycle again. */
  cycleDay: string;
  /** Focus minutes already flushed to stats for the running session. */
  flushedMs: number;
  taskId: string | null;
  /** Set when a session completes; never persisted. */
  phaseEvent: PhaseEvent | null;

  setTaskId: (taskId: string | null) => void;
  start: () => void;
  pause: () => void;
  toggle: () => void;
  reset: () => void;
  skip: () => void;
  setMode: (mode: TimerMode) => void;
  /** Switch the Pomodoro rhythm (Classic / Deep Work). Re-arms the current
   * session to the preset's duration while preserving the run state. */
  setPreset: (preset: TimerPresetId) => void;
  /** Called by the engine on every tick. */
  tick: () => void;
  /**
   * Start the cycle again when the local date has moved on. Cheap and
   * idempotent, so every path that reads or grows the count can call it: a
   * reload, a click on Start, and the engine's own midnight hand-off all land
   * here rather than each carrying its own date arithmetic.
   */
  rollCycleDay: () => void;
  /**
   * Session reached zero — record it, then move to the next phase *armed*:
   * the phase changes on its own, the clock waits for the user's start.
   */
  completeSession: () => void;
  /** Push accrued focus minutes into the daily stats. */
  syncAccrual: () => void;
}

function durationFor(preset: TimerPresetId, mode: TimerMode): number {
  return TIMER_PRESETS[preset].durations[mode];
}

function soundEnabled(): boolean {
  return useTodoStore.getState().settings.soundEnabled;
}

export const useTimerStore = create<TimerState>()(
  persist(
    (set, get) => ({
      preset: "classic",
      mode: "focus",
      running: false,
      endsAt: null,
      remainingMs: TIMER_PRESETS.classic.durations.focus,
      sessions: 0,
      cycleDay: dayKey(),
      flushedMs: 0,
      taskId: null,
      phaseEvent: null,

      setTaskId: (taskId) => set({ taskId }),

      start: () => {
        get().rollCycleDay();
        const state = get();
        if (state.running) return;
        const remaining =
          state.remainingMs > 0
            ? state.remainingMs
            : durationFor(state.preset, state.mode);
        /*
         * A *fresh* focus clock adopts the task the user is on. The list's
         * cursor and the card's "focusing on" are the same idea: starting a
         * session with a row selected should bank its minutes there instead of
         * nowhere. Only a fresh clock, and only when nothing is linked yet — a
         * paused or running session is never re-pointed behind the user's back,
         * and once a link exists the dropdown is the only thing that moves it.
         */
        const selected = useUiStore.getState().selectedId;
        const selectedTask = selected
          ? useTodoStore.getState().tasks.find((task) => task.id === selected)
          : null;
        const adopt =
          state.mode === "focus" &&
          state.taskId === null &&
          remaining === durationFor(state.preset, "focus") &&
          selectedTask &&
          !selectedTask.completed
            ? selectedTask.id
            : null;
        set({
          running: true,
          remainingMs: remaining,
          endsAt: Date.now() + remaining,
          ...(adopt ? { taskId: adopt } : {}),
        });
        /*
         * A start, whether fresh or after a pause, is the one moment the clock
         * is visibly handed the time. Five escapement clicks over two and a bit
         * seconds there, and nowhere else: a per-minute tick would talk over the
         * session, and a tick on every phase change would fire while the clock
         * is still armed.
         */
        if (soundEnabled()) playSound("tick-tock");
      },

      pause: () => {
        const state = get();
        if (!state.running) return;
        const remaining = state.endsAt
          ? Math.max(0, state.endsAt - Date.now())
          : state.remainingMs;
        set({ running: false, endsAt: null, remainingMs: remaining });
        if (state.mode === "focus") state.syncAccrual();
      },

      toggle: () => {
        if (get().running) get().pause();
        else get().start();
      },

      reset: () => {
        const state = get();
        if (state.mode === "focus") state.syncAccrual();
        set({
          running: false,
          endsAt: null,
          remainingMs: durationFor(state.preset, state.mode),
          flushedMs: 0,
          phaseEvent: null,
        });
      },

      /*
       * Skipping moves the phase on; like the automatic hand-off it stops
       * there. One rule for the whole timer: a clock runs because the user
       * asked for one — pressing Start, entering Focus Mode on a task, or
       * finishing one while Focus Mode is still open on the next — and never
       * because a phase changed on its own. Otherwise the break after a skip is
       * spent away from the screen before it is ever noticed.
       */
      skip: () => {
        const state = get();
        if (state.mode === "focus") state.syncAccrual();
        const next: TimerMode = state.mode === "focus" ? "short" : "focus";
        const sessions = state.mode === "long" ? 0 : state.sessions;
        const nextDuration = durationFor(state.preset, next);
        if (soundEnabled()) playSound("soft");
        set({
          mode: next,
          sessions,
          remainingMs: nextDuration,
          flushedMs: 0,
          running: false,
          endsAt: null,
          phaseEvent: null,
        });
      },

      setMode: (mode) => {
        const state = get();
        if (state.mode === "focus" && mode !== "focus") state.syncAccrual();
        set({
          mode,
          running: false,
          endsAt: null,
          remainingMs: durationFor(state.preset, mode),
          flushedMs: 0,
          phaseEvent: null,
        });
      },

      setPreset: (preset) => {
        const state = get();
        if (state.preset === preset) return;
        // Flush pending focus minutes against the *old* durations first,
        // then re-arm the current mode with the new preset's duration.
        if (state.mode === "focus") state.syncAccrual();
        const duration = durationFor(preset, state.mode);
        set({
          preset,
          remainingMs: duration,
          flushedMs: 0,
          ...(state.running ? { endsAt: Date.now() + duration } : {}),
        });
        if (soundEnabled()) playSound("soft");
      },

      tick: () => {
        const state = get();
        if (!state.running || !state.endsAt) return;
        const now = Date.now();
        const remaining = state.endsAt - now;
        if (remaining > 0) {
          state.syncAccrual();
          set({ remainingMs: remaining });
          return;
        }
        /*
         * The clock reached zero, so the session happened — whether we noticed
         * on the tick that crossed it or on the one that ran when the page came
         * back. It used to be discarded when noticed more than ten minutes late,
         * which is a rule a phone can never satisfy: a locked screen (or a
         * backgrounded tab, or a page the browser froze or discarded) stops the
         * interval for the whole session, so the completion is *always* noticed
         * late. The user still did the session; the timer is what knows how long
         * it was, and it says they did.
         */
        state.completeSession();
      },

      /*
       * The hand-off changes the phase; it never starts it. Running the next
       * session is the user's click — a break that begins by itself is a break
       * the user did not take, and the focus session after it would begin while
       * they were still away. The `phaseEvent` still fires, so the UI keeps its
       * flourish and the announcement.
       */
      completeSession: () => {
        get().rollCycleDay();
        const state = get();
        if (state.mode === "focus") {
          /*
           * Bank the whole session, not only the minutes the engine watched
           * tick past. On a suspended page the elapsed time *we* saw is a
           * fraction of the session (the clock is frozen with the page), so
           * syncing from `remainingMs` alone would file a 25-minute session as
           * the two minutes before the screen locked. The clock reached zero;
           * that is the session, and it is what gets counted.
           */
          set({ remainingMs: 0 });
          state.syncAccrual();
          useTodoStore.getState().registerPomodoro(state.taskId);
          const sessions = state.sessions + 1;
          const next: TimerMode =
            sessions >= TIMER_PRESETS[state.preset].longBreakAfter
              ? "long"
              : "short";
          const nextDuration = durationFor(state.preset, next);
          if (soundEnabled()) playSound("session-end");
          set({
            mode: next,
            sessions,
            remainingMs: nextDuration,
            flushedMs: 0,
            running: false,
            endsAt: null,
            phaseEvent: {
              id: (phaseEventSeq += 1),
              from: "focus",
              to: next,
              kind: next === "long" ? "cycle" : "session",
            },
          });
          return;
        }
        const sessions = state.mode === "long" ? 0 : state.sessions;
        const focusDuration = durationFor(state.preset, "focus");
        if (soundEnabled()) playSound("break-end");
        set({
          mode: "focus",
          sessions,
          remainingMs: focusDuration,
          flushedMs: 0,
          running: false,
          endsAt: null,
          phaseEvent: {
            id: (phaseEventSeq += 1),
            from: state.mode,
            to: "focus",
            kind: "session",
          },
        });
      },

      /*
       * A cycle is a day's four sessions, not a rolling four: yesterday's third
       * session must not buy today's long break before today has done any work.
       * Only the count resets — the phase, the clock and the link are left
       * exactly where the user left them, because a break that is already
       * armed (or half spent) is still the break they are owed, and a session
       * still running past midnight is still the session they started.
       */
      rollCycleDay: () => {
        const state = get();
        const today = dayKey();
        if (state.cycleDay === today) return;
        set({ cycleDay: today, sessions: 0 });
      },

      syncAccrual: () => {
        const state = get();
        if (state.mode !== "focus") return;
        const elapsed = durationFor(state.preset, "focus") - state.remainingMs;
        const pending = elapsed - state.flushedMs;
        const minutes = Math.floor(pending / 60_000);
        if (minutes <= 0) return;
        /*
         * The minutes go to today *and* to the task the clock is linked to, so
         * a task's time and its session count come from the same clock. If the
         * user re-points the timer mid-session, the minutes already banked stay
         * with the task that earned them and the rest follow the new link.
         */
        useTodoStore.getState().addFocusMinutes(minutes, state.taskId);
        set({ flushedMs: state.flushedMs + minutes * 60_000 });
      },
    }),
    {
      // The key stays frozen for compatibility; upgrades are driven by the
      // payload's `version`. Both hydrate paths run through `normalizeTimer` so
      // an unrecognised stored shape degrades instead of costing the session.
      name: "cadence:timer:v1",
      version: 1,
      skipHydration: true,
      storage: createJSONStorage(browserStorage),
      partialize: (state) => ({
        preset: state.preset,
        mode: state.mode,
        running: state.running,
        endsAt: state.endsAt,
        remainingMs: state.remainingMs,
        sessions: state.sessions,
        cycleDay: state.cycleDay,
        flushedMs: state.flushedMs,
        taskId: state.taskId,
      }),
      migrate: (persisted) => normalizeTimer(persisted),
      merge: (persisted, current) => ({
        ...current,
        ...normalizeTimer(persisted),
      }),
      /*
       * `merge` repairs the payload in memory, and the middleware never writes
       * that repaired state back: storage keeps yesterday's count until the
       * next click, and a payload from before the day was stored keeps carrying
       * no day at all — which would make every following morning look like the
       * same day, so its count would never roll. One write on hydration settles
       * both, for the price of a single `setItem` per load.
       */
      onRehydrateStorage: () => () => {
        useTimerStore.setState({});
      },
    },
  ),
);
