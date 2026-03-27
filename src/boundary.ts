import Database from 'better-sqlite3';
import type { BoundaryEntry } from './artifacts.js';
import { listSlices } from './state.js';

// ── Boundary map data model ────────────────────────────────────────

export interface BoundaryData {
  produces: string[];
  consumes: string[];
}

interface BoundaryRow {
  slice_id: string;
  produces: string;
  consumes: string;
}

/**
 * Creates the boundary_maps table idempotently.
 */
export function ensureBoundarySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS boundary_maps (
      slice_id  TEXT PRIMARY KEY REFERENCES slices(id),
      produces  TEXT NOT NULL DEFAULT '[]',
      consumes  TEXT NOT NULL DEFAULT '[]'
    );
  `);
}

/**
 * Upserts a boundary entry for a slice.
 */
export function setBoundary(
  db: Database.Database,
  sliceId: string,
  data: BoundaryData,
): void {
  db.prepare(`
    INSERT INTO boundary_maps (slice_id, produces, consumes)
    VALUES (@slice_id, @produces, @consumes)
    ON CONFLICT(slice_id) DO UPDATE SET
      produces = @produces,
      consumes = @consumes
  `).run({
    slice_id: sliceId,
    produces: JSON.stringify(data.produces),
    consumes: JSON.stringify(data.consumes),
  });
}

/**
 * Gets the boundary entry for a slice. Returns undefined if not found.
 */
export function getBoundary(
  db: Database.Database,
  sliceId: string,
): BoundaryData | undefined {
  const row = db.prepare(
    'SELECT * FROM boundary_maps WHERE slice_id = ?',
  ).get(sliceId) as BoundaryRow | undefined;

  if (!row) return undefined;

  return {
    produces: JSON.parse(row.produces) as string[],
    consumes: JSON.parse(row.consumes) as string[],
  };
}

/**
 * Lists all boundary entries for slices belonging to a given milestone.
 * Returns BoundaryEntry[] with slice_title resolved from the slices table.
 */
export function listBoundaries(
  db: Database.Database,
  milestoneId: string,
): BoundaryEntry[] {
  const slices = listSlices(db, { milestone_id: milestoneId });
  const entries: BoundaryEntry[] = [];

  for (const slice of slices) {
    const row = db.prepare(
      'SELECT * FROM boundary_maps WHERE slice_id = ?',
    ).get(slice.id) as BoundaryRow | undefined;

    if (row) {
      entries.push({
        slice_id: slice.id,
        slice_title: slice.title,
        produces: JSON.parse(row.produces) as string[],
        consumes: JSON.parse(row.consumes) as string[],
      });
    }
  }

  return entries;
}

/**
 * Renders a boundary map as a markdown table.
 */
export function renderBoundaryMap(entries: BoundaryEntry[]): string {
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
