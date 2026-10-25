import type { CSSProperties, ReactNode } from "react";

import { TONES, type ToneKey } from "@/lib/tone";
import { cn } from "@/lib/utils";

interface ProgressRingProps {
  /** 0 → 1 */
  progress: number;
  size?: number;
  strokeWidth?: number;
  /** Phase tone: electric accent for focus, ivory for breaks. */
  tone?: ToneKey;
  /** Minute graduations around the outside of the arc. */
  ticks?: { total: number; majorEvery?: number };
  className?: string;
  children?: ReactNode;
  glow?: boolean;
}

/**
 * Smooth circular progress indicator. The arc transition is linear and
 * slightly longer than the tick interval, so movement looks continuous.
 * Graduation marks turn it into an instrument rather than a spinner.
 */
export function ProgressRing({
  progress,
  size = 240,
  strokeWidth = 8,
  tone = "focus",
  ticks,
  className,
  children,
  glow = true,
}: ProgressRingProps) {
  const clamped = Math.min(1, Math.max(0, progress));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);
  const gradientId = `ring-grad-${tone}`;
  const colors = TONES[tone];
  const tickCount = ticks?.total ?? 0;
  const majorEvery = ticks?.majorEvery ?? 5;
  /*
   * How many graduations the arc has reached.
   *
   * Floored rather than rounded: the ticks light "as the arc passes them" (see
   * below), and rounding lit each one half a step — 12° of arc at fifteen ticks
   * — before the tip arrived, so the row of lit marks ran ahead of the light.
   */
  const lit = Math.floor(clamped * tickCount);

  return (
    <div
      className={cn("relative grid place-items-center", className)}
      style={{ width: size, height: size }}
    >
      {glow && (
        <div
          aria-hidden
          className="absolute inset-3 rounded-full blur-2xl transition-colors duration-700"
          style={{
            background: `radial-gradient(circle, rgba(${colors.rgb},0.2), transparent 68%)`,
          }}
        />
      )}
      <svg
        aria-hidden
        className="absolute inset-0 -rotate-90"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        <defs>
          {/*
           * Bounding-box units, deliberately: this component renders on the
           * card and again in the room, and the id repeats. A user-space
           * gradient would be resolved against whichever instance owns the
           * first id in the document, which paints the bigger ring with the
           * smaller one's coordinates.
           */}
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop
              offset="0%"
              style={{
                stopColor: colors.from,
                transition: "stop-color 600ms ease",
              }}
            />
            <stop
              offset="100%"
              style={{
                stopColor: colors.to,
                transition: "stop-color 600ms ease",
              }}
            />
          </linearGradient>
          {/*
           * The arc's glow, as an SVG filter with its own region.
           *
           * It used to be `filter: drop-shadow(0 0 12px …)` on the arc, and
           * that filter's region is the element's bounding box plus ten
           * percent — a *square*, since a circle's box is square. The shadow's
           * tail was cut off at those four straight edges and filled the box
           * on the way, so the glow read as blue patches sitting around the
           * disc along the arc, with the box's corners showing where it ended
           * (`docs` measurement: `.freebuff/measure-ring.mjs` — the halo
           * reached 14px past the stroke at 45° and 135° while stopping dead
           * at the box edge on the axes). Enlarged here so the falloff ends on
           * its own, as light, rather than on a straight line. `stdDeviation`
           * is in the referencing svg's own units, so the glow is the same
           * weight of light on the card's 216px dial and the room's larger one.
           */}
          <filter
            id={`ring-glow-${tone}`}
            x="-30%"
            y="-30%"
            width="160%"
            height="160%"
            colorInterpolationFilters="sRGB"
          >
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="6"
              floodColor={colors.solid}
              floodOpacity="0.42"
            />
          </filter>
        </defs>

        {/* Graduations — they light up as the arc passes them. */}
        {tickCount > 0 &&
          Array.from({ length: tickCount }).map((_, index) => {
            const major = (index + 1) % majorEvery === 0;
            /*
             * The svg this sits in is turned a quarter turn counter-clockwise
             * (`-rotate-90`, which is what puts the arc's start — and so the
             * light's edge — at twelve o'clock), and a child's own rotation
             * composes on top of that, so the ninety degrees have to be added
             * back here.
             *
             * Without them the whole graduation sat a quarter turn behind the
             * arc: the lit marks glowed at ten o'clock under the dark track
             * while the arc passed grey ones at one o'clock, and the
             * five-minute marks landed at 1, 5 and 9 instead of at 12, 4 and 8.
             * `.freebuff/ring-probe.mjs` reads the tick angles back off the
             * pixels.
             */
            const angle = ((index + 1) / tickCount) * 360 + 90;
            const outer = radius - strokeWidth / 2 - 2.5;
            const inner = outer - (major ? 8 : 4.5);
            const active = index < lit;
            return (
              <g
                key={index}
                transform={`rotate(${angle} ${size / 2} ${size / 2})`}
              >
                <line
                  x1={size / 2}
                  y1={size / 2 - outer}
                  x2={size / 2}
                  y2={size / 2 - inner}
                  stroke={
                    active
                      ? major
                        ? colors.soft
                        : colors.solid
                      : "rgba(244,241,234,0.12)"
                  }
                  strokeOpacity={active ? 0.9 : 1}
                  strokeWidth={major ? 1.6 : 1}
                  strokeLinecap="round"
                  style={{ transition: "stroke 400ms ease, stroke-opacity 400ms ease" }}
                />
              </g>
            );
          })}

        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(244,241,234,0.07)"
          strokeWidth={strokeWidth}
        />
        {/*
         * The light's leading edge at twelve o'clock. It is a zero-length
         * dash pinned at the path's start, painted in the arc's own gradient
         * so no seam can show: a single dash can only carry a round cap at its
         * end, so the arc used to begin with a flat cut while its other end
         * was round — it must come before the arc in paint order (the visual
         * harness reads the *last* gradient-stroked circle as the arc).
         */}
        {clamped > 0.004 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`0.01 ${circumference}`}
          />
        )}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          filter={`url(#ring-glow-${tone})`}
          style={
            {
              transition: "stroke-dashoffset 240ms linear",
            } as CSSProperties
          }
        />
        {/*
         * The light's leading edge at twelve o'clock. A single dash that starts
         * before the path can only carry a round cap at its *end*, so the arc
         * used to begin with a flat cut while its other end was round — one end
         * of the same stroke finished two different ways.
         *
         * A zero-length dash pinned at the path's start paints a round cap
         * there, in the arc's *own* gradient, so the two ends finally finish the
         * same way and the cap cannot seam against the arc it joins. (A filled
         * disc in a mixed solid colour did seam: SVG interpolates the ramp per
         * pixel, and a solid that only approximates the colour at that angle
         * shows where it ends.)
         */}
      </svg>

      {/*
       * Comet head riding the tip of the arc.
       *
       * Deliberately *outside* the svg above, and rotated as a div: rotating an
       * SVG group — or transitioning any SVG `transform` — is a layout change in
       * Blink, so a per-frame rotation inside the svg re-ran the document's
       * layout on every frame of the whole session (docs/motion-budget.md).
       * An HTML transform is composited instead. The dot sits at twelve o'clock
       * here rather than at the arc's own start angle, which is what lets the
       * wrapper carry the rotation the `-rotate-90` used to supply.
       */}
      {clamped > 0.004 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            transform: `rotate(${clamped * 360}deg)`,
            transition: "transform 240ms linear",
          }}
        >
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
            <defs>
              {/*
               * The comet's atmosphere, as a falloff rather than a disc. It
               * used to be a flat 35%-opacity circle with a hard rim, nearly
               * twice the stroke's radius, which read as a bulb snapped onto
               * the arc instead of light around the dot. The radius stays close
               * to the stroke: past roughly one stroke's width the halo starts
               * reading as its own object beside the arc rather than as the
               * arc's end.
               */}
              <radialGradient id={`comet-glow-${tone}`}>
                <stop offset="0%" stopColor={colors.solid} stopOpacity="0.5" />
                <stop offset="45%" stopColor={colors.solid} stopOpacity="0.16" />
                <stop offset="100%" stopColor={colors.solid} stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle
              cx={size / 2}
              cy={size / 2 - radius}
              r={strokeWidth * 0.95}
              fill={`url(#comet-glow-${tone})`}
            />
            <circle
              cx={size / 2}
              cy={size / 2 - radius}
              r={Math.max(1.1, strokeWidth * 0.34)}
              fill="#fffdf8"
              opacity={0.95}
            />
          </svg>
        </div>
      )}
      <div className="relative z-10 grid place-items-center">{children}</div>
    </div>
  );
}
