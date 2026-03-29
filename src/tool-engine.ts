/**
 * Tool definitions and executors for Vela's Claude tool_use integration.
 *
 * Provides 4 tools (Read, Write, Edit, Bash) as JSON Schema definitions
 * compatible with the Anthropic SDK's Tool type, plus executor functions
 * that perform real filesystem and shell operations.
 */
import type {
  Tool,
  Message,
  ToolResultBlockParam,
  ToolUseBlock,
  ContentBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync, spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import {
  sendMessage,
  extractToolUseBlocks,
  isToolUseResponse,
} from './claude-client.js';
import type { ChatMessage, SendMessageOptions } from './claude-client.js';
import { checkGate } from './governance/index.js';
import type { GateContext } from './governance/index.js';
import { trackToolUse, classifyBashResult, trackBuildTestSignal } from './governance/index.js';
import type { RetryBudget } from './governance/index.js';

// ── Tool context type ─────────────────────────────────────────

/**
 * Extended context for tool execution. Combines gate governance
 * with retry budget and tracker instrumentation.
 */
export interface ToolContext {
  gate?: GateContext;
  retryBudget?: RetryBudget;
  artifactDir?: string;
  velaDir?: string;
}

// ── Constants ─────────────────────────────────────────────────

/** Maximum output size in bytes before truncation. */
const MAX_OUTPUT_BYTES = 50 * 1024; // 50KB

/** Default timeout for Bash commands in milliseconds. */
const DEFAULT_BASH_TIMEOUT_MS = 30_000;

// ── Tool definitions ──────────────────────────────────────────

export const TOOL_DEFINITIONS: Tool[] = [
  {
    name: 'Read',
    description:
      'Read the contents of a file. Returns the file content as a string. ' +
      'Supports optional line-based offset and limit for reading portions of large files.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to read (relative or absolute).',
        },
        offset: {
          type: 'number',
          description: 'Line number to start reading from (1-indexed). Defaults to 1.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to read. Defaults to all lines.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'Write',
    description:
      'Write content to a file. Creates the file if it does not exist. ' +
      'Overwrites existing content. Automatically creates parent directories.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to write.',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file.',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'Edit',
    description:
      'Edit a file by replacing an exact text match. The old_text must match exactly ' +
      '(including whitespace). Returns an error if the file does not exist or if ' +
      'old_text is not found in the file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to edit.',
        },
        old_text: {
          type: 'string',
          description: 'Exact text to find and replace.',
        },
        new_text: {
          type: 'string',
          description: 'Text to replace old_text with.',
        },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'Bash',
    description:
      'Execute a bash command and return stdout, stderr, and exit code. ' +
      'Output is truncated at 50KB. Default timeout is 30 seconds.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description: 'Bash command to execute.',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds. Defaults to 30.',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'AsyncBash',
    description:
      'Execute a bash command in the background. Returns a job ID immediately. ' +
      'Use BashJobStatus to check progress and BashJobKill to terminate.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description: 'Bash command to execute in the background.',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds. The job is killed after this. Defaults to 300 (5 minutes).',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'BashJobStatus',
    description:
      'Check the status and output of a background job started with AsyncBash.',
    input_schema: {
      type: 'object' as const,
      properties: {
        jobId: {
          type: 'string',
          description: 'Job ID returned by AsyncBash.',
        },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'BashJobKill',
    description:
      'Terminate a background job started with AsyncBash.',
    input_schema: {
      type: 'object' as const,
      properties: {
        jobId: {
          type: 'string',
          description: 'Job ID returned by AsyncBash.',
        },
      },
      required: ['jobId'],
    },
  },
];

// ── Executor result type ──────────────────────────────────────

export interface ToolResult {
  result: string;
  is_error: boolean;
}

// ── Read executor ─────────────────────────────────────────────

export async function executeRead(input: {
  path: string;
  offset?: number;
  limit?: number;
}): Promise<string> {
  try {
    const content = await fs.readFile(input.path, 'utf-8');
    const lines = content.split('\n');

    const offset = input.offset ?? 1;
    const startIndex = Math.max(0, offset - 1); // 1-indexed → 0-indexed

    if (input.limit !== undefined) {
      const sliced = lines.slice(startIndex, startIndex + input.limit);
      return sliced.join('\n');
    }

    const sliced = lines.slice(startIndex);
    return sliced.join('\n');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(`File not found: ${input.path}`);
    }
    throw err;
  }
}

// ── Write executor ────────────────────────────────────────────

export async function executeWrite(input: {
  path: string;
  content: string;
}): Promise<string> {
  const dir = path.dirname(input.path);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(input.path, input.content, 'utf-8');
  return `Successfully wrote ${Buffer.byteLength(input.content, 'utf-8')} bytes to ${input.path}`;
}

// ── Edit executor ─────────────────────────────────────────────

export async function executeEdit(input: {
  path: string;
  old_text: string;
  new_text: string;
}): Promise<string> {
  let content: string;
  try {
    content = await fs.readFile(input.path, 'utf-8');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(`File not found: ${input.path}`);
    }
    throw err;
  }

  if (!content.includes(input.old_text)) {
    throw new Error(
      `old_text not found in ${input.path}. Ensure the text matches exactly, including whitespace.`,
    );
  }

  const updated = content.replace(input.old_text, input.new_text);
  await fs.writeFile(input.path, updated, 'utf-8');
  return `Successfully edited ${input.path}`;
}

// ── Bash executor ─────────────────────────────────────────────

/**
 * Truncates a string to fit within MAX_OUTPUT_BYTES, appending a
 * truncation notice if needed.
 */
function truncateOutput(text: string): string {
  const bytes = Buffer.byteLength(text, 'utf-8');
  if (bytes <= MAX_OUTPUT_BYTES) return text;

  // Cut to fit under the limit. We approximate by slicing chars
  // and re-checking byte length. For mostly ASCII this is close.
  let truncated = text;
  while (Buffer.byteLength(truncated, 'utf-8') > MAX_OUTPUT_BYTES) {
    truncated = truncated.slice(0, Math.floor(truncated.length * 0.9));
  }

  const notice = `\n\n[Output truncated: original ${bytes} bytes exceeded ${MAX_OUTPUT_BYTES} byte limit]`;
  return truncated + notice;
}

export function executeBash(input: {
  command: string;
  timeout?: number;
}): string {
  const timeoutMs = input.timeout
    ? input.timeout * 1000
    : DEFAULT_BASH_TIMEOUT_MS;

  try {
    const stdout = execSync(input.command, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: '/bin/bash',
    });

    return truncateOutput(stdout);
  } catch (err: unknown) {
    // execSync throws on non-zero exit or timeout
    const execErr = err as {
      status?: number | null;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      signal?: string;
      message?: string;
    };

    // Timeout case: killed by signal
    if (execErr.killed || execErr.signal === 'SIGTERM') {
      return `Command timed out after ${timeoutMs / 1000}s: ${input.command}`;
    }

    // Non-zero exit: return combined output with exit code
    const stdout = truncateOutput(execErr.stdout ?? '');
    const stderr = truncateOutput(execErr.stderr ?? '');
    const exitCode = execErr.status ?? 1;

    let result = '';
    if (stdout) result += stdout;
    if (stderr) result += (result ? '\n' : '') + stderr;
    result += `\n\nExit code: ${exitCode}`;

    return result;
  }
}

// ── AsyncBash job management ──────────────────────────────────

/** Default timeout for async bash jobs in milliseconds. */
const DEFAULT_ASYNC_BASH_TIMEOUT_MS = 300_000; // 5 minutes

export interface BashJob {
  id: string;
  command: string;
  status: 'running' | 'completed' | 'failed' | 'killed' | 'timeout';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: number;
  completedAt: number | null;
  process: ChildProcess | null;
}

/** In-memory registry of background jobs. */
const asyncJobs = new Map<string, BashJob>();

/** Counter for generating unique job IDs. */
let jobIdCounter = 0;

/**
 * Expose the job map for testing. Production code uses executeAsyncBash /
 * executeBashJobStatus / executeBashJobKill instead.
 */
export function _getJobsForTesting(): Map<string, BashJob> {
  return asyncJobs;
}

/**
 * Start a background bash command. Returns immediately with a job ID.
 * The process runs asynchronously; use BashJobStatus to poll for results.
 */
export function executeAsyncBash(input: {
  command: string;
  timeout?: number;
}): string {
  const timeoutMs = input.timeout
    ? input.timeout * 1000
    : DEFAULT_ASYNC_BASH_TIMEOUT_MS;

  const jobId = `job_${++jobIdCounter}_${Date.now().toString(36)}`;

  const child = spawn('/bin/bash', ['-c', input.command], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  });

  const job: BashJob = {
    id: jobId,
    command: input.command,
    status: 'running',
    exitCode: null,
    stdout: '',
    stderr: '',
    startedAt: Date.now(),
    completedAt: null,
    process: child,
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    job.stdout += chunk.toString('utf-8');
    // Truncate in-memory buffer to prevent unbounded growth
    if (Buffer.byteLength(job.stdout, 'utf-8') > MAX_OUTPUT_BYTES * 2) {
      job.stdout = job.stdout.slice(-MAX_OUTPUT_BYTES);
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    job.stderr += chunk.toString('utf-8');
    if (Buffer.byteLength(job.stderr, 'utf-8') > MAX_OUTPUT_BYTES * 2) {
      job.stderr = job.stderr.slice(-MAX_OUTPUT_BYTES);
    }
  });

  child.on('close', (code) => {
    if (job.status === 'running') {
      job.status = code === 0 ? 'completed' : 'failed';
      job.exitCode = code;
      job.completedAt = Date.now();
      job.process = null;
    }
  });

  child.on('error', (err) => {
    if (job.status === 'running') {
      job.status = 'failed';
      job.stderr += `\nProcess error: ${err.message}`;
      job.completedAt = Date.now();
      job.process = null;
    }
  });

  // Timeout enforcement
  const timer = setTimeout(() => {
    if (job.status === 'running' && job.process) {
      job.process.kill('SIGTERM');
      job.status = 'timeout';
      job.completedAt = Date.now();
      job.stderr += `\nKilled: exceeded ${timeoutMs / 1000}s timeout`;
      job.process = null;
    }
  }, timeoutMs);

  // Don't let the timer keep the process alive
  timer.unref();

  asyncJobs.set(jobId, job);

  return JSON.stringify({ jobId, status: 'started' });
}

/**
 * Get the current status and output of a background job.
 */
export function executeBashJobStatus(input: { jobId: string }): string {
  const job = asyncJobs.get(input.jobId);
  if (!job) {
    throw new Error(`Unknown job ID: ${input.jobId}`);
  }

  return JSON.stringify({
    jobId: job.id,
    command: job.command,
    status: job.status,
    exitCode: job.exitCode,
    stdout: truncateOutput(job.stdout),
    stderr: truncateOutput(job.stderr),
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    durationMs: job.completedAt
      ? job.completedAt - job.startedAt
      : Date.now() - job.startedAt,
  });
}

/**
 * Kill a running background job.
 */
export function executeBashJobKill(input: { jobId: string }): string {
  const job = asyncJobs.get(input.jobId);
  if (!job) {
    throw new Error(`Unknown job ID: ${input.jobId}`);
  }

  if (job.status !== 'running') {
    return JSON.stringify({
      jobId: job.id,
      status: job.status,
      message: `Job already ${job.status}`,
    });
  }

  if (job.process) {
    job.process.kill('SIGTERM');
  }
  job.status = 'killed';
  job.completedAt = Date.now();
  job.process = null;

  return JSON.stringify({
    jobId: job.id,
    status: 'killed',
    message: 'Job terminated',
  });
}

// ── Dispatcher ────────────────────────────────────────────────

/**
 * Normalise the third argument into a ToolContext.
 * Accepts either the new ToolContext or a bare GateContext for backward compatibility.
 */
function normaliseContext(ctx?: ToolContext | GateContext): ToolContext | undefined {
  if (!ctx) return undefined;
  // If it has a 'gate' key it's already ToolContext
  if ('gate' in ctx) return ctx as ToolContext;
  // Otherwise treat it as a bare GateContext (backward compat)
  return { gate: ctx as GateContext };
}

/**
 * Routes a tool call to the correct executor.
 * Returns `{ result, is_error }` for all cases including unknown tool names.
 *
 * Accepts either a ToolContext (new) or bare GateContext (backward compat)
 * as the optional third parameter.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  context?: ToolContext | GateContext,
): Promise<ToolResult> {
  const ctx = normaliseContext(context);
  const gateCtx = ctx?.gate;

  // Gate check: if governance context is provided, evaluate gates first
  // AsyncBash uses the same gate rules as Bash
  if (gateCtx) {
    const gateName = name === 'AsyncBash' ? 'Bash' : name;
    const gate = checkGate(gateName, input, gateCtx);
    if (!gate.allowed) {
      // Record block on retry budget
      try { ctx?.retryBudget?.recordBlock(gate.code); } catch { /* fail-open */ }
      return {
        result: `⛵ [Vela] ✦ BLOCKED [${gate.code}] ${gate.message}`,
        is_error: true,
      };
    }
  }

  try {
    let toolResult: ToolResult;

    switch (name) {
      case 'Read': {
        const result = await executeRead(
          input as { path: string; offset?: number; limit?: number },
        );
        toolResult = { result, is_error: false };
        break;
      }
      case 'Write': {
        const result = await executeWrite(
          input as { path: string; content: string },
        );
        toolResult = { result, is_error: false };
        break;
      }
      case 'Edit': {
        const result = await executeEdit(
          input as { path: string; old_text: string; new_text: string },
        );
        toolResult = { result, is_error: false };
        break;
      }
      case 'Bash': {
        const result = executeBash(
          input as { command: string; timeout?: number },
        );
        toolResult = { result, is_error: false };
        break;
      }
      case 'AsyncBash': {
        const result = executeAsyncBash(
          input as { command: string; timeout?: number },
        );
        toolResult = { result, is_error: false };
        break;
      }
      case 'BashJobStatus': {
        const result = executeBashJobStatus(
          input as { jobId: string },
        );
        toolResult = { result, is_error: false };
        break;
      }
      case 'BashJobKill': {
        const result = executeBashJobKill(
          input as { jobId: string },
        );
        toolResult = { result, is_error: false };
        break;
      }
      default:
        toolResult = {
          result: `Unknown tool: ${name}. Available tools: Read, Write, Edit, Bash, AsyncBash, BashJobStatus, BashJobKill`,
          is_error: true,
        };
    }

    // Record success on retry budget (only for non-error results)
    if (!toolResult.is_error) {
      try { ctx?.retryBudget?.recordSuccess(); } catch { /* fail-open */ }
    }

    // Track tool use to trace.jsonl
    const artifactDir = ctx?.artifactDir ?? gateCtx?.artifactDir;
    if (artifactDir) {
      try {
        trackToolUse(artifactDir, {
          tool: name,
          step: gateCtx?.currentStep ?? null,
        });
      } catch { /* fail-open */ }
    }

    // Classify and track Bash build/test signals
    if (name === 'Bash' && !toolResult.is_error) {
      const bashInput = input as { command: string };
      const signal = classifyBashResult(bashInput.command, toolResult.result);
      if (signal) {
        const aDir = artifactDir;
        const vDir = ctx?.velaDir ?? gateCtx?.velaDir;
        if (aDir && vDir) {
          try {
            trackBuildTestSignal(aDir, vDir, {
              signalType: signal.signalType,
              result: signal.result,
              command: bashInput.command,
              step: gateCtx?.currentStep ?? null,
            });
          } catch { /* fail-open */ }
        }
      }
    }

    return toolResult;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { result: msg, is_error: true };
  }
}

// ── Parallel tool execution ───────────────────────────────────

/** Tools that mutate files — conflicting when targeting the same path. */
const FILE_MUTATING_TOOLS = new Set(['Write', 'Edit']);

/**
 * Extract the target file path from a tool's input, if applicable.
 */
function getTargetFile(name: string, input: Record<string, unknown>): string | null {
  if (FILE_MUTATING_TOOLS.has(name)) {
    return (input.path as string) || null;
  }
  return null;
}

/**
 * Execute tool_use blocks with safe parallelism:
 * - Tools targeting the same file via Write/Edit run sequentially
 * - All other tools run in parallel via Promise.all
 *
 * Returns ToolResultBlockParam[] in the same order as the input blocks,
 * preserving the Anthropic API's expected correspondence.
 */
export async function executeToolsParallel(
  blocks: ToolUseBlock[],
  toolCtx?: ToolContext,
): Promise<ToolResultBlockParam[]> {
  if (blocks.length <= 1) {
    // Single block — no parallelism needed
    if (blocks.length === 0) return [];
    const block = blocks[0];
    const { result, is_error } = await executeTool(
      block.name,
      block.input as Record<string, unknown>,
      toolCtx,
    );
    return [{
      type: 'tool_result',
      tool_use_id: block.id,
      content: result,
      ...(is_error ? { is_error: true } : {}),
    }];
  }

  // Group blocks by target file. Blocks with the same target file
  // (and the file is being mutated) must run sequentially.
  // Non-file-mutating blocks get null → run in parallel with everything.
  const results: ToolResultBlockParam[] = new Array(blocks.length);

  // Identify file-conflict groups
  const fileGroups = new Map<string, number[]>(); // filePath → block indices
  const parallelIndices: number[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const target = getTargetFile(blocks[i].name, blocks[i].input as Record<string, unknown>);
    if (target) {
      const group = fileGroups.get(target);
      if (group) {
        group.push(i);
      } else {
        fileGroups.set(target, [i]);
      }
    } else {
      parallelIndices.push(i);
    }
  }

  // Execute a single block and store its result at the correct index
  async function execOne(idx: number): Promise<void> {
    const block = blocks[idx];
    const { result, is_error } = await executeTool(
      block.name,
      block.input as Record<string, unknown>,
      toolCtx,
    );
    results[idx] = {
      type: 'tool_result',
      tool_use_id: block.id,
      content: result,
      ...(is_error ? { is_error: true } : {}),
    };
  }

  // Build promises: parallel blocks run concurrently,
  // file-conflict groups run their members sequentially but different
  // groups run concurrently with each other.
  const promises: Promise<void>[] = [];

  // Parallel (non-conflicting) blocks
  for (const idx of parallelIndices) {
    promises.push(execOne(idx));
  }

  // Sequential groups: each group is a serial chain
  for (const indices of fileGroups.values()) {
    if (indices.length === 1) {
      // Single block targeting this file — can run in parallel
      promises.push(execOne(indices[0]));
    } else {
      // Multiple blocks targeting same file — chain them
      promises.push(
        (async () => {
          for (const idx of indices) {
            await execOne(idx);
          }
        })(),
      );
    }
  }

  await Promise.all(promises);

  return results;
}

// ── Tool loop orchestrator ────────────────────────────────────

/** Default maximum send→execute→append iterations. */
const DEFAULT_MAX_ITERATIONS = 10;

/**
 * Orchestrates a multi-turn tool_use conversation with Claude.
 *
 * Sends the initial messages to the LLM.
 * When the model responds with `stop_reason: 'tool_use'`, extracts
 * the tool_use blocks, executes each tool sequentially, appends
 * results as a user message, and sends the next turn.
 *
 * Stops when `stop_reason !== 'tool_use'` or `maxIterations` is reached.
 *
 * @returns The final Message from Claude (typically stop_reason: 'end_turn').
 */
export async function runToolLoop(
  messages: ChatMessage[],
  options: SendMessageOptions & { maxIterations?: number; context?: GateContext; retryBudget?: RetryBudget } = {},
): Promise<Message> {
  const { maxIterations = DEFAULT_MAX_ITERATIONS, context, retryBudget, ...sendOpts } = options;

  // Ensure tool definitions are included
  const loopOpts: SendMessageOptions = {
    ...sendOpts,
  };

  // Build ToolContext from options
  const toolCtx: ToolContext | undefined = (context || retryBudget)
    ? {
        gate: context,
        retryBudget,
        artifactDir: context?.artifactDir,
        velaDir: context?.velaDir,
      }
    : undefined;

  // Work on a mutable copy so we don't mutate the caller's array
  const conversation: ChatMessage[] = [...messages];

  let response = await sendMessage(null, conversation, loopOpts);
  let iterations = 0;

  while (isToolUseResponse(response) && iterations < maxIterations) {
    // Check retry budget before executing
    if (retryBudget) {
      const check = retryBudget.shouldTerminate();
      if (check.terminate) {
        // Append a final assistant-like message about budget exhaustion
        conversation.push({
          role: 'assistant',
          content: `⛵ [Vela] Retry budget exhausted — ${check.gateCode} blocked ${check.count} consecutive times. Stopping tool loop.`,
        });
        break;
      }
    }

    iterations++;

    const toolUseBlocks = extractToolUseBlocks(response);

    // Append the assistant's response to the conversation
    conversation.push({
      role: 'assistant',
      content: response.content as ContentBlockParam[],
    });

    // Execute tools — parallel where safe, sequential for file conflicts
    const toolResults = await executeToolsParallel(toolUseBlocks, toolCtx);

    // Append the tool results as a user message
    conversation.push({
      role: 'user',
      content: toolResults as ContentBlockParam[],
    });

    // Send the next turn
    response = await sendMessage(null, conversation, loopOpts);
  }

  return response;
}
