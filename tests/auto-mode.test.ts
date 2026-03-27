import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { getDb } from '../src/db.js';
import {
  ensureSchema,
  openStateDb,
  createMilestone,
  createSlice,
  createTask,
} from '../src/state.js';
import {
  startAutoMode,
  nextTask,
  getAutoStatus,
  pauseAutoMode,
  resumeAutoMode,
  cancelAutoMode,
  loadAutoModeState,
  saveAutoModeState,
} from '../src/auto-mode.js';
import type { AutoModeState } from '../src/auto-mode.js';

// ── Helpers ────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = getDb();
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  return db;
}

function setupSliceWithTasks(db: Database.Database, taskCount = 3): { milestoneId: string; sliceId: string; taskIds: string[] } {
  const milestoneId = 'M001';
  const sliceId = 'S01';
  createMilestone(db, { id: milestoneId, title: 'Test Milestone' });
  createSlice(db, { id: sliceId, milestone_id: milestoneId, title: 'Test Slice' });

  const taskIds: string[] = [];
  for (let i = 1; i <= taskCount; i++) {
    const id = `T${String(i).padStart(2, '0')}`;
    createTask(db, { id, slice_id: sliceId, milestone_id: milestoneId, title: `Task ${i}` });
    taskIds.push(id);
  }

  return { milestoneId, sliceId, taskIds };
}

let tmpDir: string;
let velaDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'vela-auto-'));
  velaDir = join(tmpDir, '.vela');
  mkdirSync(join(velaDir, 'state'), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Persistence tests ──────────────────────────────────────────────

describe('auto-mode persistence', () => {
  it('loadAutoModeState returns null when no file', () => {
    expect(loadAutoModeState(velaDir)).toBeNull();
  });

  it('save and load round-trips', () => {
    const state: AutoModeState = {
      status: 'running',
      milestone_id: 'M001',
      slice_id: 'S01',
      task_ids: ['T01', 'T02'],
      current_index: 0,
      completed_count: 0,
      blocker: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    saveAutoModeState(velaDir, state);
    const loaded = loadAutoModeState(velaDir);
    expect(loaded).toEqual(state);
  });
});

// ── startAutoMode tests ────────────────────────────────────────────

describe('startAutoMode', () => {
  it('starts with first task', () => {
    const db = makeDb();
    const { milestoneId, sliceId, taskIds } = setupSliceWithTasks(db);

    const result = startAutoMode(db, velaDir, milestoneId, sliceId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.status).toBe('running');
      expect(result.state.milestone_id).toBe(milestoneId);
      expect(result.state.slice_id).toBe(sliceId);
      expect(result.state.task_ids).toEqual(taskIds);
      expect(result.state.current_index).toBe(0);
      expect(result.state.completed_count).toBe(0);
      expect(result.current_task).toBeDefined();
      expect(result.current_task!.id).toBe('T01');
    }
    db.close();
  });

  it('rejects when already running', () => {
    const db = makeDb();
    const { milestoneId, sliceId } = setupSliceWithTasks(db);

    startAutoMode(db, velaDir, milestoneId, sliceId);
    const result = startAutoMode(db, velaDir, milestoneId, sliceId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('already');
    db.close();
  });

  it('rejects when no tasks exist', () => {
    const db = makeDb();
    createMilestone(db, { id: 'M001', title: 'Test' });
    createSlice(db, { id: 'S01', milestone_id: 'M001', title: 'Empty' });

    const result = startAutoMode(db, velaDir, 'M001', 'S01');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('No tasks');
    db.close();
  });

  it('persists state to disk', () => {
    const db = makeDb();
    const { milestoneId, sliceId } = setupSliceWithTasks(db);

    startAutoMode(db, velaDir, milestoneId, sliceId);
    const loaded = loadAutoModeState(velaDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.status).toBe('running');
    db.close();
  });
});

// ── nextTask tests ─────────────────────────────────────────────────

describe('nextTask', () => {
  it('advances to next task', () => {
    const db = makeDb();
    const { milestoneId, sliceId } = setupSliceWithTasks(db);
    startAutoMode(db, velaDir, milestoneId, sliceId);

    const result = nextTask(db, velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.current_index).toBe(1);
      expect(result.state.completed_count).toBe(1);
      expect(result.current_task).toBeDefined();
      expect(result.current_task!.id).toBe('T02');
    }
    db.close();
  });

  it('completes auto-mode when all tasks done', () => {
    const db = makeDb();
    const { milestoneId, sliceId } = setupSliceWithTasks(db, 2);
    startAutoMode(db, velaDir, milestoneId, sliceId);

    nextTask(db, velaDir); // T01 done, on T02
    const result = nextTask(db, velaDir); // T02 done, complete
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.status).toBe('completed');
      expect(result.state.completed_count).toBe(2);
      expect(result.current_task).toBeUndefined();
    }
    db.close();
  });

  it('rejects when no session active', () => {
    const db = makeDb();
    const result = nextTask(db, velaDir);
    expect(result.ok).toBe(false);
    db.close();
  });

  it('rejects when paused', () => {
    const db = makeDb();
    const { milestoneId, sliceId } = setupSliceWithTasks(db);
    startAutoMode(db, velaDir, milestoneId, sliceId);
    pauseAutoMode(velaDir);

    const result = nextTask(db, velaDir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('paused');
    db.close();
  });
});

// ── getAutoStatus tests ────────────────────────────────────────────

describe('getAutoStatus', () => {
  it('returns current status with task', () => {
    const db = makeDb();
    const { milestoneId, sliceId } = setupSliceWithTasks(db);
    startAutoMode(db, velaDir, milestoneId, sliceId);

    const result = getAutoStatus(db, velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.status).toBe('running');
      expect(result.current_task).toBeDefined();
      expect(result.current_task!.id).toBe('T01');
    }
    db.close();
  });

  it('returns error when no session', () => {
    const db = makeDb();
    const result = getAutoStatus(db, velaDir);
    expect(result.ok).toBe(false);
    db.close();
  });
});

// ── pauseAutoMode tests ────────────────────────────────────────────

describe('pauseAutoMode', () => {
  it('pauses running session', () => {
    const db = makeDb();
    const { milestoneId, sliceId } = setupSliceWithTasks(db);
    startAutoMode(db, velaDir, milestoneId, sliceId);

    const result = pauseAutoMode(velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.status).toBe('paused');
      expect(result.state.blocker).toBeNull();
    }
    db.close();
  });

  it('pauses with blocker reason', () => {
    const db = makeDb();
    const { milestoneId, sliceId } = setupSliceWithTasks(db);
    startAutoMode(db, velaDir, milestoneId, sliceId);

    const result = pauseAutoMode(velaDir, 'Build failed');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.status).toBe('paused');
      expect(result.state.blocker).not.toBeNull();
      expect(result.state.blocker!.reason).toBe('Build failed');
      expect(result.state.blocker!.task_id).toBe('T01');
    }
    db.close();
  });

  it('rejects when not running', () => {
    const result = pauseAutoMode(velaDir);
    expect(result.ok).toBe(false);
  });
});

// ── resumeAutoMode tests ───────────────────────────────────────────

describe('resumeAutoMode', () => {
  it('resumes paused session', () => {
    const db = makeDb();
    const { milestoneId, sliceId } = setupSliceWithTasks(db);
    startAutoMode(db, velaDir, milestoneId, sliceId);
    pauseAutoMode(velaDir, 'Some issue');

    const result = resumeAutoMode(velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.status).toBe('running');
      expect(result.state.blocker).toBeNull();
    }
    db.close();
  });

  it('rejects when not paused', () => {
    const db = makeDb();
    const { milestoneId, sliceId } = setupSliceWithTasks(db);
    startAutoMode(db, velaDir, milestoneId, sliceId);

    const result = resumeAutoMode(velaDir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('not paused');
    db.close();
  });
});

// ── cancelAutoMode tests ───────────────────────────────────────────

describe('cancelAutoMode', () => {
  it('cancels running session', () => {
    const db = makeDb();
    const { milestoneId, sliceId } = setupSliceWithTasks(db);
    startAutoMode(db, velaDir, milestoneId, sliceId);

    const result = cancelAutoMode(velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.status).toBe('cancelled');
    db.close();
  });

  it('cancels paused session', () => {
    const db = makeDb();
    const { milestoneId, sliceId } = setupSliceWithTasks(db);
    startAutoMode(db, velaDir, milestoneId, sliceId);
    pauseAutoMode(velaDir);

    const result = cancelAutoMode(velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.status).toBe('cancelled');
    db.close();
  });

  it('rejects when already completed', () => {
    const db = makeDb();
    const { milestoneId, sliceId } = setupSliceWithTasks(db, 1);
    startAutoMode(db, velaDir, milestoneId, sliceId);
    nextTask(db, velaDir); // completes

    const result = cancelAutoMode(velaDir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('already');
    db.close();
  });
});

// ── Full lifecycle test ────────────────────────────────────────────

describe('full auto-mode lifecycle', () => {
  it('start → next → next → next → completed', () => {
    const db = makeDb();
    const { milestoneId, sliceId } = setupSliceWithTasks(db, 3);

    // Start
    const start = startAutoMode(db, velaDir, milestoneId, sliceId);
    expect(start.ok).toBe(true);
    if (start.ok) expect(start.current_task!.id).toBe('T01');

    // Next: T01 → T02
    const next1 = nextTask(db, velaDir);
    expect(next1.ok).toBe(true);
    if (next1.ok) expect(next1.current_task!.id).toBe('T02');

    // Next: T02 → T03
    const next2 = nextTask(db, velaDir);
    expect(next2.ok).toBe(true);
    if (next2.ok) expect(next2.current_task!.id).toBe('T03');

    // Next: T03 → completed
    const next3 = nextTask(db, velaDir);
    expect(next3.ok).toBe(true);
    if (next3.ok) {
      expect(next3.state.status).toBe('completed');
      expect(next3.state.completed_count).toBe(3);
    }

    db.close();
  });

  it('start → pause → resume → next → cancel', () => {
    const db = makeDb();
    const { milestoneId, sliceId } = setupSliceWithTasks(db, 3);

    startAutoMode(db, velaDir, milestoneId, sliceId);
    pauseAutoMode(velaDir, 'Need review');

    // Cannot advance while paused
    const blocked = nextTask(db, velaDir);
    expect(blocked.ok).toBe(false);

    // Resume
    resumeAutoMode(velaDir);

    // Now can advance
    const next = nextTask(db, velaDir);
    expect(next.ok).toBe(true);

    // Cancel
    const cancel = cancelAutoMode(velaDir);
    expect(cancel.ok).toBe(true);
    if (cancel.ok) expect(cancel.state.status).toBe('cancelled');

    db.close();
  });
});
