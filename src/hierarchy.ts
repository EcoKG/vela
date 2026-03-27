import Database from 'better-sqlite3';
import {
  getTask,
  updateTask,
  listTasks,
  getSlice,
  updateSlice,
  listSlices,
  getMilestone,
  updateMilestone,
} from './state.js';
import type { Task, Slice, Milestone } from './state.js';

// ── Result types ───────────────────────────────────────────────────

export type CompleteTaskResult =
  | { ok: true; task: Task; sliceAutoCompleted: boolean; milestoneAutoCompleted: boolean }
  | { ok: false; error: string };

export type CompleteSliceResult =
  | { ok: true; slice: Slice; milestoneAutoCompleted: boolean }
  | { ok: false; error: string };

export type CompleteMilestoneResult =
  | { ok: true; milestone: Milestone }
  | { ok: false; error: string };

// ── Hierarchy orchestration ────────────────────────────────────────

/**
 * Marks a task as completed and cascades upward if all siblings are done.
 * Idempotent — already-completed tasks return success without re-modifying.
 */
export function completeTask(db: Database.Database, taskId: string): CompleteTaskResult {
  const task = getTask(db, taskId);
  if (!task) {
    return { ok: false, error: `Task "${taskId}" not found` };
  }

  // Idempotent: already completed
  if (task.status === 'completed') {
    return { ok: true, task, sliceAutoCompleted: false, milestoneAutoCompleted: false };
  }

  const updated = updateTask(db, taskId, { status: 'completed' });
  if (!updated) {
    return { ok: false, error: `Failed to update task "${taskId}"` };
  }

  // Check if all sibling tasks in the same slice are now completed
  const siblings = listTasks(db, { slice_id: task.slice_id });
  const allDone = siblings.every((t) => t.id === taskId ? true : t.status === 'completed');

  if (allDone) {
    const sliceResult = completeSlice(db, task.slice_id);
    if (sliceResult.ok) {
      return {
        ok: true,
        task: updated,
        sliceAutoCompleted: true,
        milestoneAutoCompleted: sliceResult.milestoneAutoCompleted,
      };
    }
    // Slice completion failed — still report task success
    return { ok: true, task: updated, sliceAutoCompleted: false, milestoneAutoCompleted: false };
  }

  return { ok: true, task: updated, sliceAutoCompleted: false, milestoneAutoCompleted: false };
}

/**
 * Marks a slice as completed. Validates all tasks are completed first.
 * Cascades to milestone if all sibling slices are done.
 * Idempotent — already-completed slices return success.
 */
export function completeSlice(db: Database.Database, sliceId: string): CompleteSliceResult {
  const slice = getSlice(db, sliceId);
  if (!slice) {
    return { ok: false, error: `Slice "${sliceId}" not found` };
  }

  // Idempotent: already completed
  if (slice.status === 'completed') {
    return { ok: true, slice, milestoneAutoCompleted: false };
  }

  // Validate all tasks are completed
  const tasks = listTasks(db, { slice_id: sliceId });
  const incompleteTasks = tasks.filter((t) => t.status !== 'completed');
  if (incompleteTasks.length > 0) {
    const ids = incompleteTasks.map((t) => t.id).join(', ');
    return { ok: false, error: `Cannot complete slice "${sliceId}": tasks not completed: ${ids}` };
  }

  const updated = updateSlice(db, sliceId, { status: 'completed' });
  if (!updated) {
    return { ok: false, error: `Failed to update slice "${sliceId}"` };
  }

  // Check if all sibling slices in the same milestone are now completed
  const siblings = listSlices(db, { milestone_id: slice.milestone_id });
  const allDone = siblings.every((s) => s.id === sliceId ? true : s.status === 'completed');

  if (allDone) {
    const msResult = completeMilestone(db, slice.milestone_id);
    if (msResult.ok) {
      return { ok: true, slice: updated, milestoneAutoCompleted: true };
    }
    return { ok: true, slice: updated, milestoneAutoCompleted: false };
  }

  return { ok: true, slice: updated, milestoneAutoCompleted: false };
}

/**
 * Marks a milestone as completed. Validates all slices are completed first.
 * Idempotent — already-completed milestones return success.
 */
export function completeMilestone(db: Database.Database, milestoneId: string): CompleteMilestoneResult {
  const milestone = getMilestone(db, milestoneId);
  if (!milestone) {
    return { ok: false, error: `Milestone "${milestoneId}" not found` };
  }

  // Idempotent: already completed
  if (milestone.status === 'completed') {
    return { ok: true, milestone };
  }

  // Validate all slices are completed
  const slices = listSlices(db, { milestone_id: milestoneId });
  const incompleteSlices = slices.filter((s) => s.status !== 'completed');
  if (incompleteSlices.length > 0) {
    const ids = incompleteSlices.map((s) => s.id).join(', ');
    return { ok: false, error: `Cannot complete milestone "${milestoneId}": slices not completed: ${ids}` };
  }

  const updated = updateMilestone(db, milestoneId, { status: 'completed' });
  if (!updated) {
    return { ok: false, error: `Failed to update milestone "${milestoneId}"` };
  }

  return { ok: true, milestone: updated };
}
