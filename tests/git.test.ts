import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { openStateDb } from '../src/state.js';
import { initPipeline, getPipelineState } from '../src/pipeline.js';
import {
  gitExec,
  snapshotGitState,
  createBranch,
  commitChanges,
  squashMerge,
  PROTECTED_BRANCHES,
} from '../src/git.js';
import type { GitState, GitResult } from '../src/git.js';

// ── Helpers ────────────────────────────────────────────────────────

function makeTempGitRepo(): string {
  const dir = join(tmpdir(), `vela-git-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  execSync('git init --initial-branch main', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "test"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'README.md'), '# Test\n');
  execSync('git add -A && git commit -m "initial commit"', { cwd: dir, stdio: 'pipe' });
  return dir;
}

function makeDb(): Database.Database {
  return openStateDb(); // in-memory
}

function createTestPipeline(db: Database.Database, request = 'Test feature', scale = 'large') {
  return initPipeline(db, request, scale);
}

// ── Temp dir tracking ──────────────────────────────────────────────

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  }
  tempDirs = [];
});

// ── gitExec ────────────────────────────────────────────────────────

describe('gitExec', () => {
  it('executes git commands and returns trimmed stdout', () => {
    const dir = makeTempGitRepo();
    tempDirs.push(dir);

    const result = gitExec('git rev-parse --git-dir', dir);
    expect(result).toBe('.git');
  });

  it('throws on invalid commands with stderr message', () => {
    const dir = makeTempGitRepo();
    tempDirs.push(dir);

    expect(() => gitExec('git checkout nonexistent-branch-xyz', dir)).toThrow();
  });

  it('throws on non-git directory', () => {
    const dir = join(tmpdir(), `vela-git-test-notgit-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);

    expect(() => gitExec('git rev-parse --git-dir', dir)).toThrow();
  });
});

// ── snapshotGitState ───────────────────────────────────────────────

describe('snapshotGitState', () => {
  it('returns is_repo: false for non-git directory', () => {
    const dir = join(tmpdir(), `vela-git-test-nogit-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);

    const state = snapshotGitState(dir);
    expect(state.is_repo).toBe(false);
  });

  it('detects clean main branch', () => {
    const dir = makeTempGitRepo();
    tempDirs.push(dir);

    const state = snapshotGitState(dir);
    expect(state.is_repo).toBe(true);
    if (state.is_repo && !('error' in state)) {
      expect(state.current_branch).toBe('main');
      expect(state.is_clean).toBe(true);
      expect(state.dirty_files).toBe(0);
      expect(state.head_hash).toMatch(/^[0-9a-f]{40}$/);
      expect(state.is_protected).toBe(true);
    }
  });

  it('detects dirty working tree', () => {
    const dir = makeTempGitRepo();
    tempDirs.push(dir);

    writeFileSync(join(dir, 'new-file.txt'), 'hello');

    const state = snapshotGitState(dir);
    expect(state.is_repo).toBe(true);
    if (state.is_repo && !('error' in state)) {
      expect(state.is_clean).toBe(false);
      expect(state.dirty_files).toBeGreaterThan(0);
    }
  });

  it('detects non-protected branch', () => {
    const dir = makeTempGitRepo();
    tempDirs.push(dir);

    execSync('git checkout -b feature/test', { cwd: dir, stdio: 'pipe' });
    const state = snapshotGitState(dir);

    expect(state.is_repo).toBe(true);
    if (state.is_repo && !('error' in state)) {
      expect(state.current_branch).toBe('feature/test');
      expect(state.is_protected).toBe(false);
    }
  });

  it('handles empty repository with no commits', () => {
    const dir = join(tmpdir(), `vela-git-test-empty-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);

    execSync('git init --initial-branch main', { cwd: dir, stdio: 'pipe' });
    execSync('git config user.name "test"', { cwd: dir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });

    // Empty repo — git rev-parse HEAD fails
    const state = snapshotGitState(dir);
    expect(state.is_repo).toBe(true);
    // Should return error state since HEAD doesn't exist
    if (state.is_repo && 'error' in state) {
      expect(state.error).toBeTruthy();
    }
  });

  it('protected branches include main, master, develop', () => {
    expect(PROTECTED_BRANCHES).toContain('main');
    expect(PROTECTED_BRANCHES).toContain('master');
    expect(PROTECTED_BRANCHES).toContain('develop');
  });
});

// ── createBranch ───────────────────────────────────────────────────

describe('createBranch', () => {
  it('returns error when no active pipeline', () => {
    const db = makeDb();
    const dir = makeTempGitRepo();
    tempDirs.push(dir);

    const result = createBranch(db, dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('No active pipeline');
    }
  });

  it('skips gracefully for non-git directory', () => {
    const db = makeDb();
    createTestPipeline(db);

    const dir = join(tmpdir(), `vela-git-test-nobranch-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);

    const result = createBranch(db, dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe('skipped');
    }
  });

  it('reuses current non-protected branch', () => {
    const db = makeDb();
    createTestPipeline(db);

    const dir = makeTempGitRepo();
    tempDirs.push(dir);
    execSync('git checkout -b feature/existing', { cwd: dir, stdio: 'pipe' });

    const result = createBranch(db, dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe('existing');
      if (result.action === 'existing') {
        expect(result.branch).toBe('feature/existing');
      }
    }
  });

  it('creates new branch from protected branch', () => {
    const db = makeDb();
    createTestPipeline(db);

    const dir = makeTempGitRepo();
    tempDirs.push(dir);

    const result = createBranch(db, dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe('created');
      if (result.action === 'created') {
        expect(result.branch).toMatch(/^vela\/test-feature-/);
        expect(result.base_branch).toBe('main');
        expect(result.checkpoint_hash).toMatch(/^[0-9a-f]{40}$/);
      }
    }

    // Verify we're actually on the new branch
    const currentBranch = gitExec('git rev-parse --abbrev-ref HEAD', dir);
    expect(currentBranch).toMatch(/^vela\/test-feature-/);
  });

  it('falls back to checkout if branch already exists', () => {
    const db = makeDb();
    createTestPipeline(db);

    const dir = makeTempGitRepo();
    tempDirs.push(dir);

    // Create the branch first, then go back to main
    const slug = 'test-feature';
    const timeStr = new Date().toTimeString().substring(0, 5).replace(':', '');
    const branchName = `vela/${slug}-${timeStr}`;
    execSync(`git checkout -b ${branchName}`, { cwd: dir, stdio: 'pipe' });
    execSync('git checkout main', { cwd: dir, stdio: 'pipe' });

    const result = createBranch(db, dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should either create a new one or check out existing
      expect(['created', 'existing']).toContain(result.action);
    }
  });

  it('updates pipeline git JSON column', () => {
    const db = makeDb();
    createTestPipeline(db);

    const dir = makeTempGitRepo();
    tempDirs.push(dir);

    createBranch(db, dir);

    const pipeline = getPipelineState(db);
    expect(pipeline).not.toBeNull();
    expect(pipeline!.git).not.toBeNull();
    const git = pipeline!.git as Record<string, unknown>;
    expect(git.pipeline_branch).toMatch(/^vela\//);
    expect(git.base_branch).toBe('main');
    expect(git.checkpoint_hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('sanitizes special characters in branch names', () => {
    const db = makeDb();
    initPipeline(db, 'Fix: "urgent" bug in <auth> module!', 'large');

    const dir = makeTempGitRepo();
    tempDirs.push(dir);

    const result = createBranch(db, dir);
    expect(result.ok).toBe(true);
    if (result.ok && result.action === 'created') {
      // Branch name should only have alphanumeric, hyphens, slashes
      expect(result.branch).toMatch(/^[a-z0-9\-/]+$/);
      expect(result.branch).not.toMatch(/[<>"!:]/);
    }
  });
});

// ── commitChanges ──────────────────────────────────────────────────

describe('commitChanges', () => {
  it('returns error when no active pipeline', () => {
    const db = makeDb();
    const dir = makeTempGitRepo();
    tempDirs.push(dir);

    const result = commitChanges(db, dir);
    expect(result.ok).toBe(false);
  });

  it('returns no_changes when working tree is clean', () => {
    const db = makeDb();
    createTestPipeline(db);

    const dir = makeTempGitRepo();
    tempDirs.push(dir);

    const result = commitChanges(db, dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe('no_changes');
    }
  });

  it('commits changes with conventional commit message', () => {
    const db = makeDb();
    createTestPipeline(db, 'Add login page');

    const dir = makeTempGitRepo();
    tempDirs.push(dir);

    writeFileSync(join(dir, 'feature.ts'), 'export const login = true;\n');

    const result = commitChanges(db, dir);
    expect(result.ok).toBe(true);
    if (result.ok && result.action === 'committed') {
      expect(result.hash).toMatch(/^[0-9a-f]{40}$/);
      expect(result.message).toMatch(/^feat\(add-login-page\):/);
    }

    // Verify commit actually happened
    const log = gitExec('git log --oneline -1', dir);
    expect(log).toContain('feat(add-login-page)');
  });

  it('excludes .vela/ internal files', () => {
    const db = makeDb();
    createTestPipeline(db);

    const dir = makeTempGitRepo();
    tempDirs.push(dir);

    // Create both tracked and excluded files
    writeFileSync(join(dir, 'app.ts'), 'export const app = true;\n');
    mkdirSync(join(dir, '.vela', 'state'), { recursive: true });
    writeFileSync(join(dir, '.vela', 'state', 'data.db'), 'db content');
    mkdirSync(join(dir, '.vela', 'cache'), { recursive: true });
    writeFileSync(join(dir, '.vela', 'cache', 'tmp.json'), '{}');

    const result = commitChanges(db, dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe('committed');
    }

    // Check that .vela/ files are NOT in the commit
    const committedFiles = gitExec('git diff-tree --no-commit-id --name-only -r HEAD', dir);
    expect(committedFiles).toContain('app.ts');
    expect(committedFiles).not.toContain('.vela/state/');
    expect(committedFiles).not.toContain('.vela/cache/');
  });

  it('updates pipeline git JSON column with commit hash', () => {
    const db = makeDb();
    createTestPipeline(db);

    const dir = makeTempGitRepo();
    tempDirs.push(dir);
    writeFileSync(join(dir, 'file.txt'), 'content\n');

    commitChanges(db, dir);

    const pipeline = getPipelineState(db);
    const git = pipeline!.git as Record<string, unknown>;
    expect(git.commit_hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('maps pipeline type to conventional commit type', () => {
    const db = makeDb();
    // Use the pipeline's type field — default is 'code' → 'feat'
    createTestPipeline(db, 'Fix critical auth bug');

    const dir = makeTempGitRepo();
    tempDirs.push(dir);
    writeFileSync(join(dir, 'fix.ts'), 'export const fix = true;\n');

    const result = commitChanges(db, dir);
    expect(result.ok).toBe(true);
    if (result.ok && result.action === 'committed') {
      // Default type is 'code' → 'feat'
      expect(result.message).toMatch(/^feat\(/);
    }
  });

  it('skips for non-git directory', () => {
    const db = makeDb();
    createTestPipeline(db);

    const dir = join(tmpdir(), `vela-git-test-nocommit-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);

    const result = commitChanges(db, dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe('skipped');
    }
  });
});

// ── squashMerge ────────────────────────────────────────────────────

describe('squashMerge', () => {
  it('returns error when no active pipeline', () => {
    const db = makeDb();
    const dir = makeTempGitRepo();
    tempDirs.push(dir);

    const result = squashMerge(db, dir);
    expect(result.ok).toBe(false);
  });

  it('returns error when no pipeline branch set', () => {
    const db = makeDb();
    createTestPipeline(db);

    const dir = makeTempGitRepo();
    tempDirs.push(dir);

    const result = squashMerge(db, dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('No pipeline branch');
    }
  });

  it('returns error on dirty working tree', () => {
    const db = makeDb();
    createTestPipeline(db);

    const dir = makeTempGitRepo();
    tempDirs.push(dir);

    // Create branch and set up git state
    createBranch(db, dir);
    // Make dirty
    writeFileSync(join(dir, 'dirty.txt'), 'uncommitted');

    const result = squashMerge(db, dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('dirty');
    }
  });

  it('performs full squash merge lifecycle', () => {
    const db = makeDb();
    createTestPipeline(db, 'Add user feature');

    const dir = makeTempGitRepo();
    tempDirs.push(dir);

    // Create branch
    const branchResult = createBranch(db, dir);
    expect(branchResult.ok).toBe(true);

    // Make changes and commit
    writeFileSync(join(dir, 'feature.ts'), 'export const users = [];\n');
    const commitResult = commitChanges(db, dir);
    expect(commitResult.ok).toBe(true);

    // Squash merge back
    const mergeResult = squashMerge(db, dir);
    expect(mergeResult.ok).toBe(true);
    if (mergeResult.ok && mergeResult.action === 'merged') {
      expect(mergeResult.hash).toMatch(/^[0-9a-f]{40}$/);
      expect(mergeResult.base_branch).toBe('main');
    }

    // Verify we're back on main
    const currentBranch = gitExec('git rev-parse --abbrev-ref HEAD', dir);
    expect(currentBranch).toBe('main');

    // Verify the feature file exists on main
    expect(existsSync(join(dir, 'feature.ts'))).toBe(true);

    // Verify pipeline branch was deleted
    const branches = gitExec('git branch', dir);
    expect(branches).not.toContain('vela/');
  });

  it('updates pipeline git JSON column after merge', () => {
    const db = makeDb();
    createTestPipeline(db, 'Merge test');

    const dir = makeTempGitRepo();
    tempDirs.push(dir);

    createBranch(db, dir);
    writeFileSync(join(dir, 'test.ts'), 'export const x = 1;\n');
    commitChanges(db, dir);
    squashMerge(db, dir);

    const pipeline = getPipelineState(db);
    const git = pipeline!.git as Record<string, unknown>;
    expect(git.commit_hash).toMatch(/^[0-9a-f]{40}$/);
    expect(git.pipeline_branch).toBeNull();
  });
});
