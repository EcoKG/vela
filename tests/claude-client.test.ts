import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  Message,
  RawMessageStreamEvent,
  RawMessageStartEvent,
  RawContentBlockStartEvent,
  RawContentBlockDeltaEvent,
  RawMessageDeltaEvent,
  RawMessageStopEvent,
  RawContentBlockStopEvent,
  ToolUseBlock,
  TextBlock,
  InputJSONDelta,
} from '@anthropic-ai/sdk/resources/messages/messages.js';

// ── Mock Anthropic SDK ────────────────────────────────────────

/**
 * Build a mock async iterable stream from an array of SSE events.
 * The SDK's Stream<T> implements AsyncIterable<T>, so we replicate that.
 */
function mockStream(events: RawMessageStreamEvent[]): AsyncIterable<RawMessageStreamEvent> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < events.length) {
            return { value: events[i++], done: false };
          }
          return { value: undefined as unknown as RawMessageStreamEvent, done: true };
        },
      };
    },
  };
}

// We'll use vi.mock to replace the default Anthropic export
const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
      constructor(_opts: unknown) {}
    },
  };
});

// Import after mock is set up
import {
  createClaudeClient,
  sendMessage,
  extractToolUseBlocks,
  isToolUseResponse,
} from '../src/claude-client.js';

// ── Helpers ───────────────────────────────────────────────────

function makeBaseMessage(): Message {
  return {
    id: 'msg_test123',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-20250514',
    content: [],
    stop_reason: null,
    stop_sequence: null,
    container: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, service_tier: null as never },
  };
}

function textStreamEvents(text: string): RawMessageStreamEvent[] {
  const baseMsg = makeBaseMessage();
  const chunks = text.match(/.{1,5}/g) || [text]; // split into ~5 char chunks

  const events: RawMessageStreamEvent[] = [
    // message_start
    { type: 'message_start', message: baseMsg } as RawMessageStartEvent,
    // content_block_start
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '', citations: null } as TextBlock,
    } as RawContentBlockStartEvent,
  ];

  // content_block_delta for each chunk
  for (const chunk of chunks) {
    events.push({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: chunk },
    } as RawContentBlockDeltaEvent);
  }

  events.push(
    // content_block_stop
    { type: 'content_block_stop', index: 0 } as RawContentBlockStopEvent,
    // message_delta (marks stop_reason)
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null, container: null },
      usage: { output_tokens: 5 },
    } as RawMessageDeltaEvent,
    // message_stop
    { type: 'message_stop' } as RawMessageStopEvent,
  );

  return events;
}

// ── Tests ─────────────────────────────────────────────────────

describe('createClaudeClient', () => {
  it('returns an Anthropic instance', () => {
    const client = createClaudeClient('sk-test-key');
    // The mock class exposes a messages property
    expect(client).toBeDefined();
    expect((client as unknown as { messages: unknown }).messages).toBeDefined();
  });
});

describe('sendMessage', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('streams text via onText callback in order', async () => {
    const fullText = 'Hello, I am Claude!';
    const events = textStreamEvents(fullText);
    mockCreate.mockResolvedValue(mockStream(events));

    const chunks: string[] = [];
    const client = createClaudeClient('sk-test');

    const result = await sendMessage(
      client,
      [{ role: 'user', content: 'Hi' }],
      { onText: (text) => chunks.push(text) },
    );

    // Chunks should reconstruct the full text
    expect(chunks.join('')).toBe(fullText);
    // Return value is a Message
    expect(result.type).toBe('message');
    expect(result.role).toBe('assistant');
    expect(result.stop_reason).toBe('end_turn');
  });

  it('returns full Message with correct content', async () => {
    const events = textStreamEvents('Test response');
    mockCreate.mockResolvedValue(mockStream(events));

    const client = createClaudeClient('sk-test');
    const result = await sendMessage(
      client,
      [{ role: 'user', content: 'Test' }],
    );

    // Content should contain accumulated text block
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect((result.content[0] as TextBlock).text).toBe('Test response');
  });

  it('passes model, maxTokens, system, and stream:true to SDK', async () => {
    const events = textStreamEvents('ok');
    mockCreate.mockResolvedValue(mockStream(events));

    const client = createClaudeClient('sk-test');
    await sendMessage(
      client,
      [{ role: 'user', content: 'Hi' }],
      { model: 'claude-haiku-3', maxTokens: 1024, system: 'You are a pirate.' },
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-3',
        max_tokens: 1024,
        system: 'You are a pirate.',
        stream: true,
      }),
    );
  });

  it('handles tool_use stop_reason with ToolUseBlock in content', async () => {
    const baseMsg = makeBaseMessage();
    const toolBlock: ToolUseBlock = {
      type: 'tool_use',
      id: 'toolu_123',
      name: 'get_weather',
      input: { location: 'Tokyo' },
      caller: { type: 'direct' },
    };

    const events: RawMessageStreamEvent[] = [
      { type: 'message_start', message: baseMsg } as RawMessageStartEvent,
      // Text block first
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '', citations: null } as TextBlock,
      } as RawContentBlockStartEvent,
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Let me check' },
      } as RawContentBlockDeltaEvent,
      { type: 'content_block_stop', index: 0 } as RawContentBlockStopEvent,
      // Tool use block
      {
        type: 'content_block_start',
        index: 1,
        content_block: toolBlock,
      } as RawContentBlockStartEvent,
      { type: 'content_block_stop', index: 1 } as RawContentBlockStopEvent,
      // message_delta with tool_use stop reason
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null, container: null },
        usage: { output_tokens: 20 },
      } as RawMessageDeltaEvent,
      { type: 'message_stop' } as RawMessageStopEvent,
    ];

    mockCreate.mockResolvedValue(mockStream(events));

    const client = createClaudeClient('sk-test');
    const result = await sendMessage(
      client,
      [{ role: 'user', content: "What's the weather?" }],
    );

    expect(result.stop_reason).toBe('tool_use');
    expect(isToolUseResponse(result)).toBe(true);

    const toolBlocks = extractToolUseBlocks(result);
    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0].name).toBe('get_weather');
    expect(toolBlocks[0].id).toBe('toolu_123');
    expect(toolBlocks[0].input).toEqual({ location: 'Tokyo' });
  });

  it('emits [Vela] error to stderr and re-throws on API failure', async () => {
    const apiError = new Error('Authentication failed');
    mockCreate.mockRejectedValue(apiError);

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const client = createClaudeClient('sk-bad');

    await expect(
      sendMessage(client, [{ role: 'user', content: 'Hi' }]),
    ).rejects.toThrow('Authentication failed');

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('⛵ [Vela] Claude API error: Authentication failed'),
    );

    stderrSpy.mockRestore();
  });

  it('works without onText callback', async () => {
    const events = textStreamEvents('No callback');
    mockCreate.mockResolvedValue(mockStream(events));

    const client = createClaudeClient('sk-test');
    const result = await sendMessage(
      client,
      [{ role: 'user', content: 'Hi' }],
    );

    // Should not throw, and should return the message
    expect(result.content).toHaveLength(1);
    expect((result.content[0] as TextBlock).text).toBe('No callback');
  });

  it('forwards tools param to SDK create call when provided', async () => {
    const events = textStreamEvents('ok');
    mockCreate.mockResolvedValue(mockStream(events));

    const client = createClaudeClient('sk-test');
    const tools = [
      {
        name: 'Read',
        description: 'Read a file',
        input_schema: {
          type: 'object' as const,
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    ];

    await sendMessage(
      client,
      [{ role: 'user', content: 'Hi' }],
      { tools },
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools,
        stream: true,
      }),
    );
  });

  it('does not include tools key when tools is undefined or empty', async () => {
    const events = textStreamEvents('ok');
    mockCreate.mockResolvedValue(mockStream(events));

    const client = createClaudeClient('sk-test');
    await sendMessage(client, [{ role: 'user', content: 'Hi' }]);

    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('tools');
  });

  it('captures output_tokens from message_delta usage field', async () => {
    const baseMsg = makeBaseMessage();
    // message_start usage has output_tokens: 5 (initial placeholder)
    const events: RawMessageStreamEvent[] = [
      { type: 'message_start', message: baseMsg } as RawMessageStartEvent,
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '', citations: null } as TextBlock,
      } as RawContentBlockStartEvent,
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      } as RawContentBlockDeltaEvent,
      { type: 'content_block_stop', index: 0 } as RawContentBlockStopEvent,
      // message_delta carries the cumulative output_tokens
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null, container: null },
        usage: { output_tokens: 42 },
      } as RawMessageDeltaEvent,
      { type: 'message_stop' } as RawMessageStopEvent,
    ];

    mockCreate.mockResolvedValue(mockStream(events));

    const client = createClaudeClient('sk-test');
    const result = await sendMessage(
      client,
      [{ role: 'user', content: 'Hi' }],
    );

    // output_tokens should be updated from message_delta's usage, not the initial value
    expect(result.usage.output_tokens).toBe(42);
    // input_tokens should be preserved from message_start
    expect(result.usage.input_tokens).toBe(10);
  });

  it('accumulates input_json_delta and parses into tool_use block input', async () => {
    const baseMsg = makeBaseMessage();
    const toolBlock: ToolUseBlock = {
      type: 'tool_use',
      id: 'toolu_abc',
      name: 'Read',
      input: {},
      caller: { type: 'direct' },
    };

    // Simulate streaming: tool_use block starts with empty input {},
    // then input_json_delta events deliver the JSON in chunks,
    // then content_block_stop triggers parsing.
    const events: RawMessageStreamEvent[] = [
      { type: 'message_start', message: baseMsg } as RawMessageStartEvent,
      {
        type: 'content_block_start',
        index: 0,
        content_block: toolBlock,
      } as RawContentBlockStartEvent,
      // First chunk of input JSON
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"path":' } as InputJSONDelta,
      } as RawContentBlockDeltaEvent,
      // Second chunk
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: ' "/tmp/test.txt"}' } as InputJSONDelta,
      } as RawContentBlockDeltaEvent,
      { type: 'content_block_stop', index: 0 } as RawContentBlockStopEvent,
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null, container: null },
        usage: { output_tokens: 15 },
      } as RawMessageDeltaEvent,
      { type: 'message_stop' } as RawMessageStopEvent,
    ];

    mockCreate.mockResolvedValue(mockStream(events));

    const client = createClaudeClient('sk-test');
    const result = await sendMessage(
      client,
      [{ role: 'user', content: 'Read /tmp/test.txt' }],
    );

    expect(result.stop_reason).toBe('tool_use');
    expect(result.content).toHaveLength(1);
    const block = result.content[0] as ToolUseBlock;
    expect(block.type).toBe('tool_use');
    expect(block.name).toBe('Read');
    expect(block.input).toEqual({ path: '/tmp/test.txt' });
  });
});

describe('extractToolUseBlocks', () => {
  it('returns empty array when no tool_use blocks', () => {
    const msg = makeBaseMessage();
    msg.content = [{ type: 'text', text: 'Hello', citations: null } as TextBlock];
    expect(extractToolUseBlocks(msg)).toEqual([]);
  });
});

describe('isToolUseResponse', () => {
  it('returns false for end_turn', () => {
    const msg = makeBaseMessage();
    msg.stop_reason = 'end_turn';
    expect(isToolUseResponse(msg)).toBe(false);
  });

  it('returns true for tool_use', () => {
    const msg = makeBaseMessage();
    msg.stop_reason = 'tool_use';
    expect(isToolUseResponse(msg)).toBe(true);
  });
});
