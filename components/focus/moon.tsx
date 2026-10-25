"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  MOON_DARK,
  MOON_GLYPH,
  MOON_LIGHT,
  MOON_LIGHT_TURNED,
  MOON_LIMB_SHADE,
  MOON_LIT_BRIGHTNESS,
  MOON_LIT_CONTRAST,
  MOON_NIGHT_CONTRAST,
  MOON_NIGHT_MASK,
  MOON_NIGHT_OPACITY,
  MOON_NIGHT_SATURATION,
  MOON_SCRIM_OPACITY,
  MOON_TEXTURE_URL,
  PHASE_RADIUS,
  phaseGeometry,
  terminatorFeather,
} from "@/components/focus/geometry";
import { cn } from "@/lib/utils";

/**
 * The moon, drawn at the two sizes the room needs it: the disc at the centre of
 * the dial, and the phase glyph at the size of a session marker — 14px, one step
 * up from the marker itself and the size the row has always been set at.
 *
 * They are the same object lit from the same side and, now, the same phase: the
 * terminator is a great circle on the sphere in both. The instrument clips its
 * light layer to the lit region (quantised, so a session's 7500 ticks cost about
 * a thousand repaints of one disc rather than 7500 — docs/motion-budget.md). The
 * cycle is the animation: focus advances the clip, a break runs the same clip
 * backwards from the full face. The strip's glyphs never animate, so they can
 * draw the same shape as static rasters. The old instrument slid a second disc
 * of the moon's own dark across this one, which draws a crescent but not a
 * gibbous: past half an equal disc's edge bows the wrong way and the moon
 * becomes a lens (see `phaseGeometry`).
 */

/**
 * The lit region of a moon, in normalized disc coordinates: a semicircular limb
 * on the light's side, closed by the terminator.
 *
 * The terminator is a *great circle* on the sphere, which projects to an ellipse
 * through both poles of the disc, its waist `|2k − 1|` of the radius along the
 * light's axis. The path starts at the top pole, follows the lit limb to the
 * bottom pole, and returns along that ellipse. Short of half the ellipse bulges
 * into the lit half (the path is cut in, a crescent); past half it bulges into
 * the dark half (the path is let out, a gibbous moon). The same arc carries both
 * — only its waist and sweep change — so the terminator is a phase at every
 * fraction rather than a second disc sliding off the first.
 *
 * Coordinates are the 0–1 box `clipPathUnits="objectBoundingBox"` expects, and
 * the caller rotates the path onto `MOON_NIGHT_AXIS`.
 */
function litPath(lit: number): string {
  const { waist, pastHalf } = phaseGeometry(lit);
  const rx = (waist / PHASE_RADIUS) * 0.5;
  /*
   * Below a hundredth of a percent the arc is a line for every purpose; SVG
   * treats a zero radius as one anyway, so say so and keep the command valid.
   */
  const terminator =
    rx < 0.0001
      ? "L 0.5 0"
      : `A ${rx.toFixed(5)} 0.5 0 0 ${pastHalf ? 0 : 1} 0.5 0`;
  return `M 0.5 0 A 0.5 0.5 0 0 0 0.5 1 ${terminator} Z`;
}

/** A jump larger than this is a hand-off, not the clock's own slow progress. */
const MOON_PHASE_JUMP = 0.05;

/** How long Skip takes to carry the moon to its full or dark end. */
const MOON_PHASE_TWEEN_MS = 1100;

/** Slow at both ends, so a Skip reads as a deliberate arrival. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * The moon's body: the sphere's own light, cut to the cycle's phase.
 *
 * It is a *dark* sphere lit from the left, below the middle (see `MOON_LIGHT`).
 * The light is one gradient on the disc, clipped to the exact lit region; the
 * unlit rest is the moon's own dark. The path is quantized to a thousandth of
 * the disc, so a 200ms tick changes it only about once a second — a repaint of
 * one disc, not of the ring, and far less often than the 7500 ticks a session
 * would otherwise ask for (docs/motion-budget.md).
 *
 * The cycle is the animation. `moonPhaseProgress` fills this fraction during a
 * focus session and runs it backwards during a break, so the full face at the
 * end of focus is exactly where the break starts and the dark face is exactly
 * where the next focus starts. The break's lit half is point-reflected
 * (`flip`), which makes the darkness enter from the left — the same side the
 * focus light entered from — while the terminator stays on the same line. The
 * ordinary cycle follows the clock's quantised steps directly; a **skip** is
 * the one jump the clock does not explain, so that hand-off is eased to its
 * full or dark end along the same path.
 */
export function MoonBody({
  inset,
  lit,
  flip,
  reduceMotion,
}: {
  /** The disc's inset inside the instrument box. */
  inset: number;
  /** The phase's lit fraction, quantised in `moonGeometry`. */
  lit: number;
  /** Which side the lit region occupies: left in focus, right in a break. */
  flip: boolean;
  reduceMotion: boolean;
}) {
  const clipId = `moon-lit-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [shownLit, setShownLit] = useState(lit);
  const [shownFlip, setShownFlip] = useState(flip);
  const shownRef = useRef(lit);
  const frameRef = useRef<number | null>(null);
  /** A phase hand-off owns the phase until the moon has reached its end. */
  const handoffRef = useRef(false);

  /*
   * A change smaller than this is the clock's own slow progress (a break moves
   * it by about 0.003 a second); a change larger than it is a hand-off — most
   * often Skip, which arms the next phase at full or dark in one store update.
   * Only the latter gets a tween; the cycle must not lag behind its clock.
   */
  useEffect(() => {
    if (handoffRef.current) return;
    const from = shownRef.current;
    const delta = Math.abs(lit - from);
    if (reduceMotion || delta < MOON_PHASE_JUMP) {
      shownRef.current = lit;
      setShownLit(lit);
      return;
    }

    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / MOON_PHASE_TWEEN_MS);
      const value = from + (lit - from) * easeInOutCubic(t);
      shownRef.current = value;
      setShownLit(value);
      frameRef.current = t < 1 ? requestAnimationFrame(frame) : null;
    };
    frameRef.current = requestAnimationFrame(frame);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [lit, reduceMotion]);

  /*
   * The orientation belongs to the phase, so the hand-off carries the moon to
   * the endpoint the new phase starts from even if the new clock has already
   * moved. It used to wait for `shownLit` to touch 1/0, but a break started
   * before the Skip tween had finished retargeted the tween every tick and never
   * reached the endpoint: the break then drained from the focus limb, the exact
   * opposite of the direction just lit. A full or dark face hides the turn, so
   * the hand-off finishes the arrival, flips, and lets the next tick follow the
   * new clock.
   */
  useEffect(() => {
    if (shownFlip === flip) return;
    const target = flip ? 1 : 0;
    const from = shownRef.current;
    if (reduceMotion || Math.abs(target - from) < 0.0001) {
      shownRef.current = target;
      setShownLit(target);
      setShownFlip(flip);
      return;
    }

    handoffRef.current = true;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / MOON_PHASE_TWEEN_MS);
      const value = from + (target - from) * easeInOutCubic(t);
      shownRef.current = value;
      setShownLit(value);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(frame);
      } else {
        frameRef.current = null;
        handoffRef.current = false;
        setShownFlip(flip);
      }
    };
    frameRef.current = requestAnimationFrame(frame);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      handoffRef.current = false;
    };
  }, [flip, shownFlip, reduceMotion]);

  /*
   * The light turns with the phase. A break's lit half is a point reflection,
   * so its light is one too (`MOON_LIGHT_TURNED`); with the highlight and the
   * limb shade left where focus drew them, the rim sat on the unlit crescent
   * and the disc read as lit from two sides at once.
   */
  const light = shownFlip ? MOON_LIGHT_TURNED : MOON_LIGHT;
  const { angle } = phaseGeometry(shownLit);
  /*
   * The lit face's last of the light: the *same* path the clip uses, blurred into
   * a mask, so the surface runs out at the terminator instead of ending on it.
   *
   * The path matters. A straight gradient along the light's axis is the tempting
   * shortcut — a sphere's brightness really does depend only on the coordinate
   * along that axis — but a straight ramp ends on a *straight line*, and on a
   * crescent that line crosses the lune: the moon showed a cut instead of a
   * curve. Blurring the phase's own ellipse cannot do that: the curve is softened,
   * never straightened.
   *
   * It is a mask on the lit layer and not a `filter` on it, so the limb keeps its
   * hard edge: the clip still cuts the exact shape, and the blur only ever
   * softens the seam inside it. `terminatorFeather` closes the feather to nothing
   * at full and new moon, and thins it on a lune narrower than itself.
   */
  const feather = terminatorFeather(shownLit);
  const terminatorMask =
    feather > 0.0002
      ? `url("data:image/svg+xml,${encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="none"><defs><filter id="f" x="-0.2" y="-0.2" width="1.4" height="1.4"><feGaussianBlur stdDeviation="${feather.toFixed(4)}"/></filter></defs><path d="${litPath(
            shownLit,
          )}" fill="#fff" filter="url(#f)" transform="rotate(${(
            angle + (shownFlip ? 180 : 0)
          ).toFixed(2)} 0.5 0.5)"/></svg>`,
        )}")`
      : undefined;
  return (
    <div
      data-part="disc"
      aria-hidden
      className="pointer-events-none absolute overflow-hidden rounded-full"
      style={{ inset, background: MOON_DARK }}
    >
      {/*
       * The clip lives in an SVG definition so the path can carry real arcs;
       * `objectBoundingBox` keeps it tied to the disc at any instrument size.
       */}
      <svg aria-hidden className="absolute size-0">
        <defs>
          <clipPath id={clipId} clipPathUnits="objectBoundingBox">
            <path
              d={litPath(shownLit)}
              transform={`rotate(${angle + (shownFlip ? 180 : 0)} 0.5 0.5)`}
            />
          </clipPath>
        </defs>
      </svg>

      {/*
       * The night side: the same photograph at 13%, contrast-lifted so its
       * maria survive the dim — what an earthlit moon looks like, rather than a
       * hole where the light is not. It sits *under* the lit layer rather than
       * being drawn by it, so the two are one surface at two exposures rather
       * than a shape pasted onto a hole. The token beneath keeps the disc a body
       * even where the texture is transparent at the corners.
       *
       * The mask is the second light the night face actually has: Earth sits in
       * the viewer's direction, so the unlit half is a sphere lit head-on —
       * brightest where the ground faces the viewer and dimmer toward the limb
       * (`MOON_NIGHT_MASK`). Without it the night was one alpha from terminator
       * to limb; with it the half turns away from Earth the way the lit half
       * turns away from the Sun.
       */}
      <div
        data-part="night"
        className="absolute inset-0"
        style={{
          backgroundImage: `url("${MOON_TEXTURE_URL}")`,
          backgroundSize: "100% 100%",
          opacity: MOON_NIGHT_OPACITY,
          filter: `saturate(${MOON_NIGHT_SATURATION}) contrast(${MOON_NIGHT_CONTRAST})`,
          maskImage: MOON_NIGHT_MASK,
          WebkitMaskImage: MOON_NIGHT_MASK,
        }}
      />

      {/*
       * The lit face: the albedo map, cut by the phase's exact terminator. The
       * clip is on this wrapper and the tone on its child, so no element carries
       * a filter *and* a clip path — a pairing Safari has drawn wrongly before.
       *
       * `shade` is the sphere over the photograph: a soft highlight from the
       * light's side and a falloff to the far limb, so the surface turns away
       * from the viewer instead of ending as a flat disc of terrain. The map is
       * base colour, so this is the only lighting the surface itself gets.
       */}
      <div
        data-part="lit"
        className="absolute inset-0"
        style={{ clipPath: `url(#${clipId})` }}
      >
        <div
          data-part="terminator"
          className="absolute inset-0"
          style={{
            maskImage: terminatorMask,
            maskSize: "100% 100%",
            maskRepeat: "no-repeat",
            WebkitMaskImage: terminatorMask,
            WebkitMaskSize: "100% 100%",
            WebkitMaskRepeat: "no-repeat",
          }}
        >
          <div
            data-part="surface"
            className="absolute inset-0"
            style={{
              backgroundImage: `url("${MOON_TEXTURE_URL}")`,
              backgroundSize: "100% 100%",
              filter: `brightness(${MOON_LIT_BRIGHTNESS}) contrast(${MOON_LIT_CONTRAST})`,
            }}
          />
          <div
            data-part="shade"
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle at ${light.x}% ${light.y}%, rgba(236,240,255,0.055), rgba(236,240,255,0) 46%), radial-gradient(circle at ${light.x}% ${light.y}%, transparent 34%, rgba(2,4,9,${MOON_LIMB_SHADE}) 92%)`,
            }}
          />
        </div>
      </div>

      {/*
       * The scrim under the reading. The clock is white and the photograph is
       * not, so the brightest phase gets a soft centre of shade — a paint that
       * fades out by 46% of the disc, where the maria start reading again. It is
       * a constant: the phase must not also move the light the type sits on.
       */}
      <div
        data-part="scrim"
        className="absolute inset-0"
        style={{
          background: `radial-gradient(circle at 50% 50%, rgba(3,5,10,${MOON_SCRIM_OPACITY}), rgba(3,5,10,${(
            MOON_SCRIM_OPACITY * 0.62
          ).toFixed(3)}) 22%, rgba(3,5,10,0) 46%)`,
        }}
      />
    </div>
  );
}
/**
 * The moon's form, above its light: the limb's hairline, the rim light along the
 * lower-left edge and the falloff to the upper right. It carries no fill of its
 * own, so the moon keeps its silhouette at every phase — a new moon is still a
 * moon.
 *
 * The rim and the falloff are placed from the same direction the light comes
 * from: an *inset* shadow lights the edge it is offset *towards*, so with the
 * light at the left and about a third of the way below the middle the rim is
 * `2px -0.9px` (left, low) and the falloff is `-21px 15px` (right, high) — the
 * same two directions as `MOON_LIGHT`, turned with it. Those two pairs are the
 * same pair as they were at `{ x: 21, y: 60 }` (`2px -0.5px` and `-24px 8px`),
 * at `{ x: 23, y: 65.5 }` (`2px -0.7px` and `-22px 13px`) and at
 * `{ x: 25, y: 71 }` (`2px -1px` and `-21px 17px`), scaled by where the light
 * moved to: the same distance, at the angle between those.
 *
 * A break turns both by 180°: its phase is a point reflection, so the light is
 * one too (`MOON_LIGHT_TURNED`) and the rim lands on the lit limb. Without it
 * the rim stayed on the lower-left while the lit lune moved to the upper-right,
 * and a 2px cream line on the darkest part of the disc is what a scratch looks
 * like, not an edge.
 */
export function MoonLimb({ inset, flip = false }: { inset: number; flip?: boolean }) {
  /* Both light-bearing shadows turn with the face they belong to. */
  const turn = flip ? -1 : 1;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute rounded-full"
      style={{
        inset,
        /*
         * Four layers, in order: the hairline that keeps the disc's edge
         * legible against a sky of nearly the same darkness, the rim light on
         * the side the light comes from, and the falloff that turns the disc
         * into a sphere rather than a circle of flat colour.
         */
        boxShadow: `0 0 0 1px rgba(244,241,234,0.035), inset 0 0 0 1px rgba(244,241,234,0.07), inset ${2 * turn}px ${-0.9 * turn}px 0 rgba(244,241,234,0.19), inset ${-21 * turn}px ${15 * turn}px 62px rgba(0,0,0,0.6)`,
      }}
    />
  );
}

/**
 * One moon phase, at the size of a session marker.
 *
 * `lit` is the fraction of the disc that is lit. Two layers make it: a disc of
 * the moon's own dark, and the lit part laid over it. There used to be a third —
 * a hairline limb in the phase colour, because a *tinted* unlit side needed an
 * edge to end on. The body carries its own edge now, as a shape a step *above*
 * the sky (28 luma against the 8.3 beside a pending glyph), so the row is lighter
 * for it.
 *
 * The limb was also the one thing in the glyph that was not the same on both
 * sides of the moon: drawn over the lit lune in the lune's own colour it is
 * invisible, drawn over the dark body it is a rim — so a three-quarter moon's
 * dark crescent wore an outline its quarter-moon counterpart did not have. The
 * two are meant to be the *same lune*, half a turn apart
 * (`.freebuff/phase-probe.mjs` measures exactly that), and a rim on one of them
 * is the difference.
 *
 * The unlit side is a *body* of the moon's own grey, not a dim tint of the phase
 * colour. That is the whole point of a phase at this size: a tinted unlit disc
 * glows just enough to read as part of the moon, so a three-quarter glyph (the one
 * that buys the long break) looked like a filled disc rather than as a moon a step
 * short of full. Measured with an amber-tinted disc the unlit side sat at **58**
 * luma against a sky of **19** — brighter than the sky it was supposed to be
 * darker than — and the first fix put it at **8** against a sky of 7.5 by the same
 * measure, which is not a crescent either: it is a hole. The token
 * (`--moon-glyph`, app/globals.css) sits at **28**, a step above the sky — and a
 * step above the dial's own `--moon-dark` (**21**), because a 14px glyph has less
 * area to hold a silhouette than a 300px disc and the same value that reads as a
 * body at the dial's size read as sky at the strip's (second sample sheet,
 * 2026-10-17).
 *
 * It is also **hue-less**, which is the third sheet's answer (2026-10-18): the
 * unlit side had been a blue-black, and at this size that blue is all the
 * *colour* the glyph has room to show, so it read as a hole cut in the sky rather
 * than as a body in shadow. Three lifts were painted with and without a trace of
 * the sky's blue; the hue-less one at the middle lift won, and the dial kept the
 * blue-black it already had.
 *
 * Colour still comes from the parent, and the lit lune still *is* that colour: a
 * banked session is an amber lune, a pending one a grey — the same phase, one
 * banked and one not. At three quarters that is the dark crescent running from
 * pole to pole down the upper-right limb, measured on the shipped build at lit
 * **97.1** / dark **28.8** for a pending glyph, with the sky at **8.3** beside
 * it and **22.4** inside a banked neighbour's own amber glow — where the dark
 * side is meant to meet the glow rather than sit under it
 * (`.freebuff/moon-samples.mjs`; `.freebuff/phase-dark.mjs` reads the same
 * pixels).
 */
export function MoonPhaseMark({
  lit,
  className,
}: {
  lit: number;
  className?: string;
}) {
  const maskId = `cycle-phase-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const { waist, pastHalf, angle } = phaseGeometry(lit);
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-3.5", className)}>
      <mask id={maskId}>
        <rect width="24" height="24" fill="#000" />
        {/*
         * The light's own half of the disc: everything on the light's side of
         * the diameter through the centre. That diameter is the terminator of a
         * half moon, so it is where every phase starts.
         */}
        <rect
          x={-12}
          y={-12}
          width={24}
          height={48}
          fill="#fff"
          transform={`rotate(${angle} 12 12)`}
        />
        {/*
         * The terminator: a great circle on the sphere, so an ellipse through
         * both poles, its waist reaching `|2k − 1|` of the radius along the axis.
         * Just past half the light has crossed the centre, and the ellipse is
         * part of the lit side; short of half it is cut out of it.
         */}
        <ellipse
          cx="12"
          cy="12"
          rx={waist}
          ry={PHASE_RADIUS}
          fill={pastHalf ? "#fff" : "#000"}
          transform={`rotate(${angle} 12 12)`}
        />
      </mask>
      {/* The unlit side: the room's own dark, so a phase is a moon, not a wedge. */}
      <circle cx="12" cy="12" r={PHASE_RADIUS} fill={MOON_GLYPH} />
      <circle
        cx="12"
        cy="12"
        r={PHASE_RADIUS}
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}
