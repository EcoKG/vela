/**
 * CLI git integration tests.
 * End-to-end tests for `vela git branch|commit|merge` subcommands.
 * Runs against the compiled output in dist/.
 * Run `npm run build` before running these tests.
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

describe('CLI git commands', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `vela-git-cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tempDir, { recursive: true });
    // Initialize git repo with main branch
    execSync('git init --initial-branch main', { cwd: tempDir, stdio: 'pipe' });
    execSync('git config user.name "test"', { cwd: tempDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
    writeFileSync(join(tempDir, 'README.md'), '# Test\n');
    execSync('git add -A && git commit -m "initial commit"', { cwd: tempDir, stdio: 'pipe' });
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
    // Ignore .vela/state/ so db writes don't dirty the working tree
    writeFileSync(join(tempDir, '.gitignore'), '.vela/state/\n.vela/cache/\n.vela/artifacts/\n');
    // Commit the .vela config and .gitignore so they're tracked
    execSync('git add -A && git commit -m "add vela config"', { cwd: tempDir, stdio: 'pipe' });
  }

  // ── vela help git ──────────────────────────────────────────────

  it('help lists git command', () => {
    const output = execSync(`node ${CLI} help`, { encoding: 'utf-8' });
    expect(output).toContain('git');
  });

  it('help git lists branch/commit/merge subcommands', () => {
    const output = execSync(`node ${CLI} help git`, { encoding: 'utf-8' });
    expect(output).toContain('branch');
    expect(output).toContain('commit');
    expect(output).toContain('merge');
  });

  // ── vela git branch ────────────────────────────────────────────

  it('git branch on protected branch → creates vela/ prefixed branch, returns ok JSON', () => {
    initVelaProject();
    runCli('start "add login feature" --scale small', tempDir);

    const { stdout, code } = runCli('git branch', tempDir);
    expect(code).toBe(0);
    const result = parseJson(stdout);
    expect(result.ok).toBe(true);
    expect(result.action).toBe('created');
    expect(result.branch).toMatch(/^vela\//);
    expect(result.base_branch).toBe('main');
    expect(typeof result.checkpoint_hash).toBe('string');
  });

  it('git branch with no active pipeline → error JSON', () => {
    initVelaProject();
    const { stdout, code } = runCli('git branch', tempDir);
    expect(code).toBe(1);
    const result = parseJson(stdout);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No active pipeline');
  });

  // ── vela git commit ────────────────────────────────────────────

  it('git commit after creating a file → returns committed result with hash', () => {
    initVelaProject();
    runCli('start "add login feature" --scale small', tempDir);
    runCli('git branch', tempDir);

    // Create a file to commit
    writeFileSync(join(tempDir, 'feature.ts'), 'export const login = true;\n');

    const { stdout, code } = runCli('git commit', tempDir);
    expect(code).toBe(0);
    const result = parseJson(stdout);
    expect(result.ok).toBe(true);
    expect(result.action).toBe('committed');
    expect(typeof result.hash).toBe('string');
    expect(typeof result.message).toBe('string');
  });

  it('git commit with no changes → returns no_changes', () => {
    initVelaProject();
    runCli('start "no changes test" --scale small', tempDir);
    runCli('git branch', tempDir);

    const { stdout, code } = runCli('git commit', tempDir);
    expect(code).toBe(0);
    const result = parseJson(stdout);
    expect(result.ok).toBe(true);
    expect(result.action).toBe('no_changes');
  });

  // ── vela git merge ─────────────────────────────────────────────

  it('git merge after branch + commit → returns merged result, verifies back on main', () => {
    initVelaProject();
    runCli('start "merge feature" --scale small', tempDir);
    runCli('git branch', tempDir);

    // Create and commit a file
    writeFileSync(join(tempDir, 'merged-feature.ts'), 'export const merged = true;\n');
    runCli('git commit', tempDir);

    const { stdout, code } = runCli('git merge', tempDir);
    expect(code).toBe(0);
    const result = parseJson(stdout);
    expect(result.ok).toBe(true);
    expect(result.action).toBe('merged');
    expect(typeof result.hash).toBe('string');
    expect(result.base_branch).toBe('main');

    // Verify we're back on main
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim();
    expect(branch).toBe('main');
  });

  it('git merge with no active pipeline → error JSON', () => {
    initVelaProject();
    const { stdout, code } = runCli('git merge', tempDir);
    expect(code).toBe(1);
    const result = parseJson(stdout);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No active pipeline');
  });

  it('git merge with no pipeline branch set → error JSON', () => {
    initVelaProject();
    runCli('start "no branch merge" --scale small', tempDir);
    // Don't create a branch, try to merge directly
    const { stdout, code } = runCli('git merge', tempDir);
    expect(code).toBe(1);
    const result = parseJson(stdout);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No pipeline branch or base branch');
  });

  // ── Full lifecycle ─────────────────────────────────────────────

  it('full lifecycle: init → start → git branch → create file → git commit → git merge → verify main has changes', () => {
    initVelaProject();

    // Start pipeline
    let r = runCli('start "full lifecycle feature" --scale small', tempDir);
    expect(r.code).toBe(0);
    expect(parseJson(r.stdout).ok).toBe(true);

    // Create branch
    r = runCli('git branch', tempDir);
    expect(r.code).toBe(0);
    const branchResult = parseJson(r.stdout);
    expect(branchResult.action).toBe('created');
    const branchName = branchResult.branch as string;
    expect(branchName).toMatch(/^vela\//);

    // Verify we're on the new branch
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim();
    expect(currentBranch).toBe(branchName);

    // Create a file
    writeFileSync(join(tempDir, 'lifecycle.ts'), 'export const lifecycle = "complete";\n');

    // Commit changes
    r = runCli('git commit', tempDir);
    expect(r.code).toBe(0);
    const commitResult = parseJson(r.stdout);
    expect(commitResult.action).toBe('committed');
    expect(commitResult.hash).toBeTruthy();

    // Merge back to main
    r = runCli('git merge', tempDir);
    expect(r.code).toBe(0);
    const mergeResult = parseJson(r.stdout);
    expect(mergeResult.action).toBe('merged');
    expect(mergeResult.base_branch).toBe('main');

    // Verify we're back on main
    const finalBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim();
    expect(finalBranch).toBe('main');

    // Verify the file exists on main
    const fileContent = execSync('cat lifecycle.ts', { cwd: tempDir, encoding: 'utf-8' }).trim();
    expect(fileContent).toContain('lifecycle');
  });
});
