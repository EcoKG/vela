/**
 * Context management for Vela conversations.
 *
 * Provides token-threshold detection, conversation summarization via Haiku,
 * and fresh context construction for long-running chat sessions. Used by
 * the /fresh command and automatic context-reset triggers.
 */
import type {
  ContentBlock,
  ContentBlockParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages.js';
import type { ChatMessage } from './claude-client.js';
import { sendMessage } from './claude-client.js';
import { MODEL_ALIASES } from './models.js';

// ── Token threshold ───────────────────────────────────────────

const DEFAULT_TOKEN_THRESHOLD = 100_000;

/**
 * Returns true when the total token count exceeds the reset threshold.
 */
export function shouldResetContext(
  totalTokens: number,
  threshold: number = DEFAULT_TOKEN_THRESHOLD,
): boolean {
  return totalTokens > threshold;
}

// ── Content flattening ────────────────────────────────────────

/**
 * Recursively extracts readable text from ChatMessage content.
 *
 * Handles:
 * - Plain string content → returned as-is
 * - TextBlock / TextBlockParam → `.text`
 * - ToolUseBlock → `[tool: name] <JSON input>`
 * - ToolResultBlockParam → string content or recursive extraction
 * - Unknown block types → `[block.type]` placeholder
 */
export function flattenContent(
  content: string | ContentBlock[] | ContentBlockParam[],
): string {
  if (typeof content === 'string') {
    return content;
  }

  const parts: string[] = [];

  for (const block of content) {
    if ('type' in block) {
      switch (block.type) {
        case 'text':
          parts.push((block as { text: string }).text);
          break;

        case 'tool_use':
          parts.push(
            `[tool: ${(block as { name: string }).name}] ${JSON.stringify((block as { input: unknown }).input)}`,
          );
          break;

        case 'tool_result': {
          const tr = block as ToolResultBlockParam;
          if (typeof tr.content === 'string') {
            parts.push(tr.content);
          } else if (Array.isArray(tr.content)) {
            // Recurse into nested content blocks
            parts.push(flattenContent(tr.content as ContentBlockParam[]));
          }
          break;
        }

        default:
          parts.push(`[${block.type}]`);
          break;
      }
    }
  }

  return parts.join('\n');
}

// ── Summarization prompt ──────────────────────────────────────

const SUMMARIZATION_SYSTEM = `You are a conversation summarizer. Produce a concise summary of the conversation below. Preserve:
- Key decisions and their rationale
- Important code snippets or file paths mentioned
- Action items and outcomes
- Technical context needed to continue the conversation

Be concise but complete. Use bullet points. Do not add commentary.`;

/**
 * Builds a summarization prompt from a conversation history.
 *
 * Maps each message through flattenContent and formats as a
 * role-labelled transcript, wrapped in a system instruction.
 */
export function buildSummarizationPrompt(messages: ChatMessage[]): string {
  if (messages.length === 0) {
    return '';
  }

  const transcript = messages
    .map((m) => `${m.role}: ${flattenContent(m.content)}`)
    .join('\n');

  return `Summarize this conversation:\n\n${transcript}`;
}

// ── Conversation summarization ────────────────────────────────

/**
 * Summarizes a conversation using Claude Haiku for speed and cost efficiency.
 *
 * Returns an empty string without making an API call if the conversation
 * has fewer than 2 messages (nothing meaningful to summarize).
 */
export async function summarizeConversation(
  messages: ChatMessage[],
  model?: string,
): Promise<string> {
  if (messages.length < 2) {
    return '';
  }

  const prompt = buildSummarizationPrompt(messages);
  const summarizationModel = model ?? MODEL_ALIASES['haiku'];

  const result = await sendMessage(null, [{ role: 'user', content: prompt }], {
    model: summarizationModel,
    system: SUMMARIZATION_SYSTEM,
    maxTokens: 2048,
  });

  // Extract text from the response content blocks
  const text = result.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('');

  return text;
}

// ── Fresh context construction ────────────────────────────────

const DEFAULT_KEEP_LAST_N = 4;

/**
 * Builds a fresh ChatMessage array from a summary and recent messages.
 *
 * The returned array starts with a user message containing the summary
 * as context preamble, followed by the last N messages from the
 * conversation (preserving their original roles).
 */
export function buildFreshContext(
  summaryText: string,
  recentMessages: ChatMessage[],
  keepLastN: number = DEFAULT_KEEP_LAST_N,
): ChatMessage[] {
  const kept = recentMessages.slice(-keepLastN);

  const summaryMessage: ChatMessage = {
    role: 'user',
    content: `[Context from previous conversation]\n\n${summaryText}\n\n[Continuing conversation]`,
  };

  return [summaryMessage, ...kept];
}
