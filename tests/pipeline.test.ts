import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getDb, closeDb } from '../src/db.js';
import { ensureSchema } from '../src/state.js';
import {
  initPipeline,
  getPipelineState,
  transitionPipeline,
  cancelPipeline,
  generatePipelineId,
  getStepsForType,
  scaleToType,
} from '../src/pipeline.js';
import type { PipelineResult } from '../src/pipeline.js';

// ── Helpers ────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = getDb(); // in-memory
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  return db;
}

// ── Step definitions ───────────────────────────────────────────────

describe('pipeline step definitions', () => {
  it('standard has 10 steps', () => {
    const steps = getStepsForType('standard');
    expect(steps).toHaveLength(10);
    expect(steps.map((s) => s.id)).toEqual([
      'init', 'research', 'plan', 'plan-check', 'checkpoint',
      'branch', 'execute', 'verify', 'commit', 'finalize',
    ]);
  });

  it('quick has 6 steps', () => {
    const steps = getStepsForType('quick');
    expect(steps).toHaveLength(6);
    expect(steps.map((s) => s.id)).toEqual([
      'init', 'plan', 'execute', 'verify', 'commit', 'finalize',
    ]);
  });

  it('trivial has 4 steps', () => {
    const steps = getStepsForType('trivial');
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.id)).toEqual([
      'init', 'execute', 'commit', 'finalize',
    ]);
  });

  it('each step has id, name, and mode', () => {
    for (const type of ['standard', 'quick', 'trivial'] as const) {
      for (const step of getStepsForType(type)) {
        expect(step.id).toBeTruthy();
        expect(step.name).toBeTruthy();
        expect(['read', 'write', 'readwrite']).toContain(step.mode);
      }
    }
  });
});

// ── Scale mapping ──────────────────────────────────────────────────

describe('scale to pipeline type mapping', () => {
  it('small → trivial', () => expect(scaleToType('small')).toBe('trivial'));
  it('medium → quick', () => expect(scaleToType('medium')).toBe('quick'));
  it('large → standard', () => expect(scaleToType('large')).toBe('standard'));
});

// ── Pipeline ID format ─────────────────────────────────────────────

describe('generatePipelineId', () => {
  it('produces {YYYYMMDD}_{6char}_{slug} format', () => {
    const id = generatePipelineId('Build login page');
    const parts = id.split('_');
    // Date part: 8 digits
    expect(parts[0]).toMatch(/^\d{8}$/);
    // UID part: 6 alphanumeric chars
    expect(parts[1]).toMatch(/^[a-z0-9]{6}$/);
    // Slug part: lowercased, hyphenated
    expect(parts.slice(2).join('_')).toMatch(/^[a-z0-9-]+$/);
  });

  it('slugifies special characters', () => {
    const id = generatePipelineId('Fix bug #42 in auth!');
    expect(id).toContain('fix-bug-42-in-auth');
  });

  it('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      ids.add(generatePipelineId('test'));
    }
    // All 20 should be unique (random 6-char uid)
    expect(ids.size).toBe(20);
  });
});

// ── initPipeline ───────────────────────────────────────────────────

describe('initPipeline', () => {
  it('creates a pipeline with small scale → trivial type, 4 steps', () => {
    const db = makeDb();
    const result = initPipeline(db, 'Small task', 'small');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pipeline.pipeline_type).toBe('trivial');
    expect(result.pipeline.scale).toBe('small');
    expect(result.pipeline.steps).toHaveLength(4);
    expect(result.pipeline.current_step).toBe('init');
    expect(result.pipeline.completed_steps).toEqual([]);
    expect(result.pipeline.status).toBe('active');

    closeDb(db);
  });

  it('creates a pipeline with medium scale → quick type, 6 steps', () => {
    const db = makeDb();
    const result = initPipeline(db, 'Medium task', 'medium');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pipeline.pipeline_type).toBe('quick');
    expect(result.pipeline.steps).toHaveLength(6);

    closeDb(db);
  });

  it('creates a pipeline with large scale → standard type, 10 steps', () => {
    const db = makeDb();
    const result = initPipeline(db, 'Large task', 'large');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pipeline.pipeline_type).toBe('standard');
    expect(result.pipeline.steps).toHaveLength(10);

    closeDb(db);
  });

  it('rejects invalid scale', () => {
    const db = makeDb();
    const result = initPipeline(db, 'Bad scale', 'huge');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Invalid scale');
    expect(result.error).toContain('huge');

    closeDb(db);
  });

  it('rejects when an active pipeline already exists', () => {
    const db = makeDb();
    const first = initPipeline(db, 'First task', 'small');
    expect(first.ok).toBe(true);

    const second = initPipeline(db, 'Second task', 'medium');
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toContain('active pipeline already exists');

    closeDb(db);
  });

  it('allows new pipeline after previous one is cancelled', () => {
    const db = makeDb();
    initPipeline(db, 'First', 'small');
    cancelPipeline(db);

    const result = initPipeline(db, 'Second', 'medium');
    expect(result.ok).toBe(true);

    closeDb(db);
  });

  it('pipeline ID contains the slugified request', () => {
    const db = makeDb();
    const result = initPipeline(db, 'Build login page', 'small');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pipeline.id).toContain('build-login-page');

    closeDb(db);
  });
});

// ── getPipelineState ───────────────────────────────────────────────

describe('getPipelineState', () => {
  it('returns null when no pipelines exist', () => {
    const db = makeDb();
    expect(getPipelineState(db)).toBeNull();
    closeDb(db);
  });

  it('returns the active pipeline', () => {
    const db = makeDb();
    initPipeline(db, 'My task', 'small');

    const state = getPipelineState(db);
    expect(state).not.toBeNull();
    expect(state!.request).toBe('My task');
    expect(state!.status).toBe('active');

    closeDb(db);
  });

  it('returns null after pipeline is cancelled', () => {
    const db = makeDb();
    initPipeline(db, 'Task', 'small');
    cancelPipeline(db);

    expect(getPipelineState(db)).toBeNull();

    closeDb(db);
  });
});

// ── transitionPipeline ─────────────────────────────────────────────

describe('transitionPipeline', () => {
  it('advances from first to second step', () => {
    const db = makeDb();
    initPipeline(db, 'Task', 'small'); // trivial: init, execute, commit, finalize

    const result = transitionPipeline(db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pipeline.current_step).toBe('execute');
    expect(result.pipeline.completed_steps).toEqual(['init']);

    closeDb(db);
  });

  it('completes trivial pipeline after all transitions (4 steps)', () => {
    const db = makeDb();
    initPipeline(db, 'Task', 'small'); // trivial: 4 steps

    // Transition through all 4 steps — last transition marks completed
    for (let i = 0; i < 4; i++) {
      const result = transitionPipeline(db);
      expect(result.ok).toBe(true);
    }

    const state = getPipelineState(db);
    expect(state).toBeNull(); // no active pipeline — it's completed

    closeDb(db);
  });

  it('completes quick pipeline after all transitions (6 steps)', () => {
    const db = makeDb();
    initPipeline(db, 'Task', 'medium'); // quick: 6 steps

    for (let i = 0; i < 6; i++) {
      const result = transitionPipeline(db);
      expect(result.ok).toBe(true);
    }

    expect(getPipelineState(db)).toBeNull();

    closeDb(db);
  });

  it('completes standard pipeline after all transitions (10 steps)', () => {
    const db = makeDb();
    initPipeline(db, 'Task', 'large'); // standard: 10 steps

    for (let i = 0; i < 10; i++) {
      const result = transitionPipeline(db);
      expect(result.ok).toBe(true);
    }

    expect(getPipelineState(db)).toBeNull();

    closeDb(db);
  });

  it('errors when no active pipeline exists', () => {
    const db = makeDb();
    const result = transitionPipeline(db);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('No active pipeline');

    closeDb(db);
  });

  it('errors after pipeline is completed (transition past last step)', () => {
    const db = makeDb();
    initPipeline(db, 'Task', 'small'); // trivial: 4 steps

    // Complete all steps
    for (let i = 0; i < 4; i++) {
      transitionPipeline(db);
    }

    // One more should fail — no active pipeline
    const result = transitionPipeline(db);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('No active pipeline');

    closeDb(db);
  });

  it('errors after pipeline is cancelled', () => {
    const db = makeDb();
    initPipeline(db, 'Task', 'small');
    cancelPipeline(db);

    const result = transitionPipeline(db);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('No active pipeline');

    closeDb(db);
  });

  it('completed pipeline has all step IDs in completed_steps', () => {
    const db = makeDb();
    initPipeline(db, 'Task', 'small'); // trivial: init, execute, commit, finalize

    let lastResult: PipelineResult = { ok: false, error: '' };
    for (let i = 0; i < 4; i++) {
      lastResult = transitionPipeline(db);
    }

    expect(lastResult.ok).toBe(true);
    if (!lastResult.ok) return;
    expect(lastResult.pipeline.completed_steps).toEqual([
      'init', 'execute', 'commit', 'finalize',
    ]);
    expect(lastResult.pipeline.status).toBe('completed');

    closeDb(db);
  });
});

// ── cancelPipeline ─────────────────────────────────────────────────

describe('cancelPipeline', () => {
  it('cancels an active pipeline', () => {
    const db = makeDb();
    initPipeline(db, 'Task', 'small');

    const result = cancelPipeline(db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pipeline.status).toBe('cancelled');

    closeDb(db);
  });

  it('errors when no active pipeline exists', () => {
    const db = makeDb();
    const result = cancelPipeline(db);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('No active pipeline');

    closeDb(db);
  });

  it('errors when pipeline is already cancelled (double cancel)', () => {
    const db = makeDb();
    initPipeline(db, 'Task', 'small');
    cancelPipeline(db);

    const result = cancelPipeline(db);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('No active pipeline');

    closeDb(db);
  });

  it('preserves completed_steps and current_step on cancel', () => {
    const db = makeDb();
    initPipeline(db, 'Task', 'small');
    transitionPipeline(db); // init → execute

    const result = cancelPipeline(db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pipeline.completed_steps).toEqual(['init']);
    expect(result.pipeline.current_step).toBe('execute');
    expect(result.pipeline.status).toBe('cancelled');

    closeDb(db);
  });
});
