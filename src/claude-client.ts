/**
 * Claude client shim module for Vela CLI.
 *
 * Backward-compatible façade that delegates to `./llm.ts` for actual
 * LLM communication. Preserves the same exports so consumers
 * (tool-engine, pipeline-orchestrator, context-manager, ChatApp, cli)
 * continue to work without changes.
 *
 * The `client` argument in `sendMessage()` is accepted but ignored —
 * all communication now goes through the Claude Code CLI SDK via llm.ts.
 */
import type {
  Message,
  ToolUseBlock,
  ToolUnion,
  ContentBlock,
  ContentBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages.js';

import {
  sendMessage as llmSendMessage,
} from './llm.js';
import type {
  SendMessageOptions as LlmSendMessageOptions,
} from './llm.js';

// ── Public types (backward-compatible) ─────────────────────────

/**
 * A conversation message passed to `sendMessage`.
 * Re-exported for backward compatibility — canonical source is llm.ts.
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[] | ContentBlockParam[];
}

/**
 * Options for `sendMessage`.
 *
 * Extends the llm.ts options with fields that legacy consumers still pass
 * (maxTokens, tools). These are accepted for signature compatibility but
 * are not forwarded to the CLI SDK — the SDK manages its own token limits
 * and tool definitions.
 */
export interface SendMessageOptions {
  /** Model to use (defaults to claude-sonnet-4-20250514). */
  model?: string;
  /** Maximum tokens in the response (accepted but not forwarded to CLI SDK). */
  maxTokens?: number;
  /** System prompt. */
  system?: string;
  /** Maximum agentic turns (defaults to 1). */
  maxTurns?: number;
  /** Streaming callback — invoked for each text chunk as it arrives. */
  onText?: (text: string) => void;
}

// ── Streaming send (shim) ──────────────────────────────────────

/**
 * Backward-compatible `sendMessage` that accepts a `client` arg
 * for signature compatibility but delegates entirely to `llm.ts`.
 *
 * @param _client  Ignored — kept for backward compat
 * @param messages Conversation messages
 * @param options  Model, system, onText callback, etc.
 */
export async function sendMessage(
  _client: unknown,
  messages: ChatMessage[],
  options: SendMessageOptions = {},
): Promise<Message> {
  // Extract only the fields that llm.ts understands
  const llmOptions: LlmSendMessageOptions = {
    model: options.model,
    system: options.system,
    maxTurns: options.maxTurns,
    onText: options.onText,
  };
  return llmSendMessage(messages, llmOptions);
}

// ── Tool use helpers (unchanged) ───────────────────────────────

/**
 * Extracts ToolUseBlock entries from a Message's content.
 * Returns an empty array if no tool_use blocks are present.
 */
export function extractToolUseBlocks(message: Message): ToolUseBlock[] {
  return message.content.filter(
    (block): block is ToolUseBlock => block.type === 'tool_use',
  );
}

/**
 * Returns true if the message indicates the model wants to use tools.
 */
export function isToolUseResponse(message: Message): boolean {
  return message.stop_reason === 'tool_use';
}
