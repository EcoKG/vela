import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { getDb } from '../src/db.js';
import { ensureSchema } from '../src/state.js';
import {
  validatePipelineDef,
  loadCustomPipeline,
  listCustomPipelines,
} from '../src/custom-pipeline.js';
import {
  getStepsForTypeOrCustom,
  initPipeline,
} from '../src/pipeline.js';

// ── Helpers ────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = getDb(); // in-memory
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  return db;
}

function makeTmpVelaDir(): string {
  const tmpDir = mkdtempSync(join(tmpdir(), 'vela-custom-'));
  const velaDir = join(tmpDir, '.vela');
  mkdirSync(join(velaDir, 'pipelines'), { recursive: true });
  return velaDir;
}

const VALID_PIPELINE = {
  name: 'review',
  description: 'Code review pipeline',
  steps: [
    { id: 'init', name: 'Initialize', mode: 'readwrite' },
    { id: 'review', name: 'Review Code', mode: 'read' },
    { id: 'feedback', name: 'Write Feedback', mode: 'write' },
    { id: 'finalize', name: 'Finalize', mode: 'readwrite' },
  ],
};

// ── Validation tests ───────────────────────────────────────────────

describe('validatePipelineDef', () => {
  it('accepts valid pipeline definition', () => {
    expect(validatePipelineDef(VALID_PIPELINE)).toBeNull();
  });

  it('rejects non-object', () => {
    expect(validatePipelineDef('string')).toContain('must be a JSON object');
    expect(validatePipelineDef(null)).toContain('must be a JSON object');
    expect(validatePipelineDef([])).toContain('must be a JSON object');
  });

  it('rejects missing name', () => {
    expect(validatePipelineDef({ steps: [{ id: 'a', name: 'A', mode: 'read' }] })).toContain('name');
  });

  it('rejects empty name', () => {
    expect(validatePipelineDef({ name: '', steps: [{ id: 'a', name: 'A', mode: 'read' }] })).toContain('name');
  });

  it('rejects missing steps', () => {
    expect(validatePipelineDef({ name: 'test' })).toContain('steps');
  });

  it('rejects empty steps', () => {
    expect(validatePipelineDef({ name: 'test', steps: [] })).toContain('steps');
  });

  it('rejects step without id', () => {
    expect(validatePipelineDef({
      name: 'test',
      steps: [{ name: 'A', mode: 'read' }],
    })).toContain('Step 0');
  });

  it('rejects step with invalid mode', () => {
    expect(validatePipelineDef({
      name: 'test',
      steps: [{ id: 'a', name: 'A', mode: 'invalid' }],
    })).toContain('mode');
  });

  it('rejects duplicate step IDs', () => {
    expect(validatePipelineDef({
      name: 'test',
      steps: [
        { id: 'a', name: 'A', mode: 'read' },
        { id: 'a', name: 'B', mode: 'write' },
      ],
    })).toContain('unique');
  });
});

// ── Loading tests ──────────────────────────────────────────────────

describe('loadCustomPipeline', () => {
  let velaDir: string;

  beforeEach(() => {
    velaDir = makeTmpVelaDir();
  });

  afterEach(() => {
    rmSync(join(velaDir, '..'), { recursive: true, force: true });
  });

  it('loads valid pipeline JSON', () => {
    writeFileSync(
      join(velaDir, 'pipelines', 'review.json'),
      JSON.stringify(VALID_PIPELINE),
    );
    const result = loadCustomPipeline(velaDir, 'review');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pipeline.name).toBe('review');
      expect(result.pipeline.steps).toHaveLength(4);
    }
  });

  it('returns error for non-existent pipeline', () => {
    const result = loadCustomPipeline(velaDir, 'nope');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
  });

  it('returns error for invalid JSON', () => {
    writeFileSync(join(velaDir, 'pipelines', 'bad.json'), 'not json');
    const result = loadCustomPipeline(velaDir, 'bad');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Invalid JSON');
    }
  });

  it('returns error for invalid schema', () => {
    writeFileSync(
      join(velaDir, 'pipelines', 'invalid.json'),
      JSON.stringify({ name: 'test' }), // missing steps
    );
    const result = loadCustomPipeline(velaDir, 'invalid');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Invalid pipeline definition');
    }
  });
});

describe('listCustomPipelines', () => {
  let velaDir: string;

  beforeEach(() => {
    velaDir = makeTmpVelaDir();
  });

  afterEach(() => {
    rmSync(join(velaDir, '..'), { recursive: true, force: true });
  });

  it('lists pipeline names', () => {
    writeFileSync(join(velaDir, 'pipelines', 'review.json'), JSON.stringify(VALID_PIPELINE));
    writeFileSync(join(velaDir, 'pipelines', 'deploy.json'), JSON.stringify({ ...VALID_PIPELINE, name: 'deploy' }));
    writeFileSync(join(velaDir, 'pipelines', 'readme.txt'), 'not a pipeline'); // ignored

    const names = listCustomPipelines(velaDir);
    expect(names).toEqual(['deploy', 'review']); // sorted by readdir
  });

  it('returns empty array when no pipelines dir', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'vela-empty-'));
    expect(listCustomPipelines(emptyDir)).toEqual([]);
    rmSync(emptyDir, { recursive: true, force: true });
  });
});

// ── Pipeline integration tests ─────────────────────────────────────

describe('getStepsForTypeOrCustom', () => {
  let velaDir: string;

  beforeEach(() => {
    velaDir = makeTmpVelaDir();
  });

  afterEach(() => {
    rmSync(join(velaDir, '..'), { recursive: true, force: true });
  });

  it('returns builtin steps for standard/quick/trivial', () => {
    const standard = getStepsForTypeOrCustom('standard');
    expect(standard.ok).toBe(true);
    if (standard.ok) expect(standard.steps).toHaveLength(10);

    const quick = getStepsForTypeOrCustom('quick');
    expect(quick.ok).toBe(true);
    if (quick.ok) expect(quick.steps).toHaveLength(6);

    const trivial = getStepsForTypeOrCustom('trivial');
    expect(trivial.ok).toBe(true);
    if (trivial.ok) expect(trivial.steps).toHaveLength(4);
  });

  it('loads custom pipeline steps', () => {
    writeFileSync(
      join(velaDir, 'pipelines', 'review.json'),
      JSON.stringify(VALID_PIPELINE),
    );
    const result = getStepsForTypeOrCustom('review', velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.steps).toHaveLength(4);
      expect(result.steps[0].id).toBe('init');
      expect(result.steps[1].id).toBe('review');
    }
  });

  it('returns error for unknown type without velaDir', () => {
    const result = getStepsForTypeOrCustom('unknown');
    expect(result.ok).toBe(false);
  });
});

describe('initPipeline with custom type', () => {
  let velaDir: string;

  beforeEach(() => {
    velaDir = makeTmpVelaDir();
  });

  afterEach(() => {
    rmSync(join(velaDir, '..'), { recursive: true, force: true });
  });

  it('creates pipeline with custom type', () => {
    writeFileSync(
      join(velaDir, 'pipelines', 'review.json'),
      JSON.stringify(VALID_PIPELINE),
    );
    const db = makeDb();
    const result = initPipeline(db, 'review task', 'medium', {
      type: 'review',
      velaDir,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pipeline.pipeline_type).toBe('review');
      expect(result.pipeline.steps).toEqual(['init', 'review', 'feedback', 'finalize']);
      expect(result.pipeline.current_step).toBe('init');
    }
    db.close();
  });

  it('returns error for non-existent custom type', () => {
    const db = makeDb();
    const result = initPipeline(db, 'task', 'medium', {
      type: 'nonexistent',
      velaDir,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
    db.close();
  });

  it('still works with builtin types via --type', () => {
    const db = makeDb();
    const result = initPipeline(db, 'task', 'medium', {
      type: 'standard',
      velaDir,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pipeline.pipeline_type).toBe('standard');
      expect(result.pipeline.steps).toHaveLength(10);
    }
    db.close();
  });

  it('still works without --type (scale-based)', () => {
    const db = makeDb();
    const result = initPipeline(db, 'task', 'small');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pipeline.pipeline_type).toBe('trivial');
    }
    db.close();
  });
});

// ── CLI integration tests ──────────────────────────────────────────

const CLI = join(__dirname, '..', 'dist', 'cli.js');

function run(args: string, cwd: string): { ok: boolean; [key: string]: unknown } {
  try {
    const stdout = execSync(`node ${CLI} ${args}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 10_000,
    });
    return JSON.parse(stdout.trim());
  } catch (err: unknown) {
    const execErr = err as { stdout?: string };
    if (execErr.stdout) {
      try { return JSON.parse(execErr.stdout.trim()); } catch { /* fall */ }
    }
    throw err;
  }
}

describe('CLI start --type', () => {
  let tmpDir: string;

  beforeEach(() => {
    execSync('npm run build', { cwd: join(__dirname, '..'), encoding: 'utf-8', timeout: 30_000 });
    tmpDir = mkdtempSync(join(tmpdir(), 'vela-cli-custom-'));
    run('init', tmpDir);
    // Create custom pipeline
    mkdirSync(join(tmpDir, '.vela', 'pipelines'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.vela', 'pipelines', 'review.json'),
      JSON.stringify(VALID_PIPELINE),
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('vela start with --type review → uses custom pipeline', () => {
    const result = run('start "review task" --type review', tmpDir);
    expect(result.ok).toBe(true);
    const pipeline = result.pipeline as Record<string, unknown>;
    expect(pipeline.pipeline_type).toBe('review');
    expect(pipeline.steps).toEqual(['init', 'review', 'feedback', 'finalize']);
    expect(pipeline.current_step).toBe('init');
  });

  it('vela start without --type → uses scale-based pipeline', () => {
    const result = run('start "normal task" --scale small', tmpDir);
    expect(result.ok).toBe(true);
    const pipeline = result.pipeline as Record<string, unknown>;
    expect(pipeline.pipeline_type).toBe('trivial');
  });

  it('vela state shows custom pipeline steps', () => {
    run('start "review task" --type review', tmpDir);
    const stateResult = run('state', tmpDir);
    expect(stateResult.ok).toBe(true);
    const pipeline = stateResult.pipeline as Record<string, unknown>;
    expect(pipeline.pipeline_type).toBe('review');
    expect(pipeline.steps).toEqual(['init', 'review', 'feedback', 'finalize']);
  });

  it('vela start --type nonexistent → error', () => {
    const result = run('start "task" --type nonexistent', tmpDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
  });
});
