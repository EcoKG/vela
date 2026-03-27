import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

// ── Helpers ────────────────────────────────────────────────────────

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

describe('CLI auto commands', () => {
  let tmpDir: string;

  beforeEach(() => {
    execSync('npm run build', { cwd: join(__dirname, '..'), encoding: 'utf-8', timeout: 30_000 });
    tmpDir = mkdtempSync(join(tmpdir(), 'vela-cli-auto-'));
    // Initialize project
    run('init', tmpDir);
    // Create milestone → slice → tasks
    run('milestone create "Test Milestone" --id M001', tmpDir);
    run('slice create "Test Slice" --milestone M001 --id S01', tmpDir);
    run('task create "Task 1" --slice S01 --milestone M001 --id T01', tmpDir);
    run('task create "Task 2" --slice S01 --milestone M001 --id T02', tmpDir);
    run('task create "Task 3" --slice S01 --milestone M001 --id T03', tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('auto start → returns running state with first task', () => {
    const result = run('auto start --milestone M001 --slice S01', tmpDir);
    expect(result.ok).toBe(true);
    const state = result.state as Record<string, unknown>;
    expect(state.status).toBe('running');
    expect(state.current_index).toBe(0);
    expect(result.current_task).toBeDefined();
    const task = result.current_task as Record<string, unknown>;
    expect(task.id).toBe('T01');
  });

  it('auto status → shows current state', () => {
    run('auto start --milestone M001 --slice S01', tmpDir);
    const result = run('auto status', tmpDir);
    expect(result.ok).toBe(true);
    const state = result.state as Record<string, unknown>;
    expect(state.status).toBe('running');
  });

  it('auto next → advances to next task', () => {
    run('auto start --milestone M001 --slice S01', tmpDir);
    const result = run('auto next', tmpDir);
    expect(result.ok).toBe(true);
    const state = result.state as Record<string, unknown>;
    expect(state.current_index).toBe(1);
    expect(state.completed_count).toBe(1);
    const task = result.current_task as Record<string, unknown>;
    expect(task.id).toBe('T02');
  });

  it('auto pause → pauses with reason', () => {
    run('auto start --milestone M001 --slice S01', tmpDir);
    const result = run('auto pause --reason "Build failed"', tmpDir);
    expect(result.ok).toBe(true);
    const state = result.state as Record<string, unknown>;
    expect(state.status).toBe('paused');
    const blocker = state.blocker as Record<string, unknown>;
    expect(blocker.reason).toBe('Build failed');
  });

  it('auto resume → resumes paused session', () => {
    run('auto start --milestone M001 --slice S01', tmpDir);
    run('auto pause', tmpDir);
    const result = run('auto resume', tmpDir);
    expect(result.ok).toBe(true);
    const state = result.state as Record<string, unknown>;
    expect(state.status).toBe('running');
  });

  it('auto cancel → cancels session', () => {
    run('auto start --milestone M001 --slice S01', tmpDir);
    const result = run('auto cancel', tmpDir);
    expect(result.ok).toBe(true);
    const state = result.state as Record<string, unknown>;
    expect(state.status).toBe('cancelled');
  });

  it('full lifecycle: start → next → next → next → completed', () => {
    run('auto start --milestone M001 --slice S01', tmpDir);
    run('auto next', tmpDir); // T01 → T02
    run('auto next', tmpDir); // T02 → T03
    const result = run('auto next', tmpDir); // T03 → completed
    expect(result.ok).toBe(true);
    const state = result.state as Record<string, unknown>;
    expect(state.status).toBe('completed');
    expect(state.completed_count).toBe(3);
  });

  it('full lifecycle: start → pause → resume → cancel', () => {
    run('auto start --milestone M001 --slice S01', tmpDir);
    run('auto pause --reason "Blocker found"', tmpDir);
    run('auto resume', tmpDir);
    const result = run('auto cancel', tmpDir);
    expect(result.ok).toBe(true);
    const state = result.state as Record<string, unknown>;
    expect(state.status).toBe('cancelled');
  });
});
