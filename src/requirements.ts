import Database from 'better-sqlite3';
import { writeFileSync } from 'fs';
import { join } from 'path';

// ── Types ──────────────────────────────────────────────────────────

export type RequirementStatus = 'active' | 'validated' | 'deferred' | 'out-of-scope';
export type RequirementClass =
  | 'core-capability'
  | 'differentiator'
  | 'quality-attribute'
  | 'compliance/security'
  | 'launchability'
  | 'continuity'
  | 'integration'
  | 'anti-feature';

export interface RequirementData {
  id: string;
  title: string;
  req_class: RequirementClass;
  status?: RequirementStatus;
  description?: string | null;
  why_it_matters?: string | null;
  source?: string | null;
  primary_owner?: string | null;
  supporting_slices?: string | null;
  validation?: string | null;
  notes?: string | null;
}

export interface Requirement {
  id: string;
  title: string;
  req_class: RequirementClass;
  status: RequirementStatus;
  description: string | null;
  why_it_matters: string | null;
  source: string | null;
  primary_owner: string | null;
  supporting_slices: string | null;
  validation: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RequirementUpdate {
  title?: string;
  req_class?: RequirementClass;
  status?: RequirementStatus;
  description?: string | null;
  why_it_matters?: string | null;
  source?: string | null;
  primary_owner?: string | null;
  supporting_slices?: string | null;
  validation?: string | null;
  notes?: string | null;
}

// ── Valid values ────────────────────────────────────────────────────

export const VALID_STATUSES: ReadonlySet<string> = new Set<RequirementStatus>([
  'active',
  'validated',
  'deferred',
  'out-of-scope',
]);

export const VALID_CLASSES: ReadonlySet<string> = new Set<RequirementClass>([
  'core-capability',
  'differentiator',
  'quality-attribute',
  'compliance/security',
  'launchability',
  'continuity',
  'integration',
  'anti-feature',
]);

// ── Schema ─────────────────────────────────────────────────────────

/**
 * Creates the requirements table idempotently.
 */
export function ensureRequirementsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS requirements (
      id                TEXT PRIMARY KEY,
      title             TEXT NOT NULL,
      req_class         TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'active',
      description       TEXT,
      why_it_matters    TEXT,
      source            TEXT,
      primary_owner     TEXT,
      supporting_slices TEXT,
      validation        TEXT DEFAULT 'unmapped',
      notes             TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );
  `);
}

// ── CRUD ────────────────────────────────────────────────────────────

/**
 * Creates a requirement record. Auto-generates timestamps.
 */
export function createRequirement(
  db: Database.Database,
  data: RequirementData,
): Requirement {
  const status = data.status ?? 'active';
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Invalid status "${status}". Must be one of: ${[...VALID_STATUSES].join(', ')}`);
  }
  if (!VALID_CLASSES.has(data.req_class)) {
    throw new Error(`Invalid class "${data.req_class}". Must be one of: ${[...VALID_CLASSES].join(', ')}`);
  }

  const now = new Date().toISOString();
  const row = {
    id: data.id,
    title: data.title,
    req_class: data.req_class,
    status,
    description: data.description ?? null,
    why_it_matters: data.why_it_matters ?? null,
    source: data.source ?? null,
    primary_owner: data.primary_owner ?? null,
    supporting_slices: data.supporting_slices ?? null,
    validation: data.validation ?? 'unmapped',
    notes: data.notes ?? null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO requirements (id, title, req_class, status, description, why_it_matters,
      source, primary_owner, supporting_slices, validation, notes, created_at, updated_at)
    VALUES (@id, @title, @req_class, @status, @description, @why_it_matters,
      @source, @primary_owner, @supporting_slices, @validation, @notes, @created_at, @updated_at)
  `).run(row);

  return row as Requirement;
}

/**
 * Retrieves a requirement by id. Returns undefined if not found.
 */
export function getRequirement(
  db: Database.Database,
  id: string,
): Requirement | undefined {
  return db.prepare('SELECT * FROM requirements WHERE id = ?').get(id) as Requirement | undefined;
}

/**
 * Updates a requirement with the provided fields.
 * Validates status and class if provided.
 * Returns undefined if not found.
 */
export function updateRequirement(
  db: Database.Database,
  id: string,
  data: RequirementUpdate,
): Requirement | undefined {
  const existing = getRequirement(db, id);
  if (!existing) return undefined;

  if (data.status !== undefined && !VALID_STATUSES.has(data.status)) {
    throw new Error(`Invalid status "${data.status}". Must be one of: ${[...VALID_STATUSES].join(', ')}`);
  }
  if (data.req_class !== undefined && !VALID_CLASSES.has(data.req_class)) {
    throw new Error(`Invalid class "${data.req_class}". Must be one of: ${[...VALID_CLASSES].join(', ')}`);
  }

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

  db.prepare(`UPDATE requirements SET ${setClauses.join(', ')} WHERE id = @id`).run(params);

  return getRequirement(db, id);
}

/**
 * Lists requirements. Optionally filter by status and/or class.
 */
export function listRequirements(
  db: Database.Database,
  filter?: { status?: RequirementStatus; req_class?: RequirementClass },
): Requirement[] {
  let sql = 'SELECT * FROM requirements';
  const params: Record<string, unknown> = {};
  const clauses: string[] = [];

  if (filter?.status) {
    clauses.push('status = @status');
    params.status = filter.status;
  }
  if (filter?.req_class) {
    clauses.push('req_class = @req_class');
    params.req_class = filter.req_class;
  }

  if (clauses.length > 0) {
    sql += ' WHERE ' + clauses.join(' AND ');
  }

  sql += ' ORDER BY id ASC';

  return db.prepare(sql).all(params) as Requirement[];
}

/**
 * Deletes a requirement by id. Returns true if deleted, false if not found.
 */
export function deleteRequirement(
  db: Database.Database,
  id: string,
): boolean {
  const result = db.prepare('DELETE FROM requirements WHERE id = ?').run(id);
  return result.changes > 0;
}

// ── Markdown rendering ─────────────────────────────────────────────

/**
 * Renders all requirements as a REQUIREMENTS.md markdown string.
 * Groups by status: Active, Validated, Deferred, Out of Scope.
 * Includes a traceability table at the bottom.
 */
export function renderRequirements(db: Database.Database): string {
  const all = listRequirements(db);
  const lines: string[] = [];

  lines.push('# Requirements');
  lines.push('');
  lines.push('This file is the explicit capability and coverage contract for the project.');

  const statusSections: { status: RequirementStatus; heading: string }[] = [
    { status: 'active', heading: 'Active' },
    { status: 'validated', heading: 'Validated' },
    { status: 'deferred', heading: 'Deferred' },
    { status: 'out-of-scope', heading: 'Out of Scope' },
  ];

  for (const { status, heading } of statusSections) {
    const reqs = all.filter((r) => r.status === status);
    lines.push('');
    lines.push(`## ${heading}`);

    if (reqs.length === 0) {
      lines.push('');
      lines.push('None.');
      continue;
    }

    for (const req of reqs) {
      lines.push('');
      lines.push(`### ${req.id} — ${req.title}`);
      lines.push(`- Class: ${req.req_class}`);
      lines.push(`- Status: ${req.status}`);
      if (req.description) lines.push(`- Description: ${req.description}`);
      if (req.why_it_matters) lines.push(`- Why it matters: ${req.why_it_matters}`);
      if (req.source) lines.push(`- Source: ${req.source}`);
      lines.push(`- Primary owning slice: ${req.primary_owner ?? 'none'}`);
      lines.push(`- Supporting slices: ${req.supporting_slices ?? 'none'}`);
      lines.push(`- Validation: ${req.validation ?? 'unmapped'}`);
      if (req.notes) lines.push(`- Notes: ${req.notes}`);
    }
  }

  // Traceability table
  lines.push('');
  lines.push('## Traceability');
  lines.push('');
  lines.push('| ID | Class | Status | Primary owner | Supporting | Proof |');
  lines.push('|---|---|---|---|---|---|');

  for (const req of all) {
    const proof = req.validation ?? 'unmapped';
    lines.push(
      `| ${req.id} | ${req.req_class} | ${req.status} | ${req.primary_owner ?? 'none'} | ${req.supporting_slices ?? 'none'} | ${proof} |`,
    );
  }

  // Coverage summary
  const active = all.filter((r) => r.status === 'active');
  const validated = all.filter((r) => r.status === 'validated');
  const mapped = active.filter((r) => r.primary_owner && r.primary_owner !== 'none');

  lines.push('');
  lines.push('## Coverage Summary');
  lines.push('');
  lines.push(`- Active requirements: ${active.length}`);
  lines.push(`- Mapped to slices: ${mapped.length}`);
  lines.push(`- Validated: ${validated.length} (${validated.map((r) => r.id).join(', ') || 'none'})`);
  lines.push(`- Unmapped active requirements: ${active.length - mapped.length}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Renders requirements to a REQUIREMENTS.md file in the given directory.
 * Returns the written file path.
 */
export function renderRequirementsToFile(
  db: Database.Database,
  outputDir: string,
): { ok: true; path: string } {
  const content = renderRequirements(db);
  const filePath = join(outputDir, 'REQUIREMENTS.md');
  writeFileSync(filePath, content, 'utf-8');
  return { ok: true, path: filePath };
}
