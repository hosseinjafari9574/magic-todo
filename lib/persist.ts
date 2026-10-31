/**
 * Persisted-state normalisation.
 *
 * `localStorage` is the only place MoonFlow keeps user data, which makes it the
 * one place where a shape we no longer recognise can quietly destroy it.
 * zustand's persist middleware only consults `migrate` when the stored payload
 * carries a *numeric* version that differs from the current one: a payload
 * written before versioning existed (no `version` field) is merged verbatim,
 * and a version mismatch with no `migrate` at all is discarded outright.
 *
 * Both paths funnel through the normalisers below, which turn whatever the
 * browser hands back into state the app can actually run on — repairing what
 * is repairable and dropping only entries that carry no information
 * (a task with no title, a day key that isn't a day key).
 */

import type { StateStorage } from "zustand/middleware";

import { TEMPLATE_LIMITS, TIMER_PRESETS } from "@/lib/constants";
import { dayKey, uid } from "@/lib/format";
import type {
  ActivityMap,
  Priority,
  Settings,
  Task,
  TaskTemplate,
  TimerMode,
  TimerPresetId,
} from "@/lib/types";

/**
 * `localStorage` in the browser, and an inert stand-in everywhere else.
 *
 * zustand resolves the storage the moment `createJSONStorage` runs — at module
 * scope, while Next is still prerendering the page — so a bare
 * `() => localStorage` also evaluates Node's global `localStorage`, which
 * exists there but has no file behind it and warns on every access. A storage
 * that quietly holds nothing where there is no `window` keeps that warning out
 * of the build and the server's own log without changing what the browser
 * does: nothing on the server ever reads or writes persisted state, and every
 * store hydrates on the client, after mount (see `app/page.tsx`).
 */
const inertStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export function browserStorage(): StateStorage {
  return typeof window === "undefined" ? inertStorage : window.localStorage;
}

export interface PersistedTodos {
  tasks: Task[];
  activity: ActivityMap;
  settings: Settings;
}

export interface PersistedTemplates {
  templates: TaskTemplate[];
}

export interface PersistedTimer {
  preset: TimerPresetId;
  mode: TimerMode;
  running: boolean;
  endsAt: number | null;
  remainingMs: number;
  sessions: number;
  /** Local day (`YYYY-MM-DD`) the `sessions` count belongs to. */
  cycleDay: string;
  flushedMs: number;
  taskId: string | null;
}

export const DEFAULT_SETTINGS: Settings = { soundEnabled: true };

const PRIORITIES: readonly Priority[] = ["low", "medium", "high"];
const TIMER_MODES: readonly TimerMode[] = ["focus", "short", "long"];
const PRESET_IDS: readonly TimerPresetId[] = ["classic", "deep"];

/** Ceiling for day counters — anything larger is corruption, not a streak. */
const MAX_COUNT = 1_000_000;
const MAX_TAG_LENGTH = 40;
const MAX_TAGS_PER_TASK = 24;
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(
  value: unknown,
  options: readonly T[],
): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

/** Trimmed non-empty string, or `null` when there is nothing usable. */
function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/** String forced under a character cap (already trimmed by `asString`). */
function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Non-negative integer, clamped to a sane ceiling. */
function asCount(value: unknown, fallback = 0): number {
  const n = asFiniteNumber(value);
  if (n === null) return fallback;
  return Math.min(MAX_COUNT, Math.max(0, Math.floor(n)));
}

/** Epoch milliseconds — no ceiling, but never negative or fractional. */
function asEpoch(value: unknown, fallback: number): number {
  const n = asFiniteNumber(value);
  if (n === null || n <= 0) return fallback;
  return Math.floor(n);
}

/** Timestamp duration forced into `[0, max]`. */
function asClampedMs(value: unknown, max: number, fallback: number): number {
  const n = asFiniteNumber(value);
  if (n === null) return fallback;
  return Math.min(max, Math.max(0, Math.round(n)));
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags = new Set<string>();
  for (const raw of value) {
    const tag = asString(raw);
    if (!tag) continue;
    tags.add(tag.length > MAX_TAG_LENGTH ? tag.slice(0, MAX_TAG_LENGTH) : tag);
    if (tags.size >= MAX_TAGS_PER_TASK) break;
  }
  return [...tags];
}

/**
 * Repair a single task. A task survives as long as it still has a title: a
 * missing id is regenerated (nothing durable references a task id), and a
 * missing `createdAt` falls back to the entry's position in the stored array
 * so the user's ordering is preserved rather than collapsed.
 */
export function normalizeTask(
  value: unknown,
  fallbackCreatedAt = Date.now(),
): Task | null {
  if (!isRecord(value)) return null;
  const title = asString(value.title);
  if (!title) return null;
  const completedAt = asFiniteNumber(value.completedAt);
  return {
    id: asString(value.id) ?? uid(),
    title,
    completed: asBoolean(value.completed, false),
    priority: isOneOf(value.priority, PRIORITIES) ? value.priority : "medium",
    tags: normalizeTags(value.tags),
    createdAt: asEpoch(value.createdAt, fallbackCreatedAt),
    completedAt: completedAt !== null && completedAt > 0 ? completedAt : null,
    pomodoros: asCount(value.pomodoros),
    focusMinutes: asCount(value.focusMinutes),
  };
}

export function normalizeActivity(value: unknown): ActivityMap {
  if (!isRecord(value)) return {};
  const activity: ActivityMap = {};
  for (const [key, day] of Object.entries(value)) {
    if (!DAY_KEY_PATTERN.test(key) || !isRecord(day)) continue;
    activity[key] = {
      completed: asCount(day.completed),
      pomodoros: asCount(day.pomodoros),
      focusMinutes: asCount(day.focusMinutes),
    };
  }
  return activity;
}

export function normalizeSettings(value: unknown): Settings {
  return {
    soundEnabled: asBoolean(
      isRecord(value) ? value.soundEnabled : undefined,
      DEFAULT_SETTINGS.soundEnabled,
    ),
  };
}

export function normalizeTodos(value: unknown): PersistedTodos {
  const record = isRecord(value) ? value : {};
  const raw = Array.isArray(record.tasks) ? record.tasks : [];
  const now = Date.now();
  const tasks: Task[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    // Newest first in storage, so count backwards when a stamp is missing.
    const task = normalizeTask(entry, now - index * 1_000);
    // A duplicated id would make one row drive another, so keep the first.
    if (!task || seen.has(task.id)) return;
    seen.add(task.id);
    tasks.push(task);
  });
  return {
    tasks,
    activity: normalizeActivity(record.activity),
    settings: normalizeSettings(record.settings),
  };
}

/**
 * Repair a single routine.
 *
 * A routine survives on its name *and* at least one task title: a named
 * routine with no tasks would be a row that adds nothing when it is clicked,
 * which is the same as carrying no information at all — the rule that already
 * drops a task with no title. Titles survive duplicates (a routine may repeat
 * a task on purpose) but are capped like every other stored string.
 */
export function normalizeTemplate(
  value: unknown,
  fallbackCreatedAt = Date.now(),
): TaskTemplate | null {
  if (!isRecord(value)) return null;
  const name = asString(value.name);
  if (!name) return null;
  const raw = Array.isArray(value.titles) ? value.titles : [];
  const titles: string[] = [];
  for (const entry of raw) {
    const title = asString(entry);
    if (!title) continue;
    titles.push(clip(title, TEMPLATE_LIMITS.title));
    if (titles.length >= TEMPLATE_LIMITS.tasks) break;
  }
  if (titles.length === 0) return null;
  return {
    id: asString(value.id) ?? uid(),
    name: clip(name, TEMPLATE_LIMITS.name),
    titles,
    createdAt: asEpoch(value.createdAt, fallbackCreatedAt),
  };
}

export function normalizeTemplates(value: unknown): PersistedTemplates {
  const record = isRecord(value) ? value : {};
  const raw = Array.isArray(record.templates) ? record.templates : [];
  const now = Date.now();
  const templates: TaskTemplate[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    // Newest first in storage, so count backwards when a stamp is missing.
    const template = normalizeTemplate(entry, now - index * 1_000);
    // A duplicated id would make one row drive another, so keep the first.
    if (!template || seen.has(template.id)) return;
    seen.add(template.id);
    templates.push(template);
  });
  return { templates };
}

export function normalizeTimer(value: unknown): PersistedTimer {
  const record = isRecord(value) ? value : {};
  const preset: TimerPresetId = isOneOf(record.preset, PRESET_IDS)
    ? record.preset
    : "classic";
  const mode: TimerMode = isOneOf(record.mode, TIMER_MODES)
    ? record.mode
    : "focus";
  const presetConfig = TIMER_PRESETS[preset];
  const duration = presetConfig.durations[mode];
  const remainingMs = asClampedMs(record.remainingMs, duration, duration);
  // A running clock with no end stamp can never advance, so read it as paused.
  const endsAt = asFiniteNumber(record.endsAt);
  const running = asBoolean(record.running, false) && endsAt !== null;
  // Nor can more focus time be banked than has actually elapsed this session.
  const elapsed = Math.max(0, duration - remainingMs);
  /*
   * The cycle is one day's work — four sessions buy one long break — so a count
   * banked yesterday must not spend today's fourth session on a break nobody
   * earned. A stored day that is not today therefore starts the count again at
   * zero. A payload written before the day was stored says nothing about when
   * its sessions were banked, so it keeps them and is stamped today: throwing
   * them away could discard a cycle that was in fact mid-flight this morning,
   * and the stamp makes every rollover after this one honest.
   */
  const today = dayKey();
  const storedDay =
    typeof record.cycleDay === "string" && DAY_KEY_PATTERN.test(record.cycleDay)
      ? record.cycleDay
      : null;
  const banked = Math.min(asCount(record.sessions), presetConfig.longBreakAfter);
  return {
    preset,
    mode,
    running,
    endsAt: running ? endsAt : null,
    remainingMs,
    sessions: storedDay === null || storedDay === today ? banked : 0,
    cycleDay: today,
    flushedMs: Math.min(asClampedMs(record.flushedMs, elapsed, 0), elapsed),
    taskId: asString(record.taskId),
  };
}
