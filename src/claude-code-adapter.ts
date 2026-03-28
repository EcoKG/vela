/**
 * Claude Code CLI streaming adapter.
 *
 * Uses `@anthropic-ai/claude-agent-sdk` query() API to send messages
 * through the locally installed Claude Code CLI. This leverages Claude
 * Code's OAuth session — no API key needed.
 *
 * SDK v0.2.x API:
 *   query({ prompt, options? }) → Query (AsyncGenerator<SDKMessage>)
 *   SDKMessage = SDKAssistantMessage | SDKResultMessage | ...
 *   SDKAssistantMessage.message = BetaMessage (Anthropic API format)
 *   SDKResultMessage.result = final text, .usage = token counts
 */
import type { Message } from '@anthropic-ai/sdk/resources/messages/messages.js';
import type { ChatMessage } from './claude-client.js';
import type { SendMessageOptions } from './claude-client.js';
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
 * hard compile-time dependency.
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let queryFn: (params: { prompt: string; options?: Record<string, unknown> }) => AsyncGenerator<any, void>;

  try {
    // @ts-ignore TS2307: module is optional, resolved at runtime
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    queryFn = sdk.query;
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

  // Build options matching SDK v0.2.x Options type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queryOptions: Record<string, any> = {
    model,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: 1,
  };

  if (system) {
    queryOptions.systemPrompt = system;
  }
  if (claudePath) {
    queryOptions.pathToClaudeCodeExecutable = claudePath;
  }

  // ── Stream and accumulate ─────────────────────────────────
  let accumulatedText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const stream = queryFn({ prompt, options: queryOptions });

    for await (const event of stream) {
      // SDKAssistantMessage: { type: 'assistant', message: BetaMessage }
      if (event.type === 'assistant' && event.message) {
        const betaMsg = event.message;
        if (betaMsg.content && Array.isArray(betaMsg.content)) {
          for (const block of betaMsg.content) {
            if (block.type === 'text' && block.text) {
              // Only emit new text (BetaMessage may repeat content)
              const newText = block.text.slice(accumulatedText.length);
              if (newText) {
                accumulatedText += newText;
                if (onText) onText(newText);
              }
            }
          }
        }
        // Capture usage from assistant message
        if (betaMsg.usage) {
          inputTokens = betaMsg.usage.input_tokens ?? inputTokens;
          outputTokens = betaMsg.usage.output_tokens ?? outputTokens;
        }
      }

      // SDKResultMessage: { type: 'result', subtype: 'success', result: string, usage: ... }
      if (event.type === 'result') {
        if (event.usage) {
          inputTokens = event.usage.input_tokens ?? inputTokens;
          outputTokens = event.usage.output_tokens ?? outputTokens;
        }
        // If we didn't get text from streaming, use result text
        if (!accumulatedText && event.result) {
          accumulatedText = event.result;
          if (onText) onText(accumulatedText);
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`⛵ [Vela] Claude Code CLI query failed: ${msg}\n`);
    throw new Error(`Claude Code CLI query failed: ${msg}`);
  }

  // ── Build Message ─────────────────────────────────────────
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
