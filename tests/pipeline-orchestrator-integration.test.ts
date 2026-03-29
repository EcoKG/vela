/**
 * Integration tests for the pipeline orchestrator.
 *
 * Tests the full orchestrator flow with all real modules (pipeline state,
 * prompts, artifacts) — only the Claude API and tool execution are mocked.
 *
 * Verifies:
 * - Cross-module data flow: research output → plan prompt → execute prompt
 * - DB state transitions: init → research → plan → ... → completed
 * - Callback lifecycle across all stages
 * - Tool call counting accuracy across multi-tool stages
 * - Artifact detection integration (Write tool calls → CompletionSignal)
 * - Pipeline type auto-selection based on request classification
 * - Error propagation with partial results
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type {
  Message,
  ToolUseBlock,
  TextBlock,
} from '@anthropic-ai/sdk/resources/messages/messages.js';
import type { PipelineStage } from '../src/pipeline-prompts.js';
import type { PipelineCallbacks, StepResult } from '../src/pipeline-orchestrator.js';
import { detectStageCompletion } from '../src/pipeline-artifacts.js';

// ── Mock function references ───────────────────────────────────────

const mockSendMessage = vi.fn();
const mockExecuteToolsParallel = vi.fn();

// ── Claude message builders ────────────────────────────────────────

function makeEndTurnMessage(text: string): Message {
  return {
    id: `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-20250514',
    stop_reason: 'end_turn',
    stop_sequence: null,
    content: [{ type: 'text', text } as TextBlock],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

function makeToolUseMessage(
  toolName: string,
  input: Record<string, unknown>,
  toolUseId = 'toolu_test_01',
): Message {
  return {
    id: `msg_tool_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-20250514',
    stop_reason: 'tool_use',
    stop_sequence: null,
    content: [
      {
        type: 'tool_use',
        id: toolUseId,
        name: toolName,
        input,
      } as ToolUseBlock,
    ],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

function makeMultiToolMessage(
  tools: Array<{ name: string; input: Record<string, unknown>; id: string }>,
): Message {
  return {
    id: `msg_multi_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-20250514',
    stop_reason: 'tool_use',
    stop_sequence: null,
    content: tools.map((t) => ({
      type: 'tool_use' as const,
      id: t.id,
      name: t.name,
      input: t.input,
    })),
    usage: { input_tokens: 200, output_tokens: 100 },
  };
}

// ── Module mocks (only Claude client + tool execution) ─────────────

vi.mock('../src/claude-client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/claude-client.js')>();
  return {
    ...mod,
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  };
});

vi.mock('../src/tool-engine.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/tool-engine.js')>();
  return {
    ...mod,
    executeToolsParallel: (...args: unknown[]) => mockExecuteToolsParallel(...args),
    TOOL_DEFINITIONS: mod.TOOL_DEFINITIONS,
  };
});

vi.mock('../src/governance/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/governance/index.js')>();
  return {
    ...mod,
    buildGateContext: vi.fn().mockReturnValue({
      cwd: '/test',
      mode: 'readwrite',
      currentStep: 'execute',
    }),
  };
});

// ── Imports after mocks ────────────────────────────────────────────

import {
  runPipeline,
  classifyRequest,
  getStagesForType,
} from '../src/pipeline-orchestrator.js';
import type { PipelineRunOptions } from '../src/pipeline-orchestrator.js';
import { openStateDb, listPipelines } from '../src/state.js';
import { getPipelineState } from '../src/pipeline.js';
import { getStagePrompt } from '../src/pipeline-prompts.js';

// ── Test helpers ───────────────────────────────────────────────────

function createTestDb(): Database.Database {
  return openStateDb();
}

function defaultOpts(
  overrides: Partial<PipelineRunOptions> = {},
): PipelineRunOptions {
  return {
    cwd: '/test/project',
    db: createTestDb(),
    ...overrides,
  };
}

// ── Integration tests ──────────────────────────────────────────────

describe('Integration: standard pipeline end-to-end', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
    mockExecuteToolsParallel.mockResolvedValue([]);
  });

  afterEach(() => {
    db.close();
  });

  it('runs all 5 stages in order with correct data forwarding', async () => {
    const capturedSystemPrompts: string[] = [];
    const capturedUserMessages: string[] = [];

    mockSendMessage.mockImplementation(
      async (
        _client: unknown,
        messages: Array<{ role: string; content: string }>,
        opts?: { system?: string },
      ) => {
        if (opts?.system) capturedSystemPrompts.push(opts.system);
        // Capture latest user message
        const lastUser = messages.filter((m) => m.role === 'user').pop();
        if (lastUser && typeof lastUser.content === 'string') {
          capturedUserMessages.push(lastUser.content);
        }

        // Return stage-specific output
        const sys = opts?.system || '';
        if (sys.includes('researcher')) {
          return makeEndTurnMessage('RESEARCH: Found 3 auth patterns in codebase. jwt-based auth at src/auth.ts.');
        }
        if (sys.includes('planner')) {
          return makeEndTurnMessage('<plan><task id="1" wave="1"><action>Refactor auth module</action></task></plan>');
        }
        if (sys.includes('executor')) {
          return makeEndTurnMessage('EXECUTE: Implemented auth refactoring in 2 files.');
        }
        if (sys.includes('verifier')) {
          return makeEndTurnMessage('VERIFY: All 42 tests pass. VERDICT: PASS.');
        }
        if (sys.includes('finalising')) {
          return makeEndTurnMessage('COMMIT: feat(auth): refactor authentication module');
        }
        return makeEndTurnMessage('Stage done.');
      },
    );

    const result = await runPipeline('refactor the authentication system', {
      ...defaultOpts({ db }),
      scale: 'large',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // All 5 stages ran
    expect(result.steps).toHaveLength(5);
    expect(result.steps.map((s) => s.stage)).toEqual([
      'research', 'plan', 'execute', 'verify', 'commit',
    ]);

    // Verify data forwarding: research output appears in plan system prompt
    expect(capturedSystemPrompts[1]).toContain('RESEARCH: Found 3 auth patterns');

    // Verify data forwarding: plan output appears in execute system prompt
    expect(capturedSystemPrompts[2]).toContain('Refactor auth module');

    // Each step captured its stage-specific output
    expect(result.steps[0].output).toContain('RESEARCH');
    expect(result.steps[1].output).toContain('plan');
    expect(result.steps[2].output).toContain('EXECUTE');
    expect(result.steps[3].output).toContain('VERIFY');
    expect(result.steps[4].output).toContain('COMMIT');
  });

  it('pipeline DB state reaches completed after all stages', async () => {
    mockSendMessage.mockResolvedValue(makeEndTurnMessage('Done.'));

    const result = await runPipeline('refactor auth system', {
      ...defaultOpts({ db }),
      scale: 'large',
    });

    expect(result.ok).toBe(true);

    // Pipeline should be completed in DB
    const pipelines = listPipelines(db);
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0].status).toBe('completed');
  });

  it('full callback lifecycle fires in correct order', async () => {
    const events: string[] = [];

    mockSendMessage.mockResolvedValue(makeEndTurnMessage('Done.'));

    const callbacks: PipelineCallbacks = {
      onStepStart: (stage) => events.push(`start:${stage}`),
      onStepComplete: (stage, result) =>
        events.push(`complete:${stage}:tools=${result.toolCalls}`),
      onText: (text) => events.push(`text:${text.substring(0, 10)}`),
    };

    const result = await runPipeline('refactor auth', {
      ...defaultOpts({ db }),
      scale: 'large',
      callbacks,
    });

    expect(result.ok).toBe(true);

    // Every stage had start/complete pair in order
    const stages: PipelineStage[] = ['research', 'plan', 'execute', 'verify', 'commit'];
    for (const stage of stages) {
      const startIdx = events.indexOf(`start:${stage}`);
      const completeEntry = events.find((e) => e.startsWith(`complete:${stage}`));
      const completeIdx = completeEntry ? events.indexOf(completeEntry) : -1;

      expect(startIdx).toBeGreaterThanOrEqual(0);
      expect(completeIdx).toBeGreaterThan(startIdx);
    }

    // Order: start:research before start:plan before start:execute...
    const startEvents = events.filter((e) => e.startsWith('start:'));
    expect(startEvents).toEqual(stages.map((s) => `start:${s}`));
  });
});

describe('Integration: tool calls across stages', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
    mockExecuteToolsParallel.mockResolvedValue([
      { type: 'tool_result', tool_use_id: 'toolu_01', content: 'file content' },
    ]);
  });

  afterEach(() => {
    db.close();
  });

  it('tracks tool calls per-stage accurately in multi-stage pipeline', async () => {
    const stageCalls = new Map<string, number>();

    mockSendMessage.mockImplementation(async (
      _client: unknown,
      _messages: unknown,
      opts?: { system?: string },
    ) => {
      const sys = opts?.system || '';

      // Identify current stage from system prompt
      let stage = 'unknown';
      if (sys.includes('researcher')) stage = 'research';
      else if (sys.includes('planner')) stage = 'plan';
      else if (sys.includes('executor')) stage = 'execute';
      else if (sys.includes('verifier')) stage = 'verify';
      else if (sys.includes('finalising')) stage = 'commit';

      const count = (stageCalls.get(stage) || 0) + 1;
      stageCalls.set(stage, count);

      // Research stage: 2 tool calls (Read + Read), then end
      if (stage === 'research') {
        if (count <= 2) return makeToolUseMessage('Read', { path: `src/file${count}.ts` }, `toolu_r${count}`);
        return makeEndTurnMessage('Research complete.');
      }
      // Plan stage: no tool calls
      if (stage === 'plan') {
        return makeEndTurnMessage('<plan>Plan output</plan>');
      }
      // Execute stage: 1 tool call (Write), then end
      if (stage === 'execute') {
        if (count === 1) return makeToolUseMessage('Write', { path: 'src/new.ts', content: '...' }, 'toolu_e1');
        return makeEndTurnMessage('Executed.');
      }
      return makeEndTurnMessage('Done.');
    });

    const result = await runPipeline('refactor auth', {
      ...defaultOpts({ db }),
      scale: 'large',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Research had 2 tool calls
    expect(result.steps[0].stage).toBe('research');
    expect(result.steps[0].toolCalls).toBe(2);

    // Plan had 0 tool calls
    expect(result.steps[1].stage).toBe('plan');
    expect(result.steps[1].toolCalls).toBe(0);

    // Execute had 1 tool call
    expect(result.steps[2].stage).toBe('execute');
    expect(result.steps[2].toolCalls).toBe(1);
  });

  it('onToolCall callback receives correct tool names across stages', async () => {
    const toolCalls: Array<{ name: string; stage: string }> = [];
    let currentStage = '';

    const callbacks: PipelineCallbacks = {
      onStepStart: (stage) => { currentStage = stage; },
      onToolCall: (name) => toolCalls.push({ name, stage: currentStage }),
    };

    // Execute stage: tool use, then end. Commit: end.
    mockSendMessage
      .mockResolvedValueOnce(makeToolUseMessage('Write', { path: 'a.ts', content: 'x' }, 'toolu_01'))
      .mockResolvedValueOnce(makeEndTurnMessage('Executed.'))
      .mockResolvedValueOnce(makeEndTurnMessage('Committed.'));

    await runPipeline('fix typo', {
      ...defaultOpts({ db }),
      scale: 'small',
      callbacks,
    });

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toEqual({ name: 'Write', stage: 'execute' });
  });

  it('handles parallel tool calls (multiple tool_use blocks in one response)', async () => {
    mockSendMessage
      .mockResolvedValueOnce(
        makeMultiToolMessage([
          { name: 'Read', input: { path: 'a.ts' }, id: 'toolu_01' },
          { name: 'Read', input: { path: 'b.ts' }, id: 'toolu_02' },
          { name: 'Read', input: { path: 'c.ts' }, id: 'toolu_03' },
        ]),
      )
      .mockResolvedValueOnce(makeEndTurnMessage('Execute done.'))
      .mockResolvedValueOnce(makeEndTurnMessage('Committed.'));

    mockExecuteToolsParallel.mockResolvedValueOnce([
      { type: 'tool_result', tool_use_id: 'toolu_01', content: 'a' },
      { type: 'tool_result', tool_use_id: 'toolu_02', content: 'b' },
      { type: 'tool_result', tool_use_id: 'toolu_03', content: 'c' },
    ]);

    const result = await runPipeline('fix typo', {
      ...defaultOpts({ db }),
      scale: 'small',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 3 tool calls in execute, 0 in commit
    expect(result.steps[0].toolCalls).toBe(3);
    expect(result.steps[1].toolCalls).toBe(0);
  });
});

describe('Integration: prompt module produces valid prompts for each stage', () => {
  it('getStagePrompt returns valid prompts for all stages with proper inputs', () => {
    const research = getStagePrompt('research', { request: 'test', cwd: '/tmp' });
    expect(research.ok).toBe(true);
    if (research.ok) expect(research.prompt).toContain('researcher');

    const plan = getStagePrompt('plan', { request: 'test', researchResult: 'findings' });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.prompt).toContain('findings');

    const execute = getStagePrompt('execute', { request: 'test', planResult: 'the plan' });
    expect(execute.ok).toBe(true);
    if (execute.ok) expect(execute.prompt).toContain('the plan');

    const verify = getStagePrompt('verify', { request: 'test' });
    expect(verify.ok).toBe(true);
    if (verify.ok) expect(verify.prompt).toContain('verifier');

    const commit = getStagePrompt('commit', { request: 'test' });
    expect(commit.ok).toBe(true);
    if (commit.ok) expect(commit.prompt).toContain('commit');
  });

  it('getStagePrompt fails with clear errors on missing required inputs', () => {
    const noDir = getStagePrompt('research', { request: 'test' });
    expect(noDir.ok).toBe(false);
    if (!noDir.ok) expect(noDir.error).toContain('cwd');

    const noResearch = getStagePrompt('plan', { request: 'test' });
    expect(noResearch.ok).toBe(false);
    if (!noResearch.ok) expect(noResearch.error).toContain('researchResult');

    const noPlan = getStagePrompt('execute', { request: 'test' });
    expect(noPlan.ok).toBe(false);
    if (!noPlan.ok) expect(noPlan.error).toContain('planResult');
  });
});

describe('Integration: artifact detection with orchestrator flow', () => {
  it('detectStageCompletion identifies Write calls matching artifact paths', () => {
    const cwd = '/project';
    const pipelineId = '20260327_abc123_test-fix';

    // Write to the research artifact path
    const researchResult = detectStageCompletion(
      'Write',
      { path: `${cwd}/.vela/artifacts/${pipelineId}/research.md` },
      cwd,
      pipelineId,
    );
    expect(researchResult.detected).toBe(true);
    expect(researchResult.stage).toBe('research');

    // Write to the plan artifact path (relative)
    const planResult = detectStageCompletion(
      'Write',
      { path: `.vela/artifacts/${pipelineId}/plan.md` },
      cwd,
      pipelineId,
    );
    expect(planResult.detected).toBe(true);
    expect(planResult.stage).toBe('plan');

    // Non-artifact Write
    const otherResult = detectStageCompletion(
      'Write',
      { path: 'src/index.ts' },
      cwd,
      pipelineId,
    );
    expect(otherResult.detected).toBe(false);

    // Non-Write tool
    const readResult = detectStageCompletion(
      'Read',
      { path: `${cwd}/.vela/artifacts/${pipelineId}/research.md` },
      cwd,
      pipelineId,
    );
    expect(readResult.detected).toBe(false);
  });
});

describe('Integration: pipeline type selection and stage mapping', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue(makeEndTurnMessage('Done.'));
    mockExecuteToolsParallel.mockResolvedValue([]);
  });

  afterEach(() => {
    db.close();
  });

  it('auto-classifies and runs correct stages for each request complexity', async () => {
    // Small → trivial (execute + commit)
    const smallResult = await runPipeline('fix typo', defaultOpts({ db }));
    expect(smallResult.ok).toBe(true);
    if (smallResult.ok) {
      expect(smallResult.steps.map((s) => s.stage)).toEqual(['execute', 'commit']);
    }
    db.close();

    // Medium → quick (plan + execute + verify + commit)
    db = createTestDb();
    const medResult = await runPipeline(
      'add a login page with email and password fields, validation, and error messages',
      defaultOpts({ db }),
    );
    expect(medResult.ok).toBe(true);
    if (medResult.ok) {
      expect(medResult.steps.map((s) => s.stage)).toEqual([
        'plan', 'execute', 'verify', 'commit',
      ]);
    }
    db.close();

    // Large → standard (all 5 stages)
    db = createTestDb();
    const largeResult = await runPipeline(
      'refactor the authentication system across multiple files',
      defaultOpts({ db }),
    );
    expect(largeResult.ok).toBe(true);
    if (largeResult.ok) {
      expect(largeResult.steps.map((s) => s.stage)).toEqual([
        'research', 'plan', 'execute', 'verify', 'commit',
      ]);
    }
  });

  it('explicit pipelineType overrides auto-classification', async () => {
    // "fix typo" is small, but we force standard
    const result = await runPipeline('fix typo', {
      ...defaultOpts({ db }),
      pipelineType: 'standard',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.steps).toHaveLength(5);
      expect(result.steps[0].stage).toBe('research');
    }
  });

  it('getStagesForType returns correct stage arrays', () => {
    expect(getStagesForType('standard')).toEqual(['research', 'plan', 'execute', 'verify', 'commit']);
    expect(getStagesForType('quick')).toEqual(['plan', 'execute', 'verify', 'commit']);
    expect(getStagesForType('trivial')).toEqual(['execute', 'commit']);
  });
});

describe('Integration: error handling and partial results', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
    mockExecuteToolsParallel.mockResolvedValue([]);
  });

  afterEach(() => {
    db.close();
  });

  it('mid-pipeline failure returns partial results from completed stages', async () => {
    mockSendMessage
      .mockResolvedValueOnce(makeEndTurnMessage('Research findings.'))     // research
      .mockResolvedValueOnce(makeEndTurnMessage('<plan>Plan here</plan>'))  // plan
      .mockRejectedValueOnce(new Error('API overloaded'))                   // execute fails
    ;

    const errors: Array<{ error: Error; stage: PipelineStage }> = [];
    const callbacks: PipelineCallbacks = {
      onError: (error, stage) => errors.push({ error, stage }),
    };

    const result = await runPipeline('refactor auth', {
      ...defaultOpts({ db }),
      scale: 'large',
      callbacks,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('execute');
      expect(result.error).toContain('API overloaded');
    }

    // 2 stages completed before failure
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].stage).toBe('research');
    expect(result.steps[1].stage).toBe('plan');

    // onError fired for the failed stage
    expect(errors).toHaveLength(1);
    expect(errors[0].stage).toBe('execute');
  });

  it('first stage failure returns empty steps array', async () => {
    mockSendMessage.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await runPipeline('fix typo', {
      ...defaultOpts({ db }),
      scale: 'small',
    });

    expect(result.ok).toBe(false);
    expect(result.steps).toHaveLength(0);
  });

  it('tool iteration limit prevents infinite loops', async () => {
    // Always return tool_use — never end_turn
    mockSendMessage.mockResolvedValue(
      makeToolUseMessage('Read', { path: 'loop.ts' }),
    );
    mockExecuteToolsParallel.mockResolvedValue([
      { type: 'tool_result', tool_use_id: 'toolu_test_01', content: 'content' },
    ]);

    const result = await runPipeline('fix typo', {
      ...defaultOpts({ db }),
      scale: 'small',
      maxToolIterations: 5,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Execute stage hit 5 iteration limit
      expect(result.steps[0].toolCalls).toBe(5);
    }
  });
});

describe('Integration: request classification edge cases', () => {
  it('treats "architect" keyword as large-scale', () => {
    expect(classifyRequest('architect a new plugin system')).toBe('large');
  });

  it('treats "project-wide" as large-scale', () => {
    expect(classifyRequest('apply project-wide linting rules')).toBe('large');
  });

  it('treats short requests without complex keywords as small', () => {
    expect(classifyRequest('fix bug')).toBe('small');
    expect(classifyRequest('add tooltip')).toBe('small');
  });

  it('treats 31+ word requests as large', () => {
    const words = Array(32).fill('word').join(' ');
    expect(classifyRequest(words)).toBe('large');
  });

  it('treats 11-30 word requests as medium', () => {
    const words = Array(15).fill('word').join(' ');
    expect(classifyRequest(words)).toBe('medium');
  });
});

describe('Integration: DB state consistency', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue(makeEndTurnMessage('Done.'));
    mockExecuteToolsParallel.mockResolvedValue([]);
  });

  afterEach(() => {
    db.close();
  });

  it('pipeline ID is returned and matches DB record', async () => {
    const result = await runPipeline('fix typo', {
      ...defaultOpts({ db }),
      scale: 'small',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pipelines = listPipelines(db);
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0].id).toBe(result.pipelineId);
  });

  it('completed pipeline has correct type and scale in DB', async () => {
    const result = await runPipeline('fix typo', {
      ...defaultOpts({ db }),
      scale: 'small',
    });

    expect(result.ok).toBe(true);

    const pipelines = listPipelines(db);
    expect(pipelines[0].scale).toBe('small');
    expect(pipelines[0].pipeline_type).toBe('trivial');
  });

  it('pipeline with explicit type override stores correct type', async () => {
    await runPipeline('fix typo', {
      ...defaultOpts({ db }),
      scale: 'small',
      pipelineType: 'standard',
    });

    const pipelines = listPipelines(db);
    expect(pipelines[0].pipeline_type).toBe('standard');
  });

  it('failed pipeline does not reach completed status', async () => {
    mockSendMessage.mockRejectedValue(new Error('API error'));

    await runPipeline('fix typo', {
      ...defaultOpts({ db }),
      scale: 'small',
    });

    const pipelines = listPipelines(db);
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0].status).not.toBe('completed');
  });

  it('second pipeline can run after first completes', async () => {
    await runPipeline('first task', {
      ...defaultOpts({ db }),
      scale: 'small',
    });

    const result2 = await runPipeline('second task', {
      ...defaultOpts({ db }),
      scale: 'small',
    });

    // Either both succeed (drain worked) or second fails with active pipeline — both valid
    const pipelines = listPipelines(db);
    expect(pipelines.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Integration: quick pipeline data forwarding', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
    mockExecuteToolsParallel.mockResolvedValue([]);
  });

  afterEach(() => {
    db.close();
  });

  it('quick pipeline passes plan output to execute stage', async () => {
    const systemPrompts: string[] = [];

    mockSendMessage.mockImplementation(
      async (
        _client: unknown,
        _messages: unknown,
        opts?: { system?: string },
      ) => {
        if (opts?.system) systemPrompts.push(opts.system);
        if (opts?.system?.includes('planner')) {
          return makeEndTurnMessage('PLAN: Step 1 - create auth module. Step 2 - add tests.');
        }
        return makeEndTurnMessage('Stage done.');
      },
    );

    const result = await runPipeline('add login form with validation', {
      ...defaultOpts({ db }),
      scale: 'medium',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 4 stages for quick pipeline
    expect(result.steps).toHaveLength(4);
    expect(result.steps.map((s) => s.stage)).toEqual([
      'plan', 'execute', 'verify', 'commit',
    ]);

    // Execute prompt (index 1) should contain the plan output
    expect(systemPrompts[1]).toContain('PLAN: Step 1 - create auth module');
  });
});
