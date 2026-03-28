/**
 * Tool definitions and executors for Vela's Claude tool_use integration.
 *
 * Provides 4 tools (Read, Write, Edit, Bash) as JSON Schema definitions
 * compatible with the Anthropic SDK's Tool type, plus executor functions
 * that perform real filesystem and shell operations.
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  Tool,
  Message,
  ToolResultBlockParam,
  ContentBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';
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
  if (gateCtx) {
    const gate = checkGate(name, input, gateCtx);
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
      default:
        toolResult = {
          result: `Unknown tool: ${name}. Available tools: Read, Write, Edit, Bash`,
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

// ── Tool loop orchestrator ────────────────────────────────────

/** Default maximum send→execute→append iterations. */
const DEFAULT_MAX_ITERATIONS = 10;

/**
 * Orchestrates a multi-turn tool_use conversation with Claude.
 *
 * Sends the initial messages with TOOL_DEFINITIONS attached.
 * When the model responds with `stop_reason: 'tool_use'`, extracts
 * the tool_use blocks, executes each tool sequentially, appends
 * results as a user message, and sends the next turn.
 *
 * Stops when `stop_reason !== 'tool_use'` or `maxIterations` is reached.
 *
 * @returns The final Message from Claude (typically stop_reason: 'end_turn').
 */
export async function runToolLoop(
  client: Anthropic,
  messages: ChatMessage[],
  options: SendMessageOptions & { maxIterations?: number; context?: GateContext; retryBudget?: RetryBudget } = {},
): Promise<Message> {
  const { maxIterations = DEFAULT_MAX_ITERATIONS, context, retryBudget, ...sendOpts } = options;

  // Ensure tool definitions are included
  const loopOpts: SendMessageOptions = {
    ...sendOpts,
    tools: TOOL_DEFINITIONS,
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

  let response = await sendMessage(client, conversation, loopOpts);
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

    // Execute each tool sequentially and build result entries
    const toolResults: ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const { result, is_error } = await executeTool(
        block.name,
        block.input as Record<string, unknown>,
        toolCtx,
      );
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result,
        ...(is_error ? { is_error: true } : {}),
      });
    }

    // Append the tool results as a user message
    conversation.push({
      role: 'user',
      content: toolResults as ContentBlockParam[],
    });

    // Send the next turn
    response = await sendMessage(client, conversation, loopOpts);
  }

  return response;
}
