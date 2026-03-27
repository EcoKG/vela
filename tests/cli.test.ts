/**
 * CLI integration tests.
 * These tests run against the compiled output in dist/.
 * Run `npm run build` before running these tests.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
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

describe('CLI', () => {
  it('--version prints version', () => {
    const output = execSync(`node ${CLI} --version`, { encoding: 'utf-8' }).trim();
    expect(output).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('help lists all commands', () => {
    const output = execSync(`node ${CLI} help`, { encoding: 'utf-8' });
    for (const cmd of ['init', 'start', 'state', 'transition', 'cancel']) {
      expect(output).toContain(cmd);
    }
  });
});

describe('CLI pipeline commands', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `vela-cli-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

  it('start without .vela/ project → error JSON', () => {
    const { stdout, code } = runCli('start "test task"', tempDir);
    expect(code).toBe(1);
    const result = JSON.parse(stdout);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No Vela project');
  });

  it('start "test" --scale small → creates trivial pipeline', () => {
    initVelaProject();
    const { stdout, code } = runCli('start "test task" --scale small', tempDir);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.ok).toBe(true);
    expect(result.pipeline.status).toBe('active');
    expect(result.pipeline.pipeline_type).toBe('trivial');
    expect(result.pipeline.scale).toBe('small');
    expect(result.pipeline.request).toBe('test task');
  });

  it('start with default scale → creates quick pipeline', () => {
    initVelaProject();
    const { stdout, code } = runCli('start "default scale task"', tempDir);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.ok).toBe(true);
    expect(result.pipeline.pipeline_type).toBe('quick');
    expect(result.pipeline.scale).toBe('medium');
  });

  it('start with active pipeline already existing → error JSON', () => {
    initVelaProject();
    // Create first pipeline
    runCli('start "first task" --scale small', tempDir);
    // Attempt second pipeline
    const { stdout, code } = runCli('start "second task" --scale medium', tempDir);
    expect(code).toBe(1);
    const result = JSON.parse(stdout);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('active pipeline already exists');
  });

  it('state → shows the created pipeline', () => {
    initVelaProject();
    runCli('start "state test" --scale large', tempDir);
    const { stdout, code } = runCli('state', tempDir);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.ok).toBe(true);
    expect(result.pipeline.status).toBe('active');
    expect(result.pipeline.pipeline_type).toBe('standard');
    expect(result.pipeline.request).toBe('state test');
  });

  it('state with no pipeline → no active pipeline', () => {
    initVelaProject();
    const { stdout, code } = runCli('state', tempDir);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('No active pipeline');
  });

  it('transition → advances current_step', () => {
    initVelaProject();
    // Create a trivial pipeline (init → execute → commit → finalize)
    runCli('start "transition test" --scale small', tempDir);
    const { stdout, code } = runCli('transition', tempDir);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.ok).toBe(true);
    expect(result.pipeline.current_step).toBe('execute');
    expect(result.pipeline.completed_steps).toContain('init');
  });

  it('transition with no active pipeline → error', () => {
    initVelaProject();
    const { stdout, code } = runCli('transition', tempDir);
    expect(code).toBe(1);
    const result = JSON.parse(stdout);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No active pipeline');
  });

  it('cancel → sets status cancelled', () => {
    initVelaProject();
    runCli('start "cancel test" --scale medium', tempDir);
    const { stdout, code } = runCli('cancel', tempDir);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.ok).toBe(true);
    expect(result.pipeline.status).toBe('cancelled');
  });

  it('cancel with no active pipeline → error', () => {
    initVelaProject();
    const { stdout, code } = runCli('cancel', tempDir);
    expect(code).toBe(1);
    const result = JSON.parse(stdout);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No active pipeline');
  });

  it('full lifecycle: start → state → transition → cancel', () => {
    initVelaProject();

    // Start
    let r = runCli('start "lifecycle" --scale small', tempDir);
    expect(r.code).toBe(0);
    const startResult = JSON.parse(r.stdout);
    expect(startResult.ok).toBe(true);

    // State
    r = runCli('state', tempDir);
    expect(r.code).toBe(0);
    const stateResult = JSON.parse(r.stdout);
    expect(stateResult.pipeline.request).toBe('lifecycle');

    // Transition
    r = runCli('transition', tempDir);
    expect(r.code).toBe(0);
    const transResult = JSON.parse(r.stdout);
    expect(transResult.pipeline.current_step).toBe('execute');

    // Cancel
    r = runCli('cancel', tempDir);
    expect(r.code).toBe(0);
    const cancelResult = JSON.parse(r.stdout);
    expect(cancelResult.pipeline.status).toBe('cancelled');
  });
});
