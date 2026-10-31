# MoonFlow

A calm, premium todo app with an immersive **Focus Mode** and a **Pomodoro timer**.
Everything is stored locally in your browser — no account, no backend, no sync.

The name is the two things the app is built from. The **moon** is on the dial —
the instrument in the header and the favicon — and **flow** is the state Focus
Mode exists to protect: one ordered session at a time, then a break, then a
cycle. It also describes the look — graphite surfaces, ivory text, film grain,
and an aurora that only appears in Focus Mode. The mark is the app's own
instrument: a progress ring with the moon at its centre, and one indigo dot for
live phase. It lives in
`components/moonflow-mark.tsx`; `app/icon.svg` is the favicon — the same
composition on a graphite tile so it reads against both light and dark browser
chrome, with the dial inset and the stroke widened so the ring keeps a real
margin at 16px (the dot stays: it survives there as four pixels of indigo).
Geometry, measured clearances and the rejected alternatives are in
[docs/mark.md](docs/mark.md).

Formerly *Cadence*, then *Nocturne*; the current name is **MoonFlow**. The
localStorage keys still say `cadence:` — see *Data & persistence* below.

Names screened and rejected for collisions: *Vigil* (surveillance/VMS software),
*Sundial* (timekeeping, HR and analytics), *Tessera* (three funded companies).

## Screenshots

**The day** — the list, this week's focus chart and the timer card, with two
sessions already banked and the clock pointed at the next one. It leads the
gallery because it is the first thing the app answers: what is left today, what
the week adds up to, and what is running.

![The task list, this week's focus chart and the timer card](docs/png/app-list.png)

**Focus Mode** — that same session, entered. Everything but one task, its title,
the moon and the clock is gone; the card's dial is here at full size, the
cycle's four moons sit beneath it, and the day's total and streak hold one quiet
line. The room is shot at laptop size (1280×900), because a room that needs a
cinema to breathe is not a room you can work in.

![Focus Mode at desktop size, one session just started](docs/png/focus-room.png)

Both pictures are `npm run shots`: a fixed day's work seeded into a headless
Chrome and photographed, so they are regenerated rather than hand-taken. The
room's clock is stopped at the 12:00 the card shows — entering Focus Mode starts
the session — and the key hints have already faded, so two runs differ only
where the app itself changed.

The object-level shots (the card's dial, the phase strip, the moon and its
cycle) are deliberately left out of this gallery: they document the instrument's
geometry rather than how the app is used, and are verified by
`npm run verify:visuals` instead. Their measurements live in
[docs/mark.md](docs/mark.md) and [docs/moon.md](docs/moon.md).

## Stack

- **Next.js 15** (App Router) + **TypeScript**
- **Tailwind CSS v4** with a deep dark theme — the *Graphite & Ivory* palette:
  graphite surfaces, ivory text and a single electric-indigo accent reserved for
  live state
- **Framer Motion** for every meaningful animation, driven by a shared motion
  system (`lib/motion.ts`)
- **Inter** for prose, **Geist Mono** for every number (clock, counts, stats)
- **shadcn/ui** base components (Button, Input, Dialog, Label, Switch, Badge)
- **Zustand** for state, persisted to **localStorage**

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm run prepare:moon # rebuild the moon's surface asset (needs Chrome)
```

## Features

- **Focus Mode** — a full-screen, distraction-free room, and the app's name
  taken literally: a deep-space gradient, a starfield, a galactic band, drifting
  motes and a soft nebula that drifts and never scales, film grain, and two
  orbital shells breathing around the instrument. At the centre is the mark's
  own composition at full size — a dark moon, lit from the left with the source
  below the middle, that fills *across* the disc as the session runs: a new
  session opens it as a hairline crescent on its left limb, and the light crosses
  toward the right, where the night side is the last of it to go. (The terminator
  that draws therefore runs 55° from the horizontal, walked down from a
  near-upright 71° and back a step from the 61° that followed it — the four small
  moons below are turned by the same number.) A satellite rides a slow orbit
  around it, the progress ring is the dial, and on the moon's face a large mono
  clock carries the minutes while the seconds sit back. The moon is the session
  itself in second form — its lit fraction waxes exactly with the clock until the
  face is full as the time runs out. Under it the cycle reads the same way: four
  moon phases — crescent, half, gibbous, full — one per session in the cycle,
  lit amber as you bank them: each is a real phase, its dark side the moon's own
  grey — a hue-less step *above* the sky it sits on (28 luma against 8.3,
  measured beside a pending glyph at a pane-sized room; the dial keeps its own
  blue-black at 21), so the unlit half reads as a body in shadow rather than as a
  hole, and it needs no outline — and its terminator the
  ellipse a projected
  great circle makes, so the third of them is
  legibly the step before full (and its dark crescent exactly the mirror of the
  first one's lit crescent, half a turn round) and the full moon at the end of
  the row is the one that buys the long break. Staggered entrance choreography,
  session-phase shockwaves and a completion celebration, all in the same
  language. Only the essentials: the task, the timer, and Pause / Complete / Skip
  / Reset / Exit — and those are the app's own `<Button>` at the card's own sizes,
  not a second set of buttons that merely looks like them. `Esc` leaves any time.
  Opening it *starts the session* — one click, no second start — and so does the
  advance to the next task when you complete one from inside it.
- **Phase tones** — focus is the only colourful state (indigo); every break
  drains to hue-less ivory, so the shift is felt before it is read. The nebula,
  ring, orbit, moon-light, controls and eyebrow all follow the same tone.
- **Phase-completion beat** — when a session or a full cycle ends inside Focus
  Mode, a brief centrepiece badges the change (amber for a completed cycle).
  Any key or tap skips it instantly, and it never blocks the timer.
- **Pomodoro** — two rhythm presets, switchable at any time before a
  session and remembered across reloads:
  - **Classic** — 25 min focus / 5 min short break / 15 min long break after
    four sessions
  - **Deep Work** — 50 min focus / 10 min break (20 min long break after four
    blocks)
  A smooth hand-off: when a session ends, the next phase arms itself and the
  state changes on its own — but a phase change never starts a clock. Sessions
  run because you asked for one: Start, entering Focus Mode on a task (which
  starts that task's session as it opens), or completing a task while Focus
  Mode is open on the next one. Optional sound feedback, session counters, skip
  and reset. The cycle belongs to the day: the four sessions sit in a row only
  until the local date changes, at which point the count starts again at one —
  so yesterday's fourth session cannot hand out a long break today has not
  earned. A tab left open overnight is caught at midnight, and the stored count
  carries its own day, so a reload the next morning resets it even after the
  browser has been closed. The card carries its own **Focus Mode** button, so
  the room is one tap from the timer rather than a scroll back up to the list,
  and it opens on the task the clock is linked to. Completed sessions and focus
  minutes are persisted per task and overall.
- **Tasks** — create, edit, delete, complete, plus optional priority and tags
  with tag filtering.
- **Routines** — save the groups of tasks you repeat (a morning routine, a
  weekly review) and add the whole group in one click. A routine is a name plus
  its task titles; every title is added as an ordinary task, so nothing else in
  the app has to know routines exist. The panel under the list creates, edits
  and deletes them, with undo on delete and on apply.
- **Stats & streak** — completed today, focus minutes today, current streak and
  a last-7-days focus chart.
- **Sound effects** — synthesised WebAudio chimes (no assets), toggleable:
  a short tick-tock when a clock starts, then a bell for the end of a session
  and a softer pair when a break is over.
- **Toasts** — undo for delete and completion.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `N` | New task |
| `↑` / `↓` | Move selection |
| `X` | Complete selected task |
| `E` | Edit selected task |
| `F` | Toggle Focus Mode |
| `Space` / `P` | Start / pause the pomodoro |
| `?` | Shortcut list |
| `Esc` | Exit Focus Mode / close dialogs |

## Structure

```
app/            layout, page shell, global styles + design tokens (@theme)
components/     feature UI (list, focus mode, pomodoro, stats…) + ui/ (shadcn)
hooks/          timer engine, global keyboard shortcuts, page visibility, ring sizing
lib/            pure helpers (activity, format, sound, actions) + motion & tone systems
store/          Zustand stores (todos, timer, routines, transient UI)
docs/           the mark spec (geometry, clearances, regeneration) + the moon's surface
```

Focus Mode is the one full-screen surface, so it is built from parts rather than
one file. `components/focus-mode.tsx` owns the session — the store link, the
announcement, the departure's freeze, the task-completion flow — and composes
`components/focus/`, where each module owns one concern:

```
components/focus/
  geometry.ts     moon light axis + phase terminator, orbit maths, burst table (no JSX)
  room.tsx        the sky, the nebula, the twinkle, the motes, the grain
  moon.tsx        the disc, its limb, and the phase glyph at marker size
  orbit.tsx       the satellite on its slow orbit
  instrument.tsx  the dial: halo, moon, orbit, shockwave, ring and clock
  celebration.tsx what completing the task looks like
  arrival.tsx     the two veils and the light sweep
  beat.tsx        the phase hand-off
  top-bar.tsx     the mark, the preset, the way out
  controls.tsx    run/pause, complete, skip, reset
  readouts.tsx    the cycle strip, the day's total, the key hints
```

The dial's size is measured from the room it has rather than the viewport
(`hooks/use-ring-size.ts`), and the gesture each layer is allowed — which ones
never transform, which only fade — is decided by the frame budget, not by taste.

## Design system

Tokens live in `app/globals.css` under `@theme` (`background`, `foreground`,
`ivory`, `primary`/`primary-soft`, `achievement`, surfaces 1–3, hairline and
surface overlays, the `--text-*` type scale, and the sans/mono families). One
more sits outside `@theme`, on `:root`, because the moon's unlit side is a
judgement rather than a system colour: `--moon-dark`, which the dial's disc and
the unlit part of its terminator are both painted in, and `--moon-glyph`, one step
lighter, for the 14px moons in the cycle strip. Plain custom properties because
Tailwind emits only the theme variables it sees used in class names, and the two
tokens in the app whose *values* were picked by eye off samples
(`docs/motion-budget.md`).
Reusable layer: `.panel` (matte gradient-bordered surface), `.inset`, `.kbd`,
`.hairline`, `.ambient` + `.bloom` (a soft glow, faded by a radial mask rather
than a 90px gaussian blur — see docs/motion-budget.md), `.skeleton`, `.grain`,
`.float-up`, and the Focus Mode sky: `.starfield` (the whole star field in one
static raster), `.galaxy`, `.twinkle` (opacity-only, one composited layer each)
and `.orbit-spin` (a composited HTML rotation with an SVG inside it).

Motion is centralised in `lib/motion.ts` (durations, springs, variants) and
phase colour in `lib/tone.ts` — components read the tone by timer mode instead
of hard-coding colours. Every animation respects `prefers-reduced-motion`.

The type, field and control scales — and the `tailwind-merge` registration that
keeps a size token and a colour from cancelling each other — are in
[docs/design-system.md](docs/design-system.md).

The Focus Mode entry/exit has a measured frame budget — what it is, how to
re-measure it, and which optimisations it already paid for are in
[docs/motion-budget.md](docs/motion-budget.md).

### Focus Mode's chrome is the app's chrome

A full-screen room is where a second design language creeps in, so the room's
chrome is not designed, it is *borrowed*: every control is
`components/ui/button.tsx` (the card's primary in focus and its ivory in a break,
the card's outline button for Complete, skip and reset, the header's own outline
button for the way out), the preset chip is the header's `.inset` well, and the
labels are set in the shared `--text-*` scale. What is left for the room to
decide is only which variant and how much air — and the room spends it on *one
line*: all four controls are `lg` (48px, same radius) on a single gap, where the
card's row steps down to 40px icons after its primary. The row is a line under an
instrument rather than a primary with two quieter things beside it, so a shared
frame is what reads as balanced; `.freebuff/asym-probe.mjs` measures every row of
the room against the room's own axis, and the row's heights, radii and gaps.

Its quiet text is ivory at 70% rather than `text-muted-foreground`. The muted
token is tuned for graphite; the room's quiet lines sit on the nebula, where
measured it lands at 4.0–4.4:1 — under AA on the brightest band of sky. Ivory at
70% is the same weight of grey one step lighter and reads 5.9–7.7:1 across the
whole frame. `.freebuff/design-probe.mjs` is the measurement: it compares every
button in the room against the app's own, attribute by attribute; checks that the
orbit's arc clears the title and the controls and that the room cannot scroll at
five viewports; and reads the contrast of eleven text elements out of the
rendered pixels. `.freebuff/frame-map.mjs` prints the frame as text for when a
screenshot cannot be looked at.

A design that has to be *looked at* still needs a way to be checked without
looking, and the parts that are geometry rather than styling have one:
`npm run verify:visuals`. It seeds a fixed session into a headless Chrome,
opens the room, reads the card's marks, the moon's light and the strip's masks
out of the DOM, reads their pixels back off screenshots, and compares both with
what the source implies — the tick angles and lit count, where the arc stops,
`MOON_LIGHT`'s night axis and travel, `--moon-dark`, and each glyph's lit area.
It also reads the moon's *surface*: the texture is served, the lit face carries
local terrain rather than a smooth fill, the night side keeps its earthshine (a
28–44 luma band with its own terrain, not a hole) and falls across it from 37 to
26 luma as the ground turns away from Earth, the far limb turns away, and the
clock clears 7:1 over the scrim at full moon.
The room's own fit is read on four short stages too: the title block has to
start below the top bar, which is what a flat dial floor used to spend.
It starts a dev server itself, exits non-zero and lists every measurement that
drifted, so a quarter-turn of the graduations or a token moved in one place
fails the command rather than the design review. It also drives the whole
focus → break → focus round trip, because the moon's *direction* cannot be
read off a single phase: focus fills the disc from the light's side and the
break has to drain it from that same side, so the two are point reflections of
one another. A break that darkened from the opposite limb passes every
single-phase check and fails there. The `.freebuff/*` probes named
above are how those numbers were chosen; this is the one that stays.

## Data & persistence

Everything lives in `localStorage` under three keys (`cadence:todos:v1`,
`cadence:timer:v1`, `cadence:templates:v1`). Those names predate the rename and
stay frozen on purpose — renaming them would orphan existing local data.
Upgrades are driven by the `version` field inside each payload instead.

Every hydrate runs through `lib/persist.ts`, whether the payload matches the
current version, needs a migration, or predates versioning altogether. A stored
shape we no longer recognise is *repaired* rather than discarded: missing task
fields fall back to defaults, a missing task id is regenerated, an unknown
timer mode or preset falls back to Classic focus, a running clock with no end
stamp reads as paused, and a payload stamped with a *newer* version is
normalised instead of thrown away. Only entries carrying no information at all
(a task with no title, a day key that isn't a day key, a routine with no tasks)
are dropped. A routine's task titles survive duplication on purpose — repeating
one is how a routine says "twice" — but they are capped like every other stored
string.

A running clock is the one piece of state the browser can freeze. A phone that
locks its screen stops the timer's interval for the whole session, so the
completion is always noticed late, and the store treats the clock *reaching*
zero as the session whatever the page was doing at the time — banking the
session's whole minutes rather than the ones it watched go by. Both paths are
covered in `.freebuff/e2e-timer.mjs` (cases 10 and 11).

## Credits

The moon's surface is NASA's **CGI Moon Kit** (NASA Scientific Visualization
Studio, from Lunar Reconnaissance Orbiter data), public-domain NASA imagery; it
is reprojected to a disc by [`scripts/prepare-moon-texture.mjs`](scripts/prepare-moon-texture.mjs)
and the result is documented in [docs/moon.md](docs/moon.md). Everything else
here — interface, marks, animation — is drawn in CSS, SVG and canvas with no
image dependencies.
