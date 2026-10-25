import type { TimerMode } from "@/lib/types";

/**
 * The room's numbers — everything in Focus Mode that is arithmetic and nothing
 * else: where the moon's light comes from, the terminator its lit fraction
 * implies, where the satellite sits on its orbit, and the table the completion
 * burst is placed from.
 *
 * Kept apart from the components on purpose. A change to the *shape* of the
 * room cannot reach the store, the timer or the DOM from here, and
 * `scripts/verify-visuals.mjs` checks these numbers against the shipped build's
 * own pixels — including a gibbous session, where the terminator must bow the
 * other way.
 */

/**
 * Where the moon's light comes from, in percent of its own box. Its surface
 * gradient and the axis its terminator is turned on are both derived from this
 * one point, so the light never disagrees with itself.
 *
 * **The left, a little below the middle.** A session opens as a crescent on the
 * moon's left limb and the light grows across the disc toward the right, so the
 * moon fills from the left — the reverse of a real waxing moon, and the way this
 * one was asked to read. `MOON_NIGHT_AXIS` and the phase strip's terminator both
 * come off this point, so moving it turns the instrument *and* the four small
 * moons together (`.freebuff/design-probe.mjs` measures which limb is lit).
 *
 * This point has been walked along that axis rather than guessed at, and the
 * walk is the reason the numbers look arbitrary:
 *
 * - `{ x: 34, y: 76 }` — the lower left — put a half moon's terminator at
 *   **31.6° from the horizontal**: a shallow diagonal that read as a lens
 *   leaning in a corner rather than as a moon's edge.
 * - `{ x: 21, y: 60 }` — **71°**, and at that angle the four small moons read
 *   as upright slabs rather than as moons.
 * - `{ x: 25, y: 71 }` — **50°**, painted on a ladder of five angles through the
 *   component itself (`.freebuff/moon-samples.mjs`), and the first angle the
 *   small moons were asked for by name.
 *
 * The ask (2026-10-17, second pass) was *between* the last two — off 50°, not
 * back to 71° — and the middle came out at `{ x: 23, y: 65.5 }`: the night axis
 * 29.0° above the horizontal, the terminator **61.0°** from it.
 *
 * That was a step too far the other way: at 61° the four small moons read as
 * upright again (2026-10-18). The ask was *a little less*, between 61° and the
 * 50° before it — so the light steps back down the same axis, to
 * `{ x: 24, y: 68 }`: the night axis 34.7° above the horizontal, the terminator
 * **55.3°** from it, the midpoint of the last two by angle (55.5°) taken to the
 * whole percent. The sheet paints 61, 55 and 50 side by side through the
 * component itself, and `phase-probe.mjs` measures the shipped angle back off
 * the DOM.
 */
export const MOON_LIGHT = { x: 24, y: 68 } as const;

/**
 * The same light, turned for a break: the point reflection of `MOON_LIGHT`.
 *
 * A break's phase is point-reflected — its lit half is on the other limb, so the
 * darkness enters from the side focus filled. The body's light has to turn with
 * the face it belongs to. Left where focus put it, a draining moon wore its rim
 * light and its far-limb shade on the unlit crescent: at the break's 40% phase
 * the 2px rim sat on the lower-left, where the surface is at its darkest, and
 * read as a scratch drawn beside the disc rather than as its edge — the one
 * bright thing on the night side. Point-reflecting the two shadows puts the rim
 * on the lit limb and the shade on the darkened one, the same figure a focus
 * moon draws, half a turn round.
 */
export const MOON_LIGHT_TURNED = {
  x: 100 - MOON_LIGHT.x,
  y: 100 - MOON_LIGHT.y,
} as const;

/**
 * The unit vector from the light, through the disc: the axis the terminator's
 * ellipse is turned on, and the direction its waist is measured along. Away from
 * the source, so it points up and to the right and the last of the light to go
 * is the lower-left limb — the one the highlight sits on.
 */
export const MOON_NIGHT_AXIS = (() => {
  const dx = MOON_LIGHT.x / 100 - 0.5;
  const dy = MOON_LIGHT.y / 100 - 0.5;
  const length = Math.hypot(dx, dy);
  return { x: -dx / length, y: -dy / length };
})();

/**
 * The colour the disc's own fill and its night side share, so the seam between
 * them can never be seen — the night side is the unlit moon, not a shadow drawn
 * on top of one.
 *
 * It is the `--moon-dark` token (app/globals.css) rather than a literal here,
 * which is also what lets the sample sheet paint a value through the real
 * component instead of hand-drawing a copy of it
 * (`.freebuff/moon-samples.mjs`) — and the token is where the *value* lives, with
 * the measurement behind it. What matters here is that the disc's fill and the
 * night side cut against a lifted grey: the moon is a body in shadow, and the
 * seam between its lit and unlit halves still cannot be seen.
 */
export const MOON_DARK = "var(--moon-dark)";

/**
 * The same body, a step lighter and a step greyer, for the phase strip's 14px
 * glyphs.
 *
 * Two sizes of one judgement, answered separately off the sample sheet: beside a
 * 300px disc a lifted grey competes with the clock and the dial's black was
 * called *much better*, but in a glyph the size of a fingerprint's whorl the
 * dark crescent has almost no area to read as a body with, and the same value
 * left it indistinguishable from the row's sky. `--moon-glyph` is that step —
 * 28 luma against the dial's 21, and hue-less where the dial is a blue-black —
 * so the strip and the dial part company on the value while sharing the geometry
 * (`phaseGeometry` reads `MOON_NIGHT_AXIS`, so the two are still the same moon
 * lit from the same side).
 */
export const MOON_GLYPH = "var(--moon-glyph)";

/**
 * The dark end of the cycle: no visible lit shape at all. The disc's own dark
 * body and the limb above it keep the moon from reading as a hole in the room.
 */
export const MOON_MIN_LIT = 0;

/*
 * The moon's *surface*: one photographic albedo disc, lit by the room's own
 * terminator rather than painted from gradients.
 *
 * The image is NASA's CGI Moon Kit colour map, reprojected orthographically to
 * a 1024px disc by `scripts/prepare-moon-texture.mjs` (`npm run prepare:moon`).
 * It is that map and not a full-moon photograph because the map is **base
 * colour before lighting** — a photograph carries the Sun's own shadows and
 * limb falloff, which would sit under this app's moving terminator as a second,
 * contradictory light. See `docs/moon.md` for the projection and the licence.
 *
 * The terminator is unchanged: it is still `phaseGeometry`'s exact great-circle
 * ellipse, so the surface swap buys texture, not a new shape. What the numbers
 * below do is make a photographic albedo (mean 165 luma, p05 123, p95 210) sit
 * inside a room whose sky is 8 and whose clock is white.
 */
export const MOON_TEXTURE_URL = "/moon/moon-disc.webp";

/**
 * How much of the albedo's own brightness the lit face keeps.
 *
 * 165 luma is a *photograph in daylight*; at full moon the disc has to stay
 * dimmer than the reading inside it or the clock loses its figure on the
 * surface. 0.62 puts the mean near 102 and the brightest maria near 130 — a
 * moon that is visibly a photograph, still clearly a body in space rather than
 * a lamp, and with the white readout legible above it (the scrim below buys
 * the rest). The same value is applied to the night side at a fraction.
 */
export const MOON_LIT_BRIGHTNESS = 0.62;

/**
 * A small contrast lift, because a linear dim keeps the maria but flattens the
 * difference between them and the highlands; 1.08 is the step that survives the
 * 0.62 dim without painting the surface as a high-contrast map.
 */
export const MOON_LIT_CONTRAST = 1.08;

/**
 * The night side is the same surface at 13% — *earthshine*, not a hole and not a
 * second flat fill.
 *
 * 5% was too little to survive a real display. The arithmetic was right — the
 * albedo at a twentieth over `--moon-dark` (21 luma) lands the night face at 26 —
 * but 26 luma is where a screen's own black point starts, so the maria and the
 * highlands both flattened into one silhouette and the unlit half read as a cut
 * hole rather than as a body turned away from the light. 13% puts the unlit half
 * between 37 and 33 luma across its middle (0.56R to 0.72R of the radius), still
 * well under half the lit face's 97, and its own detail survives the dim: about
 * 0.5 local rms, against 0.27 at 5% (`moon/night-side-terrain`). It is still
 * shadow, and the scrim under the clock is untouched. This is the exposure where
 * the night faces the viewer; the mask below takes it down toward the limb.
 */
export const MOON_NIGHT_OPACITY = 0.13;

/**
 * A contrast lift on the night side, for the same reason the lit face has one:
 * the maria are what make the earthlit half read as a moon instead of a grey
 * wash, and a linear dim compresses exactly that difference. 1.15 is the step
 * that survives 13% without turning the dark maria into patches of black.
 */
export const MOON_NIGHT_CONTRAST = 1.15;

/** Desaturating the night keeps it from reading as a colour rather than shadow. */
export const MOON_NIGHT_SATURATION = 0.55;

/**
 * How much of that earthshine survives at the limb: 0.66 of the middle's
 * exposure, so the unlit half carries a gradient (37 → 26 luma across it) rather
 * than one alpha from terminator to limb.
 *
 * Earth is in the viewer's direction — the near side is the side we see — so the
 * moon's night face is *not* lit like the day face. The day face is lit by a Sun
 * near the lower-left limb, which is why its highlight sits there; the night face
 * is lit head-on by a full Earth behind the viewer, and a sphere lit head-on is
 * brightest where its ground faces the light — the middle of the disc — and
 * dimmer toward every limb, where the ground turns away from it. That is the
 * difference between a body turned away from the Sun (bright middle, dark edge)
 * and one lit by a second, much weaker source: the unlit half keeps a *shape* of
 * its own instead of being one alpha over the whole area.
 *
 * 0.66 is where the fade reads without becoming a second terminator: the unlit
 * half measures 36–37 luma at 0.56R and 26 at 0.86R, about eleven down across it,
 * where the layer alone followed the limb shade to 29 (`moon/night-side-fade`).
 * Deeper and
 * the earthlit rim starts to look like a hole again; shallower and it is the flat
 * exposure this replaced.
 */
export const MOON_NIGHT_FALLOFF = 0.66;

/**
 * The falloff as the night layer's own mask: a radial ramp about the disc's
 * centre — the sub-Earth point — from no cut at the middle out to
 * `MOON_NIGHT_FALLOFF` at the limb. White with alpha rather than a black
 * gradient, so the values mean the same thing whether a browser reads the mask
 * as alpha or as luminance. The intermediate stops are placed on the sphere's
 * own curve (the cosine of the angle from the viewer falls slowly near the
 * middle and steeply at the edge), not spread evenly over the radius.
 */
export const MOON_NIGHT_MASK = (() => {
  const at = (t: number) => (1 - (1 - MOON_NIGHT_FALLOFF) * t).toFixed(3);
  return `radial-gradient(circle closest-side at 50% 50%, rgba(255,255,255,1) 34%, rgba(255,255,255,${at(
    0.18,
  )}) 55%, rgba(255,255,255,${at(0.41)}) 74%, rgba(255,255,255,${at(1)}) 98%)`;
})();

/**
 * The scrim under the clock: a soft, centred darkening so the white reading
 * keeps its contrast at the brightest phase.
 *
 * It is a *paint*, not a second moon: 0.55 at the centre falling to nothing by
 * 46% of the disc, which is where the readout's box ends and the maria begin to
 * read again. Without it the full face's highlands sit at 130 luma and the
 * clock's own 4.5:1 floor is not met at the phone's smaller type.
 */
export const MOON_SCRIM_OPACITY = 0.55;

/**
 * How much of the sphere's own falloff is laid over the photograph: a radial
 * shade from the light, so the limb turns away instead of ending as a cut-out
 * poster of a moon. 0.55 is the fraction the old gradient contributed at the
 * far edge; the photograph now supplies the detail, this supplies the volume.
 */
export const MOON_LIMB_SHADE = 0.55;

/** The phase glyph's disc, in its own 24-unit canvas. */
export const PHASE_RADIUS = 10;

/**
 * The terminator a real moon has, for a given lit fraction: the numbers the
 * phase glyph is drawn from.
 */
export interface PhaseGeometry {
  /**
   * The terminator's waist, in canvas units — how far past the centre (a phase
   * past half) or short of it (a crescent) the light reaches. Zero is a half
   * moon, whose terminator is the diameter itself.
   */
  waist: number;
  /** Which side of the waist the light is on: past half, the ellipse is lit. */
  pastHalf: boolean;
  /** The night axis' angle in the glyph's canvas, in degrees. */
  angle: number;
}

/**
 * The phase glyph is a moon, so its terminator is a moon's: a *great circle* on
 * the sphere, which in projection is an ellipse that always passes through both
 * poles of the disc, its waist `|2k − 1|` of the radius.
 *
 * It used to be a bite out of a second disc of the disc's own size — the
 * construction the mark itself is built from — and that construction cannot draw
 * a phase: with equal radii the two circles cross `acos(d/2r)` from the axis, so
 * the unlit region's horns stop short of the poles. At three quarters it spanned
 * **101°** of the rim instead of 180° and sat in the disc's corner with the far
 * limb still lit: a lens, where the waxing gibbous — the phase the cycle shows —
 * is the one shape that makes the difference unmissable. The instrument used to
 * be the same construction for paint-budget reasons, and had the same bug after
 * half; both sizes now draw this terminator. The instrument clips its light
 * layer with it (quantised to a thousandth, so the disc repaints about once a
 * second rather than on all ~7500 ticks), and the strip, four static rasters,
 * draws it directly.
 *
 * The glyph is drawn in `components/focus/moon.tsx` as the half-plane the light
 * occupies — cut by the diameter through the centre, which is exactly where a
 * half moon's terminator lies — with this ellipse either left lit (past half) or
 * cut out of it (a crescent).
 */
export function phaseGeometry(lit: number): PhaseGeometry {
  const k = Math.min(1, Math.max(0, lit));
  return {
    waist: Math.abs(2 * k - 1) * PHASE_RADIUS,
    pastHalf: k >= 0.5,
    angle: (Math.atan2(MOON_NIGHT_AXIS.y, MOON_NIGHT_AXIS.x) * 180) / Math.PI,
  };
}

/**
 * How far the terminator's edge is feathered, in disc diameters — the standard
 * deviation of the blur that ends the lit face.
 *
 * The terminator is not a line on a real moon. What the eye reads as its edge is
 * where the light *runs out* along it: grazing the ground, so brightness goes to
 * zero smoothly rather than stepping, and crater rims catch the last of it
 * unevenly. Cut as a clip alone, the phase ended in one step from the lit face's
 * 97 luma to the night face's 34 — a seam laid across the disc.
 *
 * The feather has to follow the phase's own ellipse. A straight gradient along
 * the light's axis is the tempting shortcut — brightness on a sphere does depend
 * only on the coordinate along that axis — but its *end* is a straight line, and
 * on a crescent that line crosses the lune and shows as exactly that: a straight
 * edge where the moon had a curve. Blurring the mask's own path instead keeps the
 * geometry: the curve is softened, never straightened.
 *
 * 2.4% of the disc is about 8px at 322px, a ramp of roughly 20px — the width a
 * photograph shows, and far too narrow to become a gradient ball. Only the half
 * of that ramp *inside* the terminator shows, because the clip sits on the
 * terminator itself and the outer half falls outside the lit shape: the visible
 * run-out at a thin phase is therefore about one standard deviation, not two.
 * Widening this further dims the lune's edge sooner than it lengthens the fade,
 * which is the measurement behind the 2x step from 0.012 (`.freebuff/feather-compare.mjs`).
 */
export const MOON_TERMINATOR_FEATHER = 0.024;

/**
 * The lit fraction at which the feather reaches its full width.
 *
 * The feather is measured from the terminator toward the light, so on a thin lune
 * it is measured against very little: at 2% lit the whole crescent is 2% of the
 * disc wide, and a full-width blur would soften most of it away — early in a
 * session the moon had no crescent to grow from, which is the one thing a phase
 * must never be without. Below a third lit the feather is therefore scaled by
 * `k / 0.35`; above it, the full `MOON_TERMINATOR_FEATHER`.
 */
export const MOON_TERMINATOR_FULL_LIT = 0.35;

/** Air between the progress ring and the orbit arc that circles it. */

/**
 * The blur radius the lit face is feathered by at a given phase, in disc
 * diameters — the units a mask's `viewBox` is drawn in.
 *
 * Tapered twice, for the same reason the band was: by the phase (`sin`,
 * square-rooted so a three-quarter moon still shows a falloff), because at full
 * and new the terminator sits on the limb where a feather would only dull the
 * sphere's own edge; and by the lune's own width (`k / 0.35`), because a
 * crescent thinner than the feather would otherwise be blurred out of existence.
 * Zero means no mask at all, which is what the two ends of the cycle want.
 */
export function terminatorFeather(lit: number): number {
  const k = Math.min(1, Math.max(0, lit));
  const share = Math.min(
    Math.sqrt(Math.sin(Math.PI * k)),
    k / MOON_TERMINATOR_FULL_LIT,
  );
  return MOON_TERMINATOR_FEATHER * share;
}
export const ORBIT_GAP = 26;

/**
 * How far the moon's glow reaches past its own limb, in px — the halo's inset
 * measured from the moon's, so the bloom is the same fraction of the disc at
 * every size the room is given.
 */
export const HALO_AIR = 14;

/** How much of the orbit the satellite's trail covers — a little under a third. */
export const ORBIT_TRAIL = 0.3;

/** Radial burst directions for the completion celebration. */
export const CELEBRATION_SPARKS = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2;
  const distance = 92 + (i % 3) * 32;
  return {
    id: i,
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    delay: (i % 5) * 0.045,
  };
});

export interface MoonGeometry {
  /** The disc's inset inside the instrument box, in px. */
  inset: number;
  /** The disc's own diameter, in px — the ring less its inset on both sides. */
  disc: number;
  /** The clock's type size, in px: a fifth of the disc it is read inside. */
  clockPx: number;
  /** Lit fraction of the disc; `0` at the dark end of the cycle. */
  lit: number;
}

/**
 * How far the moon is through its own cycle. Focus fills the disc; a break is
 * the same cycle run backwards, from the full face the session left to the dark
 * end. Reading the break's progress as `1 - progress` makes both hand-offs
 * continuous: focus `1` and break `0` are both full, and break `1` and the next
 * focus `0` are both dark.
 */
export function moonPhaseProgress(mode: TimerMode, progress: number): number {
  return mode === "focus" ? progress : 1 - progress;
}

/**
 * The moon's own progress, from the same `progress` the arc is drawn from: the
 * lit fraction of its disc. A paused clock has a progress that does not move, so
 * the moon freezes with it.
 */
export function moonGeometry(ringSize: number, progress: number): MoonGeometry {
  /*
   * The disc's inset, and with it the size of the reading inside it.
   *
   * 8% a side, 84% of the dial. The line has been walked before: 13% read as a
   * small object parked in the middle of the ring rather than as the instrument
   * the ring is drawn around, and 8.5% left the glow and the sixty graduations
   * 17px / 4px apart, which read busy rather than large; 10% was the middle that
   * pass settled on. The 2026-10-23 ask was *bigger* again, and this is the step
   * that grows the disc without eating the ring: 14px more diameter on the
   * desktop dial (322px), 10px on the phone (230px), 8px in the panel (186px).
   * The disc still clears the graduations' inner tips by 15px at the desktop
   * size, 6px on the phone and 2px in the panel, and the halo's last, nearly
   * transparent stop is what now meets the ticks at the smallest size — at 7% a
   * side the panel's moon edge sat on the ticks themselves.
   */
  const inset = Math.round(ringSize * 0.08);
  const disc = ringSize - inset * 2;
  /*
   * The clock was 0.235 of the *ring* (and 42px at the panel size), which is
   * over a quarter of the disc's own diameter — a number wider than the moon it
   * sits in. Scaling it from the disc instead, at a fifth of its diameter, is
   * what keeps the reading *inside* the moon rather than filling it.
   */
  const clockPx = Math.round(disc * 0.2);
  /*
   * A thousandth of the disc. `progress` changes five times a second, and the
   * terminator's path is a style: quantising it means the disc repaints about
   * once a second instead of 7500 times in a session, and a 0.1% step is a
   * third of a pixel on the largest moon the room draws.
   */
  const lit = Math.round((MOON_MIN_LIT + (1 - MOON_MIN_LIT) * progress) * 1000) / 1000;
  return { inset, disc, clockPx, lit };
}

export interface OrbitGeometry {
  /** Side of the orbit's box, in px — the ring plus its air on both sides. */
  size: number;
  radius: number;
  circumference: number;
  /** Length of the trail the satellite drags behind it. */
  trail: number;
  satelliteX: number;
  satelliteY: number;
}

export function orbitGeometry(ringSize: number): OrbitGeometry {
  const size = ringSize + ORBIT_GAP * 2;
  const radius = size / 2 - 1;
  const circumference = 2 * Math.PI * radius;
  const trail = circumference * ORBIT_TRAIL;
  const angle = Math.PI * 2 * ORBIT_TRAIL;
  return {
    size,
    radius,
    circumference,
    trail,
    satelliteX: size / 2 + radius * Math.cos(angle),
    satelliteY: size / 2 + radius * Math.sin(angle),
  };
}
