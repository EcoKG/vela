/**
 * Tests for pipeline-prompts module.
 *
 * Validates each stage prompt builder returns well-formed strings
 * containing the expected contextual inputs, and that the dispatcher
 * validates required inputs per stage.
 */
import { describe, it, expect } from 'vitest';
import {
  getResearchPrompt,
  getPlanPrompt,
  getExecutePrompt,
  getVerifyPrompt,
  getCommitPrompt,
  getStagePrompt,
  PIPELINE_STAGES,
  type PipelineStage,
  type StagePromptInput,
} from '../src/pipeline-prompts.js';

// ── Individual prompt builders ─────────────────────────────────────

describe('getResearchPrompt', () => {
  it('includes the user request and working directory', () => {
    const prompt = getResearchPrompt('add auth module', '/home/user/project');
    expect(prompt).toContain('add auth module');
    expect(prompt).toContain('/home/user/project');
  });

  it('contains research-specific instructions', () => {
    const prompt = getResearchPrompt('fix bug', '/tmp');
    expect(prompt).toContain('hypothes');
    expect(prompt).toContain('evidence');
    expect(prompt).toContain('Read-only');
  });

  it('returns a non-empty string', () => {
    const prompt = getResearchPrompt('task', '/cwd');
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });
});

describe('getPlanPrompt', () => {
  const research = '## Key Findings\n- The auth module uses JWT tokens.';

  it('includes the user request and research findings', () => {
    const prompt = getPlanPrompt('add auth module', research);
    expect(prompt).toContain('add auth module');
    expect(prompt).toContain('JWT tokens');
  });

  it('contains planning-specific instructions', () => {
    const prompt = getPlanPrompt('task', research);
    expect(prompt).toContain('architecture');
    expect(prompt).toContain('wave');
    expect(prompt).toContain('task');
  });

  it('mentions XML plan format', () => {
    const prompt = getPlanPrompt('task', research);
    expect(prompt).toContain('<plan>');
    expect(prompt).toContain('<tasks>');
  });
});

describe('getExecutePrompt', () => {
  const plan = '<plan><tasks><task id="1">implement auth</task></tasks></plan>';

  it('includes the user request and plan', () => {
    const prompt = getExecutePrompt('add auth module', plan);
    expect(prompt).toContain('add auth module');
    expect(prompt).toContain('implement auth');
  });

  it('contains TDD instructions', () => {
    const prompt = getExecutePrompt('task', plan);
    expect(prompt).toContain('TDD');
    expect(prompt).toContain('Red');
    expect(prompt).toContain('Green');
    expect(prompt).toContain('Refactor');
  });

  it('instructs not to commit until tests pass', () => {
    const prompt = getExecutePrompt('task', plan);
    expect(prompt).toContain('Do not commit until all tests pass');
  });
});

describe('getVerifyPrompt', () => {
  it('includes the original request', () => {
    const prompt = getVerifyPrompt('add auth module');
    expect(prompt).toContain('add auth module');
  });

  it('contains verification-specific instructions', () => {
    const prompt = getVerifyPrompt('task');
    expect(prompt).toContain('test suite');
    expect(prompt).toContain('regression');
    expect(prompt).toContain('PASS');
    expect(prompt).toContain('FAIL');
  });

  it('is read-only', () => {
    const prompt = getVerifyPrompt('task');
    expect(prompt).toContain('Read-only');
  });
});

describe('getCommitPrompt', () => {
  it('includes the original request', () => {
    const prompt = getCommitPrompt('add auth module');
    expect(prompt).toContain('add auth module');
  });

  it('contains commit convention guidance', () => {
    const prompt = getCommitPrompt('task');
    expect(prompt).toContain('feat(');
    expect(prompt).toContain('fix(');
    expect(prompt).toContain('conventional commit');
  });

  it('instructs not to push', () => {
    const prompt = getCommitPrompt('task');
    expect(prompt).toContain('Do NOT push');
  });
});

// ── PIPELINE_STAGES constant ───────────────────────────────────────

describe('PIPELINE_STAGES', () => {
  it('has 5 stages in the correct order', () => {
    expect(PIPELINE_STAGES).toEqual([
      'research',
      'plan',
      'execute',
      'verify',
      'commit',
    ]);
  });

  it('is a readonly tuple (as const)', () => {
    // `as const` is a compile-time constraint; at runtime it's a regular array.
    // Verify it's an array with the expected length and values.
    expect(Array.isArray(PIPELINE_STAGES)).toBe(true);
    expect(PIPELINE_STAGES).toHaveLength(5);
  });
});

// ── getStagePrompt dispatcher ──────────────────────────────────────

describe('getStagePrompt', () => {
  const baseInput: StagePromptInput = {
    request: 'add auth module',
    cwd: '/home/user/project',
    researchResult: 'research findings here',
    planResult: 'plan xml here',
  };

  it('dispatches research stage correctly', () => {
    const result = getStagePrompt('research', baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toContain('add auth module');
      expect(result.prompt).toContain('/home/user/project');
    }
  });

  it('dispatches plan stage correctly', () => {
    const result = getStagePrompt('plan', baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toContain('research findings here');
    }
  });

  it('dispatches execute stage correctly', () => {
    const result = getStagePrompt('execute', baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toContain('plan xml here');
    }
  });

  it('dispatches verify stage correctly', () => {
    const result = getStagePrompt('verify', baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toContain('add auth module');
    }
  });

  it('dispatches commit stage correctly', () => {
    const result = getStagePrompt('commit', baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toContain('add auth module');
    }
  });

  // ── Input validation ───────────────────────────────────────────

  it('returns error when research stage is missing cwd', () => {
    const result = getStagePrompt('research', { request: 'task' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('cwd');
    }
  });

  it('returns error when plan stage is missing researchResult', () => {
    const result = getStagePrompt('plan', { request: 'task' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('researchResult');
    }
  });

  it('returns error when execute stage is missing planResult', () => {
    const result = getStagePrompt('execute', { request: 'task' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('planResult');
    }
  });

  it('succeeds for verify stage with only request', () => {
    const result = getStagePrompt('verify', { request: 'task' });
    expect(result.ok).toBe(true);
  });

  it('succeeds for commit stage with only request', () => {
    const result = getStagePrompt('commit', { request: 'task' });
    expect(result.ok).toBe(true);
  });

  // ── All stages produce non-trivial prompts ─────────────────────

  it('all stages produce prompts longer than 200 chars', () => {
    for (const stage of PIPELINE_STAGES) {
      const result = getStagePrompt(stage, baseInput);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.prompt.length).toBeGreaterThan(200);
      }
    }
  });
});
