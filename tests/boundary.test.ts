import { describe, it, expect } from 'vitest';
import {
  openStateDb,
  createMilestone,
  createSlice,
} from '../src/state.js';
import {
  ensureBoundarySchema,
  setBoundary,
  getBoundary,
  listBoundaries,
  renderBoundaryMap,
} from '../src/boundary.js';
import type { BoundaryEntry } from '../src/artifacts.js';

// ── Helpers ────────────────────────────────────────────────────────

function setupDb() {
  const db = openStateDb(); // in-memory
  ensureBoundarySchema(db);
  createMilestone(db, { id: 'M1', title: 'Milestone 1' });
  createSlice(db, { id: 'S1', milestone_id: 'M1', title: 'Slice 1' });
  createSlice(db, { id: 'S2', milestone_id: 'M1', title: 'Slice 2' });
  return db;
}

// ── ensureBoundarySchema ───────────────────────────────────────────

describe('ensureBoundarySchema', () => {
  it('creates boundary_maps table', () => {
    const db = openStateDb();
    ensureBoundarySchema(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='boundary_maps'")
      .all() as { name: string }[];

    expect(tables).toHaveLength(1);
  });

  it('is idempotent — calling twice does not throw', () => {
    const db = openStateDb();
    ensureBoundarySchema(db);
    ensureBoundarySchema(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='boundary_maps'")
      .all() as { name: string }[];

    expect(tables).toHaveLength(1);
  });
});

// ── setBoundary / getBoundary ──────────────────────────────────────

describe('setBoundary / getBoundary', () => {
  it('round-trips boundary data', () => {
    const db = setupDb();

    setBoundary(db, 'S1', { produces: ['auth token', 'session'], consumes: ['user DB'] });

    const result = getBoundary(db, 'S1');
    expect(result).toEqual({
      produces: ['auth token', 'session'],
      consumes: ['user DB'],
    });
  });

  it('returns undefined for non-existent boundary', () => {
    const db = setupDb();
    const result = getBoundary(db, 'S999');
    expect(result).toBeUndefined();
  });

  it('upserts on conflict — overwrites existing data', () => {
    const db = setupDb();

    setBoundary(db, 'S1', { produces: ['v1'], consumes: [] });
    setBoundary(db, 'S1', { produces: ['v2'], consumes: ['input'] });

    const result = getBoundary(db, 'S1');
    expect(result).toEqual({ produces: ['v2'], consumes: ['input'] });
  });

  it('handles empty arrays', () => {
    const db = setupDb();

    setBoundary(db, 'S1', { produces: [], consumes: [] });

    const result = getBoundary(db, 'S1');
    expect(result).toEqual({ produces: [], consumes: [] });
  });
});

// ── listBoundaries ─────────────────────────────────────────────────

describe('listBoundaries', () => {
  it('returns boundary entries for a milestone', () => {
    const db = setupDb();

    setBoundary(db, 'S1', { produces: ['token'], consumes: [] });
    setBoundary(db, 'S2', { produces: [], consumes: ['token'] });

    const entries = listBoundaries(db, 'M1');
    expect(entries).toHaveLength(2);

    const s1Entry = entries.find((e) => e.slice_id === 'S1');
    expect(s1Entry?.slice_title).toBe('Slice 1');
    expect(s1Entry?.produces).toEqual(['token']);
  });

  it('filters by milestone — does not return other milestone boundaries', () => {
    const db = setupDb();
    createMilestone(db, { id: 'M2', title: 'Milestone 2' });
    createSlice(db, { id: 'S3', milestone_id: 'M2', title: 'Slice 3' });

    setBoundary(db, 'S1', { produces: ['a'], consumes: [] });
    setBoundary(db, 'S3', { produces: ['b'], consumes: [] });

    const entries = listBoundaries(db, 'M1');
    expect(entries).toHaveLength(1);
    expect(entries[0].slice_id).toBe('S1');
  });

  it('returns empty array when no boundaries exist', () => {
    const db = setupDb();
    const entries = listBoundaries(db, 'M1');
    expect(entries).toHaveLength(0);
  });
});

// ── renderBoundaryMap ──────────────────────────────────────────────

describe('renderBoundaryMap', () => {
  it('renders a markdown table with produces and consumes', () => {
    const entries: BoundaryEntry[] = [
      { slice_id: 'S01', slice_title: 'Login', produces: ['JWT token'], consumes: ['user DB'] },
      { slice_id: 'S02', slice_title: 'Dashboard', produces: [], consumes: ['JWT token'] },
    ];

    const md = renderBoundaryMap(entries);

    expect(md).toContain('| Slice | Produces | Consumes |');
    expect(md).toContain('|-------|----------|----------|');
    expect(md).toContain('| S01 | JWT token | user DB |');
    expect(md).toContain('| S02 | — | JWT token |');
  });

  it('uses em-dash for empty arrays', () => {
    const entries: BoundaryEntry[] = [
      { slice_id: 'S01', slice_title: 'Init', produces: [], consumes: [] },
    ];

    const md = renderBoundaryMap(entries);

    expect(md).toContain('| S01 | — | — |');
  });
});
