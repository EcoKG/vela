/**
 * Pipeline Orchestrator for Vela.
 *
 * Drives a multi-stage pipeline (research → plan → execute → verify → commit)
 * by sequentially invoking Claude with stage-specific system prompts and
 * running tool loops for each stage. Integrates with pipeline.ts for state
 * management and governance/gate.ts for per-step mode enforcement.
 *
 * Each stage:
 *  1. Advances DB state to the corresponding pipeline step
 *  2. Builds a stage-specific system prompt via pipeline-prompts.ts
 *  3. Runs a tool loop (sendMessage → tool execution → repeat)
 *  4. Collects output for downstream stages
 *  5. Fires lifecycle callbacks
 */
import type {
  Message,
  ContentBlock,
  ContentBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages.js';
import type Database from 'better-sqlite3';

import { getStagePrompt } from './pipeline-prompts.js';
import type { PipelineStage, StagePromptInput } from './pipeline-prompts.js';
import {
  sendMessage,
  extractToolUseBlocks,
  isToolUseResponse,
} from './claude-client.js';
import type { ChatMessage, SendMessageOptions } from './claude-client.js';
import { executeToolsParallel } from './tool-engine.js';
import type { ToolContext } from './tool-engine.js';
import {
  buildGateContext,
  RetryBudget,
  type GateContext,
} from './governance/index.js';
import {
  initPipeline,
  transitionPipeline,
  getPipelineState,
  scaleToType,
} from './pipeline.js';
import type { PipelineType, Scale } from './pipeline.js';

// ── Types ──────────────────────────────────────────────────────────

/** Callbacks for monitoring pipeline progress. */
export interface PipelineCallbacks {
  /** Called when a stage begins. */
  onStepStart?: (stage: PipelineStage) => void;
  /** Called when a stage completes successfully. */
  onStepComplete?: (stage: PipelineStage, result: StepResult) => void;
  /** Called for each streamed text chunk. */
  onText?: (text: string) => void;
  /** Called when Claude invokes a tool. */
  onToolCall?: (toolName: string, input: Record<string, unknown>) => void;
  /** Called when a stage fails. */
  onError?: (error: Error, stage: PipelineStage) => void;
}

/** Options for runPipeline. */
export interface PipelineRunOptions {
  /** Working directory for the project. */
  cwd: string;
  /** Claude model to use. */
  model?: string;
  /** Max tokens per response. */
  maxTokens?: number;
  /** Override pipeline type (bypasses auto-detection). */
  pipelineType?: PipelineType;
  /** Override scale (bypasses auto-detection). */
  scale?: Scale;
  /** Event callbacks. */
  callbacks?: PipelineCallbacks;
  /** SQLite database for pipeline state. */
  db: Database.Database;
  /** Max tool loop iterations per stage (default: 20). */
  maxToolIterations?: number;
}

/** Result of a single pipeline stage. */
export interface StepResult {
  /** Which stage produced this result. */
  stage: PipelineStage;
  /** Final text output from Claude. */
  output: string;
  /** Number of tool invocations during this stage. */
  toolCalls: number;
}

/** Overall pipeline execution result. */
export type PipelineRunResult =
  | { ok: true; steps: StepResult[]; pipelineId: string }
  | { ok: false; error: string; steps: StepResult[] };

// ── Pipeline step ↔ stage mapping ──────────────────────────────────

/**
 * Maps pipeline.ts step IDs to orchestrator stages.
 * null = procedural step (auto-transitioned, no Claude invocation).
 */
const STEP_TO_STAGE: Record<string, PipelineStage | null> = {
  init: null,
  research: 'research',
  plan: 'plan',
  'plan-check': null,
  checkpoint: null,
  branch: null,
  execute: 'execute',
  verify: 'verify',
  commit: 'commit',
  finalize: null,
};

// ── Request classification ─────────────────────────────────────────

const COMPLEX_INDICATORS =
  /\b(architect|refactor|redesign|migrate|system|overhaul|framework|infrastructure)\b/i;
const MULTI_FILE_INDICATORS =
  /\b(multiple\s+files|several\s+files|across|project-wide|codebase)\b/i;

/**
 * Classifies a user request into a scale for automatic pipeline type selection.
 *
 * - small  → trivial pipeline (execute + commit)
 * - medium → quick pipeline (plan + execute + verify + commit)
 * - large  → standard pipeline (all 5 stages)
 */
export function classifyRequest(request: string): Scale {
  if (COMPLEX_INDICATORS.test(request) || MULTI_FILE_INDICATORS.test(request)) {
    return 'large';
  }
  const wordCount = request.trim().split(/\s+/).length;
  if (wordCount <= 10) return 'small';
  if (wordCount <= 30) return 'medium';
  return 'large';
}

// ── Stage mapping ──────────────────────────────────────────────────

/**
 * Returns the ordered Claude-facing stages for a given pipeline type.
 */
export function getStagesForType(pipelineType: PipelineType): PipelineStage[] {
  switch (pipelineType) {
    case 'standard':
      return ['research', 'plan', 'execute', 'verify', 'commit'];
    case 'quick':
      return ['plan', 'execute', 'verify', 'commit'];
    case 'trivial':
      return ['execute', 'commit'];
  }
}

// ── Internal helpers ───────────────────────────────────────────────

/** Extract combined text content from a Claude Message. */
function extractTextContent(message: Message): string {
  return message.content
    .filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** Build StagePromptInput for a stage, pulling from prior results. */
function buildStageInput(
  stage: PipelineStage,
  request: string,
  cwd: string,
  priorResults: Map<PipelineStage, string>,
): StagePromptInput {
  const input: StagePromptInput = { request };
  switch (stage) {
    case 'research':
      input.cwd = cwd;
      break;
    case 'plan':
      input.researchResult =
        priorResults.get('research') || 'No research output available.';
      break;
    case 'execute':
      input.planResult =
        priorResults.get('plan') || 'No plan output available.';
      break;
    // verify and commit only need request — no additional input
  }
  return input;
}

/** Build the user message for a given stage. */
function buildUserMessage(stage: PipelineStage, request: string): string {
  switch (stage) {
    case 'research':
      return `Analyse the codebase for the following request:\n\n${request}`;
    case 'plan':
      return `Create an implementation plan for:\n\n${request}\n\nResearch findings are in the system prompt.`;
    case 'execute':
      return `Implement the following:\n\n${request}\n\nThe approved plan is in the system prompt.`;
    case 'verify':
      return `Verify the implementation for:\n\n${request}`;
    case 'commit':
      return `Create a git commit for the work done on:\n\n${request}`;
  }
}

// ── Stage loop ─────────────────────────────────────────────────────

/** Default max tool loop iterations per stage. */
const DEFAULT_MAX_TOOL_ITERATIONS = 20;

/**
 * Runs a single pipeline stage: sends the prompt to Claude, loops on
 * tool_use responses, fires callbacks, and returns the final text output
 * with an accurate tool call count.
 *
 * Uses sendMessage + executeToolsParallel directly (rather than the
 * higher-level runToolLoop) for full callback support and counting.
 */
async function runStageLoop(
  userMessage: string,
  systemPrompt: string,
  options: {
    model?: string;
    maxTokens?: number;
    maxIterations: number;
    gateCtx: GateContext;
    callbacks?: PipelineCallbacks;
  },
): Promise<{ output: string; toolCalls: number }> {
  const { model, maxTokens, maxIterations, gateCtx, callbacks } = options;
  const conversation: ChatMessage[] = [{ role: 'user', content: userMessage }];

  const retryBudget = new RetryBudget();
  const toolCtx: ToolContext = { gate: gateCtx, retryBudget };

  const sendOpts: SendMessageOptions = {
    system: systemPrompt,
    model,
    maxTokens,
    onText: callbacks?.onText,
  };

  let response = await sendMessage(null, conversation, sendOpts);
  let iterations = 0;
  let toolCallCount = 0;

  while (isToolUseResponse(response) && iterations < maxIterations) {
    const check = retryBudget.shouldTerminate();
    if (check.terminate) break;

    iterations++;
    const toolBlocks = extractToolUseBlocks(response);
    toolCallCount += toolBlocks.length;

    // Fire onToolCall callbacks
    for (const block of toolBlocks) {
      callbacks?.onToolCall?.(
        block.name,
        block.input as Record<string, unknown>,
      );
    }

    // Append assistant response to conversation
    conversation.push({
      role: 'assistant',
      content: response.content as ContentBlockParam[],
    });

    // Execute tools with file-conflict-aware parallelism
    const toolResults = await executeToolsParallel(toolBlocks, toolCtx);

    // Append tool results as user message
    conversation.push({
      role: 'user',
      content: toolResults as ContentBlockParam[],
    });

    // Next turn
    response = await sendMessage(null, conversation, sendOpts);
  }

  return {
    output: extractTextContent(response),
    toolCalls: toolCallCount,
  };
}

// ── Pipeline state helpers ─────────────────────────────────────────

/**
 * Advance pipeline DB state from its current step to the step
 * that corresponds to targetStage. Transitions through procedural steps
 * (init, plan-check, checkpoint, branch) automatically.
 */
function advanceToPipelineStep(
  db: Database.Database,
  targetStage: PipelineStage,
): void {
  const MAX_TRANSITIONS = 20;
  for (let i = 0; i < MAX_TRANSITIONS; i++) {
    const pipeline = getPipelineState(db);
    if (!pipeline || pipeline.status !== 'active') return;
    if (STEP_TO_STAGE[pipeline.current_step] === targetStage) return;

    const result = transitionPipeline(db);
    if (!result.ok) {
      throw new Error(`Pipeline transition failed: ${result.error}`);
    }
  }
}

/**
 * Drain remaining procedural steps (e.g. finalize) after all
 * Claude-facing stages complete, so the pipeline reaches 'completed'.
 */
function drainProceduralSteps(db: Database.Database): void {
  const MAX_TRANSITIONS = 10;
  for (let i = 0; i < MAX_TRANSITIONS; i++) {
    const pipeline = getPipelineState(db);
    if (!pipeline || pipeline.status !== 'active') return;

    const result = transitionPipeline(db);
    if (!result.ok) break;
  }
}

// ── Main orchestrator ──────────────────────────────────────────────

/**
 * Runs a full pipeline for a user request.
 *
 * Flow:
 * 1. Classifies request → determines scale + pipeline type
 * 2. Initialises pipeline in SQLite database
 * 3. For each Claude-facing stage:
 *    a. Advances DB state to this stage's pipeline step
 *    b. Builds stage-specific system prompt
 *    c. Builds governance context for mode enforcement
 *    d. Runs stage loop (Claude API + tool execution)
 *    e. Stores output for downstream stages
 * 4. Drains remaining procedural steps to complete pipeline
 * 5. Returns accumulated step results
 */
export async function runPipeline(
  request: string,
  options: PipelineRunOptions,
): Promise<PipelineRunResult> {
  const { cwd, db, callbacks, model, maxTokens } = options;
  const maxToolIterations =
    options.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  const steps: StepResult[] = [];

  // 1. Determine scale and pipeline type
  const scale = options.scale ?? classifyRequest(request);
  const pipelineType = options.pipelineType ?? scaleToType(scale);

  // 2. Initialise pipeline in DB
  const initResult = initPipeline(
    db,
    request,
    scale,
    options.pipelineType ? { type: options.pipelineType } : undefined,
  );
  if (!initResult.ok) {
    return { ok: false, error: initResult.error, steps };
  }
  const pipelineId = initResult.pipeline.id;

  // 3. Run each Claude-facing stage
  const stages = getStagesForType(pipelineType);
  const priorResults = new Map<PipelineStage, string>();

  for (const stage of stages) {
    callbacks?.onStepStart?.(stage);

    try {
      // Advance DB to this stage's pipeline step
      advanceToPipelineStep(db, stage);

      // Build system prompt
      const stageInput = buildStageInput(stage, request, cwd, priorResults);
      const promptResult = getStagePrompt(stage, stageInput);
      if (!promptResult.ok) {
        throw new Error(`Prompt build failed: ${promptResult.error}`);
      }

      // Build governance context for per-step mode enforcement
      const gateCtx = buildGateContext(cwd);

      // Build user message
      const userMessage = buildUserMessage(stage, request);

      // Run stage loop
      const { output, toolCalls } = await runStageLoop(
        userMessage,
        promptResult.prompt,
        { model, maxTokens, maxIterations: maxToolIterations, gateCtx, callbacks },
      );

      const result: StepResult = { stage, output, toolCalls };
      priorResults.set(stage, output);
      steps.push(result);

      callbacks?.onStepComplete?.(stage, result);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      callbacks?.onError?.(err, stage);
      return {
        ok: false,
        error: `Stage "${stage}" failed: ${err.message}`,
        steps,
      };
    }
  }

  // 4. Drain remaining procedural steps to complete pipeline
  drainProceduralSteps(db);

  return { ok: true, steps, pipelineId };
}
