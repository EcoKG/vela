/**
 * Lightweight type stubs for @anthropic-ai/claude-agent-sdk.
 *
 * These match the SDK v0.2.x API surface used by Vela's adapter.
 * Only the types Vela actually touches are stubbed here.
 */

// ── SDK Message types ─────────────────────────────────────────

/** Usage info embedded in BetaMessage and SDKResultMessage */
export interface UsageInfo {
  input_tokens: number;
  output_tokens: number;
}

/** A content block in a BetaMessage */
export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

/** The Anthropic BetaMessage embedded in SDKAssistantMessage */
export interface BetaMessage {
  role: 'assistant';
  content: ContentBlock[];
  model: string;
  stop_reason: string | null;
  usage: UsageInfo;
}

/** SDKAssistantMessage — emitted during streaming */
export interface SDKAssistantMessage {
  type: 'assistant';
  message: BetaMessage;
  parent_tool_use_id: string | null;
  uuid: string;
  session_id: string;
}

/** SDKResultSuccess — emitted once at stream end */
export interface SDKResultSuccess {
  type: 'result';
  subtype: 'success';
  result: string;
  usage: UsageInfo;
  total_cost_usd: number;
  num_turns: number;
  duration_ms: number;
  session_id: string;
}

/** SDKResultError — emitted on failure */
export interface SDKResultError {
  type: 'result';
  subtype: 'error';
  error: string;
  session_id: string;
}

/** Union of result types */
export type SDKResultMessage = SDKResultSuccess | SDKResultError;

/** Union of all message types Vela cares about */
export type SDKMessage = SDKAssistantMessage | SDKResultMessage | {
  type: string;
  [key: string]: unknown;
};

// ── Query API ─────────────────────────────────────────────────

/** Options passed to query() — subset Vela uses */
export interface QueryOptions {
  model?: string;
  systemPrompt?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk';
  allowDangerouslySkipPermissions?: boolean;
  pathToClaudeCodeExecutable?: string;
  abortController?: AbortController;
  maxTurns?: number;
  maxBudgetUsd?: number;
}

/** The query() function signature */
export type QueryFunction = (params: {
  prompt: string;
  options?: QueryOptions;
}) => AsyncGenerator<SDKMessage, void>;
