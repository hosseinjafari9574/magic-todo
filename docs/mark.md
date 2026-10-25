# The MoonFlow mark

The mark is the app's own instrument: a **dial** with a partial progress **arc**
(the session underway) and the **moon at its centre**, cut from one disc by an
offset disc so the crescent is real geometry rather than a drawn squiggle. A
single indigo **dot** is the only colour in it, following the app-wide rule that
colour means *live*.

- Component: [`components/moonflow-mark.tsx`](../components/moonflow-mark.tsx) — `<MoonFlowMark />`
- Where it appears: the header tile (40px tile, 24px mark), the loading screen's
  skeleton tile, and the favicon.
- Favicon: [`app/icon.svg`](../app/icon.svg) (Next serves it at `/icon.svg`) and the
  multi-size [`public/favicon.ico`](../public/favicon.ico)

## Geometry, in-app

`viewBox="0 0 24 24"`, default rendered size `size-6` (24px). All numbers are in
viewBox units; the canvas is 24 wide, centre `(12, 12)`.

| Element | Geometry |
| --- | --- |
| Mask | `rect 0 0 24 24` black · `circle 11.2 11.8 r 5.2` white · `circle 14.15 9.6 r 5.2` black |
| Dial (track) | `circle 12 12 r 9.4`, `stroke-width 2.3`, `stroke-opacity 0.22` |
| Arc (progress) | `M 12 2.6 A 9.4 9.4 0 0 1 20.15 16.78`, `stroke-width 2.3`, round cap |
| Moon | `circle 11.2 11.8 r 5.2` in `currentColor`, masked |
| Accent dot | `circle 12 2.6 r 1.5`, `fill-primary-soft` (`#8b99ff`) |

Notes that matter if you edit it:

- **The crescent is a mask, not a path.** The white circle is the moon; the black
  circle at `(14.15, 9.6)` is the bite. Those two colours are mask *luminance*,
  not app colours — don't "fix" them to tokens.
- **The bite is 3.68 units deep.** The two discs are `√(2.95² + 2.2²) = 3.68`
  apart with equal radii, so the offset distance *is* the crescent's maximum
  thickness.
- **The arc sweeps ≈120°** from 12 o'clock clockwise to about 4 o'clock — a third
  of the dial, which reads as "a session partly done" at any size.
- **Colour comes from the parent.** The mark draws in `currentColor`; a
  standalone raster of its markup renders black because `currentColor` falls back
  to the initial value outside the document. The dot is the one exception and is
  the only element that carries a colour class.
- **The dot sits exactly on the arc's start point** `(12, 2.6)`, capping the arc.
  Its fill is the same indigo used for live/focus state (`#8b99ff`).
- **Mask ids must be unique per instance** (`useId`), because the header, the
  loading screen and any future use can share one document.
- **`withDot={false}` below ~20px** — smaller than that the 3px dot turns to mush
  and competes with the arc's round cap.

## Clearances (measured, not eyeballed)

- The moon's furthest point is **6.02 units** from centre (`0.825` of centre
  offset + `5.2` radius); the dial's inner edge is at **8.25 units**
  (`9.4 − 2.3/2`). The air between them is **2.23 units ≈ 9% of the canvas**, so
  at 24px the gap is ~2.2px and never closes.
- Rendered standalone at 16 / 24 / 48px, the mark's footprint (non-transparent
  pixels) is **131 / 252 / 843** of 256 / 576 / 2304, with **zero** pixels
  touching the canvas edge at every size.
- The live header instance measures a **24×24** box in a **40×40** tile, with 2
  mask circles and a unique mask id; ivory here is `text-ivory` `#e8e2d6`
  (`rgb(232, 226, 214)`).

## The favicon, and why it is not the same geometry

`app/icon.svg` is the identical composition, but it has to survive **16px** on
both light and dark browser chrome, so it differs deliberately:

| | In-app | Favicon |
| --- | --- | --- |
| Backing | none (transparent) | `rect rx 5.2` graphite gradient `#1a1a1f → #0b0b0d` |
| Edge | — | `rect 0.5 0.5 23 23 rx 4.8`, `#f4f1ea` at `0.10` |
| Dial | `r 9.4`, stroke `2.3` | **`r 9.0`**, stroke `2.4` |
| Arc | `A 9.4 … 20.15 16.78` | `A 9 … 19.71 16.64` |
| Moon | `r 5.2` at `11.2 / 11.8` | `r 5.0` at `11.2 / 11.8` |
| Bite disc | `r 5.2` at `14.15 / 9.6` | `r 5.0` at `14.02 / 9.69` |
| Dot | `12 2.6 r 1.5` `#8b99ff` | same size, at `12 3` (the arc starts lower) |

- **Why the dial is inset (9.0, not 9.4):** at 16px the 9.4 dial's stroke landed
  on the canvas edge, so the mark looked like it was clipped out of its own
  frame. Insetting to 9.0 leaves a real margin.
- **Why the stroke grows to 2.4** while the radius shrinks: the same optical
  weight at 16px, with the moon and bite scaled `5.2 → 5.0` so the crescent's
  proportions are unchanged (the bite measures 3.68 units in-app and 3.52 in the
  favicon — the same fraction of its own disc).
- **The dot is kept**, not dropped: it survives 16px as 4 pixels of indigo, and
  it is what makes the tile recognisable as MoonFlow rather than a generic ring.
- The graphite tile is what lets a dark mark sit on light chrome; the hairline
  keeps it from bleeding into dark chrome.

Measured on the built favicon (`/icon.svg` and every frame of `/favicon.ico`
agree exactly):

| Size | Tile + glyph ink | Glyph coverage | Edge ink | Indigo dot |
| --- | --- | --- | --- | --- |
| 16px | 252 / 256 | 43 | 0 | 4 |
| 32px | 1000 / 1024 | 164 | 0 | 14 |
| 48px | 2244 / 2304 | 363 | 0 | 32 |

*Ink* counts any non-transparent pixel; *glyph coverage* counts pixels bright
enough to be the ivory mark rather than the dark tile; *edge ink* is the
outermost 1px ring, which must stay 0 (`cmp` the served bytes against disk after
any change).

## Compositions considered and rejected

Both were built and measured before C won; kept here so nobody re-derives them.

- **A — moon at the arc tip.** Dial `r 8.6`; arc `M 12 3.4 A 8.6 8.6 0 1 1 6.11 18.27`
  (a three-quarter sweep); moon tangent to the arc's end at `(8.44, 15.79)`,
  `r 3.4`. Rejected: at 16px the small dial plus a 3.4 moon packed into one
  corner and read as noise, and the moon-as-hand idea made the mark look like a
  gauge.
- **B — bold crescent, no dial.** Crescent `r 9.4` at `(10.6, 12.6)` with an echo
  arc and a dot at `(19.4, 4.6)`. Rejected: at 150px it drew about 1.6× C's ink —
  too heavy to sit beside the wordmark — and it lost the *session* reading
  entirely, since a dial is what says "timer", not "moon".
- **C — centred moon, bigger** (shipped). Wins because the dial carries the
  meaning at a glance, the crescent is large enough to survive 16px, and the whole
  thing stays balanced inside the canvas.

## Regenerating the favicon after any mark change

The ICO must never lag the SVG — an ICO holding stale geometry is a real bug, and
it has happened.

The two helpers below are scratch: they live in `.freebuff/` (ignored, and swept
with the other probes), so rebuild them when the mark changes rather than
expecting them on disk.

1. Rasterise `app/icon.svg` at 16/32/48 through a browser canvas and hand the
   bytes over with a tiny local receiver (`node .freebuff/receiver.js` in the
   background, then from the page
   `fetch('http://127.0.0.1:3199/', {method:'POST', body: JSON.stringify({16,32,48})})`
   with base64 PNGs). It validates each payload and writes
   `.freebuff/png-<size>.png`.
   **Do not copy base64 by hand** — that is what corrupted the 48px frame once
   (below).
2. Build and validate with `.freebuff/mkico2.js`. It checks each PNG's
   signature, chunk CRCs and inflated length, assembles the container, then
   reads the result back and validates every frame *inside* the ICO.
3. Confirm the served file matches disk:
   `curl -s localhost:3100/favicon.ico -o /tmp/served.ico && cmp /tmp/served.ico public/favicon.ico`.
   An identical-size replacement is served without a rebuild; a *new path* under
   `public/` needs `npm run build` first.

### Why validation has to inflate the stream

A previous `favicon.ico` passed every structural test — correct `ICONDIR`,
correct per-entry sizes and offsets, PNG signature on all three entries, last
entry ending exactly at EOF — while its 48px payload differed from a correct
render in **3 bytes** and could not be decoded at all. Size, offset and signature
checks cannot see that; `zlib.inflate` plus per-chunk CRC can. That is why
`mkico2.js` is the only supported builder; the structural-only script and its
payload (`retired-mkico-structural-only.js`, `retired-favicon-CORRUPT-48px.b64`)
are kept for the record only, and neither is an input to anything.
