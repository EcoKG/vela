import type { Milestone, Slice, Task } from './state.js';

export interface BoundaryEntry {
  slice_id: string;
  slice_title: string;
  produces: string[];
  consumes: string[];
}

// ── Roadmap rendering ──────────────────────────────────────────────

/**
 * Renders a milestone roadmap as markdown with slice checkboxes and boundary map.
 */
export function renderRoadmap(
  milestone: Milestone,
  slices: Slice[],
  boundaryEntries: BoundaryEntry[],
): string {
  const lines: string[] = [];

  lines.push(`# ${milestone.title}`);
  lines.push('');

  if (milestone.description) {
    lines.push(milestone.description);
    lines.push('');
  }

  lines.push('## Slices');
  lines.push('');

  for (const slice of slices) {
    const checkbox = slice.status === 'completed' ? '[x]' : '[ ]';
    lines.push(`- ${checkbox} **${slice.id}: ${slice.title}**`);
  }

  lines.push('');

  if (boundaryEntries.length > 0) {
    lines.push('## Boundary Map');
    lines.push('');
    lines.push(renderBoundaryMapSection(boundaryEntries));
  }

  return lines.join('\n');
}

function renderBoundaryMapSection(entries: BoundaryEntry[]): string {
  const lines: string[] = [];
  lines.push('| Slice | Produces | Consumes |');
  lines.push('|-------|----------|----------|');

  for (const entry of entries) {
    const produces = entry.produces.length > 0 ? entry.produces.join(', ') : '—';
    const consumes = entry.consumes.length > 0 ? entry.consumes.join(', ') : '—';
    lines.push(`| ${entry.slice_id} | ${produces} | ${consumes} |`);
  }

  return lines.join('\n');
}

// ── Slice plan rendering ───────────────────────────────────────────

/**
 * Renders a slice plan as markdown with task checkboxes.
 */
export function renderSlicePlan(slice: Slice, tasks: Task[]): string {
  const lines: string[] = [];

  lines.push(`# ${slice.id}: ${slice.title}`);
  lines.push('');

  if (slice.description) {
    lines.push(slice.description);
    lines.push('');
  }

  lines.push('## Tasks');
  lines.push('');

  for (const task of tasks) {
    const checkbox = task.status === 'completed' ? '[x]' : '[ ]';
    lines.push(`- ${checkbox} **${task.id}: ${task.title}**`);
  }

  lines.push('');

  return lines.join('\n');
}

// ── Task summary rendering ─────────────────────────────────────────

/**
 * Renders a completed task summary as markdown.
 */
export function renderTaskSummary(task: Task): string {
  const lines: string[] = [];

  lines.push(`# ${task.id}: ${task.title}`);
  lines.push('');
  lines.push(`**Status:** ${task.status}`);
  lines.push('');

  if (task.description) {
    lines.push('## Description');
    lines.push('');
    lines.push(task.description);
    lines.push('');
  }

  if (task.summary) {
    lines.push('## Summary');
    lines.push('');
    lines.push(task.summary);
    lines.push('');
  }

  return lines.join('\n');
}

// ── Slice summary rendering ────────────────────────────────────────

/**
 * Renders a completed slice summary as markdown with task details.
 */
export function renderSliceSummary(slice: Slice, tasks: Task[]): string {
  const lines: string[] = [];

  lines.push(`# ${slice.id}: ${slice.title}`);
  lines.push('');
  lines.push(`**Status:** ${slice.status}`);
  lines.push('');

  if (slice.description) {
    lines.push(slice.description);
    lines.push('');
  }

  lines.push('## Tasks');
  lines.push('');

  for (const task of tasks) {
    const checkbox = task.status === 'completed' ? '[x]' : '[ ]';
    lines.push(`- ${checkbox} **${task.id}: ${task.title}**`);
    if (task.summary) {
      lines.push(`  - ${task.summary}`);
    }
  }

  lines.push('');

  return lines.join('\n');
}
