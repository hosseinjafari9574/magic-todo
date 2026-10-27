"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { ArrivalSweep, ArrivalVeils } from "@/components/focus/arrival";
import { PhaseHandoff } from "@/components/focus/beat";
import { FocusControls } from "@/components/focus/controls";
import { FocusInstrument } from "@/components/focus/instrument";
import { CycleReadouts, KeyboardHints } from "@/components/focus/readouts";
import { FocusRoom } from "@/components/focus/room";
import { FocusTopBar } from "@/components/focus/top-bar";
import { usePageVisible } from "@/hooks/use-page-visible";
import { useRingSize } from "@/hooks/use-ring-size";
import { currentStreak, getDay, sortTasks } from "@/lib/activity";
import { PRIORITY_META, TIMER_PRESETS, modeMeta } from "@/lib/constants";
import { formatClock } from "@/lib/format";
import { EASE_OUT_EXPO, EASE_SOFT, focusShell, focusStage } from "@/lib/motion";
import { toggleTaskWithFeedback } from "@/lib/task-actions";
import { advanceFocus, getProgress } from "@/lib/timer-actions";
import { toneForMode, toneKeyForMode } from "@/lib/tone";
import { cn } from "@/lib/utils";
import { useTodoStore } from "@/store/use-todo-store";
import { useTimerStore, type PhaseEvent } from "@/store/use-timer-store";
import { useUiStore } from "@/store/use-ui-store";

/**
 * Focus Mode — the overlay, and nothing else.
 *
 * This is the orchestrator: it owns the session's state and its lifecycle (what
 * the store is linked to, what gets announced, what a departure freezes) and
 * composes the parts the room is built from. Each of those parts owns its own
 * concern and is a module of its own:
 *
 *   focus/geometry.ts    the moon's geometry, the orbit's maths, the burst table
 *   focus/room.tsx       the sky, the nebula, the twinkle, the motes, the grain
 *   focus/moon.tsx       the disc, its limb, and the phase glyph at marker size
 *   focus/orbit.tsx      the satellite on its slow orbit
 *   focus/instrument.tsx the dial: halo, moon, orbit, shockwave, ring and clock
 *   focus/celebration.tsx what completing the task looks like
 *   focus/arrival.tsx    the two veils and the light sweep
 *   focus/beat.tsx       the phase hand-off
 *   focus/top-bar.tsx    the mark, the preset, the way out
 *   focus/controls.tsx   run/pause, complete, skip, reset
 *   focus/readouts.tsx   the cycle strip, the day's total, the key hints
 *   hooks/use-ring-size.ts  how big the dial is in the room it has
 *
 * The budget this screen is held to — and the measurements behind every layer
 * choice above — are in docs/motion-budget.md.
 */

const MODE_COPY = {
  focus: { hint: "One thing. Nothing else." },
  short: { hint: "Breathe. Look away from the screen." },
  long: { hint: "You've earned a longer pause." },
} as const;

/*
 * A hidden start-up pre-warm of this tree used to live here: the overlay
 * mounted once at 1% opacity at app start, on the theory that its first commit
 * and first rasters were what the first arrival's ~250ms frame was paying for.
 * Behind the loading screen it cost ~300ms of skeleton, and with `?nowarm` as a
 * control its benefit did not reproduce (six fresh-session runs each side,
 * `entry` max median 266ms with it against 250ms without). It was removed on
 * 2026-10-11; docs/motion-budget.md records the trial and the numbers.
 */

export function FocusMode() {
  const focusTaskId = useUiStore((state) => state.focusTaskId);
  const closeFocus = useUiStore((state) => state.closeFocus);
  const focusedTask = useTodoStore((state) =>
    state.tasks.find((item) => item.id === focusTaskId),
  );
  const activity = useTodoStore((state) => state.activity);
  const preset = useTimerStore((state) => state.preset);
  const mode = useTimerStore((state) => state.mode);
  const running = useTimerStore((state) => state.running);
  const remainingMs = useTimerStore((state) => state.remainingMs);
  const sessions = useTimerStore((state) => state.sessions);
  const phaseEvent = useTimerStore((state) => state.phaseEvent);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const blockRef = useRef<HTMLDivElement>(null);
  const celebrationTimer = useRef<number | null>(null);
  const seenPhaseEvent = useRef(phaseEvent?.id ?? 0);

  const [announcement, setAnnouncement] = useState("");
  const [celebrating, setCelebrating] = useState(false);
  const [beat, setBeat] = useState<PhaseEvent | null>(null);
  const [hintsVisible, setHintsVisible] = useState(true);

  const reduceMotion = useReducedMotion();
  const pageVisible = usePageVisible();

  const open = Boolean(focusTaskId);
  const task = focusedTask;

  const tone = toneForMode(mode);
  const toneKey = toneKeyForMode(mode);
  const isFocus = tone.hot;
  const presetMeta = TIMER_PRESETS[preset];
  const longBreakAfter = presetMeta.longBreakAfter;
  const sessionWord = presetMeta.sessionWord;
  const progress = getProgress(mode, remainingMs, preset);
  /*
   * A clock that has never run is *started*; a paused one is *resumed*. The
   * hand-off arms the next phase untouched, so it reads "Start" — calling it
   * "Resume" would claim the user had already begun a break they haven't.
   */
  const fresh = remainingMs >= presetMeta.durations[mode];
  const minutes = presetMeta.durations[mode] / 60_000;
  const today = getDay(activity);
  const streak = currentStreak(activity);

  const ringSize = useRingSize({ open, stageRef, blockRef });

  const phaseLabel =
    mode === "focus"
      ? preset === "deep"
        ? "Deep work"
        : "Focus session"
      : modeMeta(preset, mode).label;

  /*
   * What the phase line says. Focus counts the sessions in the cycle, so the
   * room tells you where you are without a second widget; a break prefers the
   * instruction, which is the only thing that matters during one.
   */
  const phaseDetail =
    mode === "focus"
      ? `${sessionWord} ${Math.min(sessions + 1, longBreakAfter)} of ${longBreakAfter}`
      : null;
  const taskMeta =
    mode === "focus"
      ? [
          task ? `${PRIORITY_META[task.priority].label} priority` : null,
          task && task.pomodoros > 0 ? `${task.pomodoros} done` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : MODE_COPY[mode].hint;

  /*
   * The clock, split so the minutes can carry the weight and the seconds sit
   * back. `formatClock` always returns both, so the fallbacks are for the type
   * checker alone.
   */
  const [clockMinutes = "0", clockSeconds = "00"] = formatClock(remainingMs).split(
    ":",
  );

  /*
   * Keep the timer linked to the task the overlay is showing, whatever put it
   * there — a click on the row (`enterFocus`), the F key, or the advance after
   * a task is completed (`advanceFocus`). Both entry paths start the session
   * themselves; this effect is only the safety net that keeps the link honest
   * when something else moved the overlay.
   */
  useEffect(() => {
    if (!focusTaskId) return;
    const timer = useTimerStore.getState();
    if (timer.taskId !== focusTaskId) timer.setTaskId(focusTaskId);
  }, [focusTaskId]);

  /*
   * Lock background scroll and manage focus for screen readers.
   *
   * Both the root and the body, not just the body. `overflow: hidden` on
   * <body> alone is enough in Chromium, but not in every engine — Safari on a
   * phone ignores it once the page is taller than the viewport, and this page
   * is routinely taller there. Locking <html> as well removes the scrollport
   * and the scrollbar, and `overscroll-behavior: none` keeps a wheel or a swipe
   * from chaining to the page behind the sheet. Values are restored exactly,
   * not cleared, because the page may have been locked by a dialog first.
   */
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const body = document.body;
    const previous = {
      rootOverflow: root.style.overflow,
      rootOverscroll: root.style.overscrollBehavior,
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
    };
    const previouslyFocused = document.activeElement as HTMLElement | null;
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    containerRef.current?.focus();
    return () => {
      root.style.overflow = previous.rootOverflow;
      root.style.overscrollBehavior = previous.rootOverscroll;
      body.style.overflow = previous.bodyOverflow;
      body.style.overscrollBehavior = previous.bodyOverscroll;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  /*
   * The departure freezes the scene's eternal animations (the breathing orbital
   * shells, the twinkling stars, the drifting motes, the satellite's orbit, the
   * live dot) for the length of the fade — see `.departing` in app/globals.css
   * for why the window wants it.
   *
   * The class cannot come from the render. The tree AnimatePresence keeps
   * mounted during an exit is the one from *before* the store flipped, so every
   * `className` in it still says the overlay is open; only an effect (which
   * runs in the re-render that follows) can see the new state. It goes on the
   * live DOM node, which is the same node either way.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.classList.toggle("departing", !open);
  }, [open]);

  /* The task vanished (deleted) — leave gracefully. */
  useEffect(() => {
    if (focusTaskId && !task) closeFocus();
  }, [focusTaskId, task, closeFocus]);

  /*
   * Announce on entry, phase changes and the start/pause toggle — never every
   * tick. A hand-off leaves the next phase armed but *not running*, and saying
   * "remaining" over a clock nobody started would be a small lie.
   */
  useEffect(() => {
    if (!open) return;
    setAnnouncement(
      `${phaseLabel}. ${formatClock(remainingMs)} ${running ? "remaining" : "ready"}.`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, sessions, running]);

  /* Never leave a pending celebration timer behind. */
  useEffect(
    () => () => {
      if (celebrationTimer.current) window.clearTimeout(celebrationTimer.current);
    },
    [],
  );

  /* The phase hand-off: staged here, but the timer never waits for it. */
  useEffect(() => {
    if (!phaseEvent || phaseEvent.id === seenPhaseEvent.current) return;
    seenPhaseEvent.current = phaseEvent.id;
    if (!open || reduceMotion) return;
    setBeat(phaseEvent);
    const timeout = window.setTimeout(() => setBeat(null), 1700);
    return () => window.clearTimeout(timeout);
  }, [phaseEvent, open, reduceMotion]);

  /* Any key or tap skips the beat immediately. */
  useEffect(() => {
    if (!beat) return;
    const skip = () => setBeat(null);
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [beat]);

  /* Keyboard hints step back once you're absorbed. */
  useEffect(() => {
    if (!open) return;
    let timer = window.setTimeout(() => setHintsVisible(false), 5000);
    const wake = () => {
      setHintsVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setHintsVisible(false), 5000);
    };
    window.addEventListener("keydown", wake);
    window.addEventListener("pointermove", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", wake);
      window.removeEventListener("pointermove", wake);
    };
  }, [open]);

  function exit() {
    setBeat(null);
    closeFocus();
  }

  function handleComplete() {
    if (!task) return;
    if (task.completed) {
      exit();
      return;
    }
    /*
     * Completing the task ends *its* session. The minutes it was given are
     * banked where they were spent — before the completion releases the link,
     * so they land on this task and not on the day alone — and the clock is
     * re-armed to a whole session, so whoever is next gets a full one instead
     * of the tail of the one that just finished. The advance then starts it:
     * the user is still in here, so landing on a task still means working on
     * it. A break is left alone: the task ending is not the pause ending.
     */
    const timer = useTimerStore.getState();
    if (timer.mode === "focus") timer.reset();
    toggleTaskWithFeedback(task);
    setCelebrating(true);
    if (celebrationTimer.current) window.clearTimeout(celebrationTimer.current);
    celebrationTimer.current = window.setTimeout(() => {
      celebrationTimer.current = null;
      setCelebrating(false);
      const ui = useUiStore.getState();
      // The user may have left focus mode during the celebration.
      if (ui.focusTaskId !== task.id) return;
      /*
       * "Next" means the next row the *list* would show: sorted the way it
       * sorts, and inside the tag filter the user is looking through. This used
       * to take the first open task in raw store order, which is the same thing
       * only while no tag filter is set.
       */
      const todos = useTodoStore.getState().tasks;
      const pool = ui.tagFilter
        ? todos.filter((item) => item.tags.includes(ui.tagFilter as string))
        : todos;
      const nextTask = sortTasks(pool).find((item) => !item.completed);
      /* Same rule as entry: landing on a task in here starts its session. */
      if (nextTask) advanceFocus(nextTask.id);
      else ui.closeFocus();
    }, 1000);
  }

  return (
    <AnimatePresence>
      {open && task && (
        <motion.div
          ref={containerRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={`Focus mode: ${task.title}`}
          variants={focusShell}
          initial="hidden"
          animate="show"
          exit="exit"
          /*
           * Full screen and scroll-proof: the overlay is a fixed, clipped box
           * (`overscroll-none` also stops rubber-banding on touch), and the
           * column inside it is a three-row flex that owns the whole height.
           */
          className="fixed inset-0 z-50 overflow-hidden overscroll-none bg-[#040509] outline-none"
        >
          <FocusRoom
            toneRgb={tone.rgb}
            isFocus={isFocus}
            toneKey={toneKey}
            reduceMotion={Boolean(reduceMotion)}
            pageVisible={pageVisible}
          />

          {/*
           * The arrival: two veils sweep in from the edges — each with a
           * hairline at its leading edge — hold while the lens settles, then
           * lift away.
           */}
          <ArrivalVeils reduceMotion={Boolean(reduceMotion)} />

          {/* One pass of light as the veils lift — and on every phase change. */}
          <ArrivalSweep
            toneKey={toneKey}
            isFocus={isFocus}
            reduceMotion={Boolean(reduceMotion)}
          />

          {/* The session — three rows, the middle one owns the slack. */}
          <motion.div
            variants={focusStage}
            /*
             * `overflow-x-clip` trims the few pixels the orbit, the phase
             * shockwave and the celebration sparks spend outside the column —
             * horizontally only, so the moon's glow keeps its vertical bloom.
             * `clip` (not `hidden`) adds no scroll port.
             */
            className="relative z-20 flex h-full w-full flex-col overflow-x-clip px-5 pb-5 pt-5 sm:px-8 sm:pb-6 sm:pt-6"
          >
            <FocusTopBar
              presetMeta={presetMeta}
              running={running}
              tone={tone}
              onExit={exit}
            />

            {/*
             * Stage: the task, a rule, then the instrument.
             *
             * The bottom padding is optical, not structural. Centred between the
             * top bar and the controls, the instrument's centre landed 31px below
             * the viewport's on a 1280x900 window — the header is shorter than the
             * control row, so a plain `justify-center` sits the moon low and the
             * room reads bottom-heavy. The content centres in a box that has shrunk
             * from below, so half of the added padding is the lift: `pb-8` over the
             * old `py-2` raises the moon by 12px on the desktop and `pb-4` by 4px on
             * the phone (`.freebuff/moon-bias.mjs` measures both).
             *
             * The big lift needs height to spend, so it is gated on having some: in
             * a landscape phone's 340px the stage is already shorter than its own
             * content, and the extra 24px would come out of the title's clearance
             * under the top bar (measured: −15px of overlap before this padding,
             * −27px with it). Below 560px of height the stage keeps `pb-4`.
             *
             * The gap between the title and the dial steps back the same way, and
             * for the same reason: below 400px of height the room cannot hold the
             * desktop's 48px of air, and that air is what the dial is paid out of.
             * At 340px the wider gap left a 97px dial; the tight one gives 121px
             * for the same 6px of clearance under the bar. `useRingSize` reads this
             * same value back out of the stage, so the two cannot drift.
             */}
            <div
              ref={stageRef}
              className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-9 pb-4 pt-2 text-center [@media(min-width:640px)_and_(min-height:401px)]:gap-12 [@media(max-height:400px)]:gap-6 [@media(min-width:640px)_and_(min-height:560px)]:pb-8"
            >
              <div
                ref={blockRef}
                className="flex flex-none flex-col items-center gap-3"
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={`phase-${toneKey}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      transition: { duration: 0.34, delay: 0.3, ease: EASE_OUT_EXPO },
                    }}
                    /*
                     * The exit is quick and has no delay of its own: the enter
                     * delay is the arrival's choreography (it waits for the room
                     * to settle), but a hand-off must not hold the old line on
                     * screen while it waits. Framer used to inherit the 0.3s
                     * delay through the shared `transition`, so a phase change
                     * spent a third of a second fading text that was already gone
                     * in every other sense.
                     */
                    exit={{
                      opacity: 0,
                      y: -10,
                      transition: { duration: 0.16, ease: EASE_SOFT },
                    }}
                    className={cn(
                      "text-micro font-semibold uppercase tracking-[0.14em] [@media(max-height:520px)]:hidden sm:tracking-[0.22em]",
                      isFocus
                        ? "text-primary-soft glow-accent"
                        : "text-ivory glow-ivory",
                    )}
                  >
                    {phaseLabel}
                    {phaseDetail && (
                      <span className="text-ivory/70">
                        {" · "}
                        {phaseDetail}
                      </span>
                    )}
                  </motion.span>
                </AnimatePresence>

                <AnimatePresence mode="wait">
                  <motion.h1
                    key={task.id}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      transition: { duration: 0.42, delay: 0.4, ease: EASE_OUT_EXPO },
                    }}
                    exit={{
                      opacity: 0,
                      y: -14,
                      transition: { duration: 0.18, ease: EASE_SOFT },
                    }}
                    className="line-clamp-2 max-w-[22ch] text-balance text-[clamp(1.5rem,calc(3.2vh_+_1rem),2.9rem)] font-medium leading-[1.1] tracking-[-0.015em] text-white/95"
                  >
                    {task.title}
                  </motion.h1>
                </AnimatePresence>

                <p className="text-caption text-ivory/70 [@media(max-height:640px)]:hidden">
                  {taskMeta}
                </p>

                <span aria-hidden className="hairline w-24 opacity-70" />
              </div>

              <FocusInstrument
                progress={progress}
                ringSize={ringSize}
                isFocus={isFocus}
                tone={tone}
                toneKey={toneKey}
                running={running}
                reduceMotion={Boolean(reduceMotion)}
                minutes={minutes}
                mode={mode}
                fresh={fresh}
                clockMinutes={clockMinutes}
                clockSeconds={clockSeconds}
                celebrating={celebrating}
              />
            </div>

            {/* Controls, then everything that can afford to step away. */}
            <div className="flex flex-none flex-col items-center gap-3 sm:gap-4">
              <FocusControls
                running={running}
                fresh={fresh}
                completed={task.completed}
                taskTitle={task.title}
                isFocus={isFocus}
                onToggle={() => useTimerStore.getState().toggle()}
                onComplete={handleComplete}
                onSkip={() => useTimerStore.getState().skip()}
                onReset={() => useTimerStore.getState().reset()}
              />

              <CycleReadouts
                sessions={sessions}
                longBreakAfter={longBreakAfter}
                sessionWord={sessionWord}
                todayFocusMinutes={today.focusMinutes}
                streak={streak}
              />

              <KeyboardHints
                hintsVisible={hintsVisible}
                running={running}
                fresh={fresh}
              />
            </div>
          </motion.div>

          <PhaseHandoff
            beat={beat}
            tone={tone}
            isFocus={isFocus}
            preset={preset}
            todayFocusMinutes={today.focusMinutes}
          />

          <p role="status" aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
