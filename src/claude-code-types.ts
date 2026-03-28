/**
 * Lightweight type stubs for @anthropic-ai/claude-agent-sdk message types.
 *
 * These provide type safety for the Claude Code CLI adapter without
 * requiring a hard compile-time dependency on the SDK package.
 * Shapes are based on the SDK's public API as of v0.x.
 */

// ── Conversation types ────────────────────────────────────────

/** A conversation message in claude-agent-sdk format. */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

/** A content block within a conversation message. */
export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
}

// ── Stream event types ────────────────────────────────────────

/** Usage information returned in result events. */
export interface UsageInfo {
  input_tokens: number;
  output_tokens: number;
}

/** Cost information returned in result events. */
export interface CostInfo {
  input_cost: number;
  output_cost: number;
  total_cost: number;
}

/** A text_delta sub-event within a stream_event. */
export interface TextDeltaEvent {
  type: 'content_block_delta';
  delta: {
    type: 'text_delta';
    text: string;
  };
}

/** Result message returned when the stream completes. */
export interface ResultMessage {
  role: 'assistant';
  content: ContentBlock[];
  model: string;
  stop_reason: string | null;
  usage: UsageInfo;
  cost?: CostInfo;
}

/**
 * Union type for message stream events from claude-agent-sdk query().
 *
 * - `result`: Final message with usage/cost, emitted once at stream end.
 * - `stream_event`: Incremental SSE events (content_block_delta, etc.)
 *   forwarded from the underlying Anthropic API stream.
 */
export type MessageEvent =
  | { type: 'result'; result: ResultMessage }
  | { type: 'stream_event'; event: TextDeltaEvent };

// ── Query options ─────────────────────────────────────────────

/**
 * Options passed to claude-agent-sdk's query() function.
 * Only the fields Vela uses are stubbed here.
 */
export interface QueryOptions {
  /** Model to use (e.g. 'claude-sonnet-4-20250514'). */
  model?: string;
  /** System prompt. */
  systemPrompt?: string;
  /** Permission mode for tool execution. */
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions';
  /** Path to the claude CLI executable. */
  pathToClaudeCodeExecutable?: string;
  /** AbortController for cancellation. */
  abortController?: AbortController;
  /** Maximum tokens for the response (maps to max_turns or similar). */
  maxTurns?: number;
}
