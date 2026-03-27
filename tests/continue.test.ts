import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  saveContinuePoint,
  loadContinuePoint,
  clearContinuePoint,
} from '../src/continue.js';

// ── Helpers ────────────────────────────────────────────────────────

let velaDir: string;

beforeEach(() => {
  velaDir = mkdtempSync(join(tmpdir(), 'vela-continue-'));
});

afterEach(() => {
  rmSync(velaDir, { recursive: true, force: true });
});

// ── saveContinuePoint ──────────────────────────────────────────────

describe('saveContinuePoint', () => {
  it('writes continue.md with correct YAML frontmatter', () => {
    const result = saveContinuePoint(velaDir, {
      milestone_id: 'M01',
      slice_id: 'S01',
      task_id: 'T01',
      step: 'execute',
      notes: 'Working on auth',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.point.milestone_id).toBe('M01');
    expect(result.point.slice_id).toBe('S01');
    expect(result.point.task_id).toBe('T01');
    expect(result.point.step).toBe('execute');
    expect(result.point.notes).toBe('Working on auth');
    expect(result.point.timestamp).toBeTruthy();

    // Verify file contents
    const content = readFileSync(join(velaDir, 'continue.md'), 'utf-8');
    expect(content).toContain('---');
    expect(content).toContain('milestone_id: M01');
    expect(content).toContain('slice_id: S01');
    expect(content).toContain('task_id: T01');
    expect(content).toContain('step: execute');
    expect(content).toContain('notes: Working on auth');
    expect(content).toContain('# Continue Here');
    expect(content).toContain('Resume from task T01 in slice S01.');
  });

  it('writes minimal point without optional fields', () => {
    const result = saveContinuePoint(velaDir, {
      milestone_id: 'M02',
      slice_id: 'S03',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.point.task_id).toBeUndefined();
    expect(result.point.step).toBeUndefined();
    expect(result.point.notes).toBeUndefined();

    const content = readFileSync(join(velaDir, 'continue.md'), 'utf-8');
    expect(content).toContain('milestone_id: M02');
    expect(content).toContain('slice_id: S03');
    expect(content).not.toContain('task_id');
    expect(content).not.toContain('step');
    expect(content).not.toContain('notes');
    expect(content).toContain('Resume from slice S03.');
  });

  it('overwrites existing continue point', () => {
    saveContinuePoint(velaDir, { milestone_id: 'M01', slice_id: 'S01' });
    const result = saveContinuePoint(velaDir, { milestone_id: 'M02', slice_id: 'S05' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.point.milestone_id).toBe('M02');

    const content = readFileSync(join(velaDir, 'continue.md'), 'utf-8');
    expect(content).toContain('milestone_id: M02');
    expect(content).not.toContain('milestone_id: M01');
  });
});

// ── loadContinuePoint ──────────────────────────────────────────────

describe('loadContinuePoint', () => {
  it('reads back a saved continue point with all fields', () => {
    saveContinuePoint(velaDir, {
      milestone_id: 'M01',
      slice_id: 'S01',
      task_id: 'T01',
      step: 'execute',
      notes: 'Working on auth',
    });

    const result = loadContinuePoint(velaDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.point.milestone_id).toBe('M01');
    expect(result.point.slice_id).toBe('S01');
    expect(result.point.task_id).toBe('T01');
    expect(result.point.step).toBe('execute');
    expect(result.point.notes).toBe('Working on auth');
    expect(result.point.timestamp).toBeTruthy();
  });

  it('reads back a saved point with only required fields', () => {
    saveContinuePoint(velaDir, {
      milestone_id: 'M03',
      slice_id: 'S02',
    });

    const result = loadContinuePoint(velaDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.point.milestone_id).toBe('M03');
    expect(result.point.slice_id).toBe('S02');
    expect(result.point.task_id).toBeUndefined();
    expect(result.point.step).toBeUndefined();
    expect(result.point.notes).toBeUndefined();
  });

  it('returns error when file does not exist', () => {
    const result = loadContinuePoint(velaDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('No continue point found');
  });

  it('returns error for invalid frontmatter', () => {
    const { writeFileSync } = require('node:fs');
    writeFileSync(join(velaDir, 'continue.md'), 'no frontmatter here', 'utf-8');

    const result = loadContinuePoint(velaDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('invalid frontmatter');
  });
});

// ── clearContinuePoint ─────────────────────────────────────────────

describe('clearContinuePoint', () => {
  it('removes the continue file', () => {
    saveContinuePoint(velaDir, { milestone_id: 'M01', slice_id: 'S01' });
    expect(existsSync(join(velaDir, 'continue.md'))).toBe(true);

    const result = clearContinuePoint(velaDir);
    expect(result.ok).toBe(true);
    expect(existsSync(join(velaDir, 'continue.md'))).toBe(false);
  });

  it('succeeds even when file does not exist', () => {
    const result = clearContinuePoint(velaDir);
    expect(result.ok).toBe(true);
  });

  it('load returns error after clear', () => {
    saveContinuePoint(velaDir, { milestone_id: 'M01', slice_id: 'S01' });
    clearContinuePoint(velaDir);

    const result = loadContinuePoint(velaDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('No continue point found');
  });
});

// ── Round-trip ─────────────────────────────────────────────────────

describe('round-trip', () => {
  it('save → load → clear → load cycle works correctly', () => {
    // Save with all fields
    const saveResult = saveContinuePoint(velaDir, {
      milestone_id: 'M01',
      slice_id: 'S02',
      task_id: 'T03',
      step: 'verify',
      notes: 'Running final checks',
    });
    expect(saveResult.ok).toBe(true);

    // Load and verify round-trip fidelity
    const loadResult = loadContinuePoint(velaDir);
    expect(loadResult.ok).toBe(true);
    if (!loadResult.ok) return;
    expect(loadResult.point.milestone_id).toBe('M01');
    expect(loadResult.point.slice_id).toBe('S02');
    expect(loadResult.point.task_id).toBe('T03');
    expect(loadResult.point.step).toBe('verify');
    expect(loadResult.point.notes).toBe('Running final checks');

    // Clear
    const clearResult = clearContinuePoint(velaDir);
    expect(clearResult.ok).toBe(true);

    // Load after clear
    const afterClear = loadContinuePoint(velaDir);
    expect(afterClear.ok).toBe(false);
  });
});
