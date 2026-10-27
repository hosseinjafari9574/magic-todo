#!/usr/bin/env node
/**
 * The instrument's geometry, measured.
 *
 * Three things in this app are geometry rather than styling: the card's
 * graduations, the room's moon and the phase strip. Each of them has a right
 * answer — an angle, a lit fraction, a token — so each of them can be *read
 * back* and compared with what the source implies. This does that in one
 * checked-in script, against a headless Chrome and a seeded session, and exits
 * non-zero on drift.
 *
 * It replaces the pile of one-off probes this repository grew while the room was
 * being measured (`ring-probe.mjs`, `ring-focus.mjs`, `phase-probe.mjs`, the
 * moon half of `moon-samples.mjs`). Those are still the record of *how* the
 * numbers were chosen; this is the part worth guarding.
 *
 * What is measured, and where the expectation comes from:
 *
 *   ring    the card's 25 graduations. Expected angles are derived from the
 *           marked-minute count, the arc's lit span from the seeded progress,
 *           and both are confirmed against the rendered pixels: every tick's
 *           angular position and whether it is lit, plus where the arc stops.
 *           The last one is the regression that started this: the marks sat a
 *           quarter turn behind the arc, and only the pixels showed it.
 *
 *   moon    the room's disc. Its light's position is read from the gradient and
 *           compared with `MOON_LIGHT`; the terminator's waist is compared with
 *           the exact `|2k − 1|` its lit fraction implies, and its side and
 *           angle with the light's axis; the disc's fill with `--moon-dark`;
 *           and the pixels are sampled on both sides of the terminator and along
 *           both limbs. The same is read once more on a gibbous session, where
 *           the old offset-disc construction could only draw a lens, and the
 *           night side's earthshine band and its fade are read again on the
 *           desktop's largest disc — on a crescent, where the 0.56R probe is
 *           inside the unlit face. The terminator itself is walked along the
 *           light's axis on five chords across the pole axis, so its *curve* is
 *           measured and not only its waist: a straight ramp, which is what the
 *           first feather was, holds one radius on every chord and fails.
 *
 *   strip   the four phases. Each mask's rotation must be the night axis from
 *           `geometry.ts` and each terminator's waist the one `|2k − 1|` gives;
 *           the area each glyph actually lights is measured off its pixels (a
 *           coverage-weighted count, so antialiasing is not counted as a
 *           judgement) and must be the quarter it says; the unlit body must be
 *           `--moon-glyph`, hue-less; and the banked moons must be amber where
 *           the pending ones are grey.
 *
 *   stage   the room's fit on a short viewport, where the column wants more
 *           height than the stage has: the title block must start *below* the top
 *           bar, and the dial is paid for out of what is left. A flat 148px dial
 *           floor spent the title's clearance instead, putting it 19px inside the
 *           bar on a 340px-tall landscape window — the bar's own row, on the same
 *           line as the preset and the exit button.
 *
 *   cycle   the whole focus → break → focus round trip, driven through the
 *           room's own controls with the clock moved under the store. The moon
 *           has to fill from the light's side and *drain from that same side*,
 *           so the break's terminator is the focus's turned a half-turn: the
 *           two phases are point reflections of one another, and the pixels on
 *           either side of the disc say which way the light moved. A break
 *           that darkened from the opposite limb passes every single-phase
 *           check and fails here.
 *
 * Usage:
 *   npm run verify:visuals                     # starts `next dev` itself
 *   APP=http://127.0.0.1:3100 npm run verify:visuals
 *   node scripts/verify-visuals.mjs [url]      # an already-running app
 *
 * Artifacts (the screenshots each subject was measured from, and the report)
 * are written to `.freebuff/verify-visuals/`, which is ignored. Exit code 1
 * means at least one measurement drifted; every check is printed either way,
 * with the numbers.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ARTIFACTS = join(ROOT, ".freebuff", "verify-visuals");

const TASKS_KEY = "cadence:todos:v1";
const TIMER_KEY = "cadence:timer:v1";
const DIALOG = '[role="dialog"][aria-label^="Focus mode"]';
const TASK_TITLE = "Rewrite the quarterly report";

/**
 * The stages with less height than the column needs: a short laptop window, a
 * phone in landscape, and the two heights where a flat dial floor used to put the
 * title *inside* the top bar (`hooks/use-ring-size.ts` carries the arithmetic).
 */
const SHORT_STAGES = [
  [1024, 520],
  [844, 390],
  [844, 340],
  [780, 320],
];

/** One finished cycle plus a half: two banked moons, a session two thirds run. */
const SESSIONS = 2;
const REMAINING_MIN = 15;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fmt = (n, digits = 2) => (Number.isFinite(n) ? String(Number(n.toFixed(digits))) : String(n));

/* ------------------------------------------------------------------ source */

/**
 * What the app says its own numbers are. Reading them here rather than copying
 * them is the point of the exercise: a changed light position or token is a
 * change the check has to see, not one it silently inherits.
 */
function readSource() {
  const geometry = readFileSync(join(ROOT, "components/focus/geometry.ts"), "utf8");
  const globals = readFileSync(join(ROOT, "app/globals.css"), "utf8");
  const constants = readFileSync(join(ROOT, "lib/constants.ts"), "utf8");

  const light = /MOON_LIGHT = \{ x: ([\d.]+), y: ([\d.]+) \}/.exec(geometry);
  const minLit = /MOON_MIN_LIT = ([\d.]+)/.exec(geometry);
  const focusMinutes = /classic:[\s\S]*?focus: (\d+) \* 60_000/.exec(constants);
  const cycle = /longBreakAfter: (\d+)/.exec(constants);
  const dark = /--moon-dark:\s*(#[0-9a-fA-F]{6})/.exec(globals);
  const glyph = /--moon-glyph:\s*(#[0-9a-fA-F]{6})/.exec(globals);
  /*
   * The moon's *surface*: the texture and the four numbers the treatment is
   * set by. Read the same way as the light — a drift in any of them is a change
   * the check has to see, not one it silently inherits from the import.
   */
  const textureUrl = /MOON_TEXTURE_URL = "([^"]+)"/.exec(geometry);
  const brightness = /MOON_LIT_BRIGHTNESS = ([\d.]+)/.exec(geometry);
  const contrast = /MOON_LIT_CONTRAST = ([\d.]+)/.exec(geometry);
  const nightOpacity = /MOON_NIGHT_OPACITY = ([\d.]+)/.exec(geometry);
  const nightFalloff = /MOON_NIGHT_FALLOFF = ([\d.]+)/.exec(geometry);
  const scrim = /MOON_SCRIM_OPACITY = ([\d.]+)/.exec(geometry);
  const limb = /MOON_LIMB_SHADE = ([\d.]+)/.exec(geometry);
  /*
   * The disc's inset as a share of the dial. The room's moon ÷ dial is checked
   * from this rather than from a copied 80%, so shrinking the inset is a change
   * the check sees, not one it silently inherits.
   */
  const moonInset = /const inset = Math\.round\(ringSize \* ([\d.]+)\)/.exec(geometry);

  if (
    !light ||
    !minLit ||
    !focusMinutes ||
    !cycle ||
    !dark ||
    !glyph ||
    !textureUrl ||
    !brightness ||
    !contrast ||
    !nightOpacity ||
    !nightFalloff ||
    !scrim ||
    !limb ||
    !moonInset
  ) {
    throw new Error(
      "could not read the instrument's own numbers out of components/focus/geometry.ts, " +
        "lib/constants.ts or app/globals.css — update the patterns in scripts/verify-visuals.mjs",
    );
  }

  return {
    light: { x: Number(light[1]), y: Number(light[2]) },
    minLit: Number(minLit[1]),
    focusMinutes: Number(focusMinutes[1]),
    cycle: Number(cycle[1]),
    moonDark: dark[1],
    moonGlyph: glyph[1],
    textureUrl: textureUrl[1],
    moonInset: Number(moonInset[1]),
    surface: {
      brightness: Number(brightness[1]),
      contrast: Number(contrast[1]),
      nightOpacity: Number(nightOpacity[1]),
      nightFalloff: Number(nightFalloff[1]),
      scrim: Number(scrim[1]),
      limb: Number(limb[1]),
    },
  };
}

const hexLuma = (hex) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};

/**
 * The night axis, from `MOON_LIGHT`: the direction the unlit half slides, and
 * the rotation the phase strip's terminator carries. Written out here rather
 * than imported because this side of the check has to be able to disagree.
 */
function nightAxis(light) {
  const dx = light.x / 100 - 0.5;
  const dy = light.y / 100 - 0.5;
  const length = Math.hypot(dx, dy);
  return { x: -dx / length, y: -dy / length };
}

/* -------------------------------------------------------------------- app */

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function stopTree(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

/** A dev server, started here so the script stands alone. */
async function startApp() {
  const port = await freePort();
  const nextBin = join(ROOT, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextBin)) throw new Error("next is not installed — run the project's install first");
  const child = spawn(process.execPath, [nextBin, "dev", "-p", String(port)], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk;
  });
  child.stderr.on("data", (chunk) => {
    log += chunk;
  });

  const base = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`next dev exited (${child.exitCode}) before it answered:\n${log.slice(-3000)}`);
    }
    try {
      const response = await fetch(base);
      if (response.ok) return { base, stop: () => stopTree(child) };
    } catch {
      /* not up yet */
    }
    await sleep(400);
  }
  stopTree(child);
  throw new Error(`the app did not answer on ${base} within 120s:\n${log.slice(-3000)}`);
}

/* ---------------------------------------------------------------- browser */

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function findChrome() {
  const found = CHROME_CANDIDATES.find((candidate) => candidate && existsSync(candidate));
  if (!found) {
    throw new Error(
      "no Chrome or Edge found — set CHROME_PATH to a Chromium-based browser binary",
    );
  }
  return found;
}

class Session {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    };
  }

  send(method, params = {}) {
    const id = (this.nextId += 1);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(
        exceptionDetails.exception?.description ?? exceptionDetails.text ?? "page threw",
      );
    }
    return result.value;
  }

  close() {
    this.socket.close();
  }
}

/** Calls a Node function inside the page, with JSON arguments. */
const inPage = (session, fn, ...args) =>
  session.eval(`(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(", ")})`);

async function connect(cdpPort) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((r) => r.json());
      const page = list.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.onopen = resolve;
          socket.onerror = reject;
        });
        return new Session(socket);
      }
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error("no CDP target appeared");
}

/* ----------------------------------------------------- browser-side readers */

/** The card's ring out of the DOM: marks, arc and box. */
function readCardRing() {
  const svg = [...document.querySelectorAll("svg")].find(
    (element) => element.querySelectorAll("line").length > 5 && !element.closest('[role="dialog"]'),
  );
  if (!svg) return null;
  const lines = [...svg.querySelectorAll("line")];
  const arcs = [...svg.querySelectorAll("circle")].filter((circle) =>
    /url\(/.test(circle.getAttribute("stroke") || ""),
  );
  const arc = arcs[arcs.length - 1];
  if (!arc) return null;
  const box = svg.getBoundingClientRect();
  const ys = lines.flatMap((line) => [
    Number(line.getAttribute("y1")),
    Number(line.getAttribute("y2")),
  ]);
  const size = box.width;
  const style = getComputedStyle(arc);
  const dash = Number.parseFloat(style.strokeDasharray.split(",")[0]);
  const offset = Number.parseFloat(style.strokeDashoffset);
  return {
    box: { x: box.x, y: box.y, w: box.width, h: box.height },
    size,
    tickOuter: size / 2 - Math.min(...ys),
    tickInner: size / 2 - Math.max(...ys),
    arcR: Number(arc.getAttribute("r")),
    arcW: Number(arc.getAttribute("stroke-width")),
    angles: lines.map((line) =>
      Number((line.parentElement.getAttribute("transform") || "").match(/rotate\(([-\d.]+)/)?.[1]),
    ),
    /* Each mark's own shaft, so a short tick is not sampled where only a long one reaches. */
    shafts: lines.map((line) => {
      const y1 = Number(line.getAttribute("y1"));
      const y2 = Number(line.getAttribute("y2"));
      return {
        inner: size / 2 - Math.max(y1, y2),
        outer: size / 2 - Math.min(y1, y2),
        major: Math.abs(y1 - y2) > 6,
      };
    }),
    active: lines.map((line) => line.getAttribute("stroke-opacity") === "0.9"),
    major: lines.map(
      (line) => Math.abs(Number(line.getAttribute("y1")) - Number(line.getAttribute("y2"))) > 6,
    ),
    progress: 1 - offset / dash,
    clock: document.querySelector('[role="timer"]')?.textContent ?? null,
  };
}

/** The room: dial, moon, strip and the tokens they are painted from. */
function readFocusRoom() {
  const dialog = document.querySelector('[role="dialog"][aria-label^="Focus mode"]');
  if (!dialog) return null;

  const dialSvg = [...dialog.querySelectorAll("svg")].find(
    (element) => element.querySelectorAll("line").length > 5,
  );
  const dialLines = dialSvg ? [...dialSvg.querySelectorAll("line")] : [];
  const dialBox = dialSvg?.getBoundingClientRect() ?? null;
  const arcs = [...dialog.querySelectorAll("circle")].filter((circle) =>
    /url\(/.test(circle.getAttribute("stroke") || ""),
  );
  const arc = arcs[arcs.length - 1];
  const arcStyle = arc ? getComputedStyle(arc) : null;
  const arcDash = arcStyle ? Number.parseFloat(arcStyle.strokeDasharray.split(",")[0]) : NaN;
  const arcOffset = arcStyle ? Number.parseFloat(arcStyle.strokeDashoffset) : NaN;

  const instrument = dialog.querySelector("div.relative.flex-none");
  const moon = instrument?.children?.[1] ?? null;
  /*
   * The moon's body, by its parts rather than by child index: the disc holds the
   * clip definition, the night surface, the clipped lit surface, and the scrim
   * under the reading. Reading `children[1]` (which the old gradient body made
   * the light layer) is exactly the sort of coupling a layer swap breaks.
   */
  const part = (name) =>
    moon?.getAttribute("data-part") === name
      ? moon
      : (moon?.querySelector(`[data-part="${name}"]`) ?? null);
  const clipPath = moon?.querySelector("clipPath path") ?? null;
  const litLayer = part("lit");
  const surface = part("surface");
  const night = part("night");
  const shade = part("shade");
  const scrim = part("scrim");
  const disc = moon?.getBoundingClientRect() ?? null;
  const gradient = shade ? getComputedStyle(shade).backgroundImage : "";
  const at = /circle at ([\d.]+)% ([\d.]+)%/.exec(gradient);
  const scrimGradient = scrim ? getComputedStyle(scrim).backgroundImage : "";
  const scrimCentre = /rgba\(3, 5, 10, ([\d.]+)\)/.exec(scrimGradient);
  const textureMatch = surface
    ? /url\("([^"]+)"\)/.exec(getComputedStyle(surface).backgroundImage)
    : null;
  /*
   * The limb is a sibling of the disc, not a part of it: the two shadows that
   * carry the light (the 2px rim and the 62px far-limb falloff) are its own.
   */
  const rimShadow = instrument
    ? getComputedStyle(
        [...instrument.children].find(
          (element) =>
            element.getAttribute("aria-hidden") !== null &&
            getComputedStyle(element).boxShadow.includes("inset"),
        ) ?? instrument,
      ).boxShadow
    : "";
  const rimOffsets = /rgba\(244, 241, 234, 0\.19\) (-?[\d.]+)px (-?[\d.]+)px/.exec(rimShadow);
  const surfaceFilter = surface ? getComputedStyle(surface).filter : "";
  const path = clipPath?.getAttribute("d") ?? "";
  const terminatorArc = /A ([\d.]+) 0\.5 0 0 ([01]) 0\.5 0/.exec(path);
  const angleMatch = (clipPath?.getAttribute("transform") || "").match(/rotate\(([-\d.]+)/);

  const strip = dialog.querySelector('[role="img"]');
  const glyphs = strip
    ? [...strip.querySelectorAll("svg")].map((svg) => {
        const box = svg.getBoundingClientRect();
        const ellipse = svg.querySelector("ellipse");
        return {
          box: { x: box.x, y: box.y, w: box.width, h: box.height },
          rotations: [...svg.querySelectorAll("[transform]")].map((node) =>
            Number((node.getAttribute("transform") || "").match(/rotate\(([-\d.]+)/)?.[1]),
          ),
          rx: ellipse ? Number(ellipse.getAttribute("rx")) : null,
          ry: ellipse ? Number(ellipse.getAttribute("ry")) : null,
          color: getComputedStyle(svg).color,
        };
      })
    : [];

  const tokenSource = moon ?? document.documentElement;
  const tokens = getComputedStyle(tokenSource ?? document.documentElement);
  const dark = tokens.getPropertyValue("--moon-dark").trim();
  const glyph = tokens.getPropertyValue("--moon-glyph").trim();

  return {
    dial: {
      box: dialBox ? { x: dialBox.x, y: dialBox.y, w: dialBox.width, h: dialBox.height } : null,
      angles: dialLines.map((line) =>
        Number((line.parentElement.getAttribute("transform") || "").match(/rotate\(([-\d.]+)/)?.[1]),
      ),
      active: dialLines.filter((line) => line.getAttribute("stroke-opacity") === "0.9").length,
      progress: 1 - arcOffset / arcDash,
    },
    moon: {
      box: disc ? { x: disc.x, y: disc.y, w: disc.width, h: disc.height } : null,
      light: at ? { x: Number(at[1]), y: Number(at[2]) } : null,
      fill: moon ? getComputedStyle(moon).backgroundColor : null,
      rim: rimOffsets ? { x: Number(rimOffsets[1]), y: Number(rimOffsets[2]) } : null,
      texture: {
        url: textureMatch ? textureMatch[1] : null,
        filter: surfaceFilter,
        night: night ? getComputedStyle(night).opacity : null,
        nightMask: night ? getComputedStyle(night).maskImage : null,
        scrimCentre: scrimCentre ? Number(scrimCentre[1]) : null,
        /* The far-limb shade, and that it rides inside the clipped lit layer. */
        limbShade: Number(/rgba\(2, 4, 9, ([\d.]+)\) 92%/.exec(gradient)?.[1]),
        /*
         * The shade sits one level deeper than it used to: the lit layer now
         * wraps it in the terminator's own fading band (`data-part="terminator"`,
         * a mask), so the clip is an ancestor rather than the parent. Same
         * assertion — the shade is under the clip that cuts the phase — read up
         * the tree.
         */
        shadeClipped: Boolean(shade?.closest('[data-part="lit"]')?.style.clipPath),
        /* Whether the surface, not just its wrapper, is a photograph. */
        painted: Boolean(surface && getComputedStyle(surface).backgroundImage !== "none"),
      },
      parts: ["disc", "night", "lit", "surface", "shade", "scrim"].filter((name) => part(name)),
      phase: {
        path,
        /* The terminator's waist, as a fraction of the radius. */
        rx: terminatorArc ? Number(terminatorArc[1]) : 0,
        /* 0 draws the ellipse on the night side (gibbous), 1 on the lit side. */
        sweep: terminatorArc ? Number(terminatorArc[2]) : null,
        angle: angleMatch ? Number(angleMatch[1]) : null,
        clip: litLayer ? getComputedStyle(litLayer).clipPath : null,
      },
    },
    strip: {
      label: strip?.getAttribute("aria-label") ?? null,
      count: glyphs.length,
      glyphs,
      box: strip
        ? (() => {
            const box = strip.getBoundingClientRect();
            return { x: box.x, y: box.y, w: box.width, h: box.height };
          })()
        : null,
    },
    tokens: { dark, glyph },
  };
}

/**
 * The room's fit, where the stage has less height than the column needs.
 *
 * The top bar is found by the button that leaves it — the row is a plain flex
 * box with no marker of its own — and the title block by the `h1` it holds: the
 * phase line, the title, the meta and the rule are one block, and it is that box
 * that has to stay clear of the bar. The stage is the block's own parent, and
 * the dial its sibling's box, which is the ring's size by construction.
 */
function readRoomClearance() {
  const dialog = document.querySelector('[role="dialog"][aria-label^="Focus mode"]');
  if (!dialog) return null;
  const exit = [...dialog.querySelectorAll("button")].find(
    (element) =>
      (element.getAttribute("aria-label") || "") === "Exit focus mode" && element.offsetParent,
  );
  const bar = exit ? exit.parentElement : null;
  const title = dialog.querySelector("h1");
  const block = title ? title.parentElement : null;
  const stage = block ? block.parentElement : null;
  if (!bar || !block || !stage) return null;
  const barBox = bar.getBoundingClientRect();
  const blockBox = block.getBoundingClientRect();
  const stageBox = stage.getBoundingClientRect();
  const instrument = dialog.querySelector("div.relative.flex-none");
  return {
    clearance: blockBox.top - barBox.bottom,
    barBottom: barBox.bottom,
    blockTop: blockBox.top,
    blockHeight: blockBox.height,
    stageHeight: stageBox.height,
    dial: instrument ? instrument.getBoundingClientRect().height : null,
    gap: Number.parseFloat(getComputedStyle(stage).rowGap) || 0,
    overflow: stage.scrollHeight - stage.clientHeight,
  };
}

/* ----------------------------------------------------- browser-side pixels */

/**
 * Reads the captured pixels. One function for all three subjects, because the
 * screenshot arrives as a data URL inside the page and decoding it is the same
 * work each time.
 */
async function measurePixels(spec) {
  const image = new Image();
  image.src = `data:image/png;base64,${spec.shot}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  const w = width;
  const h = height;

  const rgbAt = (x, y) => {
    const i = (Math.round(y) * w + Math.round(x)) * 4;
    if (i < 0 || i + 3 >= data.length) return null;
    return { r: data[i], g: data[i + 1], b: data[i + 2] };
  };
  const lumaAt = (x, y) => {
    const p = rgbAt(x, y);
    return p ? 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b : null;
  };
  const meanAt = (x, y, radius) => {
    let sum = 0;
    let count = 0;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const l = lumaAt(x + dx, y + dy);
        if (l !== null) {
          sum += l;
          count += 1;
        }
      }
    }
    return count ? sum / count : null;
  };

  if (spec.kind === "ring") {
    const scale = w / spec.size;
    const cx = w / 2;
    const cy = h / 2;
    const sample = (deg, radius) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return lumaAt(cx + Math.cos(a) * radius * scale, cy + Math.sin(a) * radius * scale);
    };
    const peakAt = (deg, inner, outer) => {
      let best = 0;
      for (let r = inner; r <= outer; r += 0.5) {
        const l = sample(deg, r);
        if (l !== null && l > best) best = l;
      }
      return best;
    };

    /*
     * Where each mark actually is. A 1px line at 1° steps is a shoulder, not a
     * spike — its plateau can have no strict local maximum at the sampled
     * resolution — so each mark is found by searching a window narrower than the
     * 14.4° spacing for the brightest point in its own shaft. A quarter-turn
     * slip puts the search on the sky, and the luma says so.
     */
    const marks = spec.marks.map((mark) => {
      let best = { deg: mark.angle, luma: 0 };
      for (let offset = -5; offset <= 5; offset += 0.5) {
        const deg = mark.angle + offset;
        const luma = peakAt(deg, mark.inner + 1, mark.outer - 0.6);
        if (luma > best.luma) best = { deg, luma: Math.round(luma) };
      }
      return best;
    });

    let arcEnd = 0;
    for (let d = 0; d < 360; d += 0.5) {
      const l = peakAt(d, spec.arcInner, spec.arcOuter);
      if (l >= spec.arcThreshold) arcEnd = d;
      else if (d > 8) break;
    }

    return { marks, arcEnd };
  }

  if (spec.kind === "moon") {
    const radius = w / 2;
    const cx = w / 2;
    const cy = h / 2;
    const lx = spec.light.x / 100 - 0.5;
    const ly = spec.light.y / 100 - 0.5;
    const length = Math.hypot(lx, ly);
    const ux = lx / length;
    const uy = ly / length;
    /*
     * 0.72 of the radius, not 0.42: the dial's clock sits in the middle of the
     * moon, and a sample there is a sample of white text rather than of the
     * surface. At this distance both sides are past the reading and still well
     * inside the disc.
     */
    /* `u` points from the centre toward the light, so the lit half is +u. */
    const at = (dx, dy, fraction) =>
      meanAt(cx + dx * fraction * radius, cy + dy * fraction * radius, 3);
    /*
     * A point on the diameter through the poles, off the clock: dark in a
     * crescent, lit in a gibbous. It is where the old offset-disc construction
     * started drawing the wrong shape, so it reads the phase in pixels rather
     * than only in the path.
     */
    const vx = -uy;
    const vy = ux;
    /*
     * How much terrain the unlit half still carries. The 3×3 means are taken
     * across the whole night half (past the reading, inside the limb) and the
     * spread is their p05–p95: a flat fill, or a night side dimmed until the
     * albedo disappears, reads a couple of luma; earthshine reads tens.
     */
    const nightMeans = [];
    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x += 4) {
        const dx = (x + 0.5 - cx) / radius;
        const dy = (y + 0.5 - cy) / radius;
        const reach = Math.hypot(dx, dy);
        /*
         * Outside the scrim's reach (0.46R) and inside the limb's own light, so
         * this measures terrain rather than the paint over the clock or the rim
         * highlight.
         */
        if (reach > 0.86 || reach < 0.5) continue;
        /*
         * Well into the unlit half: a sample on the terminator would carry
         * antialiased lit pixels and turn this into a phase measurement.
         */
        if (dx * ux + dy * uy > -0.4) continue;
        const value = meanAt(x, y, 1);
        if (value !== null) nightMeans.push(value);
      }
    }
    nightMeans.sort((a, b) => a - b);
    const nightPercentile = (fraction) =>
      nightMeans[Math.floor(fraction * (nightMeans.length - 1))] ?? 0;
    /*
     * The photograph's own detail on that half, after the sphere's broad
     * shading is subtracted: the same idea as the lit face's `textureRms`, and
     * the number a flat fill cannot fake.
     */
    let nightResidual = 0;
    let nightResidualCount = 0;
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const dx = (x + 0.5 - cx) / radius;
        const dy = (y + 0.5 - cy) / radius;
        const reach = Math.hypot(dx, dy);
        if (reach > 0.86 || reach < 0.5) continue;
        if (dx * ux + dy * uy > -0.4) continue;
        const value = lumaAt(x, y);
        const local = meanAt(x, y, 1);
        if (value === null || local === null) continue;
        nightResidual += (value - local) ** 2;
        nightResidualCount += 1;
      }
    }
    /*
     * The terminator's own curve, read on chords across the pole axis.
     *
     * The waist in the DOM says the ellipse is *defined* with `|2k − 1|`, not
     * that the pixels carry it: a straight ramp at the same radius at the
     * equator passes a waist check and still draws the cut across the lune that
     * this shape replaced. Each chord walks the light's axis at a fixed `v` and
     * finds where the surface runs out, so the reading is of the painted edge —
     * the ellipse pulls the crossing toward the centre as `sqrt(1 − v²)`, a line
     * does not.
     */
    const terminatorOn = (v) => {
      /* Inside the limb, and inside the disc at every `v` the chord starts from. */
      const reach = Math.sqrt(Math.max(0, 0.93 ** 2 - v * v));
      const samples = [];
      for (let u = reach; u >= -reach; u -= 0.006) {
        const l = meanAt(
          cx + (u * ux + v * vx) * radius,
          cy + (u * uy + v * vy) * radius,
          2,
        );
        if (l !== null) samples.push({ u, l });
      }
      /*
       * Levels from the ends, not from a fixed offset around the crossing: a
       * fixed offset moves with the feather and reports every phase as the same
       * edge. The lit side is read past the clock (u ≥ 0.5, where the lune still
       * is at a crescent) and the night side past it on the other hand (u ≤ −0.5).
       */
      const percentileOf = (values, fraction) => {
        if (!values.length) return null;
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
      };
      const litLevel = percentileOf(
        samples.filter((s) => s.u >= 0.5).map((s) => s.l),
        0.85,
      );
      const nightLevel = percentileOf(
        samples.filter((s) => s.u <= -0.5).map((s) => s.l),
        0.2,
      );
      if (litLevel === null || nightLevel === null || litLevel - nightLevel < 8) return null;
      const mid = (litLevel + nightLevel) / 2;
      /*
       * From the lit limb inward, the first sample below the halfway level is
       * the terminator. Taking the first rather than the steepest is what keeps
       * the clock out of it: the type's edges are further in, and at this phase
       * the surface has already run out before the chord reaches them.
       */
      for (let i = 1; i < samples.length; i += 1) {
        if (samples[i].l > mid) continue;
        const before = samples[i - 1];
        const after = samples[i];
        const t = (before.l - mid) / Math.max(1e-6, before.l - after.l);
        return { v, u: before.u + (after.u - before.u) * t };
      }
      return null;
    };
    const terminator = [-0.55, -0.28, 0, 0.28, 0.55].map(terminatorOn);
    return {
      litSide: at(ux, uy, 0.72),
      nightSide: at(-ux, -uy, 0.72),
      terminator,
      /*
       * The same axis, inside and outside that sample: earthshine is lit by a
       * full Earth in the viewer's direction, so it is brightest where the
       * ground faces the viewer and dimmer at the limb. The pair is the fade —
       * a night layer masked to one flat exposure moves neither end.
       */
      nightNear: at(-ux, -uy, 0.56),
      nightFar: at(-ux, -uy, 0.86),
      litLimb: at(ux, uy, 0.88),
      nightLimb: at(-ux, -uy, 0.88),
      litPastCentre: at(vx, vy, 0.62),
      nightSpread: nightPercentile(0.95) - nightPercentile(0.05),
      nightRms: Math.sqrt(nightResidual / Math.max(1, nightResidualCount)),
      centre: at(0, 0, 0.1),
    };
  }

  if (spec.kind === "surface") {
    /*
     * The lit face is a *photograph*, and this is what says so. Two discs of
     * the same mean luma are not the same surface: a gradient is smooth at every
     * scale, a lunar albedo is not. `textureRms` is the local variation — each
     * sample against the mean of its own 3×3 neighbourhood — so the sphere's
     * broad falloff is subtracted out and what is left is terrain. Reverting the
     * surface to a gradient drops it to near zero while every luma check still
     * passes; that is the drift this measurement exists for.
     *
     * The annulus starts at 0.5 of the radius so the clock's type and the scrim
     * over it are both outside the sample, and stops at 0.86 so the limb's own
     * antialiasing is outside it too.
     */
    const radius = w / 2;
    const cx = w / 2;
    const cy = h / 2;
    const lx = spec.light.x / 100 - 0.5;
    const ly = spec.light.y / 100 - 0.5;
    const length = Math.hypot(lx, ly);
    const ux = lx / length;
    const uy = ly / length;
    const lumaOf = (x, y) => {
      const p = rgbAt(x, y);
      return p ? 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b : null;
    };
    const lit = [];
    let localSum = 0;
    let localCount = 0;
    for (let y = Math.ceil(cy - radius * 0.86); y <= Math.floor(cy + radius * 0.86); y += 2) {
      for (let x = Math.ceil(cx - radius * 0.86); x <= Math.floor(cx + radius * 0.86); x += 2) {
        const dx = (x + 0.5 - cx) / radius;
        const dy = (y + 0.5 - cy) / radius;
        const r = Math.hypot(dx, dy);
        if (r < 0.5 || r > 0.86) continue;
        /*
         * The lit region, with the terminator's own antialiasing excluded: the
         * boundary sits `|2k − 1|` of the radius along the axis, and a sample
         * astride it would report the phase's hard edge as "texture".
         */
        const cut = spec.lit < 0.5 ? Math.max(0.18, 1 - 2 * spec.lit + 0.15) : 0.18;
        if (dx * ux + dy * uy < cut) continue;
        const l = lumaOf(x, y);
        if (l === null) continue;
        lit.push(l);
        let sum = 0;
        let count = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const n = lumaOf(x + ox, y + oy);
            if (n !== null) {
              sum += n;
              count += 1;
            }
          }
        }
        localSum += (l - sum / count) ** 2;
        localCount += 1;
      }
    }
    const sorted = lit.sort((a, b) => a - b);
    const percentile = (fraction) =>
      sorted.length ? sorted[Math.floor(fraction * (sorted.length - 1))] : null;
    /*
     * The sphere's own falloff, read on the *night* limb: at both phases this
     * check runs at, 0.68 of the radius away from the light is past the
     * terminator, while 0.92 is close enough to the edge for the limb to turn
     * away. Measuring the lit side instead would be measuring the albedo's
     * brightest highlands, which sit right where the light's axis meets the rim.
     */
    const along = (fraction) =>
      meanAt(cx + ux * fraction * radius, cy + uy * fraction * radius, 3);
    return {
      count: sorted.length,
      median: percentile(0.5),
      p05: percentile(0.05),
      p95: percentile(0.95),
      textureRms: localCount ? Math.sqrt(localSum / localCount) : null,
      litAtMid: along(0.42),
      litAtLimb: along(0.84),
      nightAtMid: along(-0.68),
      nightAtLimb: along(-0.92),
      limbFalloff: along(-0.68) - along(-0.92),
    };
  }

  if (spec.kind === "clock") {
    /*
     * The reading over the moon: its own type against the scrim it sits on. The
     * background is the *median* of the pixels that are clearly not type, so a
     * line of white numerals cannot drag its own backdrop up with it.
     */
    const radius = w / 2;
    const cx = w / 2;
    const cy = h / 2;
    const background = [];
    const type = [];
    for (let y = Math.floor(cy - radius * 0.2); y <= Math.ceil(cy + radius * 0.2); y += 1) {
      for (let x = Math.floor(cx - radius * 0.3); x <= Math.ceil(cx + radius * 0.3); x += 1) {
        const p = rgbAt(x, y);
        if (!p) continue;
        const l = 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b;
        if (l < 110) background.push(p);
        else if (l > 170) type.push(p);
      }
    }
    const linear = (channel) => {
      const s = channel / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const relLuma = (p) => 0.2126 * linear(p.r) + 0.7152 * linear(p.g) + 0.0722 * linear(p.b);
    const medianOf = (pixels, key) => {
      if (!pixels.length) return null;
      const values = pixels.map(key).sort((a, b) => a - b);
      return values[Math.floor(values.length / 2)];
    };
    const back = {
      r: medianOf(background, (p) => p.r),
      g: medianOf(background, (p) => p.g),
      b: medianOf(background, (p) => p.b),
    };
    const front = {
      r: medianOf(type, (p) => p.r),
      g: medianOf(type, (p) => p.g),
      b: medianOf(type, (p) => p.b),
    };
    const bg = background.length ? relLuma(back) : null;
    const fg = type.length ? relLuma(front) : null;
    const contrast = bg !== null && fg !== null ? (fg + 0.05) / (bg + 0.05) : null;
    const lumaOf = (p) => 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b;
    return {
      contrast,
      background: background.length ? lumaOf(back) : null,
      type: type.length ? lumaOf(front) : null,
      samples: { background: background.length, type: type.length },
    };
  }

  if (spec.kind === "strip") {
    /*
     * The screenshot is scaled by the clip's scale *and* the device pixel
     * ratio, so image pixels per CSS pixel is measured from the capture rather
     * than assumed: at dpr 3 and scale 3 a 14px glyph is 126px of image, not
     * 42, and a rect converted with the wrong factor lands in its neighbour.
     */
    const sx = w / spec.clip.w;
    return spec.glyphs.map((glyph) => {
      const box = {
        x: (glyph.x - spec.clip.x) * sx,
        y: (glyph.y - spec.clip.y) * sx,
        w: glyph.w * sx,
        h: glyph.h * sx,
      };
      const radius = (10 / 24) * box.w;
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const inside = [];
      for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
        for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
          const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (distance > radius - 0.6) continue;
          const p = rgbAt(x, y);
          if (!p) continue;
          inside.push({ l: 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b, ...p });
        }
      }
      if (!inside.length) return null;

      const lumas = inside.map((p) => p.l).sort((a, b) => a - b);
      const percentile = (fraction) =>
        lumas[Math.min(lumas.length - 1, Math.floor(fraction * (lumas.length - 1)))];
      const litReference = percentile(0.92);
      const darkReference = Math.max(6, spec.darkLuma);
      const span = Math.max(12, litReference - darkReference);

      let coverage = 0;
      const darkPixels = [];
      const litPixels = [];
      for (const p of inside) {
        const t = Math.min(1, Math.max(0, (p.l - darkReference) / span));
        coverage += t;
        if (t < 0.15) darkPixels.push(p);
        if (t > 0.85) litPixels.push(p);
      }

      const median = (pixels, pick) => {
        if (!pixels.length) return null;
        const values = pixels.map(pick).sort((a, b) => a - b);
        return values[Math.floor(values.length / 2)];
      };
      const darkMedian = {
        r: median(darkPixels, (p) => p.r),
        g: median(darkPixels, (p) => p.g),
        b: median(darkPixels, (p) => p.b),
      };
      const darkLuma =
        darkPixels.length
          ? 0.2126 * darkMedian.r + 0.7152 * darkMedian.g + 0.0722 * darkMedian.b
          : null;

      return {
        litFraction: coverage / inside.length,
        darkLuma,
        darkSpread:
          darkPixels.length
            ? Math.max(darkMedian.r, darkMedian.g, darkMedian.b) -
              Math.min(darkMedian.r, darkMedian.g, darkMedian.b)
            : null,
        litLuma: median(litPixels, (p) => p.l),
        litWarmth:
          litPixels.length
            ? median(litPixels, (p) => p.r) - median(litPixels, (p) => p.b)
            : null,
        pixels: inside.length,
      };
    });
  }

  throw new Error(`unknown pixel subject ${spec.kind}`);
}

/* --------------------------------------------------------------- reporting */

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "ok   " : "DRIFT"} ${name.padEnd(30)} ${detail}`);
  return ok;
}

function near(name, actual, expected, tolerance, unit = "") {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance + 1e-9;
  return record(
    name,
    ok,
    `measured ${fmt(actual)}${unit}, expected ${fmt(expected)} ± ${fmt(tolerance)}${unit}`,
  );
}

function same(name, actual, expected) {
  return record(name, actual === expected, `measured ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function atLeast(name, actual, floor, unit = "") {
  return record(name, Number.isFinite(actual) && actual >= floor, `measured ${fmt(actual)}${unit}, needs ≥ ${fmt(floor)}${unit}`);
}

/* ------------------------------------------------------------------- main */

async function main() {
  const source = readSource();
  const expectedProgress = 1 - REMAINING_MIN / source.focusMinutes;
  const tickCount = source.focusMinutes;
  const step = 360 / tickCount;
  const litTicks = Math.floor(expectedProgress * tickCount);
  const axis = nightAxis(source.light);
  const axisAngle = (Math.atan2(axis.y, axis.x) * 180) / Math.PI;
  const terminatorAngle = 90 + axisAngle;

  console.log(
    `\nsource: light ${source.light.x}/${source.light.y}% · night axis ${fmt(axisAngle)}° ` +
      `(terminator ${fmt(terminatorAngle)}°) · ${tickCount} minutes · ` +
      `--moon-dark ${source.moonDark} (${fmt(hexLuma(source.moonDark), 1)} luma) · ` +
      `--moon-glyph ${source.moonGlyph} (${fmt(hexLuma(source.moonGlyph), 1)} luma)`,
  );

  const app = process.env.APP || process.env.BASE_URL || process.argv[2] ? null : await startApp();
  const base = process.env.APP || process.env.BASE_URL || process.argv[2] || app.base;
  console.log(`app:    ${base}${app ? " (started here)" : ""}`);
  mkdirSync(ARTIFACTS, { recursive: true });

  const cdpPort = 9500 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), "verify-visuals-"));
  const chrome = spawn(findChrome(), [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profile}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    "--window-size=1280,900",
    "--window-position=-32000,-32000",
    "about:blank",
  ]);
  chrome.stderr.on("data", () => {});

  const shots = {};
  const report = {};
  let session = null;

  try {
    session = await connect(cdpPort);
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    await session.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });

    const todos = {
      state: {
        tasks: [
          {
            id: "vv-1",
            title: TASK_TITLE,
            completed: false,
            priority: "high",
            tags: [],
            createdAt: 1,
            completedAt: null,
            pomodoros: SESSIONS,
            focusMinutes: SESSIONS * source.focusMinutes,
          },
        ],
        activity: {},
        settings: { soundEnabled: false },
      },
      version: 1,
    };
    const timer = {
      state: {
        preset: "classic",
        mode: "focus",
        running: false,
        endsAt: null,
        remainingMs: REMAINING_MIN * 60_000,
        sessions: SESSIONS,
        flushedMs: 0,
        taskId: "vv-1",
      },
      version: 1,
    };
    /*
     * Injected at document creation: the app hydrates from storage before its
     * first paint, and writing into a mounted page races the clock's own
     * persistence.
     */
    const seed = await session.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try {
        localStorage.setItem(${JSON.stringify(TASKS_KEY)}, ${JSON.stringify(JSON.stringify(todos))});
        localStorage.setItem(${JSON.stringify(TIMER_KEY)}, ${JSON.stringify(JSON.stringify(timer))});
      } catch {}`,
    });

    const load = async (width, height, dpr) => {
      await session.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: dpr,
        mobile: false,
      });
      await session.send("Page.navigate", { url: base });
      for (let attempt = 0; attempt < 120; attempt += 1) {
        try {
          if (await session.eval('document.readyState === "complete" && !!document.querySelector("main li")')) break;
        } catch {
          /* navigating */
        }
        await sleep(250);
      }
      await session.eval("document.fonts.ready.then(() => true)");
      await sleep(700);
    };

    const capture = async (name, clip, scale) => {
      const shot = await session.send("Page.captureScreenshot", {
        format: "png",
        clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale },
      });
      shots[name] = shot.data;
      return shot.data;
    };

    /* ------------------------------------------------------------- the ring */

    await load(1280, 900, 1);
    const ring = await inPage(session, readCardRing);
    if (!ring) throw new Error("the card's ring did not render");

    console.log(`\nring — the card at 1280×900, seeded ${REMAINING_MIN}/${source.focusMinutes} min\n`);

    same("ring/tick-count", ring.angles.length, tickCount);
    same("ring/major-every", ring.major.filter(Boolean).length, Math.floor(tickCount / 5));

    const angleDrift = ring.angles.map((angle, index) => Math.abs(angle - (90 + (index + 1) * step)));
    const worstAngle = Math.max(...angleDrift);
    const worstIndex = angleDrift.indexOf(worstAngle);
    record(
      "ring/tick-angles",
      worstAngle <= 0.05,
      `${tickCount} marks at ${fmt(step)}° steps; worst Δ ${fmt(worstAngle)}° at mark ${worstIndex + 1} ` +
        `(${fmt(ring.angles[worstIndex])}°, expected ${fmt(90 + (worstIndex + 1) * step)}°)`,
    );

    const litIndices = ring.active.map((active, index) => (active ? index : -1)).filter((i) => i >= 0);
    near("ring/arc-progress", ring.progress, expectedProgress, 0.01);
    record(
      "ring/lit-marks",
      litIndices.length === litTicks &&
        litIndices.every((index) => index < litTicks) &&
        ring.active.slice(litTicks).every((active) => !active),
      `${litIndices.length} lit (${litIndices.map((i) => i + 1).join(",")}), expected the first ${litTicks}`,
    );
    same("ring/clock", ring.clock, `${REMAINING_MIN}:00`);

    const expectedScreen = Array.from(
      { length: tickCount },
      (_, index) => ((index + 1) / tickCount) * 360,
    );
    const ringClip = ring.box;
    const ringShot = await capture("card.png", ringClip, 2);
    const ringPixels = await inPage(session, measurePixels, {
      kind: "ring",
      shot: ringShot,
      size: ring.size,
      angles: expectedScreen,
      marks: ring.shafts.map((shaft, index) => ({ ...shaft, angle: expectedScreen[index] })),
      tickInner: ring.tickInner,
      tickOuter: ring.tickOuter,
      arcInner: ring.arcR - ring.arcW / 2 + 1.5,
      arcOuter: ring.arcR + ring.arcW / 2 - 1.5,
      arcThreshold: 60,
    });
    const angular = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
    if (process.env.DEBUG) {
      console.log(
        `  debug marks: ${ringPixels.marks.map((mark) => `${fmt(mark.deg, 1)}°/${mark.luma}`).join(" ")}`,
      );
    }
    const markMisses = ringPixels.marks.map((mark, index) =>
      angular(mark.deg, expectedScreen[index]),
    );
    const worstMark = Math.max(...markMisses);
    record(
      "ring/pixel-angles",
      worstMark <= 2 && ringPixels.marks.every((mark) => mark.luma > 33),
      `${ringPixels.marks.length} marks found, worst Δ ${fmt(worstMark)}° from the ${tickCount} ` +
        `expected positions, faintest ${Math.min(...ringPixels.marks.map((mark) => mark.luma))} luma`,
    );

    const markLit = ringPixels.marks.map((mark) => mark.luma);
    const median = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    const litMedian = median(markLit.slice(0, litTicks));
    const darkMedian = median(markLit.slice(litTicks));
    record(
      "ring/pixel-lit",
      litMedian - darkMedian >= 25,
      `lit marks median ${litMedian} luma, unlit median ${darkMedian} luma ` +
        `(first ${litTicks} vs the last ${markLit.length - litTicks})`,
    );

    const lastLitAngle = litTicks * step;
    record(
      "ring/arc-ends-on-the-tip",
      angular(ringPixels.arcEnd, lastLitAngle) <= 4,
      `arc ends at ${fmt(ringPixels.arcEnd)}°, last lit mark at ${fmt(lastLitAngle)}°`,
    );

    /* ------------------------------------------------- the moon and the strip */

    /** Opens the room at a viewport, and waits for it to have settled. */
    const openRoom = async (width, height, dpr) => {
      await load(width, height, dpr);
      const opened = await session.eval(`(() => {
        const button = [...document.querySelectorAll("main button")].find((element) =>
          (element.getAttribute("aria-label") || "").startsWith("Enter focus mode"),
        );
        if (button) button.click();
        return Boolean(button);
      })()`);
      if (!opened) throw new Error('no "Enter focus mode" button on the page');
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (await session.eval(`!!document.querySelector(${JSON.stringify(DIALOG)})`)) break;
        await sleep(250);
      }
      await session.eval("document.fonts.ready.then(() => true)");
      await sleep(1500);
    };
    const loadPhone = () => openRoom(390, 844, 3);

    await loadPhone();
    const room = await inPage(session, readFocusRoom);
    if (!room) throw new Error("Focus Mode did not open");
    const dial = room.dial;
    const moon = room.moon;
    const strip = room.strip;

    console.log(`\nmoon & strip — Focus Mode at 390×844\n`);

    same("dial/tick-count", dial.angles.length, tickCount);
    const dialAngleDrift = dial.angles.map((angle, index) => Math.abs(angle - (90 + (index + 1) * step)));
    const worstDialAngle = Math.max(...dialAngleDrift);
    record(
      "dial/tick-angles",
      worstDialAngle <= 0.05,
      `${dial.angles.length} marks; worst Δ ${fmt(worstDialAngle)}°`,
    );
    same("dial/lit-marks", dial.active, litTicks);
    near("dial/arc-progress", dial.progress, expectedProgress, 0.02);

    const darkRgb = [1, 3, 5].map((start) => Number.parseInt(source.moonDark.slice(start, start + 2), 16));
    same("moon/disc-fill", moon.fill, `rgb(${darkRgb.join(", ")})`);
    same("moon/light-x", moon.light?.x, source.light.x);
    same("moon/light-y", moon.light?.y, source.light.y);

    const moonProgress = dial.progress;
    const moonLit = source.minLit + (1 - source.minLit) * moonProgress;
    /*
     * The lit region's terminator: an ellipse through both poles whose waist is
     * `|2k − 1|` of the radius, drawn as a fraction of the radius in the DOM.
     */
    const wantWaist = Math.abs(2 * moonLit - 1) * 0.5;
    near("moon/terminator-waist", moon.phase.rx, wantWaist, 0.002);
    same(
      "moon/terminator-side",
      moon.phase.sweep,
      moonLit >= 0.5 ? 0 : 1,
    );
    near("moon/terminator-angle", moon.phase.angle, axisAngle, 0.05, "°");
    record(
      "moon/clip-applied",
      /url\(/.test(moon.phase.clip || "") && /A 0\.5 0\.5/.test(moon.phase.path),
      `light layer clip ${moon.phase.clip}, path “${moon.phase.path}”`,
    );
    record(
      "moon/terminator-band",
      terminatorAngle >= 52 && terminatorAngle <= 65,
      `terminator ${fmt(terminatorAngle)}° from the horizontal, documented band 52–65°`,
    );

    /*
     * The surface: the photograph, and the four numbers the treatment is set
     * by. These are read off the *lit layer's own surface*, not off the disc, so
     * a texture that failed to apply cannot pass on the night layer's fill.
     */
    same(
      "moon/parts",
      moon.parts.join(","),
      "disc,night,lit,surface,shade,scrim",
    );
    record(
      "moon/texture-url",
      Boolean(moon.texture.url && moon.texture.url.endsWith(source.textureUrl)),
      `lit surface paints ${JSON.stringify(moon.texture.url)}, expected …${source.textureUrl}`,
    );
    const surfaceFilter = moon.texture.filter || "";
    const brightness = Number(/brightness\(([\d.]+)\)/.exec(surfaceFilter)?.[1]);
    const contrast = Number(/contrast\(([\d.]+)\)/.exec(surfaceFilter)?.[1]);
    near("moon/surface-brightness", brightness, source.surface.brightness, 0.001);
    near("moon/surface-contrast", contrast, source.surface.contrast, 0.001);
    near("moon/night-opacity", Number(moon.texture.night), source.surface.nightOpacity, 0.001);
    /*
     * And the mask that makes the night a surface lit by a second source rather
     * than one alpha over the whole half: a radial ramp about the disc's centre
     * (the sub-Earth point) ending at `MOON_NIGHT_FALLOFF`. Read off the DOM, so
     * a night layer that lost the mask — or kept the shape with the depth edited
     * in place — fails here rather than looking subtly flat in review.
     */
    const nightMask = moon.texture.nightMask || "";
    /*
     * The stops, not the prefix: browsers serialise a radial gradient's default
     * shape keyword differently, and the claim here is the ramp — four stops
     * that only ever come down, ending at the limb on the configured depth.
     */
    const maskStops = [...nightMask.matchAll(/(rgba?\(255, 255, 255[^)]*\))\s*([\d.]+)%/g)].map(
      (match) => ({
        alpha: match[1].startsWith("rgba(")
          ? Number(match[1].slice(0, -1).split(",").pop())
          : 1,
        at: Number(match[2]),
      }),
    );
    const maskRamp =
      maskStops.length === 4 &&
      maskStops.every((stop, index) => index === 0 || stop.alpha <= maskStops[index - 1].alpha) &&
      maskStops[3].at >= 90;
    record(
      "moon/night-falloff",
      nightMask !== "none" &&
        maskRamp &&
        Math.abs(maskStops[3].alpha - source.surface.nightFalloff) <= 0.005,
      nightMask === "none"
        ? "the night layer carries no mask — one flat exposure from terminator to limb"
        : `night mask ${maskStops
            .map((stop) => `${fmt(stop.alpha, 2)}@${fmt(stop.at, 0)}%`)
            .join(" ")} (a monotone ramp ending at ${fmt(
            source.surface.nightFalloff * 100,
            0,
          )}% of the middle's exposure)`,
    );
    near("moon/scrim-opacity", moon.texture.scrimCentre, source.surface.scrim, 0.002);
    near("moon/limb-shade", moon.texture.limbShade, source.surface.limb, 0.002);
    record(
      "moon/shade-clipped",
      moon.texture.shadeClipped,
      `the far-limb shade ${moon.texture.shadeClipped ? "is" : "is not"} inside the clipped lit layer`,
    );
    record(
      "moon/texture-painted",
      moon.texture.painted,
      `lit surface background ${moon.texture.painted ? "is" : "is not"} painted`,
    );

    /*
     * The asset itself, fetched by the page: a URL in a style is not an image.
     * The disc is square, opaque inside its own limb and at least 768px across
     * so the 300px phone disc is still oversampled on a 3× screen.
     */
    const asset = await session.eval(`(async () => {
      const response = await fetch(${JSON.stringify(source.textureUrl)});
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      /*
       * The disc's two polar caps, before the room's own dim. The first source
       * map this asset was built from carried 96 pure-black rows along its
       * bottom edge; those rows are the map's south pole, so the projection
       * painted them as a black cap across the very bottom of the moon — a
       * fault no geometry check can see, because the shape was right and only
       * the photograph was missing.
       *
       * Measured as the mean of the fully opaque pixels in the outer 4% of the
       * disc's height at each pole, at the asset's own resolution. The cap is an
       * area, not a point: the limb itself is antialiased against the sky, and
       * a 64px downsample blends the cap into the rows above it. A band edge at
       * 0.96 samples latitude −74°, which is where the letterbox rows began, so
       * a black cap reads 0 here and the surface reads about 200.
       */
      const probe = document.createElement("canvas");
      probe.width = bitmap.width;
      probe.height = bitmap.height;
      const context = probe.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
      const cap = (from, to) => {
        let sum = 0;
        let n = 0;
        const start = Math.round(((from + 1) / 2) * probe.height);
        const end = Math.round(((to + 1) / 2) * probe.height);
        for (let y = start; y < end; y += 1) {
          for (let x = 0; x < probe.width; x += 1) {
            const i = (y * probe.width + x) * 4;
            if (pixels[i + 3] !== 255) continue;
            sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
            n += 1;
          }
        }
        return n ? sum / n : 0;
      };
      return {
        status: response.status,
        type: response.headers.get("content-type"),
        bytes: blob.size,
        width: bitmap.width,
        height: bitmap.height,
        north: cap(-1, -0.96),
        south: cap(0.96, 1),
      };
    })()`);
    record(
      "moon/texture-asset",
      asset.status === 200 &&
        /image\/webp/.test(asset.type || "") &&
        asset.width === asset.height &&
        asset.width >= 768,
      `${asset.status} ${asset.type}, ${fmt(asset.bytes / 1024, 1)} KB, ${asset.width}×${asset.height}`,
    );
    record(
      "moon/texture-caps",
      asset.north >= 40 && asset.south >= 40,
      `polar caps: north ${fmt(asset.north, 1)} luma, south ${fmt(asset.south, 1)} luma (a letterboxed south edge reads 0)`,
    );

    if (!moon.box) throw new Error("the moon's disc did not render");
    const moonShot = await capture("moon.png", moon.box, 2);
    const moonPixels = await inPage(session, measurePixels, {
      kind: "moon",
      shot: moonShot,
      light: source.light,
    });
    atLeast("moon/lit-side-above-night", moonPixels.litSide - moonPixels.nightSide, 4, " luma");
    /*
     * Earthshine, not a hole. The floor is what the last build failed: at 5%
     * the night side sat at 26 and its own terrain flattened into the screen's
     * black point. The ceiling is what keeps it shadow — the unlit half is the
     * room's darkest large surface after the sky, and it must not become a
     * second lamp behind the reading. 28–44 holds both, and the terrain check
     * below says the surface inside that band is still a photograph.
     */
    record(
      "moon/night-side-earthshine",
      moonPixels.nightSide >= 28 && moonPixels.nightSide <= 44,
      `night side ${fmt(moonPixels.nightSide, 1)} luma (28–44), lit side ${fmt(moonPixels.litSide, 1)}`,
    );
    record(
      "moon/night-side-terrain",
      moonPixels.nightRms >= 0.36,
      `unlit half local rms ${fmt(moonPixels.nightRms, 2)} luma (the 5% night read 0.27; a flat fill is 0), p05–p95 ${fmt(moonPixels.nightSpread, 1)}`,
    );
    /*
     * And it is not one exposure. Earth is in the viewer's direction, so the
     * unlit half is a sphere lit head-on: brightest where the ground faces the
     * viewer, dimmer at the limb where it turns away. The floor is the fade
     * this pass added (`MOON_NIGHT_FALLOFF`); the ceiling keeps it a fade and
     * not a second terminator, and `nightFar` has to stay earthlit, not black.
     */
    record(
      "moon/night-side-fade",
      moonPixels.nightNear - moonPixels.nightFar >= 3 &&
        moonPixels.nightNear - moonPixels.nightFar <= 14 &&
        moonPixels.nightFar >= 24,
      `earthshine ${fmt(moonPixels.nightNear, 1)} luma at 0.56R → ${fmt(moonPixels.nightFar, 1)} at 0.86R ` +
        `(fade ${fmt(moonPixels.nightNear - moonPixels.nightFar, 1)}; needs a 3–14 luma fall and an earthlit far end, not the 21 fill)`,
    );
    atLeast("moon/light-from-the-left", moonPixels.litLimb - moonPixels.nightLimb, 3, " luma");
    record(
      "moon/past-centre-dark",
      moonPixels.litPastCentre - moonPixels.nightSide <= 9,
      `pole line ${fmt(moonPixels.litPastCentre, 1)} luma, night side ${fmt(moonPixels.nightSide, 1)} (crescent: both dark; the glow is not a phase)`,
    );

    /*
     * And the surface those numbers add up to. `textureRms` is the one that
     * cannot be satisfied by a flat fill: it measures the terrain itself, after
     * the sphere's broad shading is subtracted out per pixel.
     */
    const surfacePixels = await inPage(session, measurePixels, {
      kind: "surface",
      shot: moonShot,
      light: source.light,
      lit: moonLit,
    });
    /*
     * The phone capture is the *level* check, not the texture one: at the 3×
     * device pixel ratio the browser's gradient dithering sits at about the size
     * of the albedo's own fine detail (a 230px disc is 1380px of screenshot), so
     * a local-RMS reading there cannot tell a photograph from a flat fill. The
     * desktop pass below is the one that measures terrain.
     */
    record(
      "moon/surface-level",
      surfacePixels.median >= 75 && surfacePixels.p95 <= 150,
      `median ${fmt(surfacePixels.median, 1)} luma, p05 ${fmt(surfacePixels.p05, 1)}, p95 ${fmt(surfacePixels.p95, 1)}`,
    );
    atLeast(
      "moon/limb-falloff",
      surfacePixels.limbFalloff,
      5,
      " luma (night side, 0.68R − 0.92R)",
    );

    same("strip/count", strip.count, source.cycle);
    same(
      "strip/label",
      strip.label,
      `${SESSIONS} of ${source.cycle} focus sessions completed`,
    );
    const rotations = strip.glyphs.flatMap((glyph) => glyph.rotations);
    const worstRotation = rotations.reduce(
      (worst, angle) => Math.max(worst, Math.abs(angle - axisAngle)),
      0,
    );
    record(
      "strip/terminator-angles",
      rotations.length === strip.glyphs.length * 2 && worstRotation <= 0.05,
      `${rotations.length} masks at the night axis; worst Δ ${fmt(worstRotation)}°`,
    );

    const wantWaists = strip.glyphs.map((_, index) => Math.abs(2 * ((index + 1) / source.cycle) - 1) * 10);
    const waistDrift = strip.glyphs.reduce(
      (worst, glyph, index) => Math.max(worst, Math.abs(glyph.rx - wantWaists[index])),
      0,
    );
    record(
      "strip/terminator-waists",
      waistDrift <= 0.01,
      `rx ${strip.glyphs.map((glyph) => fmt(glyph.rx)).join(", ")}, expected ${wantWaists.map((w) => fmt(w)).join(", ")}`,
    );
    record(
      "strip/glyph-height",
      strip.glyphs.every((glyph) => Math.abs(glyph.ry - 10) <= 0.01),
      `every ellipse ry ${fmt(strip.glyphs[0]?.ry)} (the disc's radius)`,
    );

    if (!strip.box) throw new Error("the phase strip did not render");
    const stripShot = await capture("strip.png", strip.box, 3);
    const stripPixels = await inPage(session, measurePixels, {
      kind: "strip",
      shot: stripShot,
      clip: strip.box,
      darkLuma: hexLuma(source.moonGlyph),
      glyphs: strip.glyphs.map((glyph) => ({
        x: glyph.box.x,
        y: glyph.box.y,
        w: glyph.box.w,
        h: glyph.box.h,
      })),
    });

    stripPixels.forEach((glyph, index) => {
      const want = (index + 1) / source.cycle;
      /* Antialiasing along the limb is worth about a twentieth of the disc. */
      near(`strip/lit-fraction-${index + 1}`, glyph.litFraction, want, 0.05);
    });
    stripPixels.slice(0, source.cycle - 1).forEach((glyph, index) => {
      near(`strip/unlit-luma-${index + 1}`, glyph.darkLuma, hexLuma(source.moonGlyph), 4, " luma");
      record(
        `strip/unlit-hue-${index + 1}`,
        glyph.darkSpread <= 4,
        `channel spread ${glyph.darkSpread}, expected ≤ 4 (hue-less)`,
      );
    });
    atLeast("strip/banked-warmth", stripPixels[0].litWarmth, 30, " r−b");
    const pendingWarmth = stripPixels[source.cycle - 1].litWarmth;
    record(
      "strip/pending-neutral",
      Number.isFinite(pendingWarmth) && Math.abs(pendingWarmth) <= 15,
      `full moon's lit side r−b ${pendingWarmth}`,
    );
    /*
     * The row stands at the session the eyebrow names: with two banked, the
     * third — in progress — is already lit. A row that lit only banked sessions
     * read one session behind for the whole period, which is what it used to do;
     * this counts the glyphs whose lit side is warm, so the off-by-one fails here
     * rather than only on a screenshot.
     */
    const warmGlyphs = stripPixels.filter(
      (glyph) => glyph.litWarmth !== null && glyph.litWarmth >= 30,
    ).length;
    same("strip/lit-through-current", warmGlyphs, Math.min(SESSIONS + 1, source.cycle));

    /*
     * The room where the column is taller than the stage it sits in.
     *
     * Focus Mode never scrolls, so the dial is sized from the room the stage can
     * give it (`useRingSize`) — and when even the dial's floor will not fit, the
     * centred column overflows *upward*, out of the stage and into the top bar.
     * That is the failure this reads for: the title block's top against the bar's
     * bottom, on the stages where there is nothing to spare. It must clear, and
     * the dial, the gap and the overflow are printed beside it so a clearance
     * bought with a dial nobody can read is visible in the numbers.
     */
    console.log(`\nstage — the title's clearance under the top bar\n`);
    for (const [width, height] of SHORT_STAGES) {
      await openRoom(width, height, 1);
      const fit = await inPage(session, readRoomClearance);
      if (!fit) throw new Error(`the room did not render at ${width}×${height}`);
      record(
        `stage/clearance-${width}x${height}`,
        fit.clearance >= 0,
        `title block ${fmt(fit.clearance)}px below the top bar ` +
          `(stage ${fmt(fit.stageHeight, 0)}px, gap ${fmt(fit.gap, 0)}, dial ${fmt(fit.dial, 0)}px, ` +
          `overflow ${fmt(fit.overflow, 0)}px) at ${width}×${height}`,
      );
    }

    /*
     * The night side on the largest instrument, on the same crescent the phone
     * is measured on. The earthshine fade is a property of the unlit face, and
     * its 0.56R probe stops being inside that face before the gibbous phase used
     * for the desktop surface pass: at 80% lit the terminator is already 0.6R
     * across the axis, so 0.56R reads lit surface (63 luma against the night's
     * 37). Read it here, before the gibbous seed, with the phone's
     * own sampler and thresholds — the fade is one claim at two sizes.
     */
    await openRoom(1280, 900, 2);
    const wideNight = await inPage(session, readFocusRoom);
    if (!wideNight?.moon.box) throw new Error("the desktop moon did not render for the night check");
    console.log(`\nmoon — desktop night side, ring ${fmt(wideNight.dial.box.w, 0)}px\n`);
    const wideNightShot = await capture("moon-desktop-night.png", wideNight.moon.box, 2);
    const wideNightPixels = await inPage(session, measurePixels, {
      kind: "moon",
      shot: wideNightShot,
      light: source.light,
    });
    record(
      "desktop/night-side-earthshine",
      wideNightPixels.nightSide >= 28 && wideNightPixels.nightSide <= 44,
      `night side ${fmt(wideNightPixels.nightSide, 1)} luma (28–44), lit side ${fmt(wideNightPixels.litSide, 1)}`,
    );
    record(
      "desktop/night-side-fade",
      wideNightPixels.nightNear - wideNightPixels.nightFar >= 3 &&
        wideNightPixels.nightNear - wideNightPixels.nightFar <= 14 &&
        wideNightPixels.nightFar >= 24,
      `earthshine ${fmt(wideNightPixels.nightNear, 1)} luma at 0.56R → ${fmt(wideNightPixels.nightFar, 1)} at 0.86R ` +
        `(fade ${fmt(wideNightPixels.nightNear - wideNightPixels.nightFar, 1)}), ` +
        `${fmt(wideNight.moon.box.w, 0)}px disc`,
    );

    /*
     * The gibbous half of the session, where the old offset-disc construction
     * failed: a second disc's edge cannot bow the right way past half, so it
     * drew a lens instead of a moon. Seed a session four fifths run and read
     * the same path back, then sample the pixels around its waist.
     */
    const gibbousRemaining = 5;
    const gibbousTimer = {
      ...timer,
      state: { ...timer.state, remainingMs: gibbousRemaining * 60_000 },
    };
    await session.send("Page.removeScriptToEvaluateOnNewDocument", {
      identifier: seed.identifier,
    });
    await session.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try {
        localStorage.setItem(${JSON.stringify(TIMER_KEY)}, ${JSON.stringify(JSON.stringify(gibbousTimer))});
      } catch {}`,
    });
    await loadPhone();
    const gibbous = await inPage(session, readFocusRoom);
    if (!gibbous) throw new Error("Focus Mode did not reopen for the gibbous check");
    const gibbousProgress = 1 - gibbousRemaining / source.focusMinutes;
    const gibbousLit = source.minLit + (1 - source.minLit) * gibbousProgress;
    console.log(`\nmoon — gibbous, ${gibbousRemaining}/${source.focusMinutes} min remaining\n`);
    near(
      "moon-gibbous/terminator-waist",
      gibbous.moon.phase.rx,
      Math.abs(2 * gibbousLit - 1) * 0.5,
      0.002,
    );
    same("moon-gibbous/terminator-side", gibbous.moon.phase.sweep, 0);
    near("moon-gibbous/terminator-angle", gibbous.moon.phase.angle, axisAngle, 0.05, "°");
    record(
      "moon-gibbous/clip-applied",
      /url\(/.test(gibbous.moon.phase.clip || "") && /A 0\.5 0\.5/.test(gibbous.moon.phase.path),
      `light layer clip ${gibbous.moon.phase.clip}`,
    );

    if (!gibbous.moon.box) throw new Error("the gibbous moon's disc did not render");
    const gibbousShot = await capture("moon-gibbous.png", gibbous.moon.box, 2);
    const gibbousPixels = await inPage(session, measurePixels, {
      kind: "moon",
      shot: gibbousShot,
      light: source.light,
    });
    atLeast(
      "moon-gibbous/lit-side-above-night",
      gibbousPixels.litSide - gibbousPixels.nightSide,
      4,
      " luma",
    );
    record(
      "moon-gibbous/night-side-earthshine",
      gibbousPixels.nightSide >= 28 && gibbousPixels.nightSide <= 44,
      `night side ${fmt(gibbousPixels.nightSide, 1)} luma (28–44), lit side ${fmt(gibbousPixels.litSide, 1)}`,
    );
    atLeast(
      "moon-gibbous/light-from-the-left",
      gibbousPixels.litLimb - gibbousPixels.nightLimb,
      3,
      " luma",
    );
    atLeast(
      "moon-gibbous/past-centre-lit",
      gibbousPixels.litPastCentre - gibbousPixels.nightSide,
      5,
      " luma",
    );

    /*
     * The same disc at the largest size the room draws — the ring's own cap, 384,
     * which is the desktop instrument and a 322px disc. The surface has to hold at
     * both ends: a texture that reads at 230px (the phone's disc) must not alias
     * at 322, and the clock's scrim must still hold the reading at a disc where
     * the type is a fifth of it. The phase is the seeded gibbous, so the clock
     * sits on lit surface rather than near a terminator.
     */
    await openRoom(1280, 900, 2);
    const wide = await inPage(session, readFocusRoom);
    if (!wide?.moon.box) throw new Error("the desktop moon did not render");
    console.log(`\nmoon — desktop, ring ${fmt(wide.dial.box.w, 0)}px\n`);
    near(
      "desktop/disc-size",
      wide.moon.box.w,
      wide.dial.box.w * (1 - 2 * source.moonInset),
      3,
      "px",
    );
    const wideShot = await capture("moon-desktop.png", wide.moon.box, 2);
    const wideSurface = await inPage(session, measurePixels, {
      kind: "surface",
      shot: wideShot,
      light: source.light,
      lit: gibbousLit,
    });
    const wideClock = await inPage(session, measurePixels, { kind: "clock", shot: wideShot });
    atLeast("desktop/surface-texture", wideSurface.textureRms, 1, " luma rms");
    record(
      "desktop/surface-level",
      wideSurface.median >= 75 && wideSurface.p95 <= 150,
      `median ${fmt(wideSurface.median, 1)} luma, p05 ${fmt(wideSurface.p05, 1)}, p95 ${fmt(wideSurface.p95, 1)}`,
    );
    atLeast(
      "desktop/limb-falloff",
      wideSurface.limbFalloff,
      5,
      " luma (night side, 0.68R − 0.92R)",
    );
    record(
      "desktop/clock-contrast",
      wideClock.contrast >= 7,
      `${fmt(wideClock.contrast, 2)}:1 — type ${fmt(wideClock.type, 1)} luma over ` +
        `scrimmed surface ${fmt(wideClock.background, 1)} luma, four fifths lit`,
    );

    /* The cycle reads its own pixels at the phone's size, the one people use. */
    await loadPhone();

    /*
     * ------------------------------------------------------ the full cycle
     *
     * The cycle is the moon's animation, and its two directions have to be one
     * motion: focus fills the disc from the light's side, and the break drains
     * it from that same side — not from the opposite limb. Sampling one focus
     * phase cannot see that, and a fresh page load cannot either: opening Focus
     * Mode always starts a focus session, so a break is only ever on screen in a
     * room that was already open. So this drives the room's own Reset and Start
     * controls and moves the clock the store reads, taking the cycle through
     * dark → waxing → full → waning → dark and back to focus.
     *
     * The break is where the hand-off happens. At 40% lit a focus moon is a left
     * crescent; the same phase in a break must be its point reflection — a right
     * crescent with the darkness on the left — or the darkening started from the
     * wrong limb. That is the regression this check exists for.
     */
    console.log(`\ncycle — focus → break → focus\n`);

    const clickRoom = async (label) => {
      const clicked = await session.eval(`(() => {
        const button = [...document.querySelectorAll(${JSON.stringify(DIALOG)} + " button")]
          .find((element) => element.getAttribute("aria-label") === ${JSON.stringify(label)});
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (!clicked) throw new Error(`the Focus Mode room has no “${label}” button`);
      await sleep(350);
    };

    /*
     * The store's clock is `endsAt - Date.now()`, so the cycle can be moved
     * without waiting: shift the page's `Date.now` and let the engine's own
     * 200ms tick read the new time. The shift is restored between phases, so
     * every `start()` arms from real time.
     */
    const moveClock = async (ms) => {
      await session.eval(`(() => {
        window.__verifyRealNow ||= Date.now;
        Date.now = () => window.__verifyRealNow() + ${ms};
        return true;
      })()`);
      /* One tick (200ms) is all the engine needs to see the jump. */
      await sleep(450);
    };

    const readCycle = async (name) => {
      const roomNow = await inPage(session, readFocusRoom);
      if (!roomNow?.moon.box) throw new Error(`the cycle's ${name} moon did not render`);
      /* A paint is always a frame behind the DOM read; take the shot after two. */
      await session.eval(
        "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
      );
      const shot = await capture(`${name}.png`, roomNow.moon.box, 2);
      const pixels = await inPage(session, measurePixels, {
        kind: "moon",
        shot,
        light: source.light,
      });
      return {
        phase: roomNow.moon.phase,
        light: roomNow.moon.light,
        rim: roomNow.moon.rim,
        dial: roomNow.dial,
        pixels,
        shot,
      };
    };

    /*
     * The lit fraction the path encodes. The waist alone is symmetric about
     * half, so the sweep flag says which side of it the light is on. At zero the
     * terminator is the diameter and its ellipse is cut out of the lit half; at
     * full it is let out to the whole disc.
     */
    const litOf = (phase) => (phase.sweep === 1 ? 0.5 - phase.rx : 0.5 + phase.rx);

    /* 1. The dark face the cycle opens on. */
    await clickRoom("Reset current session");
    await sleep(450);
    const focusStart = await readCycle("cycle-focus-start");
    near("cycle/focus-start-lit", litOf(focusStart.phase), 0, 0.01);
    same("cycle/focus-start-side", focusStart.phase.sweep, 1);
    near("cycle/focus-start-angle", focusStart.phase.angle, axisAngle, 0.05, "°");
    record(
      "cycle/focus-start-dark",
      focusStart.pixels.litSide <= 52 && focusStart.pixels.nightSide <= 46,
      `lit side ${fmt(focusStart.pixels.litSide, 1)} luma, night side ${fmt(focusStart.pixels.nightSide, 1)} ` +
        `(earthlit surface varies a few luma across the disc, so both are ceilings)`,
    );

    /* 2. Ten minutes in: the light has entered from the left. */
    await clickRoom("Start timer");
    /*
     * Three minutes in, before the ten-minute read: the thinnest crescent the
     * cycle shows, and the only phase where the terminator sits far enough from
     * the clock (0.76R) for a chord across it to be a chord of the surface. The
     * tween that carries the phase out from zero has to have finished, hence the
     * wait — a capture taken mid-hand-off measures two phases at once.
     */
    await moveClock(3 * 60_000);
    await sleep(1500);
    const thin = await readCycle("cycle-terminator-thin");
    const thinLit = thin.dial.progress;
    const chords = (thin.pixels.terminator ?? []).filter(Boolean);
    const uAt = (v) => chords.find((row) => Math.abs(row.v - v) < 1e-6)?.u ?? null;
    const ellipseU = (v) => Math.abs(2 * thinLit - 1) * Math.sqrt(1 - v * v);
    const centreU = uAt(0);
    const poleUs = [uAt(-0.55), uAt(0.55)];
    const pull = poleUs.map((u) => (Number.isFinite(u) ? centreU - u : NaN));
    console.log(
      `\nterminator curve at ${fmt(thinLit * 100, 0)}% lit — ` +
        chords.map((row) => `v ${fmt(row.v, 2)}: ${fmt(row.u, 3)}`).join(" · "),
    );
    record(
      "moon/terminator-curves-toward-the-poles",
      Number.isFinite(centreU) &&
        pull.every((drop) => Number.isFinite(drop) && drop >= 0.05),
      `${chords.length}/5 chords; radius ${fmt(centreU, 3)} at v=0, ` +
        `pull ${pull.map((drop) => fmt(drop, 3)).join(" / ")} at v=±0.55 ` +
        `(the ellipse pulls ${fmt(
          Math.abs(2 * thinLit - 1) * (1 - Math.sqrt(1 - 0.55 * 0.55)),
          3,
        )}; a straight ramp pulls 0)`,
    );
    record(
      "moon/terminator-follows-the-ellipse",
      Number.isFinite(centreU) &&
        chords.length === 5 &&
        chords.every((row) => Math.abs(row.u - ellipseU(row.v)) <= 0.05),
      chords
        .map(
          (row) =>
            `v ${fmt(row.v, 2)}: ${fmt(row.u, 3)} (ellipse ${fmt(ellipseU(row.v), 3)})`,
        )
        .join(" · "),
    );
    await moveClock(10 * 60_000);
    const waxing = await readCycle("cycle-focus-waxing");
    const waxingLit = waxing.dial.progress;
    near("cycle/focus-waxing-lit", litOf(waxing.phase), waxingLit, 0.01);
    near(
      "cycle/focus-waxing-waist",
      waxing.phase.rx,
      Math.abs(2 * waxingLit - 1) * 0.5,
      0.005,
    );
    same("cycle/focus-waxing-side", waxing.phase.sweep, waxingLit >= 0.5 ? 0 : 1);
    near("cycle/focus-waxing-angle", waxing.phase.angle, axisAngle, 0.05, "°");
    /*
     * The direction is a before/after, not a single frame's two points: the
     * side the light comes from has to gain and the far side has to hold. A
     * phase that filled from the right would be the mirror of this, and a disc
     * that had not changed at all would move neither.
     */
    const waxingNearGain = waxing.pixels.litSide - focusStart.pixels.litSide;
    const waxingFarDrift = Math.abs(waxing.pixels.nightSide - focusStart.pixels.nightSide);
    record(
      "cycle/focus-waxing-light-from-the-left",
      waxingNearGain >= 20 && waxingFarDrift <= 6,
      `lit side ${fmt(focusStart.pixels.litSide, 1)} → ${fmt(waxing.pixels.litSide, 1)} (gain ${fmt(waxingNearGain, 1)}), ` +
        `night side ${fmt(focusStart.pixels.nightSide, 1)} → ${fmt(waxing.pixels.nightSide, 1)} (drift ${fmt(waxingFarDrift, 1)})`,
    );

    /*
     * 3. The hand-off the clock makes on its own: focus reaches zero, the break
     * opens on the full face and waits, and the moon turns its path there. This
     * is the real cycle's turn; a skip from a half-lit focus reaches the same
     * endpoint, but only after its own short tween has carried it there.
     */
    await moveClock(26 * 60_000);
    await sleep(800);
    const breakStart = await readCycle("cycle-break-start");
    near("cycle/break-start-lit", litOf(breakStart.phase), 1, 0.01);
    same("cycle/break-start-side", breakStart.phase.sweep, 0);
    near("cycle/break-start-angle", breakStart.phase.angle, axisAngle + 180, 0.05, "°");
    record(
      "cycle/break-start-full",
      breakStart.pixels.litSide >= 12 && breakStart.pixels.nightSide >= 12,
      `lit side ${fmt(breakStart.pixels.litSide, 1)} luma, night side ${fmt(breakStart.pixels.nightSide, 1)} (both lit)`,
    );
    /*
     * The body's light turns with the phase. The break's lit lune is on the
     * upper-right, so the rim and the limb shade belong there too — the point
     * reflection of the focus moon's. A rim left on the lower-left sits on the
     * half the break has just darkened, where a 2px cream line is the brightest
     * thing on the disc and reads as a scratch beside it rather than its edge.
     */
    record(
      "cycle/break-light-turned",
      breakStart.light?.x === 100 - (moon.light?.x ?? NaN) &&
        breakStart.light?.y === 100 - (moon.light?.y ?? NaN) &&
        breakStart.rim?.x === -(moon.rim?.x ?? NaN) &&
        breakStart.rim?.y === -(moon.rim?.y ?? NaN),
      `the body's light is at ${breakStart.light?.x}% ${breakStart.light?.y}% with its rim at ` +
        `${breakStart.rim?.x}px ${breakStart.rim?.y}px (focus: ${moon.light?.x}% ${moon.light?.y}%, ` +
        `${moon.rim?.x}px ${moon.rim?.y}px)`,
    );
    /*
     * Full moon is the brightest surface the reading ever sits on, so it is where
     * the scrim has to hold the clock's contrast. The bar is 7:1 — WCAG AAA — not
     * the 3:1 a display-size number would technically need, because the reading is
     * the one thing the room exists to show and the scrim is there to buy exactly
     * that margin: the surface dimmed to 0.62 already lands at about 5.6:1 without
     * it, so a 4.5 floor would pass an unshaded full moon and never test the scrim
     * at all (measured, 2026-10-21).
     */
    const clockPixels = await inPage(session, measurePixels, {
      kind: "clock",
      shot: breakStart.shot,
    });
    record(
      "cycle/clock-contrast",
      clockPixels.contrast >= 7,
      `${fmt(clockPixels.contrast, 2)}:1 — type ${fmt(clockPixels.type, 1)} luma over ` +
        `scrimmed surface ${fmt(clockPixels.background, 1)} luma at full moon`,
    );

    /*
     * 4. The same 40% phase, drained. Focus at 40% is a left crescent; its
     * point reflection must be a right crescent, so the left side is the dark
     * one. Both the path's rotation and the pixels have to say so.
     *
     * The clock is put back to real time first: the break's `start()` arms its
     * deadline from whatever `Date.now` says, so starting it while the page is
     * still 26 minutes ahead would arm a deadline the next, smaller shift could
     * not reach.
     */
    await moveClock(0);
    await clickRoom("Start timer");
    await moveClock(3 * 60_000);
    const waning = await readCycle("cycle-break-waning");
    const waningLit = 1 - waning.dial.progress;
    near("cycle/break-waning-lit", litOf(waning.phase), waningLit, 0.01);
    near(
      "cycle/break-waning-waist",
      waning.phase.rx,
      Math.abs(2 * waningLit - 1) * 0.5,
      0.005,
    );
    same("cycle/break-waning-side", waning.phase.sweep, waningLit >= 0.5 ? 0 : 1);
    near("cycle/break-waning-angle", waning.phase.angle, axisAngle + 180, 0.05, "°");
    const waningNearDrop = breakStart.pixels.litSide - waning.pixels.litSide;
    const waningFarDrift = Math.abs(breakStart.pixels.nightSide - waning.pixels.nightSide);
    /*
     * The left starts on the far limb, not on the open lit face: the break's
     * light is the point reflection of focus's, so it comes from the upper
     * right and the lower-left edge is already under the far-limb shade at the
     * full face (52 against the lit 128). The drop is therefore measured from a
     * shaded start — about 17 luma here — and the direction is also carried by
     * the two sides' separation, which only widens as the darkness enters.
     */
    record(
      "cycle/break-waning-dark-from-the-left",
      waningNearDrop >= 10 &&
        waningFarDrift <= 8 &&
        waning.pixels.nightSide - waning.pixels.litSide >= 40,
      `left ${fmt(breakStart.pixels.litSide, 1)} → ${fmt(waning.pixels.litSide, 1)} (drop ${fmt(waningNearDrop, 1)}), ` +
        `right ${fmt(breakStart.pixels.nightSide, 1)} → ${fmt(waning.pixels.nightSide, 1)} (held ${fmt(waningFarDrift, 1)}), ` +
        `gap ${fmt(waning.pixels.nightSide - waning.pixels.litSide, 1)}`,
    );
    near("cycle/same-phase-mirrored-waist", waning.phase.rx, waxing.phase.rx, 0.01);
    near(
      "cycle/darkening-turns-the-path",
      angular(waning.phase.angle, waxing.phase.angle),
      180,
      0.1,
      "°",
    );

    /*
     * 5. The break's dark end, still on the turned path. Leave fifteen seconds,
     * not five: the room takes a moment to read and capture, and a clock that
     * reaches zero here would already be the next focus.
     */
    await moveClock(285_000);
    await sleep(800);
    const breakEnd = await readCycle("cycle-break-end");
    const endLit = 1 - breakEnd.dial.progress;
    near("cycle/break-end-lit", litOf(breakEnd.phase), endLit, 0.01);
    same("cycle/break-end-side", breakEnd.phase.sweep, endLit >= 0.5 ? 0 : 1);
    near("cycle/break-end-angle", breakEnd.phase.angle, axisAngle + 180, 0.05, "°");
    const endNearDrop = breakStart.pixels.litSide - breakEnd.pixels.litSide;
    const endFarDrop = breakStart.pixels.nightSide - breakEnd.pixels.nightSide;
    record(
      "cycle/break-end-dark",
      endNearDrop >= 10 &&
        endFarDrop >= 4 &&
        breakEnd.pixels.litSide <= 56 &&
        breakEnd.pixels.nightSide <= 58,
      `left ${fmt(breakStart.pixels.litSide, 1)} → ${fmt(breakEnd.pixels.litSide, 1)} (drop ${fmt(endNearDrop, 1)}), ` +
        `right ${fmt(breakStart.pixels.nightSide, 1)} → ${fmt(breakEnd.pixels.nightSide, 1)} (drop ${fmt(endFarDrop, 1)}; ` +
        `the right is the last lit lune at 4%, so it ends a step above the left)`,
    );

    /* 6. Zero completes the break on its own and arms the next dark focus. */
    await moveClock(5.1 * 60_000);
    await sleep(800);
    const returned = await readCycle("cycle-focus-return");
    near("cycle/focus-return-lit", litOf(returned.phase), 0, 0.01);
    same("cycle/focus-return-side", returned.phase.sweep, 1);
    near("cycle/focus-return-angle", returned.phase.angle, axisAngle, 0.05, "°");
    record(
      "cycle/focus-return-dark",
      returned.pixels.litSide <= 52 && returned.pixels.nightSide <= 46,
      `lit side ${fmt(returned.pixels.litSide, 1)} luma, night side ${fmt(returned.pixels.nightSide, 1)}`,
    );
    await moveClock(0);

    /*
     * A skip into a break that starts at once is the hand-off's hardest case:
     * the break's first ticks are already pulling the phase down while the moon
     * is still arriving at full. The orientation has to turn there anyway;
     * waiting for `shownLit` to touch 1 never happens, and the break then drains
     * from the focus limb. Run it with motion on, so the hand-off tween is the
     * real one, and assert the turned path after it settles.
     */
    await session.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
    });
    await clickRoom("Start timer");
    await moveClock(10 * 60_000);
    await sleep(1300);
    await clickRoom("Skip to next session");
    await moveClock(0);
    await clickRoom("Start timer");
    await moveClock(3 * 60_000);
    await sleep(2500);
    const skipped = await readCycle("cycle-skip-break");
    const skippedLit = 1 - skipped.dial.progress;
    near("cycle-skip/break-lit", litOf(skipped.phase), skippedLit, 0.05);
    same("cycle-skip/break-side", skipped.phase.sweep, skippedLit >= 0.5 ? 0 : 1);
    near("cycle-skip/break-angle", skipped.phase.angle, axisAngle + 180, 0.05, "°");
    await moveClock(0);
    await session.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });

    report.cycle = {
      focusStart,
      thin,
      waxing,
      breakStart,
      waning,
      breakEnd,
      returned,
      skipped,
    };

    report.room = room;
    report.gibbous = gibbous.moon;
    report.ring = ring;
    report.strip = stripPixels;
  } catch (error) {
    console.log(`FAILED: ${String(error?.stack ?? error?.message ?? error)}`);
    process.exitCode = 1;
  } finally {
    if (session) session.close();
    chrome.kill();
    if (app) app.stop();
    for (const [name, data] of Object.entries(shots)) {
      writeFileSync(join(ARTIFACTS, name), Buffer.from(data, "base64"));
    }
    writeFileSync(
      join(ARTIFACTS, "report.json"),
      JSON.stringify({ source, ...report, results }, null, 2),
    );
    console.log(`\nartifacts: ${ARTIFACTS}`);
  }

  const drifted = results.filter((result) => !result.ok);
  if (drifted.length) {
    console.error(`\n${drifted.length} of ${results.length} measurements drifted:`);
    for (const result of drifted) console.error(`  - ${result.name}: ${result.detail}`);
    process.exitCode = 1;
  } else if (results.length) {
    console.log(`\nall ${results.length} measurements hold`);
  }
}

await main();
