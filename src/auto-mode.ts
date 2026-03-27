import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { listTasks } from './state.js';
import type { Task } from './state.js';

// ── Types ──────────────────────────────────────────────────────────

export type AutoModeStatus = 'idle' | 'running' | 'paused' | 'completed' | 'cancelled';

export interface AutoModeBlocker {
  reason: string;
  task_id: string;
  created_at: string;
}

export interface AutoModeState {
  status: AutoModeStatus;
  milestone_id: string;
  slice_id: string;
  task_ids: string[];
  current_index: number;
  completed_count: number;
  blocker: AutoModeBlocker | null;
  created_at: string;
  updated_at: string;
}

// ── Persistence ────────────────────────────────────────────────────

const AUTO_MODE_FILE = 'auto-mode.json';

function getAutoModePath(velaDir: string): string {
  return join(velaDir, 'state', AUTO_MODE_FILE);
}

/**
 * Reads the auto-mode state from disk.
 * Returns null if no state file exists.
 */
export function loadAutoModeState(velaDir: string): AutoModeState | null {
  const filePath = getAutoModePath(velaDir);
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as AutoModeState;
  } catch {
    return null;
  }
}

/**
 * Writes auto-mode state to disk.
 */
export function saveAutoModeState(velaDir: string, state: AutoModeState): void {
  const stateDir = join(velaDir, 'state');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(getAutoModePath(velaDir), JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Removes the auto-mode state file.
 */
export function clearAutoModeState(velaDir: string): void {
  const filePath = getAutoModePath(velaDir);
  if (existsSync(filePath)) {
    const { unlinkSync } = require('fs');
    unlinkSync(filePath);
  }
}

// ── Result types ───────────────────────────────────────────────────

export type AutoModeResult =
  | { ok: true; state: AutoModeState; current_task?: Task }
  | { ok: false; error: string };

// ── Engine functions ───────────────────────────────────────────────

/**
 * Starts auto-mode for a given milestone/slice.
 * Loads pending tasks and begins with the first one.
 */
export function startAutoMode(
  db: Database.Database,
  velaDir: string,
  milestoneId: string,
  sliceId: string,
): AutoModeResult {
  // Check for existing active auto-mode
  const existing = loadAutoModeState(velaDir);
  if (existing && (existing.status === 'running' || existing.status === 'paused')) {
    return { ok: false, error: `Auto-mode is already ${existing.status}. Cancel or complete it first.` };
  }

  // Get tasks for the slice
  const tasks = listTasks(db, { slice_id: sliceId });
  if (tasks.length === 0) {
    return { ok: false, error: `No tasks found for slice "${sliceId}"` };
  }

  // Sort by ID for deterministic order
  const sorted = [...tasks].sort((a, b) => a.id.localeCompare(b.id));
  const pendingTasks = sorted.filter((t) => t.status !== 'completed');

  if (pendingTasks.length === 0) {
    return { ok: false, error: `All tasks in slice "${sliceId}" are already completed` };
  }

  const now = new Date().toISOString();
  const taskIds = sorted.map((t) => t.id);
  const firstPendingIndex = sorted.findIndex((t) => t.status !== 'completed');

  const state: AutoModeState = {
    status: 'running',
    milestone_id: milestoneId,
    slice_id: sliceId,
    task_ids: taskIds,
    current_index: firstPendingIndex,
    completed_count: sorted.filter((t) => t.status === 'completed').length,
    blocker: null,
    created_at: now,
    updated_at: now,
  };

  saveAutoModeState(velaDir, state);

  const currentTask = sorted[firstPendingIndex];
  return { ok: true, state, current_task: currentTask };
}

/**
 * Advances to the next task. Marks auto-mode as completed if no tasks remain.
 */
export function nextTask(
  db: Database.Database,
  velaDir: string,
): AutoModeResult {
  const state = loadAutoModeState(velaDir);
  if (!state) {
    return { ok: false, error: 'No auto-mode session active' };
  }

  if (state.status !== 'running') {
    return { ok: false, error: `Auto-mode is "${state.status}", not running` };
  }

  const now = new Date().toISOString();

  // Move to next task
  const nextIndex = state.current_index + 1;
  state.completed_count += 1;
  state.updated_at = now;

  if (nextIndex >= state.task_ids.length) {
    // All tasks done
    state.status = 'completed';
    state.current_index = state.task_ids.length;
    saveAutoModeState(velaDir, state);
    return { ok: true, state };
  }

  state.current_index = nextIndex;
  saveAutoModeState(velaDir, state);

  // Get the next task from DB
  const tasks = listTasks(db, { slice_id: state.slice_id });
  const sortedTasks = [...tasks].sort((a, b) => a.id.localeCompare(b.id));
  const nextTaskObj = sortedTasks.find((t) => t.id === state.task_ids[nextIndex]);

  return { ok: true, state, current_task: nextTaskObj };
}

/**
 * Returns the current auto-mode status.
 */
export function getAutoStatus(
  db: Database.Database,
  velaDir: string,
): AutoModeResult {
  const state = loadAutoModeState(velaDir);
  if (!state) {
    return { ok: false, error: 'No auto-mode session active' };
  }

  let currentTask: Task | undefined;
  if (state.status === 'running' && state.current_index < state.task_ids.length) {
    const tasks = listTasks(db, { slice_id: state.slice_id });
    const sorted = [...tasks].sort((a, b) => a.id.localeCompare(b.id));
    currentTask = sorted.find((t) => t.id === state.task_ids[state.current_index]);
  }

  return { ok: true, state, current_task: currentTask };
}

/**
 * Pauses auto-mode, optionally recording a blocker reason.
 */
export function pauseAutoMode(
  velaDir: string,
  reason?: string,
): AutoModeResult {
  const state = loadAutoModeState(velaDir);
  if (!state) {
    return { ok: false, error: 'No auto-mode session active' };
  }

  if (state.status !== 'running') {
    return { ok: false, error: `Auto-mode is "${state.status}", not running` };
  }

  const now = new Date().toISOString();
  state.status = 'paused';
  state.updated_at = now;

  if (reason) {
    state.blocker = {
      reason,
      task_id: state.task_ids[state.current_index] ?? '',
      created_at: now,
    };
  }

  saveAutoModeState(velaDir, state);
  return { ok: true, state };
}

/**
 * Resumes a paused auto-mode session.
 */
export function resumeAutoMode(
  velaDir: string,
): AutoModeResult {
  const state = loadAutoModeState(velaDir);
  if (!state) {
    return { ok: false, error: 'No auto-mode session active' };
  }

  if (state.status !== 'paused') {
    return { ok: false, error: `Auto-mode is "${state.status}", not paused` };
  }

  const now = new Date().toISOString();
  state.status = 'running';
  state.blocker = null;
  state.updated_at = now;

  saveAutoModeState(velaDir, state);
  return { ok: true, state };
}

/**
 * Cancels the current auto-mode session.
 */
export function cancelAutoMode(
  velaDir: string,
): AutoModeResult {
  const state = loadAutoModeState(velaDir);
  if (!state) {
    return { ok: false, error: 'No auto-mode session active' };
  }

  if (state.status === 'completed' || state.status === 'cancelled') {
    return { ok: false, error: `Auto-mode is already "${state.status}"` };
  }

  const now = new Date().toISOString();
  state.status = 'cancelled';
  state.updated_at = now;

  saveAutoModeState(velaDir, state);
  return { ok: true, state };
}
