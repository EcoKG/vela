import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { getPipelineState } from './pipeline.js';
import { updatePipeline } from './state.js';
import type { Pipeline } from './state.js';

// ── Constants ──────────────────────────────────────────────────────

export const PROTECTED_BRANCHES = ['main', 'master', 'develop'] as const;

// ── Types ──────────────────────────────────────────────────────────

export interface GitStateRepo {
  is_repo: true;
  current_branch: string;
  is_clean: boolean;
  dirty_files: number;
  head_hash: string;
  remote: string | null;
  is_protected: boolean;
}

export interface GitStateNotRepo {
  is_repo: false;
}

export interface GitStateError {
  is_repo: true;
  error: string;
}

export type GitState = GitStateRepo | GitStateNotRepo | GitStateError;

export type GitResult =
  | { ok: true; action: 'created'; branch: string; base_branch: string; checkpoint_hash: string }
  | { ok: true; action: 'existing'; branch: string }
  | { ok: true; action: 'skipped'; message: string }
  | { ok: true; action: 'committed'; hash: string; message: string }
  | { ok: true; action: 'no_changes' }
  | { ok: true; action: 'merged'; hash: string; base_branch: string }
  | { ok: false; error: string };

// ── Helpers ────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

// ── Core functions ─────────────────────────────────────────────────

/**
 * Thin wrapper around execSync with 15s timeout and piped stdio.
 * Returns stdout as a trimmed string.
 */
export function gitExec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
    }).toString().trim();
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer; message?: string };
    const stderr = e.stderr ? e.stderr.toString().trim() : (e.message ?? 'Unknown git error');
    throw new Error(stderr);
  }
}

/**
 * Snapshots the current git state at the given directory.
 * Returns { is_repo: false } if not a git repository.
 */
export function snapshotGitState(cwd: string): GitState {
  try {
    gitExec('git rev-parse --git-dir', cwd);
  } catch {
    return { is_repo: false };
  }

  try {
    const currentBranch = gitExec('git rev-parse --abbrev-ref HEAD', cwd);
    const status = gitExec('git status --porcelain', cwd);
    const headHash = gitExec('git rev-parse HEAD', cwd);

    let remote: string | null = null;
    try {
      const remoteOutput = gitExec('git remote', cwd);
      remote = remoteOutput.split('\n')[0] || null;
    } catch {
      // No remote configured — that's fine
    }

    return {
      is_repo: true,
      current_branch: currentBranch,
      is_clean: status === '',
      dirty_files: status ? status.split('\n').length : 0,
      head_hash: headHash,
      remote,
      is_protected: (PROTECTED_BRANCHES as readonly string[]).includes(currentBranch),
    };
  } catch (err: unknown) {
    const e = err as Error;
    return { is_repo: true, error: e.message };
  }
}

/**
 * Creates or reuses a branch for the active pipeline.
 * - Non-repo: skips gracefully
 * - Non-protected branch: reuses current branch
 * - Protected branch: creates vela/{slug}-{HHMM}
 * Updates pipeline git JSON column.
 */
export function createBranch(db: Database.Database, cwd: string): GitResult {
  const pipeline = getPipelineState(db);
  if (!pipeline) {
    return { ok: false, error: 'No active pipeline' };
  }

  const state = snapshotGitState(cwd);
  if (!state.is_repo) {
    updatePipeline(db, pipeline.id, {
      git: { ...(pipeline.git ?? {}), pipeline_branch: null },
    });
    return { ok: true, action: 'skipped', message: 'Not a git repository' };
  }

  if ('error' in state) {
    return { ok: false, error: state.error };
  }

  const currentBranch = state.current_branch;
  const isProtected = state.is_protected;

  // Already on a non-protected branch — reuse it
  if (!isProtected) {
    updatePipeline(db, pipeline.id, {
      git: {
        ...(pipeline.git ?? {}),
        pipeline_branch: currentBranch,
        current_branch: currentBranch,
      },
    });
    return { ok: true, action: 'existing', branch: currentBranch };
  }

  // Generate branch name from pipeline request
  const slug = slugify(pipeline.request);
  const timeStr = new Date().toTimeString().substring(0, 5).replace(':', '');
  const branchName = `vela/${slug}-${timeStr}`;

  try {
    gitExec(`git checkout -b ${branchName}`, cwd);
  } catch {
    // Branch might already exist — try plain checkout
    try {
      gitExec(`git checkout ${branchName}`, cwd);
    } catch (e2: unknown) {
      return { ok: false, error: `Failed to create branch: ${(e2 as Error).message}` };
    }
  }

  const checkpointHash = gitExec('git rev-parse HEAD', cwd);
  updatePipeline(db, pipeline.id, {
    git: {
      ...(pipeline.git ?? {}),
      pipeline_branch: branchName,
      base_branch: currentBranch,
      current_branch: branchName,
      checkpoint_hash: checkpointHash,
    },
  });

  return {
    ok: true,
    action: 'created',
    branch: branchName,
    base_branch: currentBranch,
    checkpoint_hash: checkpointHash,
  };
}

/**
 * Stages and commits changes for the active pipeline.
 * Excludes .vela/state/, .vela/cache/, .vela/artifacts/.
 * Uses conventional commit format: {type}({slug}): {description}
 */
export function commitChanges(db: Database.Database, cwd: string): GitResult {
  const pipeline = getPipelineState(db);
  if (!pipeline) {
    return { ok: false, error: 'No active pipeline' };
  }

  const state = snapshotGitState(cwd);
  if (!state.is_repo) {
    return { ok: true, action: 'skipped', message: 'Not a git repository' };
  }

  if ('error' in state) {
    return { ok: false, error: state.error };
  }

  // Check for uncommitted changes
  const status = gitExec('git status --porcelain', cwd);
  if (!status) {
    return { ok: true, action: 'no_changes' };
  }

  // Stage all changes
  gitExec('git add -A', cwd);

  // Unstage .vela/ internal files
  const velaExclusions = ['.vela/state/', '.vela/cache/', '.vela/artifacts/'];
  for (const vf of velaExclusions) {
    try {
      gitExec(`git reset HEAD -- "${vf}"`, cwd);
    } catch {
      // Path might not exist in index — that's fine
    }
  }

  // Re-check if anything is staged after exclusions
  const staged = gitExec('git diff --cached --name-only', cwd);
  if (!staged) {
    return { ok: true, action: 'no_changes' };
  }

  // Build conventional commit message
  const typeMap: Record<string, string> = {
    code: 'feat',
    'code-bug': 'fix',
    'code-refactor': 'refactor',
    docs: 'docs',
    infra: 'chore',
  };
  const commitType = typeMap[pipeline.type] || 'feat';
  const slug = slugify(pipeline.request);
  const shortDesc = pipeline.request.substring(0, 70);
  const commitMessage = `${commitType}(${slug}): ${shortDesc}`;

  // Write message to temp file, commit, clean up
  const tmpMsgFile = join(cwd, '.vela-commit-msg.tmp');
  try {
    writeFileSync(tmpMsgFile, commitMessage);
    gitExec(`git commit -F "${tmpMsgFile}"`, cwd);
  } catch (err: unknown) {
    return { ok: false, error: `Commit failed: ${(err as Error).message}` };
  } finally {
    try { unlinkSync(tmpMsgFile); } catch { /* already cleaned */ }
  }

  const commitHash = gitExec('git rev-parse HEAD', cwd);
  updatePipeline(db, pipeline.id, {
    git: {
      ...(pipeline.git ?? {}),
      commit_hash: commitHash,
    },
  });

  return { ok: true, action: 'committed', hash: commitHash, message: commitMessage };
}

/**
 * Squash-merges the pipeline branch back to its base branch.
 * Requires clean working tree and valid pipeline branch/base branch.
 */
export function squashMerge(db: Database.Database, cwd: string): GitResult {
  const pipeline = getPipelineState(db);
  if (!pipeline) {
    return { ok: false, error: 'No active pipeline' };
  }

  const git = pipeline.git as Record<string, unknown> | null;
  if (!git || !git.pipeline_branch || !git.base_branch) {
    return { ok: false, error: 'No pipeline branch or base branch set' };
  }

  const pipelineBranch = git.pipeline_branch as string;
  const baseBranch = git.base_branch as string;

  // Verify working tree is clean
  const state = snapshotGitState(cwd);
  if (!state.is_repo) {
    return { ok: false, error: 'Not a git repository' };
  }
  if ('error' in state) {
    return { ok: false, error: state.error };
  }
  if (!state.is_clean) {
    return { ok: false, error: 'Working tree is dirty — commit or stash changes first' };
  }

  try {
    gitExec(`git checkout ${baseBranch}`, cwd);
    gitExec(`git merge --squash ${pipelineBranch}`, cwd);
    gitExec(`git commit -m "merge: ${pipelineBranch}"`, cwd);
    gitExec(`git branch -D ${pipelineBranch}`, cwd);
  } catch (err: unknown) {
    return { ok: false, error: `Squash merge failed: ${(err as Error).message}` };
  }

  const mergeHash = gitExec('git rev-parse HEAD', cwd);
  updatePipeline(db, pipeline.id, {
    git: {
      ...(pipeline.git ?? {}),
      commit_hash: mergeHash,
      pipeline_branch: null,
    },
  });

  return { ok: true, action: 'merged', hash: mergeHash, base_branch: baseBranch };
}
