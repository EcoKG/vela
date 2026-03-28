/**
 * Claude Code CLI streaming adapter.
 *
 * Bridges `@anthropic-ai/claude-agent-sdk`'s `query()` to Vela's
 * `sendMessage()` contract. Produces the same Anthropic `Message`
 * return type, streams text deltas via `onText`, and strips
 * tool-use blocks from the response.
 */
import type { Message } from '@anthropic-ai/sdk/resources/messages/messages.js';
import type { ChatMessage, SendMessageOptions } from './claude-client.js';
import type {
  MessageEvent,
  QueryOptions,
  ContentBlock,
} from './claude-code-types.js';
import { getClaudePath } from './claude-code-readiness.js';
import { DEFAULT_MODEL } from './models.js';

// ── Helpers ───────────────────────────────────────────────────

/**
 * Extracts the text prompt from the last user message.
 * The SDK manages its own history, so we only send the latest user turn.
 */
function extractLastUserPrompt(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;

    if (typeof msg.content === 'string') {
      return msg.content;
    }

    // ContentBlock[] or ContentBlockParam[] — extract text blocks
    const textParts: string[] = [];
    for (const block of msg.content) {
      if ('type' in block && block.type === 'text' && 'text' in block) {
        textParts.push((block as { text: string }).text);
      }
    }
    return textParts.join('\n');
  }

  return '';
}

// ── Public API ────────────────────────────────────────────────

/**
 * Sends a message to Claude via the Claude Code CLI SDK.
 *
 * Dynamically imports `@anthropic-ai/claude-agent-sdk` to avoid a
 * hard compile-time dependency. If the SDK is not installed, throws
 * a descriptive error.
 *
 * @param messages  Conversation history (only last user message is sent)
 * @param options   Standard Vela send options (model, system, onText, etc.)
 * @returns         Anthropic SDK `Message`-compatible object
 */
export async function sendMessageViaCli(
  messages: ChatMessage[],
  options: SendMessageOptions = {},
): Promise<Message> {
  const {
    model = DEFAULT_MODEL,
    system,
    onText,
  } = options;

  // ── Dynamic import ────────────────────────────────────────
  let query: (
    prompt: string,
    options?: QueryOptions,
  ) => AsyncIterable<MessageEvent>;

  try {
    // Dynamic import — the package is optional and may not be installed.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore TS2307: module is optional, resolved at runtime
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    query = sdk.query;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `⛵ [Vela] Claude Code CLI SDK not available: ${msg}\n`,
    );
    throw new Error(
      'Claude Code CLI SDK not installed. Run: npm install @anthropic-ai/claude-agent-sdk',
    );
  }

  // ── Prepare query ─────────────────────────────────────────
  const prompt = extractLastUserPrompt(messages);
  const claudePath = getClaudePath();

  const queryOptions: QueryOptions = {
    model,
    permissionMode: 'bypassPermissions',
    ...(system ? { systemPrompt: system } : {}),
    ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
  };

  // ── Stream and accumulate ─────────────────────────────────
  let accumulatedText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const stream = query(prompt, queryOptions);

    for await (const event of stream) {
      if (
        event.type === 'stream_event' &&
        event.event.type === 'content_block_delta' &&
        event.event.delta.type === 'text_delta'
      ) {
        const text = event.event.delta.text;
        accumulatedText += text;
        if (onText) {
          onText(text);
        }
      } else if (event.type === 'result') {
        // Capture usage from result message
        if (event.result.usage) {
          inputTokens = event.result.usage.input_tokens;
          outputTokens = event.result.usage.output_tokens;
        }
        // Extract text from result content blocks (strip tool-use)
        if (event.result.content && !accumulatedText) {
          accumulatedText = event.result.content
            .filter((b: ContentBlock) => b.type === 'text')
            .map((b: ContentBlock) => b.text ?? '')
            .join('');
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`⛵ [Vela] Claude Code CLI query failed: ${msg}\n`);
    throw new Error(`Claude Code CLI query failed: ${msg}`);
  }

  // ── Build Message ─────────────────────────────────────────
  // Only include text content — tool-use blocks are stripped
  const content: Array<{ type: 'text'; text: string; citations: null }> = [];
  if (accumulatedText) {
    content.push({ type: 'text', text: accumulatedText, citations: null });
  }

  const message: Message = {
    id: `cli-${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: 'end_turn',
    stop_sequence: null,
    container: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation: null,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      inference_geo: null,
      server_tool_use: null,
      service_tier: null,
    },
  };

  return message;
}
