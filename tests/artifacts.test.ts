import { describe, it, expect } from 'vitest';
import {
  renderRoadmap,
  renderSlicePlan,
  renderTaskSummary,
  renderSliceSummary,
} from '../src/artifacts.js';
import type { Milestone, Slice, Task, BoundaryEntry } from '../src/artifacts.js';

// ── Helpers ────────────────────────────────────────────────────────

function makeMilestone(overrides?: Partial<Milestone>): Milestone {
  return {
    id: 'M1',
    title: 'Authentication System',
    status: 'active',
    description: null,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSlice(overrides?: Partial<Slice>): Slice {
  return {
    id: 'S01',
    milestone_id: 'M1',
    title: 'Login Flow',
    status: 'pending',
    description: null,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTask(overrides?: Partial<Task>): Task {
  return {
    id: 'T01',
    slice_id: 'S01',
    milestone_id: 'M1',
    title: 'Create login endpoint',
    status: 'pending',
    description: null,
    summary: null,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── renderRoadmap ──────────────────────────────────────────────────

describe('renderRoadmap', () => {
  it('renders milestone title and slice checkboxes', () => {
    const milestone = makeMilestone();
    const slices = [
      makeSlice({ id: 'S01', title: 'Login Flow', status: 'completed' }),
      makeSlice({ id: 'S02', title: 'Registration', status: 'pending' }),
    ];

    const md = renderRoadmap(milestone, slices, []);

    expect(md).toContain('# Authentication System');
    expect(md).toContain('- [x] **S01: Login Flow**');
    expect(md).toContain('- [ ] **S02: Registration**');
  });

  it('includes milestone description when present', () => {
    const milestone = makeMilestone({ description: 'Build the auth system' });
    const md = renderRoadmap(milestone, [], []);

    expect(md).toContain('Build the auth system');
  });

  it('renders boundary map section when entries are provided', () => {
    const milestone = makeMilestone();
    const slices = [makeSlice()];
    const boundaries: BoundaryEntry[] = [
      { slice_id: 'S01', slice_title: 'Login Flow', produces: ['auth token'], consumes: ['user DB'] },
    ];

    const md = renderRoadmap(milestone, slices, boundaries);

    expect(md).toContain('## Boundary Map');
    expect(md).toContain('| Slice | Produces | Consumes |');
    expect(md).toContain('| S01 | auth token | user DB |');
  });

  it('omits boundary map section when no entries', () => {
    const milestone = makeMilestone();
    const md = renderRoadmap(milestone, [], []);

    expect(md).not.toContain('## Boundary Map');
  });
});

// ── renderSlicePlan ────────────────────────────────────────────────

describe('renderSlicePlan', () => {
  it('renders slice title and task checkboxes', () => {
    const slice = makeSlice();
    const tasks = [
      makeTask({ id: 'T01', title: 'Create endpoint', status: 'completed' }),
      makeTask({ id: 'T02', title: 'Write tests', status: 'pending' }),
    ];

    const md = renderSlicePlan(slice, tasks);

    expect(md).toContain('# S01: Login Flow');
    expect(md).toContain('- [x] **T01: Create endpoint**');
    expect(md).toContain('- [ ] **T02: Write tests**');
  });

  it('includes slice description when present', () => {
    const slice = makeSlice({ description: 'Handles user login' });
    const md = renderSlicePlan(slice, []);

    expect(md).toContain('Handles user login');
  });
});

// ── renderTaskSummary ──────────────────────────────────────────────

describe('renderTaskSummary', () => {
  it('renders task title and status', () => {
    const task = makeTask({ status: 'completed' });
    const md = renderTaskSummary(task);

    expect(md).toContain('# T01: Create login endpoint');
    expect(md).toContain('**Status:** completed');
  });

  it('includes description and summary when present', () => {
    const task = makeTask({
      description: 'Build the POST /login route',
      summary: 'Implemented JWT-based login',
    });
    const md = renderTaskSummary(task);

    expect(md).toContain('## Description');
    expect(md).toContain('Build the POST /login route');
    expect(md).toContain('## Summary');
    expect(md).toContain('Implemented JWT-based login');
  });

  it('omits description/summary sections when null', () => {
    const task = makeTask();
    const md = renderTaskSummary(task);

    expect(md).not.toContain('## Description');
    expect(md).not.toContain('## Summary');
  });
});

// ── renderSliceSummary ─────────────────────────────────────────────

describe('renderSliceSummary', () => {
  it('renders slice title, status, and task list', () => {
    const slice = makeSlice({ status: 'completed' });
    const tasks = [
      makeTask({ id: 'T01', title: 'Create endpoint', status: 'completed', summary: 'Done' }),
      makeTask({ id: 'T02', title: 'Write tests', status: 'completed', summary: 'All passing' }),
    ];

    const md = renderSliceSummary(slice, tasks);

    expect(md).toContain('# S01: Login Flow');
    expect(md).toContain('**Status:** completed');
    expect(md).toContain('- [x] **T01: Create endpoint**');
    expect(md).toContain('  - Done');
    expect(md).toContain('- [x] **T02: Write tests**');
    expect(md).toContain('  - All passing');
  });

  it('renders task without summary bullet when summary is null', () => {
    const slice = makeSlice({ status: 'completed' });
    const tasks = [
      makeTask({ id: 'T01', title: 'Create endpoint', status: 'completed', summary: null }),
    ];

    const md = renderSliceSummary(slice, tasks);

    expect(md).toContain('- [x] **T01: Create endpoint**');
    expect(md).not.toContain('  - null');
  });
});
