/**
 * CLI hierarchy integration tests.
 * End-to-end test of the full milestone → slice → task → complete → continue flow.
 * Runs against the compiled output in dist/.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'dist', 'cli.js');

function runCli(args: string, cwd: string): { stdout: string; code: number } {
  try {
    const stdout = execSync(`node ${CLI} ${args}`, {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return { stdout, code: 0 };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { stdout: (err.stdout ?? '').trim(), code: err.status ?? 1 };
  }
}

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout) as Record<string, unknown>;
}

describe('CLI hierarchy commands', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `vela-hier-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function initVelaProject(): void {
    const velaDir = join(tempDir, '.vela');
    mkdirSync(join(velaDir, 'state'), { recursive: true });
    writeFileSync(
      join(velaDir, 'config.json'),
      JSON.stringify({ version: '1.0', pipeline: { default: 'standard', scales: ['trivial', 'quick', 'standard'] } }),
    );
  }

  // ── Milestone commands ─────────────────────────────────────────

  it('milestone create → returns milestone JSON', () => {
    initVelaProject();
    const { stdout, code } = runCli('milestone create "Alpha Release" --id M001', tempDir);
    expect(code).toBe(0);
    const result = parseJson(stdout);
    expect(result.ok).toBe(true);
    const ms = result.milestone as Record<string, unknown>;
    expect(ms.id).toBe('M001');
    expect(ms.title).toBe('Alpha Release');
    expect(ms.status).toBe('active');
  });

  it('milestone list → returns milestones array', () => {
    initVelaProject();
    runCli('milestone create "M1" --id M001', tempDir);
    runCli('milestone create "M2" --id M002', tempDir);
    const { stdout, code } = runCli('milestone list', tempDir);
    expect(code).toBe(0);
    const result = parseJson(stdout);
    expect(result.ok).toBe(true);
    const milestones = result.milestones as unknown[];
    expect(milestones.length).toBe(2);
  });

  it('milestone complete with no slices → completes successfully', () => {
    initVelaProject();
    runCli('milestone create "Empty MS" --id M001', tempDir);
    const { stdout, code } = runCli('milestone complete M001', tempDir);
    expect(code).toBe(0);
    const result = parseJson(stdout);
    expect(result.ok).toBe(true);
    const ms = result.milestone as Record<string, unknown>;
    expect(ms.status).toBe('completed');
  });

  it('milestone complete with incomplete slices → error', () => {
    initVelaProject();
    runCli('milestone create "Has Slices" --id M001', tempDir);
    runCli('slice create "S1" --milestone M001 --id S01', tempDir);
    const { stdout, code } = runCli('milestone complete M001', tempDir);
    expect(code).toBe(1);
    const result = parseJson(stdout);
    expect(result.ok).toBe(false);
    expect(result.error as string).toContain('slices not completed');
  });

  // ── Slice commands ─────────────────────────────────────────────

  it('slice create → returns slice JSON', () => {
    initVelaProject();
    runCli('milestone create "MS" --id M001', tempDir);
    const { stdout, code } = runCli('slice create "Setup" --milestone M001 --id S01', tempDir);
    expect(code).toBe(0);
    const result = parseJson(stdout);
    expect(result.ok).toBe(true);
    const slice = result.slice as Record<string, unknown>;
    expect(slice.id).toBe('S01');
    expect(slice.title).toBe('Setup');
    expect(slice.milestone_id).toBe('M001');
  });

  it('slice list → returns slices array', () => {
    initVelaProject();
    runCli('milestone create "MS" --id M001', tempDir);
    runCli('slice create "S1" --milestone M001 --id S01', tempDir);
    runCli('slice create "S2" --milestone M001 --id S02', tempDir);
    const { stdout, code } = runCli('slice list --milestone M001', tempDir);
    expect(code).toBe(0);
    const result = parseJson(stdout);
    expect(result.ok).toBe(true);
    const slices = result.slices as unknown[];
    expect(slices.length).toBe(2);
  });

  it('slice boundary → sets and returns boundary data', () => {
    initVelaProject();
    runCli('milestone create "MS" --id M001', tempDir);
    runCli('slice create "S1" --milestone M001 --id S01', tempDir);
    const { stdout, code } = runCli('slice boundary S01 --produces "api,types" --consumes "config"', tempDir);
    expect(code).toBe(0);
    const result = parseJson(stdout);
    expect(result.ok).toBe(true);
    const boundary = result.boundary as Record<string, unknown>;
    expect(boundary.produces).toEqual(['api', 'types']);
    expect(boundary.consumes).toEqual(['config']);
  });

  // ── Task commands ──────────────────────────────────────────────

  it('task create → returns task JSON', () => {
    initVelaProject();
    runCli('milestone create "MS" --id M001', tempDir);
    runCli('slice create "S1" --milestone M001 --id S01', tempDir);
    const { stdout, code } = runCli('task create "Build API" --slice S01 --milestone M001 --id T01', tempDir);
    expect(code).toBe(0);
    const result = parseJson(stdout);
    expect(result.ok).toBe(true);
    const task = result.task as Record<string, unknown>;
    expect(task.id).toBe('T01');
    expect(task.title).toBe('Build API');
    expect(task.slice_id).toBe('S01');
  });

  it('task list → returns tasks array', () => {
    initVelaProject();
    runCli('milestone create "MS" --id M001', tempDir);
    runCli('slice create "S1" --milestone M001 --id S01', tempDir);
    runCli('task create "T1" --slice S01 --milestone M001 --id T01', tempDir);
    runCli('task create "T2" --slice S01 --milestone M001 --id T02', tempDir);
    const { stdout, code } = runCli('task list --slice S01', tempDir);
    expect(code).toBe(0);
    const result = parseJson(stdout);
    expect(result.ok).toBe(true);
    const tasks = result.tasks as unknown[];
    expect(tasks.length).toBe(2);
  });

  it('task complete → cascades to slice and milestone when all done', () => {
    initVelaProject();
    runCli('milestone create "MS" --id M001', tempDir);
    runCli('slice create "S1" --milestone M001 --id S01', tempDir);
    runCli('task create "Only task" --slice S01 --milestone M001 --id T01', tempDir);

    const { stdout, code } = runCli('task complete T01', tempDir);
    expect(code).toBe(0);
    const result = parseJson(stdout);
    expect(result.ok).toBe(true);
    expect(result.sliceAutoCompleted).toBe(true);
    expect(result.milestoneAutoCompleted).toBe(true);
  });

  // ── Continue commands ──────────────────────────────────────────

  it('continue save → creates continue point', () => {
    initVelaProject();
    const { stdout, code } = runCli('continue save --milestone M001 --slice S01 --task T01 --step "step3" --notes "halfway"', tempDir);
    expect(code).toBe(0);
    const result = parseJson(stdout);
    expect(result.ok).toBe(true);
    const point = result.point as Record<string, unknown>;
    expect(point.milestone_id).toBe('M001');
    expect(point.slice_id).toBe('S01');
    expect(point.task_id).toBe('T01');
    expect(point.step).toBe('step3');
    expect(point.notes).toBe('halfway');
  });

  it('continue load → reads saved point', () => {
    initVelaProject();
    runCli('continue save --milestone M001 --slice S01', tempDir);
    const { stdout, code } = runCli('continue load', tempDir);
    expect(code).toBe(0);
    const result = parseJson(stdout);
    expect(result.ok).toBe(true);
    const point = result.point as Record<string, unknown>;
    expect(point.milestone_id).toBe('M001');
    expect(point.slice_id).toBe('S01');
  });

  it('continue load with no point → error', () => {
    initVelaProject();
    const { stdout, code } = runCli('continue load', tempDir);
    expect(code).toBe(1);
    const result = parseJson(stdout);
    expect(result.ok).toBe(false);
    expect(result.error as string).toContain('No continue point');
  });

  it('continue clear → removes continue point', () => {
    initVelaProject();
    runCli('continue save --milestone M001 --slice S01', tempDir);
    const { stdout: clearOut, code: clearCode } = runCli('continue clear', tempDir);
    expect(clearCode).toBe(0);
    expect(parseJson(clearOut).ok).toBe(true);

    // Load should now fail
    const { code: loadCode } = runCli('continue load', tempDir);
    expect(loadCode).toBe(1);
  });

  // ── Full lifecycle integration test ────────────────────────────

  it('full lifecycle: init → milestone → slice → boundary → tasks → complete → continue', () => {
    initVelaProject();

    // Create milestone
    let r = runCli('milestone create "Full Test" --id M001', tempDir);
    expect(r.code).toBe(0);
    expect(parseJson(r.stdout).ok).toBe(true);

    // Create slice
    r = runCli('slice create "Core" --milestone M001 --id S01', tempDir);
    expect(r.code).toBe(0);
    expect(parseJson(r.stdout).ok).toBe(true);

    // Set boundary
    r = runCli('slice boundary S01 --produces "api,sdk" --consumes "config"', tempDir);
    expect(r.code).toBe(0);
    const boundaryResult = parseJson(r.stdout);
    expect(boundaryResult.ok).toBe(true);
    expect((boundaryResult.boundary as Record<string, unknown>).produces).toEqual(['api', 'sdk']);

    // Create task 1
    r = runCli('task create "Build core" --slice S01 --milestone M001 --id T01', tempDir);
    expect(r.code).toBe(0);

    // Create task 2
    r = runCli('task create "Add tests" --slice S01 --milestone M001 --id T02', tempDir);
    expect(r.code).toBe(0);

    // Complete task 1 — should not cascade yet
    r = runCli('task complete T01', tempDir);
    expect(r.code).toBe(0);
    let taskResult = parseJson(r.stdout);
    expect(taskResult.ok).toBe(true);
    expect(taskResult.sliceAutoCompleted).toBe(false);
    expect(taskResult.milestoneAutoCompleted).toBe(false);

    // Complete task 2 — should cascade slice + milestone
    r = runCli('task complete T02', tempDir);
    expect(r.code).toBe(0);
    taskResult = parseJson(r.stdout);
    expect(taskResult.ok).toBe(true);
    expect(taskResult.sliceAutoCompleted).toBe(true);
    expect(taskResult.milestoneAutoCompleted).toBe(true);

    // Verify milestone is completed via list
    r = runCli('milestone list', tempDir);
    expect(r.code).toBe(0);
    const milestones = parseJson(r.stdout).milestones as Array<Record<string, unknown>>;
    expect(milestones[0].status).toBe('completed');

    // Save continue point
    r = runCli('continue save --milestone M001 --slice S01 --task T02 --notes "all done"', tempDir);
    expect(r.code).toBe(0);

    // Load continue point
    r = runCli('continue load', tempDir);
    expect(r.code).toBe(0);
    const point = parseJson(r.stdout).point as Record<string, unknown>;
    expect(point.milestone_id).toBe('M001');
    expect(point.task_id).toBe('T02');
    expect(point.notes).toBe('all done');

    // Clear continue point
    r = runCli('continue clear', tempDir);
    expect(r.code).toBe(0);

    // Load after clear → error
    r = runCli('continue load', tempDir);
    expect(r.code).toBe(1);
    expect(parseJson(r.stdout).ok).toBe(false);
  });
});
