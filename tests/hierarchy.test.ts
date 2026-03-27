import { describe, it, expect } from 'vitest';
import {
  openStateDb,
  createMilestone,
  createSlice,
  createTask,
  getTask,
  getSlice,
  getMilestone,
  updateTask,
} from '../src/state.js';
import {
  completeTask,
  completeSlice,
  completeMilestone,
} from '../src/hierarchy.js';

// ── Helpers ────────────────────────────────────────────────────────

function setupDb() {
  const db = openStateDb(); // in-memory
  createMilestone(db, { id: 'M1', title: 'Milestone 1' });
  createSlice(db, { id: 'S1', milestone_id: 'M1', title: 'Slice 1' });
  return db;
}

// ── completeTask ───────────────────────────────────────────────────

describe('completeTask', () => {
  it('completes a task and returns success', () => {
    const db = setupDb();
    createTask(db, { id: 'T1', slice_id: 'S1', milestone_id: 'M1', title: 'Task 1' });

    const result = completeTask(db, 'T1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.task.status).toBe('completed');
    }
  });

  it('is idempotent — completing an already-completed task returns success', () => {
    const db = setupDb();
    createTask(db, { id: 'T1', slice_id: 'S1', milestone_id: 'M1', title: 'Task 1' });

    completeTask(db, 'T1');
    const result = completeTask(db, 'T1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.task.status).toBe('completed');
      expect(result.sliceAutoCompleted).toBe(false);
    }
  });

  it('returns error for non-existent task', () => {
    const db = setupDb();
    const result = completeTask(db, 'T999');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
  });

  it('auto-completes slice when all tasks are done', () => {
    const db = setupDb();
    createTask(db, { id: 'T1', slice_id: 'S1', milestone_id: 'M1', title: 'Task 1' });
    createTask(db, { id: 'T2', slice_id: 'S1', milestone_id: 'M1', title: 'Task 2' });

    completeTask(db, 'T1');
    const result = completeTask(db, 'T2');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sliceAutoCompleted).toBe(true);

      const slice = getSlice(db, 'S1');
      expect(slice?.status).toBe('completed');
    }
  });

  it('does not auto-complete slice when some tasks remain', () => {
    const db = setupDb();
    createTask(db, { id: 'T1', slice_id: 'S1', milestone_id: 'M1', title: 'Task 1' });
    createTask(db, { id: 'T2', slice_id: 'S1', milestone_id: 'M1', title: 'Task 2' });

    const result = completeTask(db, 'T1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sliceAutoCompleted).toBe(false);

      const slice = getSlice(db, 'S1');
      expect(slice?.status).toBe('pending');
    }
  });

  it('cascades from task → slice → milestone when all are done', () => {
    const db = setupDb();
    createTask(db, { id: 'T1', slice_id: 'S1', milestone_id: 'M1', title: 'Task 1' });

    const result = completeTask(db, 'T1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sliceAutoCompleted).toBe(true);
      expect(result.milestoneAutoCompleted).toBe(true);

      const milestone = getMilestone(db, 'M1');
      expect(milestone?.status).toBe('completed');
    }
  });
});

// ── completeSlice ──────────────────────────────────────────────────

describe('completeSlice', () => {
  it('completes a slice when all tasks are done', () => {
    const db = setupDb();
    createTask(db, { id: 'T1', slice_id: 'S1', milestone_id: 'M1', title: 'Task 1', status: 'completed' });

    const result = completeSlice(db, 'S1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.slice.status).toBe('completed');
    }
  });

  it('rejects when tasks are incomplete', () => {
    const db = setupDb();
    createTask(db, { id: 'T1', slice_id: 'S1', milestone_id: 'M1', title: 'Task 1' });
    createTask(db, { id: 'T2', slice_id: 'S1', milestone_id: 'M1', title: 'Task 2', status: 'completed' });

    const result = completeSlice(db, 'S1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('T1');
      expect(result.error).toContain('not completed');
    }
  });

  it('is idempotent', () => {
    const db = setupDb();
    createTask(db, { id: 'T1', slice_id: 'S1', milestone_id: 'M1', title: 'Task 1', status: 'completed' });

    completeSlice(db, 'S1');
    const result = completeSlice(db, 'S1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.milestoneAutoCompleted).toBe(false);
    }
  });

  it('auto-completes milestone when all slices are done', () => {
    const db = setupDb();
    createSlice(db, { id: 'S2', milestone_id: 'M1', title: 'Slice 2' });
    createTask(db, { id: 'T1', slice_id: 'S1', milestone_id: 'M1', title: 'Task 1', status: 'completed' });
    createTask(db, { id: 'T2', slice_id: 'S2', milestone_id: 'M1', title: 'Task 2', status: 'completed' });

    completeSlice(db, 'S1');
    const result = completeSlice(db, 'S2');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.milestoneAutoCompleted).toBe(true);

      const milestone = getMilestone(db, 'M1');
      expect(milestone?.status).toBe('completed');
    }
  });

  it('returns error for non-existent slice', () => {
    const db = setupDb();
    const result = completeSlice(db, 'S999');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
  });

  it('completes a slice with zero tasks (vacuously complete)', () => {
    const db = setupDb();
    const result = completeSlice(db, 'S1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.slice.status).toBe('completed');
    }
  });
});

// ── completeMilestone ──────────────────────────────────────────────

describe('completeMilestone', () => {
  it('completes a milestone when all slices are done', () => {
    const db = setupDb();
    createTask(db, { id: 'T1', slice_id: 'S1', milestone_id: 'M1', title: 'Task 1', status: 'completed' });
    completeSlice(db, 'S1');

    const result = completeMilestone(db, 'M1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.milestone.status).toBe('completed');
    }
  });

  it('rejects when slices are incomplete', () => {
    const db = setupDb();
    createSlice(db, { id: 'S2', milestone_id: 'M1', title: 'Slice 2' });
    createTask(db, { id: 'T1', slice_id: 'S1', milestone_id: 'M1', title: 'Task 1', status: 'completed' });
    completeSlice(db, 'S1');

    const result = completeMilestone(db, 'M1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('S2');
      expect(result.error).toContain('not completed');
    }
  });

  it('is idempotent', () => {
    const db = setupDb();
    createTask(db, { id: 'T1', slice_id: 'S1', milestone_id: 'M1', title: 'Task 1', status: 'completed' });
    completeSlice(db, 'S1');
    completeMilestone(db, 'M1');

    const result = completeMilestone(db, 'M1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.milestone.status).toBe('completed');
    }
  });

  it('returns error for non-existent milestone', () => {
    const db = setupDb();
    const result = completeMilestone(db, 'M999');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
  });
});
