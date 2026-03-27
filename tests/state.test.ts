import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { getDb, closeDb } from '../src/db.js';
import {
  ensureSchema,
  openStateDb,
  createPipeline,
  getPipeline,
  updatePipeline,
  listPipelines,
  createMilestone,
  getMilestone,
  updateMilestone,
  listMilestones,
  createSlice,
  getSlice,
  updateSlice,
  listSlices,
  createTask,
  getTask,
  updateTask,
  listTasks,
} from '../src/state.js';
import type { PipelineData, MilestoneData, SliceData, TaskData } from '../src/state.js';

// ── Helpers ────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = getDb(); // in-memory
  db.pragma('foreign_keys = ON');
  return db;
}

function samplePipelineData(overrides?: Partial<PipelineData>): PipelineData {
  return {
    id: 'pipe-001',
    pipeline_type: 'standard',
    request: 'Build login page',
    scale: 'medium',
    current_step: 'research',
    steps: ['research', 'plan', 'execute', 'verify'],
    ...overrides,
  };
}

// ── Schema tests ───────────────────────────────────────────────────

describe('ensureSchema', () => {
  it('creates all four tables', () => {
    const db = makeDb();
    ensureSchema(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);

    expect(names).toContain('pipelines');
    expect(names).toContain('milestones');
    expect(names).toContain('slices');
    expect(names).toContain('tasks');

    closeDb(db);
  });

  it('is idempotent — calling twice does not throw', () => {
    const db = makeDb();
    ensureSchema(db);
    expect(() => ensureSchema(db)).not.toThrow();
    closeDb(db);
  });
});

// ── openStateDb tests ──────────────────────────────────────────────

describe('openStateDb', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs) {
      rmSync(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('creates file-backed DB with tables', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vela-state-'));
    tempDirs.push(tmp);

    const db = openStateDb(tmp);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('pipelines');
    expect(names).toContain('milestones');

    closeDb(db);
  });

  it('enables foreign_keys pragma', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vela-state-'));
    tempDirs.push(tmp);

    const db = openStateDb(tmp);

    const fk = db.pragma('foreign_keys') as { foreign_keys: number }[];
    expect(fk[0].foreign_keys).toBe(1);

    closeDb(db);
  });

  it('creates in-memory DB when no arg given', () => {
    const db = openStateDb();

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.length).toBeGreaterThanOrEqual(4);

    closeDb(db);
  });
});

// ── Pipeline CRUD tests ────────────────────────────────────────────

describe('Pipeline CRUD', () => {
  it('createPipeline returns a pipeline with timestamps', () => {
    const db = makeDb();
    ensureSchema(db);

    const pipeline = createPipeline(db, samplePipelineData());

    expect(pipeline.id).toBe('pipe-001');
    expect(pipeline.status).toBe('active');
    expect(pipeline.pipeline_type).toBe('standard');
    expect(pipeline.created_at).toBeTruthy();
    expect(pipeline.updated_at).toBeTruthy();

    closeDb(db);
  });

  it('getPipeline retrieves a created pipeline', () => {
    const db = makeDb();
    ensureSchema(db);

    createPipeline(db, samplePipelineData());
    const found = getPipeline(db, 'pipe-001');

    expect(found).toBeDefined();
    expect(found!.id).toBe('pipe-001');
    expect(found!.request).toBe('Build login page');

    closeDb(db);
  });

  it('JSON columns round-trip correctly (steps array, revisions object)', () => {
    const db = makeDb();
    ensureSchema(db);

    const revisions = { r1: { summary: 'First pass', status: 'done' } };
    const git = { branch: 'feat/login', commit: 'abc123' };

    createPipeline(db, samplePipelineData({ revisions, git }));
    const found = getPipeline(db, 'pipe-001')!;

    expect(found.steps).toEqual(['research', 'plan', 'execute', 'verify']);
    expect(found.completed_steps).toEqual([]);
    expect(found.revisions).toEqual(revisions);
    expect(found.git).toEqual(git);

    closeDb(db);
  });

  it('updatePipeline changes specific fields', () => {
    const db = makeDb();
    ensureSchema(db);

    createPipeline(db, samplePipelineData());
    const updated = updatePipeline(db, 'pipe-001', {
      status: 'completed',
      current_step: 'verify',
      completed_steps: ['research', 'plan', 'execute'],
    });

    expect(updated).toBeDefined();
    expect(updated!.status).toBe('completed');
    expect(updated!.current_step).toBe('verify');
    expect(updated!.completed_steps).toEqual(['research', 'plan', 'execute']);
    // Unchanged fields preserved
    expect(updated!.request).toBe('Build login page');
    expect(updated!.pipeline_type).toBe('standard');

    closeDb(db);
  });

  it('updatePipeline sets updated_at to current time', () => {
    const db = makeDb();
    ensureSchema(db);

    const before = new Date().toISOString();
    createPipeline(db, samplePipelineData());
    const updated = updatePipeline(db, 'pipe-001', { status: 'completed' });

    // updated_at should be >= the timestamp we captured before the operation
    expect(updated!.updated_at >= before).toBe(true);
    // And it should be a valid ISO date
    expect(new Date(updated!.updated_at).toISOString()).toBe(updated!.updated_at);

    closeDb(db);
  });

  it('listPipelines returns all pipelines', () => {
    const db = makeDb();
    ensureSchema(db);

    createPipeline(db, samplePipelineData({ id: 'p1' }));
    createPipeline(db, samplePipelineData({ id: 'p2' }));
    createPipeline(db, samplePipelineData({ id: 'p3' }));

    const all = listPipelines(db);
    expect(all).toHaveLength(3);

    closeDb(db);
  });

  it('listPipelines filters by status', () => {
    const db = makeDb();
    ensureSchema(db);

    createPipeline(db, samplePipelineData({ id: 'p1', status: 'active' }));
    createPipeline(db, samplePipelineData({ id: 'p2', status: 'completed' }));
    createPipeline(db, samplePipelineData({ id: 'p3', status: 'active' }));

    const active = listPipelines(db, { status: 'active' });
    expect(active).toHaveLength(2);

    const completed = listPipelines(db, { status: 'completed' });
    expect(completed).toHaveLength(1);
    expect(completed[0].id).toBe('p2');

    closeDb(db);
  });

  // ── Negative tests ─────────────────────────────────────────────

  it('getPipeline with nonexistent id returns undefined', () => {
    const db = makeDb();
    ensureSchema(db);

    const found = getPipeline(db, 'nonexistent');
    expect(found).toBeUndefined();

    closeDb(db);
  });

  it('updatePipeline with nonexistent id returns undefined', () => {
    const db = makeDb();
    ensureSchema(db);

    const result = updatePipeline(db, 'ghost', { status: 'done' });
    expect(result).toBeUndefined();

    closeDb(db);
  });

  it('listPipelines with no rows returns empty array', () => {
    const db = makeDb();
    ensureSchema(db);

    const list = listPipelines(db);
    expect(list).toEqual([]);

    closeDb(db);
  });

  it('createPipeline with empty steps array serializes correctly', () => {
    const db = makeDb();
    ensureSchema(db);

    const pipeline = createPipeline(db, samplePipelineData({ steps: [] }));
    expect(pipeline.steps).toEqual([]);

    const found = getPipeline(db, 'pipe-001')!;
    expect(found.steps).toEqual([]);

    closeDb(db);
  });
});

// ── Milestone CRUD tests ───────────────────────────────────────────

describe('Milestone CRUD', () => {
  it('createMilestone returns a milestone with timestamps', () => {
    const db = makeDb();
    ensureSchema(db);

    const ms = createMilestone(db, { id: 'ms-001', title: 'MVP' });

    expect(ms.id).toBe('ms-001');
    expect(ms.title).toBe('MVP');
    expect(ms.status).toBe('active');
    expect(ms.description).toBeNull();
    expect(ms.created_at).toBeTruthy();
    expect(ms.updated_at).toBeTruthy();

    closeDb(db);
  });

  it('getMilestone retrieves a created milestone', () => {
    const db = makeDb();
    ensureSchema(db);

    createMilestone(db, { id: 'ms-001', title: 'MVP' });
    const found = getMilestone(db, 'ms-001');

    expect(found).toBeDefined();
    expect(found!.title).toBe('MVP');

    closeDb(db);
  });

  it('getMilestone with nonexistent id returns undefined', () => {
    const db = makeDb();
    ensureSchema(db);

    expect(getMilestone(db, 'ghost')).toBeUndefined();

    closeDb(db);
  });

  it('updateMilestone changes specific fields', () => {
    const db = makeDb();
    ensureSchema(db);

    createMilestone(db, { id: 'ms-001', title: 'MVP' });
    const updated = updateMilestone(db, 'ms-001', {
      title: 'MVP v2',
      status: 'completed',
      description: 'Done!',
    });

    expect(updated).toBeDefined();
    expect(updated!.title).toBe('MVP v2');
    expect(updated!.status).toBe('completed');
    expect(updated!.description).toBe('Done!');

    closeDb(db);
  });

  it('updateMilestone with nonexistent id returns undefined', () => {
    const db = makeDb();
    ensureSchema(db);

    expect(updateMilestone(db, 'ghost', { title: 'x' })).toBeUndefined();

    closeDb(db);
  });

  it('listMilestones returns all milestones', () => {
    const db = makeDb();
    ensureSchema(db);

    createMilestone(db, { id: 'ms-1', title: 'A' });
    createMilestone(db, { id: 'ms-2', title: 'B' });

    const all = listMilestones(db);
    expect(all).toHaveLength(2);

    closeDb(db);
  });

  it('listMilestones filters by status', () => {
    const db = makeDb();
    ensureSchema(db);

    createMilestone(db, { id: 'ms-1', title: 'A', status: 'active' });
    createMilestone(db, { id: 'ms-2', title: 'B', status: 'completed' });

    const active = listMilestones(db, { status: 'active' });
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('ms-1');

    closeDb(db);
  });
});

// ── Slice CRUD tests ───────────────────────────────────────────────

describe('Slice CRUD', () => {
  function setupMilestone(db: Database.Database): void {
    ensureSchema(db);
    createMilestone(db, { id: 'ms-001', title: 'MVP' });
  }

  it('createSlice returns a slice with timestamps', () => {
    const db = makeDb();
    setupMilestone(db);

    const sl = createSlice(db, { id: 'sl-001', milestone_id: 'ms-001', title: 'Auth' });

    expect(sl.id).toBe('sl-001');
    expect(sl.milestone_id).toBe('ms-001');
    expect(sl.title).toBe('Auth');
    expect(sl.status).toBe('pending');
    expect(sl.created_at).toBeTruthy();

    closeDb(db);
  });

  it('getSlice retrieves a created slice', () => {
    const db = makeDb();
    setupMilestone(db);

    createSlice(db, { id: 'sl-001', milestone_id: 'ms-001', title: 'Auth' });
    const found = getSlice(db, 'sl-001');

    expect(found).toBeDefined();
    expect(found!.title).toBe('Auth');
    expect(found!.milestone_id).toBe('ms-001');

    closeDb(db);
  });

  it('getSlice with nonexistent id returns undefined', () => {
    const db = makeDb();
    setupMilestone(db);

    expect(getSlice(db, 'ghost')).toBeUndefined();

    closeDb(db);
  });

  it('updateSlice changes specific fields', () => {
    const db = makeDb();
    setupMilestone(db);

    createSlice(db, { id: 'sl-001', milestone_id: 'ms-001', title: 'Auth' });
    const updated = updateSlice(db, 'sl-001', { title: 'Auth v2', status: 'active' });

    expect(updated).toBeDefined();
    expect(updated!.title).toBe('Auth v2');
    expect(updated!.status).toBe('active');

    closeDb(db);
  });

  it('updateSlice with nonexistent id returns undefined', () => {
    const db = makeDb();
    setupMilestone(db);

    expect(updateSlice(db, 'ghost', { title: 'x' })).toBeUndefined();

    closeDb(db);
  });

  it('listSlices returns all slices for a milestone', () => {
    const db = makeDb();
    setupMilestone(db);
    createMilestone(db, { id: 'ms-002', title: 'Phase 2' });

    createSlice(db, { id: 'sl-1', milestone_id: 'ms-001', title: 'A' });
    createSlice(db, { id: 'sl-2', milestone_id: 'ms-001', title: 'B' });
    createSlice(db, { id: 'sl-3', milestone_id: 'ms-002', title: 'C' });

    const ms1Slices = listSlices(db, { milestone_id: 'ms-001' });
    expect(ms1Slices).toHaveLength(2);

    const ms2Slices = listSlices(db, { milestone_id: 'ms-002' });
    expect(ms2Slices).toHaveLength(1);
    expect(ms2Slices[0].id).toBe('sl-3');

    closeDb(db);
  });

  it('listSlices filters by status', () => {
    const db = makeDb();
    setupMilestone(db);

    createSlice(db, { id: 'sl-1', milestone_id: 'ms-001', title: 'A', status: 'active' });
    createSlice(db, { id: 'sl-2', milestone_id: 'ms-001', title: 'B', status: 'completed' });

    const active = listSlices(db, { status: 'active' });
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('sl-1');

    closeDb(db);
  });

  it('FK constraint: createSlice with nonexistent milestone_id throws', () => {
    const db = makeDb();
    ensureSchema(db);

    expect(() =>
      createSlice(db, { id: 'sl-bad', milestone_id: 'no-such-ms', title: 'Orphan' })
    ).toThrow();

    closeDb(db);
  });
});

// ── Task CRUD tests ────────────────────────────────────────────────

describe('Task CRUD', () => {
  function setupHierarchy(db: Database.Database): void {
    ensureSchema(db);
    createMilestone(db, { id: 'ms-001', title: 'MVP' });
    createSlice(db, { id: 'sl-001', milestone_id: 'ms-001', title: 'Auth' });
  }

  it('createTask returns a task with timestamps', () => {
    const db = makeDb();
    setupHierarchy(db);

    const task = createTask(db, {
      id: 'task-001',
      slice_id: 'sl-001',
      milestone_id: 'ms-001',
      title: 'Write tests',
    });

    expect(task.id).toBe('task-001');
    expect(task.slice_id).toBe('sl-001');
    expect(task.milestone_id).toBe('ms-001');
    expect(task.title).toBe('Write tests');
    expect(task.status).toBe('pending');
    expect(task.description).toBeNull();
    expect(task.summary).toBeNull();
    expect(task.created_at).toBeTruthy();

    closeDb(db);
  });

  it('getTask retrieves a created task', () => {
    const db = makeDb();
    setupHierarchy(db);

    createTask(db, { id: 'task-001', slice_id: 'sl-001', milestone_id: 'ms-001', title: 'Write tests' });
    const found = getTask(db, 'task-001');

    expect(found).toBeDefined();
    expect(found!.title).toBe('Write tests');

    closeDb(db);
  });

  it('getTask with nonexistent id returns undefined', () => {
    const db = makeDb();
    setupHierarchy(db);

    expect(getTask(db, 'ghost')).toBeUndefined();

    closeDb(db);
  });

  it('updateTask changes specific fields', () => {
    const db = makeDb();
    setupHierarchy(db);

    createTask(db, { id: 'task-001', slice_id: 'sl-001', milestone_id: 'ms-001', title: 'Write tests' });
    const updated = updateTask(db, 'task-001', {
      status: 'completed',
      summary: 'All tests pass',
    });

    expect(updated).toBeDefined();
    expect(updated!.status).toBe('completed');
    expect(updated!.summary).toBe('All tests pass');
    expect(updated!.title).toBe('Write tests'); // unchanged

    closeDb(db);
  });

  it('updateTask with nonexistent id returns undefined', () => {
    const db = makeDb();
    setupHierarchy(db);

    expect(updateTask(db, 'ghost', { status: 'done' })).toBeUndefined();

    closeDb(db);
  });

  it('listTasks returns tasks filtered by slice_id', () => {
    const db = makeDb();
    setupHierarchy(db);
    createSlice(db, { id: 'sl-002', milestone_id: 'ms-001', title: 'Dashboard' });

    createTask(db, { id: 't1', slice_id: 'sl-001', milestone_id: 'ms-001', title: 'A' });
    createTask(db, { id: 't2', slice_id: 'sl-001', milestone_id: 'ms-001', title: 'B' });
    createTask(db, { id: 't3', slice_id: 'sl-002', milestone_id: 'ms-001', title: 'C' });

    const sl1Tasks = listTasks(db, { slice_id: 'sl-001' });
    expect(sl1Tasks).toHaveLength(2);

    const sl2Tasks = listTasks(db, { slice_id: 'sl-002' });
    expect(sl2Tasks).toHaveLength(1);
    expect(sl2Tasks[0].id).toBe('t3');

    closeDb(db);
  });

  it('listTasks filters by status', () => {
    const db = makeDb();
    setupHierarchy(db);

    createTask(db, { id: 't1', slice_id: 'sl-001', milestone_id: 'ms-001', title: 'A', status: 'pending' });
    createTask(db, { id: 't2', slice_id: 'sl-001', milestone_id: 'ms-001', title: 'B', status: 'completed' });

    const pending = listTasks(db, { status: 'pending' });
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('t1');

    closeDb(db);
  });

  it('FK constraint: createTask with nonexistent slice_id throws', () => {
    const db = makeDb();
    setupHierarchy(db);

    expect(() =>
      createTask(db, { id: 't-bad', slice_id: 'no-such-slice', milestone_id: 'ms-001', title: 'Orphan' })
    ).toThrow();

    closeDb(db);
  });

  it('FK constraint: createTask with nonexistent milestone_id throws', () => {
    const db = makeDb();
    setupHierarchy(db);

    expect(() =>
      createTask(db, { id: 't-bad', slice_id: 'sl-001', milestone_id: 'no-such-ms', title: 'Orphan' })
    ).toThrow();

    closeDb(db);
  });
});

// ── Hierarchy integration tests ────────────────────────────────────

describe('Hierarchy integration', () => {
  it('milestone → slices → tasks: parent queries return correct counts', () => {
    const db = makeDb();
    ensureSchema(db);

    // Create 1 milestone
    createMilestone(db, { id: 'ms-001', title: 'MVP' });

    // Create 2 slices under it
    createSlice(db, { id: 'sl-001', milestone_id: 'ms-001', title: 'Auth' });
    createSlice(db, { id: 'sl-002', milestone_id: 'ms-001', title: 'Dashboard' });

    // Create 3 tasks across slices (2 in sl-001, 1 in sl-002)
    createTask(db, { id: 't1', slice_id: 'sl-001', milestone_id: 'ms-001', title: 'Login form' });
    createTask(db, { id: 't2', slice_id: 'sl-001', milestone_id: 'ms-001', title: 'Session mgmt' });
    createTask(db, { id: 't3', slice_id: 'sl-002', milestone_id: 'ms-001', title: 'Widgets' });

    // List slices by milestone
    const slices = listSlices(db, { milestone_id: 'ms-001' });
    expect(slices).toHaveLength(2);

    // List tasks by slice
    const sl1Tasks = listTasks(db, { slice_id: 'sl-001' });
    expect(sl1Tasks).toHaveLength(2);

    const sl2Tasks = listTasks(db, { slice_id: 'sl-002' });
    expect(sl2Tasks).toHaveLength(1);
    expect(sl2Tasks[0].title).toBe('Widgets');

    // List all tasks by milestone
    const allTasks = listTasks(db, { milestone_id: 'ms-001' });
    expect(allTasks).toHaveLength(3);

    closeDb(db);
  });

  it('deleting a milestone cascades or is blocked by FK', () => {
    const db = makeDb();
    ensureSchema(db);

    createMilestone(db, { id: 'ms-001', title: 'MVP' });
    createSlice(db, { id: 'sl-001', milestone_id: 'ms-001', title: 'Auth' });

    // With FK enforcement on and no CASCADE, deleting a milestone with children should throw
    expect(() => db.prepare('DELETE FROM milestones WHERE id = ?').run('ms-001')).toThrow();

    closeDb(db);
  });
});
