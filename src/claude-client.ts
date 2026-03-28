/**
 * Claude streaming client module for Vela CLI.
 *
 * Wraps the Anthropic SDK with streaming support and a tool_use loop skeleton.
 * Provides `createClaudeClient()` for instantiation and `sendMessage()` for
 * streaming conversations. When the model invokes tools (stop_reason: 'tool_use'),
 * the response is returned with ToolUseBlock content so the caller can execute
 * tools and continue the conversation loop.
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  Message,
  MessageParam,
  ContentBlock,
  ContentBlockParam,
  RawMessageStreamEvent,
  ToolUseBlock,
  ToolUnion,
  TextDelta,
  InputJSONDelta,
} from '@anthropic-ai/sdk/resources/messages/messages.js';
import { DEFAULT_MODEL } from './models.js';

// ── Public types ──────────────────────────────────────────────

/** A conversation message passed to `sendMessage`. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[] | ContentBlockParam[];
}

/** Options for `sendMessage`. */
export interface SendMessageOptions {
  /** Model to use (defaults to claude-sonnet-4-20250514). */
  model?: string;
  /** Maximum tokens in the response. */
  maxTokens?: number;
  /** System prompt. */
  system?: string;
  /** Tool definitions forwarded to the API when provided. */
  tools?: ToolUnion[];
  /** Streaming callback — invoked for each text chunk as it arrives. */
  onText?: (text: string) => void;
}

// ── Constants ─────────────────────────────────────────────────

const DEFAULT_MAX_TOKENS = 4096;

// ── Client factory ────────────────────────────────────────────

/**
 * Creates and returns an Anthropic SDK client instance.
 */
export function createClaudeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

// ── Streaming send ────────────────────────────────────────────

/**
 * Sends a conversation to Claude with streaming support.
 *
 * Iterates SSE events from the streaming response:
 * - `content_block_delta` with `text_delta` → invokes `options.onText`
 *
 * After the stream completes, returns the full `Message` object. If
 * `stop_reason === 'tool_use'`, the message's `content` array will
 * contain `ToolUseBlock` entries that the caller can execute before
 * continuing the conversation loop.
 *
 * @throws Re-throws Anthropic API errors after logging to stderr.
 */
export async function sendMessage(
  client: Anthropic,
  messages: ChatMessage[],
  options: SendMessageOptions = {},
): Promise<Message> {
  const {
    model = DEFAULT_MODEL,
    maxTokens = DEFAULT_MAX_TOKENS,
    system,
    tools,
    onText,
  } = options;

  try {
    const stream = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: messages as MessageParam[],
      stream: true,
      ...(system ? { system } : {}),
      ...(tools && tools.length > 0 ? { tools } : {}),
    });

    // Accumulate the final message from stream events
    let finalMessage: Message | undefined;
    const contentBlocks: ContentBlock[] = [];
    let currentBlockIndex = -1;
    // Accumulate input_json_delta partial JSON per block index
    const inputJsonAccumulator = new Map<number, string>();

    for await (const event of stream as AsyncIterable<RawMessageStreamEvent>) {
      switch (event.type) {
        case 'message_start':
          finalMessage = event.message;
          break;

        case 'content_block_start':
          currentBlockIndex = event.index;
          contentBlocks[currentBlockIndex] = event.content_block;
          break;

        case 'content_block_delta':
          if (
            event.delta.type === 'text_delta' &&
            onText
          ) {
            onText((event.delta as TextDelta).text);
          }
          // Accumulate text into the content block
          if (event.delta.type === 'text_delta') {
            const block = contentBlocks[event.index];
            if (block && block.type === 'text') {
              (block as { text: string }).text += (event.delta as TextDelta).text;
            }
          }
          // Accumulate input_json_delta partial JSON for tool_use blocks
          if (event.delta.type === 'input_json_delta') {
            const partialJson = (event.delta as InputJSONDelta).partial_json;
            const prev = inputJsonAccumulator.get(event.index) ?? '';
            inputJsonAccumulator.set(event.index, prev + partialJson);
          }
          break;

        case 'content_block_stop': {
          // If we accumulated JSON for this block, parse and assign to tool_use input
          const accumulatedJson = inputJsonAccumulator.get(event.index);
          if (accumulatedJson !== undefined) {
            const block = contentBlocks[event.index];
            if (block && block.type === 'tool_use') {
              try {
                (block as ToolUseBlock).input = JSON.parse(accumulatedJson);
              } catch {
                // If partial JSON is malformed, keep the raw string as input
                (block as ToolUseBlock).input = accumulatedJson;
              }
              inputJsonAccumulator.delete(event.index);
            }
          }
          break;
        }

        case 'message_delta':
          if (finalMessage) {
            finalMessage.stop_reason = event.delta.stop_reason;
            // Capture cumulative usage from message_delta (output_tokens is always present;
            // input_tokens is nullable but useful when provided)
            if (event.usage) {
              finalMessage.usage = {
                ...finalMessage.usage,
                output_tokens: event.usage.output_tokens,
                ...(event.usage.input_tokens != null
                  ? { input_tokens: event.usage.input_tokens }
                  : {}),
              };
            }
          }
          break;

        // message_stop is a no-op for our purposes
      }
    }

    if (!finalMessage) {
      throw new Error('No message_start event received from stream');
    }

    // Replace the initial (empty) content with accumulated blocks
    finalMessage.content = contentBlocks;

    return finalMessage;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`⛵ [Vela] Claude API error: ${msg}\n`);
    throw error;
  }
}

// ── Tool use helpers ──────────────────────────────────────────

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
