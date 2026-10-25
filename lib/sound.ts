/**
 * Tiny WebAudio chime engine — no audio assets, everything is synthesised.
 * The context is created lazily on the first user gesture so autoplay
 * policies are respected.
 */

export type SoundName =
  | "complete"
  | "session-end"
  | "break-end"
  | "soft"
  | "tick-tock";

let context: AudioContext | null = null;

function get_context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as (Window & { webkitAudioContext?: typeof AudioContext }))
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  if (context.state === "suspended") void context.resume();
  return context;
}

interface ToneOptions {
  frequency: number;
  at?: number;
  duration?: number;
  gain?: number;
  type?: OscillatorState["type"];
  detune?: number;
}

type OscillatorState = OscillatorNode;

function tone(ctx: AudioContext, options: ToneOptions) {
  const {
    frequency,
    at = 0,
    duration = 0.45,
    gain = 0.16,
    type = "sine",
    detune = 0,
  } = options;
  const start = ctx.currentTime + at;

  const oscillator = ctx.createOscillator();
  const amp = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  oscillator.detune.value = detune;

  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.02);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(amp).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
}

/**
 * A tenth of a second of white noise, made once per context.
 *
 * Every mechanical tick in this file is built from it: an escapement is a
 * collision, and a collision is broadband. Two oscillators can be tuned into a
 * beep, but they cannot be tuned into a *click* — that needs the noise, a
 * resonant body to give it a pitch, and a very short envelope.
 */
let noiseCache: { ctx: AudioContext; buffer: AudioBuffer } | null = null;

function noise(ctx: AudioContext): AudioBuffer {
  if (noiseCache?.ctx === ctx) return noiseCache.buffer;
  const length = Math.ceil(ctx.sampleRate * 0.12);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }
  noiseCache = { ctx, buffer };
  return buffer;
}

/**
 * One escapement click: the strike, the case's answer, and a little weight.
 *
 * Three parts, because that is what the ear hears in a real clock. The *strike* —
 * 18ms of band-limited noise, which is the pallet hitting the wheel, and the part
 * that has to arrive first and loudest: a tick whose weight leads it is a thud.
 * The *body* — the same noise through a narrow resonance an octave below the
 * strike, decaying over 70ms, which is the wooden case answering. And a short sine
 * at ~230Hz, quiet and 55ms long, for the weight a click alone does not have.
 *
 * `high` is the tick (leading beat) and the tock is a whole step below, the pair
 * that makes a clock an alternating mechanism rather than a metronome.
 */
function escapement(ctx: AudioContext, at: number, high: boolean, gain: number) {
  const start = ctx.currentTime + at;
  const source = ctx.createBufferSource();
  source.buffer = noise(ctx);

  const strike = ctx.createBiquadFilter();
  strike.type = "bandpass";
  strike.frequency.value = high ? 2500 : 1800;
  strike.Q.value = 1;
  const strikeGain = ctx.createGain();
  strikeGain.gain.setValueAtTime(0.0001, start);
  strikeGain.gain.exponentialRampToValueAtTime(gain, start + 0.0015);
  strikeGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.018);

  const body = ctx.createBiquadFilter();
  body.type = "bandpass";
  body.frequency.value = high ? 1250 : 900;
  body.Q.value = 6;
  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0.0001, start);
  bodyGain.gain.exponentialRampToValueAtTime(gain * 0.45, start + 0.005);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.075);

  source.connect(strike).connect(strikeGain).connect(ctx.destination);
  source.connect(body).connect(bodyGain).connect(ctx.destination);
  source.start(start);
  source.stop(start + 0.14);

  tone(ctx, {
    frequency: high ? 232 : 174,
    at,
    duration: 0.055,
    gain: gain * 0.14,
  });
}

/**
 * The clock announcing itself: five escapement clicks over two and a bit seconds.
 *
 * Alternating tick and tock at a walking 109bpm, with the last pair pulled back
 * so the gesture settles instead of stopping dead. It is a start, not a
 * countdown and not a per-minute tick: long enough that pressing play is heard,
 * short enough that it is over before the first minute of work.
 */
function tickTock(ctx: AudioContext) {
  const gap = 0.55;
  const pattern = [true, false, true, false, true];
  pattern.forEach((high, index) => {
    const settle = index === pattern.length - 1 ? 0.5 : index === pattern.length - 2 ? 0.78 : 1;
    escapement(ctx, index * gap, high, 0.32 * settle);
  });
}

const PRESETS: Record<Exclude<SoundName, "tick-tock">, ToneOptions[]> = {
  // Gentle rising arpeggio when a task is completed.
  complete: [
    { frequency: 659.25, duration: 0.4, gain: 0.12 },
    { frequency: 830.61, at: 0.09, duration: 0.4, gain: 0.11 },
    { frequency: 987.77, at: 0.18, duration: 0.6, gain: 0.1 },
  ],
  // Warm bell for the end of a focus session.
  "session-end": [
    { frequency: 880, duration: 1.1, gain: 0.14 },
    { frequency: 1320, at: 0.02, duration: 0.9, gain: 0.06, detune: 6 },
    { frequency: 440, duration: 1.2, gain: 0.07 },
  ],
  // Two soft ascending notes when a break is over.
  "break-end": [
    { frequency: 587.33, duration: 0.35, gain: 0.12 },
    { frequency: 880, at: 0.16, duration: 0.7, gain: 0.12 },
  ],
  // Subtle tick used for focus start / mode switches.
  soft: [{ frequency: 523.25, duration: 0.22, gain: 0.08, type: "triangle" }],
};

export function playSound(name: SoundName) {
  const ctx = get_context();
  if (!ctx) return;
  if (name === "tick-tock") {
    tickTock(ctx);
    return;
  }
  for (const options of PRESETS[name]) tone(ctx, options);
}

/** Warm the audio context up after the first gesture (avoids a delayed first sound). */
export function primeAudio() {
  get_context();
}
