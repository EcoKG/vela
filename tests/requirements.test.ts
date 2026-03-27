import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getDb } from '../src/db.js';
import { ensureSchema } from '../src/state.js';
import {
  ensureRequirementsSchema,
  createRequirement,
  getRequirement,
  updateRequirement,
  listRequirements,
  deleteRequirement,
  renderRequirements,
  renderRequirementsToFile,
  VALID_STATUSES,
  VALID_CLASSES,
} from '../src/requirements.js';
import type { RequirementData, RequirementStatus, RequirementClass } from '../src/requirements.js';

// ── Helpers ────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = getDb(); // in-memory
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  ensureRequirementsSchema(db);
  return db;
}

function sampleReq(overrides?: Partial<RequirementData>): RequirementData {
  return {
    id: 'R001',
    title: 'Test requirement',
    req_class: 'core-capability',
    ...overrides,
  };
}

// ── Schema tests ───────────────────────────────────────────────────

describe('ensureRequirementsSchema', () => {
  it('creates requirements table', () => {
    const db = makeDb();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='requirements'",
    ).all();
    expect(tables).toHaveLength(1);
    db.close();
  });

  it('is idempotent', () => {
    const db = makeDb();
    ensureRequirementsSchema(db); // second call
    ensureRequirementsSchema(db); // third call
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='requirements'",
    ).all();
    expect(tables).toHaveLength(1);
    db.close();
  });
});

// ── CRUD tests ─────────────────────────────────────────────────────

describe('createRequirement', () => {
  it('creates a requirement with defaults', () => {
    const db = makeDb();
    const req = createRequirement(db, sampleReq());
    expect(req.id).toBe('R001');
    expect(req.title).toBe('Test requirement');
    expect(req.req_class).toBe('core-capability');
    expect(req.status).toBe('active');
    expect(req.validation).toBe('unmapped');
    expect(req.created_at).toBeTruthy();
    expect(req.updated_at).toBeTruthy();
    db.close();
  });

  it('creates with all fields populated', () => {
    const db = makeDb();
    const req = createRequirement(db, {
      id: 'R100',
      title: 'Full requirement',
      req_class: 'differentiator',
      status: 'validated',
      description: 'A detailed description',
      why_it_matters: 'Very important',
      source: 'user',
      primary_owner: 'M001/S01',
      supporting_slices: 'M001/S02',
      validation: 'tested with 10 tests',
      notes: 'Some notes',
    });
    expect(req.status).toBe('validated');
    expect(req.description).toBe('A detailed description');
    expect(req.why_it_matters).toBe('Very important');
    expect(req.source).toBe('user');
    expect(req.primary_owner).toBe('M001/S01');
    expect(req.supporting_slices).toBe('M001/S02');
    expect(req.validation).toBe('tested with 10 tests');
    expect(req.notes).toBe('Some notes');
    db.close();
  });

  it('rejects invalid status', () => {
    const db = makeDb();
    expect(() =>
      createRequirement(db, sampleReq({ status: 'invalid' as RequirementStatus })),
    ).toThrow('Invalid status');
    db.close();
  });

  it('rejects invalid class', () => {
    const db = makeDb();
    expect(() =>
      createRequirement(db, sampleReq({ req_class: 'bogus' as RequirementClass })),
    ).toThrow('Invalid class');
    db.close();
  });

  it('rejects duplicate id', () => {
    const db = makeDb();
    createRequirement(db, sampleReq());
    expect(() => createRequirement(db, sampleReq())).toThrow();
    db.close();
  });
});

describe('getRequirement', () => {
  it('returns requirement by id', () => {
    const db = makeDb();
    createRequirement(db, sampleReq());
    const req = getRequirement(db, 'R001');
    expect(req).toBeDefined();
    expect(req!.id).toBe('R001');
    db.close();
  });

  it('returns undefined for non-existent id', () => {
    const db = makeDb();
    expect(getRequirement(db, 'R999')).toBeUndefined();
    db.close();
  });
});

describe('updateRequirement', () => {
  it('updates status', () => {
    const db = makeDb();
    createRequirement(db, sampleReq());
    const updated = updateRequirement(db, 'R001', { status: 'validated' });
    expect(updated).toBeDefined();
    expect(updated!.status).toBe('validated');
    db.close();
  });

  it('updates title and description', () => {
    const db = makeDb();
    createRequirement(db, sampleReq());
    const updated = updateRequirement(db, 'R001', {
      title: 'New title',
      description: 'New description',
    });
    expect(updated!.title).toBe('New title');
    expect(updated!.description).toBe('New description');
    db.close();
  });

  it('updates validation field', () => {
    const db = makeDb();
    createRequirement(db, sampleReq());
    const updated = updateRequirement(db, 'R001', {
      validation: '5 tests pass',
    });
    expect(updated!.validation).toBe('5 tests pass');
    db.close();
  });

  it('updates updated_at timestamp', () => {
    const db = makeDb();
    const created = createRequirement(db, sampleReq());
    // Force updated_at to differ by setting it manually, then updating
    db.prepare("UPDATE requirements SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = 'R001'").run();
    const updated = updateRequirement(db, 'R001', { status: 'validated' });
    expect(updated!.updated_at).not.toBe('2020-01-01T00:00:00.000Z');
    db.close();
  });

  it('returns existing if no fields provided', () => {
    const db = makeDb();
    createRequirement(db, sampleReq());
    const updated = updateRequirement(db, 'R001', {});
    expect(updated).toBeDefined();
    expect(updated!.status).toBe('active');
    db.close();
  });

  it('returns undefined for non-existent id', () => {
    const db = makeDb();
    expect(updateRequirement(db, 'R999', { status: 'validated' })).toBeUndefined();
    db.close();
  });

  it('rejects invalid status', () => {
    const db = makeDb();
    createRequirement(db, sampleReq());
    expect(() =>
      updateRequirement(db, 'R001', { status: 'bogus' as RequirementStatus }),
    ).toThrow('Invalid status');
    db.close();
  });

  it('rejects invalid class', () => {
    const db = makeDb();
    createRequirement(db, sampleReq());
    expect(() =>
      updateRequirement(db, 'R001', { req_class: 'bogus' as RequirementClass }),
    ).toThrow('Invalid class');
    db.close();
  });

  it('allows all valid status transitions', () => {
    const db = makeDb();
    createRequirement(db, sampleReq());
    for (const status of VALID_STATUSES) {
      const updated = updateRequirement(db, 'R001', { status: status as RequirementStatus });
      expect(updated!.status).toBe(status);
    }
    db.close();
  });
});

describe('listRequirements', () => {
  it('lists all requirements ordered by id', () => {
    const db = makeDb();
    createRequirement(db, sampleReq({ id: 'R002', title: 'Second' }));
    createRequirement(db, sampleReq({ id: 'R001', title: 'First' }));
    const list = listRequirements(db);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('R001');
    expect(list[1].id).toBe('R002');
    db.close();
  });

  it('filters by status', () => {
    const db = makeDb();
    createRequirement(db, sampleReq({ id: 'R001' }));
    createRequirement(db, sampleReq({ id: 'R002', status: 'validated' }));
    createRequirement(db, sampleReq({ id: 'R003', status: 'deferred' }));

    expect(listRequirements(db, { status: 'active' })).toHaveLength(1);
    expect(listRequirements(db, { status: 'validated' })).toHaveLength(1);
    expect(listRequirements(db, { status: 'deferred' })).toHaveLength(1);
    expect(listRequirements(db, { status: 'out-of-scope' })).toHaveLength(0);
    db.close();
  });

  it('filters by class', () => {
    const db = makeDb();
    createRequirement(db, sampleReq({ id: 'R001', req_class: 'core-capability' }));
    createRequirement(db, sampleReq({ id: 'R002', req_class: 'differentiator' }));

    expect(listRequirements(db, { req_class: 'core-capability' })).toHaveLength(1);
    expect(listRequirements(db, { req_class: 'differentiator' })).toHaveLength(1);
    expect(listRequirements(db, { req_class: 'launchability' })).toHaveLength(0);
    db.close();
  });

  it('filters by status and class combined', () => {
    const db = makeDb();
    createRequirement(db, sampleReq({ id: 'R001', req_class: 'core-capability', status: 'active' }));
    createRequirement(db, sampleReq({ id: 'R002', req_class: 'core-capability', status: 'validated' }));
    createRequirement(db, sampleReq({ id: 'R003', req_class: 'differentiator', status: 'active' }));

    const result = listRequirements(db, { status: 'active', req_class: 'core-capability' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('R001');
    db.close();
  });

  it('returns empty array when no requirements', () => {
    const db = makeDb();
    expect(listRequirements(db)).toHaveLength(0);
    db.close();
  });
});

describe('deleteRequirement', () => {
  it('deletes existing requirement', () => {
    const db = makeDb();
    createRequirement(db, sampleReq());
    expect(deleteRequirement(db, 'R001')).toBe(true);
    expect(getRequirement(db, 'R001')).toBeUndefined();
    db.close();
  });

  it('returns false for non-existent id', () => {
    const db = makeDb();
    expect(deleteRequirement(db, 'R999')).toBe(false);
    db.close();
  });
});

// ── Rendering tests ────────────────────────────────────────────────

describe('renderRequirements', () => {
  it('renders markdown with status sections', () => {
    const db = makeDb();
    createRequirement(db, sampleReq({ id: 'R001', title: 'Active one', status: 'active' }));
    createRequirement(db, sampleReq({ id: 'R002', title: 'Validated one', status: 'validated' }));
    createRequirement(db, sampleReq({ id: 'R003', title: 'Deferred one', status: 'deferred' }));
    createRequirement(db, sampleReq({ id: 'R004', title: 'Out of scope', status: 'out-of-scope', req_class: 'anti-feature' }));

    const md = renderRequirements(db);

    expect(md).toContain('# Requirements');
    expect(md).toContain('## Active');
    expect(md).toContain('### R001 — Active one');
    expect(md).toContain('## Validated');
    expect(md).toContain('### R002 — Validated one');
    expect(md).toContain('## Deferred');
    expect(md).toContain('### R003 — Deferred one');
    expect(md).toContain('## Out of Scope');
    expect(md).toContain('### R004 — Out of scope');
    db.close();
  });

  it('renders "None." for empty sections', () => {
    const db = makeDb();
    createRequirement(db, sampleReq({ id: 'R001', status: 'active' }));

    const md = renderRequirements(db);
    // Validated, Deferred, Out of Scope should say None.
    const validatedIdx = md.indexOf('## Validated');
    const deferredIdx = md.indexOf('## Deferred');
    const section = md.substring(validatedIdx, deferredIdx);
    expect(section).toContain('None.');
    db.close();
  });

  it('renders traceability table', () => {
    const db = makeDb();
    createRequirement(db, sampleReq({
      id: 'R001',
      primary_owner: 'M001/S01',
      supporting_slices: 'M001/S02',
      validation: '5 tests pass',
    }));

    const md = renderRequirements(db);
    expect(md).toContain('## Traceability');
    expect(md).toContain('| R001 | core-capability | active | M001/S01 | M001/S02 | 5 tests pass |');
    db.close();
  });

  it('renders coverage summary', () => {
    const db = makeDb();
    createRequirement(db, sampleReq({ id: 'R001', status: 'active', primary_owner: 'M001/S01' }));
    createRequirement(db, sampleReq({ id: 'R002', status: 'active' }));
    createRequirement(db, sampleReq({ id: 'R003', status: 'validated' }));

    const md = renderRequirements(db);
    expect(md).toContain('- Active requirements: 2');
    expect(md).toContain('- Mapped to slices: 1');
    expect(md).toContain('- Validated: 1 (R003)');
    expect(md).toContain('- Unmapped active requirements: 1');
    db.close();
  });

  it('includes all requirement fields in markdown', () => {
    const db = makeDb();
    createRequirement(db, {
      id: 'R001',
      title: 'Full requirement',
      req_class: 'differentiator',
      description: 'Test description',
      why_it_matters: 'Very important',
      source: 'user',
      primary_owner: 'M001/S01',
      supporting_slices: 'M001/S02',
      validation: 'tested',
      notes: 'Some notes',
    });

    const md = renderRequirements(db);
    expect(md).toContain('- Class: differentiator');
    expect(md).toContain('- Description: Test description');
    expect(md).toContain('- Why it matters: Very important');
    expect(md).toContain('- Source: user');
    expect(md).toContain('- Primary owning slice: M001/S01');
    expect(md).toContain('- Supporting slices: M001/S02');
    expect(md).toContain('- Validation: tested');
    expect(md).toContain('- Notes: Some notes');
    db.close();
  });

  it('renders empty requirements', () => {
    const db = makeDb();
    const md = renderRequirements(db);
    expect(md).toContain('# Requirements');
    expect(md).toContain('- Active requirements: 0');
    db.close();
  });
});

describe('renderRequirementsToFile', () => {
  it('writes REQUIREMENTS.md to disk', () => {
    const db = makeDb();
    createRequirement(db, sampleReq());

    const tmpDir = mkdtempSync(join(tmpdir(), 'vela-req-'));
    try {
      const result = renderRequirementsToFile(db, tmpDir);
      expect(result.ok).toBe(true);
      expect(result.path).toBe(join(tmpDir, 'REQUIREMENTS.md'));

      const content = readFileSync(result.path, 'utf-8');
      expect(content).toContain('# Requirements');
      expect(content).toContain('### R001 — Test requirement');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    db.close();
  });
});

// ── Constants tests ────────────────────────────────────────────────

describe('constants', () => {
  it('VALID_STATUSES has 4 entries', () => {
    expect(VALID_STATUSES.size).toBe(4);
    expect(VALID_STATUSES.has('active')).toBe(true);
    expect(VALID_STATUSES.has('validated')).toBe(true);
    expect(VALID_STATUSES.has('deferred')).toBe(true);
    expect(VALID_STATUSES.has('out-of-scope')).toBe(true);
  });

  it('VALID_CLASSES has 8 entries', () => {
    expect(VALID_CLASSES.size).toBe(8);
    expect(VALID_CLASSES.has('core-capability')).toBe(true);
    expect(VALID_CLASSES.has('anti-feature')).toBe(true);
  });
});
