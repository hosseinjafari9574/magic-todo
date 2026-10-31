import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { dayKey } from "@/lib/format";
import { browserStorage, normalizeTodos } from "@/lib/persist";
import type { ActivityMap, NewTaskInput, Settings, Task } from "@/lib/types";
import { uid } from "@/lib/format";

interface TodoState {
  tasks: Task[];
  activity: ActivityMap;
  settings: Settings;

  addTask: (input: NewTaskInput) => Task;
  updateTask: (id: string, patch: Partial<Omit<Task, "id">>) => void;
  toggleTask: (id: string) => void;
  setTaskCompleted: (id: string, completed: boolean) => void;
  deleteTask: (id: string) => void;
  /** Re-insert a previously deleted task (undo). */
  restoreTask: (task: Task) => void;
  clearCompleted: () => void;

  /** A focus session finished — count it overall + per task. */
  registerPomodoro: (taskId: string | null) => void;
  /**
   * Accrue (partial) focus minutes — to today, and to the task they were
   * spent on when the clock is linked to one, so a task's minutes and its
   * session count come from the same run of the clock.
   */
  addFocusMinutes: (minutes: number, taskId?: string | null) => void;

  setSoundEnabled: (enabled: boolean) => void;
}

function bumpDay(activity: ActivityMap, patch: Partial<ActivityMap[string]>): ActivityMap {
  const key = dayKey();
  const current = activity[key] ?? { completed: 0, pomodoros: 0, focusMinutes: 0 };
  return {
    ...activity,
    [key]: {
      completed: current.completed + (patch.completed ?? 0),
      pomodoros: current.pomodoros + (patch.pomodoros ?? 0),
      focusMinutes: current.focusMinutes + (patch.focusMinutes ?? 0),
    },
  };
}

/** Reverse a completion bump (never below zero). */
function unbumpCompletion(activity: ActivityMap): ActivityMap {
  const key = dayKey();
  const current = activity[key];
  if (!current || current.completed <= 0) return activity;
  return {
    ...activity,
    [key]: { ...current, completed: current.completed - 1 },
  };
}

export const useTodoStore = create<TodoState>()(
  persist(
    (set, get) => ({
      tasks: [],
      activity: {},
      settings: { soundEnabled: true },

      addTask: (input) => {
        const title = input.title.trim();
        const task: Task = {
          id: uid(),
          title,
          completed: false,
          priority: input.priority ?? "medium",
          tags: input.tags ?? [],
          createdAt: Date.now(),
          completedAt: null,
          pomodoros: 0,
          focusMinutes: 0,
        };
        set((state) => ({ tasks: [task, ...state.tasks] }));
        return task;
      },

      updateTask: (id, patch) =>
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === id ? { ...task, ...patch } : task,
          ),
        })),

      toggleTask: (id) => {
        const task = get().tasks.find((t) => t.id === id);
        if (!task) return;
        get().setTaskCompleted(id, !task.completed);
      },

      setTaskCompleted: (id, completed) => {
        const task = get().tasks.find((t) => t.id === id);
        if (!task || task.completed === completed) return;
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id
              ? {
                  ...t,
                  completed,
                  completedAt: completed ? Date.now() : null,
                }
              : t,
          ),
          activity: completed
            ? bumpDay(state.activity, { completed: 1 })
            : unbumpCompletion(state.activity),
        }));
      },

      deleteTask: (id) =>
        set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) })),

      restoreTask: (task) =>
        set((state) =>
          state.tasks.some((t) => t.id === task.id)
            ? state
            : { tasks: [...state.tasks, task] },
        ),

      clearCompleted: () =>
        set((state) => ({ tasks: state.tasks.filter((t) => !t.completed) })),

      registerPomodoro: (taskId) =>
        set((state) => ({
          tasks: taskId
            ? state.tasks.map((t) =>
                t.id === taskId ? { ...t, pomodoros: t.pomodoros + 1 } : t,
              )
            : state.tasks,
          activity: bumpDay(state.activity, { pomodoros: 1 }),
        })),

      addFocusMinutes: (minutes, taskId = null) => {
        if (minutes <= 0) return;
        set((state) => ({
          tasks: taskId
            ? state.tasks.map((t) =>
                t.id === taskId
                  ? { ...t, focusMinutes: t.focusMinutes + minutes }
                  : t,
              )
            : state.tasks,
          activity: bumpDay(state.activity, { focusMinutes: minutes }),
        }));
      },

      setSoundEnabled: (enabled) =>
        set((state) => ({ settings: { ...state.settings, soundEnabled: enabled } })),
    }),
    {
      // The key stays frozen for compatibility; upgrades are driven by the
      // payload's `version`. Both hydrate paths run through `normalizeTodos` so
      // an unrecognised stored shape degrades instead of costing the list.
      name: "cadence:todos:v1",
      version: 1,
      skipHydration: true,
      storage: createJSONStorage(browserStorage),
      partialize: (state) => ({
        tasks: state.tasks,
        activity: state.activity,
        settings: state.settings,
      }),
      migrate: (persisted) => normalizeTodos(persisted),
      merge: (persisted, current) => ({
        ...current,
        ...normalizeTodos(persisted),
      }),
    },
  ),
);
