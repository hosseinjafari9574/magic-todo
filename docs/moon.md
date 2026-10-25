# The moon's surface

The dial's moon is not painted. It is a **photograph of the Moon's albedo**,
reprojected into the disc the room draws, and then lit by the room's own
terminator. This file is the record of where that image comes from, how it is
projected, and what the four numbers around it were chosen against.

- Component: [`components/focus/moon.tsx`](../components/focus/moon.tsx) — `MoonBody`
- Numbers: [`components/focus/geometry.ts`](../components/focus/geometry.ts) — `MOON_TEXTURE_URL` and the five surface constants
- Asset: [`public/moon/moon-disc.webp`](../public/moon/moon-disc.webp) — 1024×1024, 158 KB
- Build step: [`scripts/prepare-moon-texture.mjs`](../scripts/prepare-moon-texture.mjs) — `npm run prepare:moon`
- Checks: `npm run verify:visuals`, the `moon/*` and `desktop/*` measurements

## Why base colour, not a photograph of the full moon

A photograph of a full moon carries the Sun's own lighting: the shadows in every
crater, and the limb falloff of a sphere lit from one side. Drawing this room's
terminator over it would put a second, contradictory light on the same disc — a
crescent whose lit limb still shows the full moon's own shadows. NASA's CGI Moon
Kit publishes the **base-colour map** instead: the albedo before lighting, which
is exactly the surface a renderer is supposed to light itself. That is the file
this asset is built from.

It is also why the night side can be the *same photograph* at 13% rather than a
second flat fill: one surface at two exposures is what an earthlit moon looks
like, and it keeps the seam between day and night from being a shape pasted onto
a hole.

## The source

| | |
| --- | --- |
| File | `lroc_color_2k.jpg` (NASA SVS, CGI Moon Kit, 2025 revision) |
| URL | <https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg> |
| Size | 2048×1024, equirectangular (full 360° longitude × 180° latitude) |
| SHA-256 | `f7130a1822681fa7512d7dcfd40db8c10b9ba4f06777910348698260ed7a2170` |
| Licence | NASA imagery — public domain, no attribution required (credited here anyway) |

The digest is pinned in the prep script. A replaced map fails the build step
loudly instead of quietly changing the moon; review the new map, then update the
pinned hash. That is how the previous revision was caught: its bottom **96 rows
were pure black**, and since those rows are the map's south pole, the projection
painted them as a black cap across the bottom of the disc — the shape was right
and only the photograph was missing. The current revision has surface to the
pole, and `moon/texture-caps` samples the committed disc at both of its poles so
a letterboxed map cannot come back through a routine rebuild.

The source is cached at `.freebuff/moon-source.jpg` (ignored). The **output** is
committed, so a checkout builds without the download and without Chrome.

## The projection

The room needs a disc — a sphere seen from here — not an equirectangular map, so
the script does the projection itself, in a headless browser, because the browser
is the only image decoder this project has without adding a dependency.

For every output pixel, and for a 4×4 grid of subsamples inside it:

1. Map the subsample to the unit disc, `u, v ∈ [−1, 1]`, and skip it if
   `u² + v² > 1`.
2. Invert the orthographic projection: `z = √(1 − u² − v²)` is the component
   toward the viewer, `lat = asin(−v)`, `lon = atan2(u, z)`. The **near side**
   faces out, and the map's central meridian (`lon = 0`) is the face the Moon
   keeps toward us.
3. Sample the map bilinearly, wrapping in longitude and clamping in latitude.
4. Average the covered subsamples into the pixel, and use the coverage count as
   the pixel's alpha.

The 4×4 grid is the antialiasing: the limb is where an equirectangular map is
compressed hardest, and without supersampling the edge is a staircase. Alpha is
partial coverage at the rim and 255 inside it.

Two properties matter and are easy to get wrong:

- **Latitude is negated** (`asin(−v)`): canvas `y` grows downward, latitude grows
  upward. Dropping the sign flips the Moon upside down — it still looks like a
  moon, which is exactly why it needs saying.
- **Longitude comes from `atan2(u, z)`, not from `u` alone.** Using `u` directly
  stretches the map toward the limb instead of compressing it there.

The script prints the surface's luma distribution after projecting, which is what
the treatment below is chosen against:

```
surface mean 165.8 luma · p05 123.6 · p50 167.8 · p95 210.5 · 822056 opaque px
```

165 is a *photograph in daylight*. The room's sky is 8 and its clock is white, so
the disc has to be dimmed before it can be a body in space.

## The numbers

Each is in `geometry.ts` with the measurement behind them; these are the
readings the shipped build produced (`npm run verify:visuals`, phone at 390×844
and desktop at 1280×900).

| Constant | Value | Measured |
| --- | --- | --- |
| `MOON_LIT_BRIGHTNESS` | 0.62 | lit surface median **97** luma, p95 **133** |
| `MOON_LIT_CONTRAST` | 1.08 | maria stay distinct after the dim without becoming a map |
| `MOON_NIGHT_OPACITY` · `MOON_NIGHT_CONTRAST` | 0.13 · 1.15 | night side **33.8** luma at 0.72R (band 28–44), its own terrain **0.46–0.54** local rms |
| `MOON_NIGHT_FALLOFF` | 0.66 | earthshine **37** luma at 0.56R → **25** at 0.86R on the phone; **38 → 29** on the desktop's 322px disc: a fall of about **9–12** luma across the unlit half |
| `MOON_LIMB_SHADE` | 0.55 | night limb falls **13–14** luma from 0.68R to 0.92R |
| `MOON_SCRIM_OPACITY` | 0.55 | clock contrast **7.9:1** at full moon (9.8:1 on desktop) |
| `MOON_TERMINATOR_FEATHER` | 0.024 | an **8px** blur radius on a 322px disc, so the lit face runs out over roughly **20px**, following the terminator's own curve (was one hard step) |

- **0.62 brightness** puts the disc under the reading. At full moon the clock sits
  on the brightest surface the room ever shows, and the type is white; anything
  near the albedo's own 165 would turn the face into a lamp.
- **1.08 contrast** is a small lift, because a linear dim flattens the difference
  between maria and highlands. More than this starts painting the photograph as a
  high-contrast map.
- **0.13 night** is the albedo at 13% over `--moon-dark`: earthshine, not a hole
  and not a second flat fill. 5% was arithmetically sound — it landed the unlit
  face at 26 — but 26 luma is where a display's black point begins, so the maria
  and the highlands flattened into one silhouette and the night half read as a
  cut hole. At 13% the face sits at **37** near the middle and **34** at 0.72R,
  still well under half the lit face’s 97, and its own terrain survives the dim:
  **0.46–0.54** local rms against 0.27 at 5%, and a p05–p95 spread near 15 across the
  unlit half. **1.15 contrast** is what carries the maria through that dim, the
  same job 1.08 does on the lit face; without it the night reads as a grey wash
  rather than a surface.
- **0.66 falloff** is the second light the night face has. Earth sits in the
  viewer’s direction — the side we see is the side facing it — so the unlit half
  is a sphere lit *head-on*, not one alpha spread over the whole area: brightest
  where the ground faces the viewer, dimmer at the limb where the ground turns
  away. It is the same geometry that makes the lit limb fall off, on a source
  a hundred thousand times weaker. 0.66 takes the night from **37** luma at
  0.56R to **25** at 0.86R on the phone — about twelve luma, part of it the limb
  shade’s own contribution — and the fade is what stops the unlit half from
  reading as one flat sheet with a vignette. On the desktop’s 322px disc the same
  ramp reads **38 → 29**: nine luma rather than twelve, because the limb shade is
  drawn at a fixed 62px and covers a little less of a larger radius — the reason
  the fade is measured on both discs rather than assumed to scale. Deeper and the earthlit rim starts to read as a
  hole again; shallower and it is the flat exposure this replaced.
- **0.55 limb** is the sphere over the photograph: a radial shade from the light's
  position, so the disc turns away at the far edge instead of ending as a cut-out
  poster of a moon. It rides *inside* the clipped lit layer, so it moves with the
  phase rather than sitting on the whole disc.
- **0.024 terminator feather** is the surface's last of the light, as a blur
  radius in disc diameters (about 8px on the 322px disc, so the surface runs out
  over roughly 20px). Only the half of that ramp inside the terminator is visible:
  the clip sits on the terminator, so the outer half falls outside the lit shape —
  which is why widening the blur further dims the lune's edge before it lengthens
  the fade. The terminator is not a line on a real moon: the light
  grazes the ground there, so brightness goes to zero smoothly and crater rims
  catch the last of it unevenly. Cut as a clip alone, the phase ended in one step
  from the lit face's 97 luma to the night face's 34 — a seam laid across the
  disc. The feather is scaled twice (`terminatorFeather`): by the phase, because
  at full and new the terminator has left the visible face and a feather there
  would only dull the sphere's own edge; and by the lune's own width below a
  third lit (`MOON_TERMINATOR_FULL_LIT`), because a blur wider than a hairline
  crescent blurs it away — early in a session the moon had no crescent to grow
  from. The moon's lit width along the light's axis is exactly `k` of the disc,
  so the share is `k / 0.35`: a third of the lune at its thinnest, the full
  feather once the crescent is wide enough to carry it.
- **0.55 scrim** is a soft, centred darkening under the clock, fading out by 46% of
  the disc where the maria begin reading again. It is a paint, not a second moon,
  and it is constant: the phase must not also move the light the type sits on.
  The bar is **7:1** (WCAG AAA), not the 4.5:1 body text would need, because the
  reading is the one thing the room exists to show. Without the scrim the same
  measurement is 5.6:1 — which is why the check is 7 and not 4.5.

## The layers, and why they are split this way

```
[data-part="disc"]          rounded-full, overflow-hidden, --moon-dark
  svg                       the clipPath and the feathered terminator mask
                            (both objectBoundingBox)
  [data-part="night"]       the texture at 13%, contrast-lifted, masked to 66% at the limb
  [data-part="lit"]         clip-path: url(#…)
    [data-part="terminator"] mask: the lit face's last of the light
      [data-part="surface"]  the texture, brightness/contrast filtered
      [data-part="shade"]    highlight + far-limb falloff
  [data-part="scrim"]       the paint under the clock
```

- **The clip is on the wrapper, the filter on its child.** No element carries a
  `filter` and a `clip-path` at once. `clip-path: url()` on a filtered layer is
  the pairing Safari has drawn wrongly before; keeping them on separate elements
  makes the question moot rather than needing a fallback.
- **The clip is still the exact terminator.** `litPath` is unchanged; it is the
  great-circle ellipse through both poles whose waist is `|2k − 1|` of the radius
  (`phaseGeometry`). The surface swap bought texture, not a new shape.
- **The clip is the shape; the mask is the light.** `litPath` cuts the phase to
  the pixel, and the layer inside it carries a mask built from the *same path*,
  blurred by `terminatorFeather` and declared as an element in the same `<defs>`
  as the clip (`maskUnits="objectBoundingBox"`, so it follows the disc at every
  instrument size). Blurring
  the path rather than fading along the light's axis is the whole point: a
  straight ramp's end is a straight line, and on a crescent that line crosses the
  lune — it showed as a cut across the moon where the phase had a curve. The
  path's own blur softens the curve without ever straightening it.
- **The mask is markup, not an image.** It used to be an SVG *data URI* with
  `mask-size: 100% 100%`. Firefox does not paint a layer whose mask image has not
  decoded, and the phase rewrites the mask about once a second — so every rewrite
  asked Firefox to decode a fresh image and the lit layer went missing until it
  finished: the moon blinked dark on arrival and again on each step of the clock.
  Chrome keeps painting through the decode, so only Firefox ever showed it. A
  `<mask>` element needs no decode; its path is parsed markup and only
  re-rasterises when the path changes. `.freebuff/ff-maskcheck.mjs` reads the same
  terminator profile, pixel for pixel, from both engines.
- **The feather is on a child, not on the clipped layer.** `filter` + `clip-path`
  on one element is the pairing Safari has drawn wrongly, so the mask rides the
  wrapper inside the clip. The clip is what keeps the limb hard — the blur can
  spill past the terminator but never past the shape, so the body's edge stays the
  body's edge. Where the phase's mask would be thinner than a pixel
  (`feather > 0.0002`), it is dropped entirely and the clip alone draws the
  phase.
- **The night layer is under the lit layer**, not a second shape beside it, so the
  two are one surface at two exposures. The disc's own `--moon-dark` background
  keeps it a body even where the texture is transparent at the corners. Its own
  exposure is set twice: 13% over the whole layer, and a mask — white with alpha,
  a radial ramp about the disc's centre — that brings that exposure down to 66% of
  the middle's at the limb. Both ride the same element, so the filter, the opacity
  and the mask compose once rather than as three stacked copies of the surface.
- `MoonLimb` is unchanged and still sits above all of this: its hairline, rim light
  and inset falloff are what keep a new moon a moon rather than a hole. Its two
  light-bearing shadows are point-reflected with the phase (`MOON_LIGHT_TURNED`),
  because a break's lit half is: the rim belongs on the lit limb, and a 2px cream
  line left on the darkened crescent is the brightest thing on that half — a
  scratch beside the disc rather than its edge.
- The `.webp` is warmed by [`lib/moon-texture.ts`](../lib/moon-texture.ts) about a
  second after the card settles, so opening Focus Mode never paints a bare disc
  and then fills it in during the arrival.

## Rebuilding the asset

```bash
npm run prepare:moon                          # 1024px, quality 0.92 — the shipped asset
node scripts/prepare-moon-texture.mjs --size 1536 --quality 0.9
```

It needs a local Chrome or Edge (set `CHROME_PATH` if none is in the usual
places) and network access on the first run. The browser is driven over the
DevTools protocol from the same helper shape as `verify-visuals`, so there is no
image dependency in `package.json` and nothing runs during `next build`.

After regenerating, run `npm run verify:visuals`: `moon/texture-asset` checks the
served file is WebP, square and at least 768px, `moon/texture-caps` checks the
disc's poles carry surface rather than a letterbox band, and
`desktop/surface-texture` checks the pixels still carry terrain rather than a
smooth fill.

## What the checks measure

`npm run verify:visuals` reads the layer structure by `data-part`, not by child
index, and then:

- **the treatment**: the texture URL, the brightness/contrast filter, the night
  layer's opacity and contrast, the mask that ramps it down to `MOON_NIGHT_FALLOFF`
  at the limb, the limb shade, the scrim's centre alpha, and that the shade is
  inside the clipped layer;
- **the asset**: fetched by the page, checking status, MIME type, size,
  dimensions and that both poles are surface (a black south cap is what made the
  first build's moon end in a straight line);
- **the surface**: median and p95 of the lit face, the local luma variation
  (`textureRms` — a photograph is not smooth at the pixel scale; a gradient is),
  the night side's earthshine band and its own local terrain, how far that
  earthshine falls between 0.56R and 0.86R, and the night limb's falloff. The
  band and its fade are measured on the phone's crescent and again on the
  desktop's largest disc, where the same 0.56R probe would sit on lit surface if
  run at the gibbous phase;
- **the reading**: type versus the scrimmed surface under it, as a WCAG contrast
  ratio, at full moon on the phone and four-fifths lit at the desktop's largest
  disc;
- **the turn**: through the whole cycle, the body's light and rim are the point
  reflection of focus's in a break (`cycle/break-light-turned`), so the phase and
  the shading move together.

Deliberate drifts, run against this build: putting the night back at 5% — the
value this pass replaced — fails `moon/night-side-earthshine` and
`moon/night-side-terrain` (25.8 luma against the 28 floor, 0.27 rms against
0.36), while everything else stays green; removing the night layer's mask — the
one line that makes it a sphere lit by Earth instead of one exposure — fails
`moon/night-falloff` alone, with the measured fade easing from about 11 to 8.6 luma,
which is the limb shade's own falloff and still inside the 3–14 band
`moon/night-side-fade` allows; a flat gradient instead of the texture
fails `desktop/surface-texture` (0.54 against a 1.0 floor, where the photograph reads
1.25); removing the scrim fails both `clock-contrast` checks (5.6:1 and 6.2:1
against the 7:1 bar); and rebuilding the disc from a map whose south 96 rows are
black — the asset this project shipped first, to the byte — fails
`moon/texture-caps` alone, south cap 0.1 luma against the 40 floor while the
north cap stays at 207 and every other measurement holds. That last one is the
useful shape of the check: the fault was invisible to every geometric measure,
because the shape was right and only the photograph was missing. Each drift was
restored and the green run repeated.

## Credit

The surface is NASA's **CGI Moon Kit** (NASA Scientific Visualization Studio,
using Lunar Reconnaissance Orbiter data), released as public domain NASA
imagery. It is reprojected unmodified — the only operations are the projection,
the alpha coverage, the dim and the shading described above.
