import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { getDb } from './db.js';
import { ensureRequirementsSchema } from './requirements.js';

// ── Types ──────────────────────────────────────────────────────────

export interface PipelineData {
  id: string;
  status?: string;
  pipeline_type: string;
  request: string;
  type?: string;
  scale: string;
  current_step: string;
  steps: string[];
  completed_steps?: string[];
  revisions?: Record<string, unknown>;
  git?: Record<string, unknown> | null;
  artifact_dir?: string | null;
}

export interface Pipeline extends PipelineData {
  status: string;
  type: string;
  completed_steps: string[];
  revisions: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PipelineUpdate {
  status?: string;
  pipeline_type?: string;
  request?: string;
  type?: string;
  scale?: string;
  current_step?: string;
  steps?: string[];
  completed_steps?: string[];
  revisions?: Record<string, unknown>;
  git?: Record<string, unknown> | null;
  artifact_dir?: string | null;
}

// ── Milestone types ────────────────────────────────────────────────

export interface MilestoneData {
  id: string;
  title: string;
  status?: string;
  description?: string | null;
}

export interface Milestone {
  id: string;
  title: string;
  status: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface MilestoneUpdate {
  title?: string;
  status?: string;
  description?: string | null;
}

// ── Slice types ────────────────────────────────────────────────────

export interface SliceData {
  id: string;
  milestone_id: string;
  title: string;
  status?: string;
  description?: string | null;
}

export interface Slice {
  id: string;
  milestone_id: string;
  title: string;
  status: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface SliceUpdate {
  title?: string;
  status?: string;
  description?: string | null;
}

// ── Task types ─────────────────────────────────────────────────────

export interface TaskData {
  id: string;
  slice_id: string;
  milestone_id: string;
  title: string;
  status?: string;
  description?: string | null;
  summary?: string | null;
}

export interface Task {
  id: string;
  slice_id: string;
  milestone_id: string;
  title: string;
  status: string;
  description: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskUpdate {
  title?: string;
  status?: string;
  description?: string | null;
  summary?: string | null;
}

// ── Schema ─────────────────────────────────────────────────────────

/**
 * Creates all four tables idempotently.
 * Safe to call on every connection open.
 */
export function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pipelines (
      id              TEXT PRIMARY KEY,
      status          TEXT NOT NULL DEFAULT 'active',
      pipeline_type   TEXT NOT NULL,
      request         TEXT NOT NULL,
      type            TEXT NOT NULL DEFAULT 'code',
      scale           TEXT NOT NULL,
      current_step    TEXT NOT NULL,
      steps           TEXT NOT NULL,
      completed_steps TEXT NOT NULL DEFAULT '[]',
      revisions       TEXT NOT NULL DEFAULT '{}',
      git             TEXT,
      artifact_dir    TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS milestones (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'active',
      description TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS slices (
      id            TEXT PRIMARY KEY,
      milestone_id  TEXT NOT NULL REFERENCES milestones(id),
      title         TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      description   TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      slice_id      TEXT NOT NULL REFERENCES slices(id),
      milestone_id  TEXT NOT NULL REFERENCES milestones(id),
      title         TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      description   TEXT,
      summary       TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
  `);
}

// ── DB lifecycle ───────────────────────────────────────────────────

/**
 * Opens the state database.
 * - With velaDir: creates <velaDir>/state/vela.db (file-backed, WAL mode)
 * - Without velaDir: in-memory database (for tests)
 * Always enables foreign keys and runs schema creation.
 */
export function openStateDb(velaDir?: string): Database.Database {
  let db: Database.Database;

  if (velaDir) {
    const stateDir = join(velaDir, 'state');
    mkdirSync(stateDir, { recursive: true });
    const dbPath = join(stateDir, 'vela.db');
    db = getDb(dbPath);
  } else {
    db = getDb(); // in-memory
  }

  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  ensureRequirementsSchema(db);
  return db;
}

// ── JSON column helpers ────────────────────────────────────────────

const JSON_PIPELINE_COLS = ['steps', 'completed_steps', 'revisions', 'git'] as const;

function parsePipelineRow(row: Record<string, unknown>): Pipeline {
  return {
    ...row,
    steps: JSON.parse(row.steps as string) as string[],
    completed_steps: JSON.parse(row.completed_steps as string) as string[],
    revisions: JSON.parse(row.revisions as string) as Record<string, unknown>,
    git: row.git ? JSON.parse(row.git as string) as Record<string, unknown> : null,
  } as Pipeline;
}

// ── Pipeline CRUD ──────────────────────────────────────────────────

/**
 * Creates a pipeline record. Auto-generates timestamps.
 * JSON columns (steps, completed_steps, revisions, git) are stringified.
 */
export function createPipeline(db: Database.Database, data: PipelineData): Pipeline {
  const now = new Date().toISOString();
  const row = {
    id: data.id,
    status: data.status ?? 'active',
    pipeline_type: data.pipeline_type,
    request: data.request,
    type: data.type ?? 'code',
    scale: data.scale,
    current_step: data.current_step,
    steps: JSON.stringify(data.steps),
    completed_steps: JSON.stringify(data.completed_steps ?? []),
    revisions: JSON.stringify(data.revisions ?? {}),
    git: data.git ? JSON.stringify(data.git) : null,
    artifact_dir: data.artifact_dir ?? null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO pipelines (id, status, pipeline_type, request, type, scale, current_step,
      steps, completed_steps, revisions, git, artifact_dir, created_at, updated_at)
    VALUES (@id, @status, @pipeline_type, @request, @type, @scale, @current_step,
      @steps, @completed_steps, @revisions, @git, @artifact_dir, @created_at, @updated_at)
  `).run(row);

  return parsePipelineRow(row);
}

/**
 * Retrieves a pipeline by id. Returns undefined if not found.
 */
export function getPipeline(db: Database.Database, id: string): Pipeline | undefined {
  const row = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return parsePipelineRow(row);
}

/**
 * Updates a pipeline with the provided fields. Re-stringifies JSON columns.
 * Automatically updates `updated_at`.
 */
export function updatePipeline(db: Database.Database, id: string, data: PipelineUpdate): Pipeline | undefined {
  const existing = getPipeline(db, id);
  if (!existing) return undefined;

  const setClauses: string[] = [];
  const params: Record<string, unknown> = { id };

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    const isJsonCol = (JSON_PIPELINE_COLS as readonly string[]).includes(key);
    const paramValue = isJsonCol && value !== null ? JSON.stringify(value) : value;
    setClauses.push(`${key} = @${key}`);
    params[key] = paramValue;
  }

  if (setClauses.length === 0) return existing;

  setClauses.push('updated_at = @updated_at');
  params.updated_at = new Date().toISOString();

  db.prepare(`UPDATE pipelines SET ${setClauses.join(', ')} WHERE id = @id`).run(params);

  return getPipeline(db, id);
}

/**
 * Lists pipelines. Optionally filter by status.
 */
export function listPipelines(db: Database.Database, filter?: { status?: string }): Pipeline[] {
  let sql = 'SELECT * FROM pipelines';
  const params: Record<string, unknown> = {};

  if (filter?.status) {
    sql += ' WHERE status = @status';
    params.status = filter.status;
  }

  sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(params) as Record<string, unknown>[];
  return rows.map(parsePipelineRow);
}

// ── Milestone CRUD ─────────────────────────────────────────────────

/**
 * Creates a milestone record. Auto-generates timestamps.
 */
export function createMilestone(db: Database.Database, data: MilestoneData): Milestone {
  const now = new Date().toISOString();
  const row = {
    id: data.id,
    title: data.title,
    status: data.status ?? 'active',
    description: data.description ?? null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO milestones (id, title, status, description, created_at, updated_at)
    VALUES (@id, @title, @status, @description, @created_at, @updated_at)
  `).run(row);

  return row as Milestone;
}

/**
 * Retrieves a milestone by id. Returns undefined if not found.
 */
export function getMilestone(db: Database.Database, id: string): Milestone | undefined {
  const row = db.prepare('SELECT * FROM milestones WHERE id = ?').get(id) as Milestone | undefined;
  return row;
}

/**
 * Updates a milestone with the provided fields. Automatically updates `updated_at`.
 * Returns undefined if not found.
 */
export function updateMilestone(db: Database.Database, id: string, data: MilestoneUpdate): Milestone | undefined {
  const existing = getMilestone(db, id);
  if (!existing) return undefined;

  const setClauses: string[] = [];
  const params: Record<string, unknown> = { id };

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    setClauses.push(`${key} = @${key}`);
    params[key] = value;
  }

  if (setClauses.length === 0) return existing;

  setClauses.push('updated_at = @updated_at');
  params.updated_at = new Date().toISOString();

  db.prepare(`UPDATE milestones SET ${setClauses.join(', ')} WHERE id = @id`).run(params);

  return getMilestone(db, id);
}

/**
 * Lists milestones. Optionally filter by status.
 */
export function listMilestones(db: Database.Database, filter?: { status?: string }): Milestone[] {
  let sql = 'SELECT * FROM milestones';
  const params: Record<string, unknown> = {};

  if (filter?.status) {
    sql += ' WHERE status = @status';
    params.status = filter.status;
  }

  sql += ' ORDER BY created_at DESC';

  return db.prepare(sql).all(params) as Milestone[];
}

// ── Slice CRUD ─────────────────────────────────────────────────────

/**
 * Creates a slice record. Auto-generates timestamps.
 * milestone_id must reference an existing milestone (FK enforced).
 */
export function createSlice(db: Database.Database, data: SliceData): Slice {
  const now = new Date().toISOString();
  const row = {
    id: data.id,
    milestone_id: data.milestone_id,
    title: data.title,
    status: data.status ?? 'pending',
    description: data.description ?? null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO slices (id, milestone_id, title, status, description, created_at, updated_at)
    VALUES (@id, @milestone_id, @title, @status, @description, @created_at, @updated_at)
  `).run(row);

  return row as Slice;
}

/**
 * Retrieves a slice by id. Returns undefined if not found.
 */
export function getSlice(db: Database.Database, id: string): Slice | undefined {
  const row = db.prepare('SELECT * FROM slices WHERE id = ?').get(id) as Slice | undefined;
  return row;
}

/**
 * Updates a slice with the provided fields. Automatically updates `updated_at`.
 * Returns undefined if not found.
 */
export function updateSlice(db: Database.Database, id: string, data: SliceUpdate): Slice | undefined {
  const existing = getSlice(db, id);
  if (!existing) return undefined;

  const setClauses: string[] = [];
  const params: Record<string, unknown> = { id };

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    setClauses.push(`${key} = @${key}`);
    params[key] = value;
  }

  if (setClauses.length === 0) return existing;

  setClauses.push('updated_at = @updated_at');
  params.updated_at = new Date().toISOString();

  db.prepare(`UPDATE slices SET ${setClauses.join(', ')} WHERE id = @id`).run(params);

  return getSlice(db, id);
}

/**
 * Lists slices. Optionally filter by milestone_id and/or status.
 */
export function listSlices(db: Database.Database, filter?: { milestone_id?: string; status?: string }): Slice[] {
  let sql = 'SELECT * FROM slices';
  const params: Record<string, unknown> = {};
  const clauses: string[] = [];

  if (filter?.milestone_id) {
    clauses.push('milestone_id = @milestone_id');
    params.milestone_id = filter.milestone_id;
  }
  if (filter?.status) {
    clauses.push('status = @status');
    params.status = filter.status;
  }

  if (clauses.length > 0) {
    sql += ' WHERE ' + clauses.join(' AND ');
  }

  sql += ' ORDER BY created_at DESC';

  return db.prepare(sql).all(params) as Slice[];
}

// ── Task CRUD ──────────────────────────────────────────────────────

/**
 * Creates a task record. Auto-generates timestamps.
 * slice_id and milestone_id must reference existing records (FK enforced).
 */
export function createTask(db: Database.Database, data: TaskData): Task {
  const now = new Date().toISOString();
  const row = {
    id: data.id,
    slice_id: data.slice_id,
    milestone_id: data.milestone_id,
    title: data.title,
    status: data.status ?? 'pending',
    description: data.description ?? null,
    summary: data.summary ?? null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO tasks (id, slice_id, milestone_id, title, status, description, summary, created_at, updated_at)
    VALUES (@id, @slice_id, @milestone_id, @title, @status, @description, @summary, @created_at, @updated_at)
  `).run(row);

  return row as Task;
}

/**
 * Retrieves a task by id. Returns undefined if not found.
 */
export function getTask(db: Database.Database, id: string): Task | undefined {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined;
  return row;
}

/**
 * Updates a task with the provided fields. Automatically updates `updated_at`.
 * Returns undefined if not found.
 */
export function updateTask(db: Database.Database, id: string, data: TaskUpdate): Task | undefined {
  const existing = getTask(db, id);
  if (!existing) return undefined;

  const setClauses: string[] = [];
  const params: Record<string, unknown> = { id };

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    setClauses.push(`${key} = @${key}`);
    params[key] = value;
  }

  if (setClauses.length === 0) return existing;

  setClauses.push('updated_at = @updated_at');
  params.updated_at = new Date().toISOString();

  db.prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = @id`).run(params);

  return getTask(db, id);
}

/**
 * Lists tasks. Optionally filter by slice_id, milestone_id, and/or status.
 */
export function listTasks(db: Database.Database, filter?: { slice_id?: string; milestone_id?: string; status?: string }): Task[] {
  let sql = 'SELECT * FROM tasks';
  const params: Record<string, unknown> = {};
  const clauses: string[] = [];

  if (filter?.slice_id) {
    clauses.push('slice_id = @slice_id');
    params.slice_id = filter.slice_id;
  }
  if (filter?.milestone_id) {
    clauses.push('milestone_id = @milestone_id');
    params.milestone_id = filter.milestone_id;
  }
  if (filter?.status) {
    clauses.push('status = @status');
    params.status = filter.status;
  }

  if (clauses.length > 0) {
    sql += ' WHERE ' + clauses.join(' AND ');
  }

  sql += ' ORDER BY created_at DESC';

  return db.prepare(sql).all(params) as Task[];
}
