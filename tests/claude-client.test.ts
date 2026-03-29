/**
 * Tests for claude-client.ts shim module.
 *
 * Verifies that:
 *   - sendMessage accepts the legacy (client, messages, options) signature
 *     but delegates to llm.ts sendMessage, ignoring the client
 *   - extractToolUseBlocks and isToolUseResponse still work correctly
 *   - ChatMessage and SendMessageOptions re-exports are compatible
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Message, ToolUseBlock, TextBlock } from '@anthropic-ai/sdk/resources/messages/messages.js';

// ── Mock llm.ts sendMessage via K006 pattern ─────────────────

declare global {
  // eslint-disable-next-line no-var
  var __mockLlmSendMessage: (...args: unknown[]) => Promise<Message>;
}

vi.mock('../src/llm.js', () => ({
  sendMessage: (...args: unknown[]) => globalThis.__mockLlmSendMessage(...args),
}));

// Import after mock is set up
import {
  sendMessage,
  extractToolUseBlocks,
  isToolUseResponse,
} from '../src/claude-client.js';
import type { ChatMessage, SendMessageOptions } from '../src/claude-client.js';

// ── Helpers ───────────────────────────────────────────────────

function makeBaseMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'vela-test123',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-20250514',
    content: [{ type: 'text', text: 'Hello', citations: null } as TextBlock],
    stop_reason: 'end_turn',
    stop_sequence: null,
    container: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      service_tier: null as never,
    },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('sendMessage (shim)', () => {
  let llmSendMessageSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    llmSendMessageSpy = vi.fn();
    globalThis.__mockLlmSendMessage = llmSendMessageSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates to llm.ts sendMessage, ignoring client arg', async () => {
    const expectedMsg = makeBaseMessage();
    llmSendMessageSpy.mockResolvedValue(expectedMsg);

    const client = {};
    const messages: ChatMessage[] = [{ role: 'user', content: 'Hi' }];
    const result = await sendMessage(client, messages);

    expect(result).toBe(expectedMsg);
    // llm.ts sendMessage is called with (messages, options) — no client arg
    expect(llmSendMessageSpy).toHaveBeenCalledTimes(1);
    const [passedMessages, passedOptions] = llmSendMessageSpy.mock.calls[0];
    expect(passedMessages).toBe(messages);
    // Default options — model, system, maxTurns, onText all undefined
    expect(passedOptions).toEqual({
      model: undefined,
      system: undefined,
      maxTurns: undefined,
      onText: undefined,
    });
  });

  it('forwards model, system, maxTurns, and onText to llm.ts', async () => {
    llmSendMessageSpy.mockResolvedValue(makeBaseMessage());

    const onText = vi.fn();
    const client = {};
    const options: SendMessageOptions = {
      model: 'claude-haiku-3',
      system: 'You are a pirate.',
      maxTurns: 3,
      onText,
    };

    await sendMessage(client, [{ role: 'user', content: 'Hi' }], options);

    const [, passedOptions] = llmSendMessageSpy.mock.calls[0];
    expect(passedOptions).toEqual({
      model: 'claude-haiku-3',
      system: 'You are a pirate.',
      maxTurns: 3,
      onText,
    });
  });

  it('accepts maxTokens but does not forward it to llm.ts', async () => {
    llmSendMessageSpy.mockResolvedValue(makeBaseMessage());

    const client = {};
    const options: SendMessageOptions = {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 2048,
    };

    await sendMessage(client, [{ role: 'user', content: 'Hi' }], options);

    const [, passedOptions] = llmSendMessageSpy.mock.calls[0];
    // maxTokens should NOT be in the forwarded options
    expect(passedOptions).not.toHaveProperty('maxTokens');
    // model should still be forwarded
    expect(passedOptions.model).toBe('claude-sonnet-4-20250514');
  });

  it('accepts any value for client arg (ignored)', async () => {
    llmSendMessageSpy.mockResolvedValue(makeBaseMessage());

    // Pass null, undefined, random object — all should work
    await sendMessage(null, [{ role: 'user', content: 'Hi' }]);
    await sendMessage(undefined, [{ role: 'user', content: 'Hi' }]);
    await sendMessage({ random: 'object' }, [{ role: 'user', content: 'Hi' }]);

    expect(llmSendMessageSpy).toHaveBeenCalledTimes(3);
  });

  it('propagates errors from llm.ts sendMessage', async () => {
    llmSendMessageSpy.mockRejectedValue(new Error('SDK not available'));

    const client = {};
    await expect(
      sendMessage(client, [{ role: 'user', content: 'Hi' }]),
    ).rejects.toThrow('SDK not available');
  });
});

describe('extractToolUseBlocks', () => {
  it('returns empty array when no tool_use blocks', () => {
    const msg = makeBaseMessage();
    msg.content = [{ type: 'text', text: 'Hello', citations: null } as TextBlock];
    expect(extractToolUseBlocks(msg)).toEqual([]);
  });

  it('extracts tool_use blocks from mixed content', () => {
    const toolBlock: ToolUseBlock = {
      type: 'tool_use',
      id: 'toolu_123',
      name: 'get_weather',
      input: { location: 'Tokyo' },
      caller: { type: 'direct' },
    };

    const msg = makeBaseMessage({
      content: [
        { type: 'text', text: 'Let me check', citations: null } as TextBlock,
        toolBlock,
      ],
    });

    const result = extractToolUseBlocks(msg);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('get_weather');
    expect(result[0].id).toBe('toolu_123');
    expect(result[0].input).toEqual({ location: 'Tokyo' });
  });
});

describe('isToolUseResponse', () => {
  it('returns false for end_turn', () => {
    const msg = makeBaseMessage({ stop_reason: 'end_turn' });
    expect(isToolUseResponse(msg)).toBe(false);
  });

  it('returns true for tool_use', () => {
    const msg = makeBaseMessage({ stop_reason: 'tool_use' });
    expect(isToolUseResponse(msg)).toBe(true);
  });
});
