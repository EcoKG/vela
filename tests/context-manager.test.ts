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
  TextBlock,
} from '@anthropic-ai/sdk/resources/messages/messages.js';

// ── Mock Anthropic SDK (same pattern as claude-client.test.ts) ──

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
      constructor(_opts: unknown) {}
    },
  };
});

// ── Mock sendMessage from claude-client ──

const mockSendMessage = vi.fn();

vi.mock('../src/claude-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/claude-client.js')>();
  return {
    ...actual,
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  };
});

// Import after mocks
import {
  shouldResetContext,
  flattenContent,
  buildSummarizationPrompt,
  summarizeConversation,
  buildFreshContext,
} from '../src/context-manager.js';
import { createClaudeClient } from '../src/claude-client.js';
import { MODEL_ALIASES } from '../src/models.js';
import type { ChatMessage } from '../src/claude-client.js';

// ── Helpers ───────────────────────────────────────────────────

function makeBaseMessage(): Message {
  return {
    id: 'msg_test_sum',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-20250514',
    content: [],
    stop_reason: 'end_turn',
    stop_sequence: null,
    container: null,
    usage: {
      input_tokens: 50,
      output_tokens: 30,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      service_tier: null as never,
    },
  };
}

function makeTextMessage(text: string): Message {
  const msg = makeBaseMessage();
  msg.content = [{ type: 'text', text, citations: null } as TextBlock];
  return msg;
}

// ── shouldResetContext ────────────────────────────────────────

describe('shouldResetContext', () => {
  it('returns false when below default threshold', () => {
    expect(shouldResetContext(50_000)).toBe(false);
  });

  it('returns false when exactly at default threshold', () => {
    expect(shouldResetContext(100_000)).toBe(false);
  });

  it('returns true when above default threshold', () => {
    expect(shouldResetContext(100_001)).toBe(true);
  });

  it('uses custom threshold when provided', () => {
    expect(shouldResetContext(5_000, 4_000)).toBe(true);
    expect(shouldResetContext(3_000, 4_000)).toBe(false);
  });
});

// ── flattenContent ────────────────────────────────────────────

describe('flattenContent', () => {
  it('returns string input as-is', () => {
    expect(flattenContent('hello world')).toBe('hello world');
  });

  it('extracts text from TextBlock array', () => {
    const blocks = [
      { type: 'text' as const, text: 'First block', citations: null },
      { type: 'text' as const, text: 'Second block', citations: null },
    ];
    expect(flattenContent(blocks)).toBe('First block\nSecond block');
  });

  it('extracts tool_use block with name and input', () => {
    const blocks = [
      {
        type: 'tool_use' as const,
        id: 'toolu_1',
        name: 'Read',
        input: { path: '/tmp/file.txt' },
        caller: { type: 'direct' as const },
      },
    ];
    expect(flattenContent(blocks)).toBe(
      '[tool: Read] {"path":"/tmp/file.txt"}',
    );
  });

  it('extracts tool_result block with string content', () => {
    const blocks = [
      {
        type: 'tool_result' as const,
        tool_use_id: 'toolu_1',
        content: 'file contents here',
      },
    ];
    expect(flattenContent(blocks)).toBe('file contents here');
  });

  it('extracts tool_result block with nested content blocks', () => {
    const blocks = [
      {
        type: 'tool_result' as const,
        tool_use_id: 'toolu_1',
        content: [
          { type: 'text' as const, text: 'nested text' },
        ],
      },
    ];
    expect(flattenContent(blocks)).toBe('nested text');
  });

  it('handles mixed content types', () => {
    const blocks = [
      { type: 'text' as const, text: 'Hello', citations: null },
      {
        type: 'tool_use' as const,
        id: 'toolu_1',
        name: 'Bash',
        input: { command: 'ls' },
        caller: { type: 'direct' as const },
      },
      {
        type: 'tool_result' as const,
        tool_use_id: 'toolu_1',
        content: 'file1.txt\nfile2.txt',
      },
    ];
    const result = flattenContent(blocks);
    expect(result).toContain('Hello');
    expect(result).toContain('[tool: Bash]');
    expect(result).toContain('file1.txt');
  });

  it('handles unknown block types with placeholder', () => {
    const blocks = [
      { type: 'thinking' as const, thinking: 'hmm' },
    ];
    // Cast to satisfy type checker — we're testing the fallback
    expect(flattenContent(blocks as never)).toBe('[thinking]');
  });
});

// ── buildSummarizationPrompt ──────────────────────────────────

describe('buildSummarizationPrompt', () => {
  it('formats messages as role-labelled transcript', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: 'The answer is 4.' },
    ];
    const prompt = buildSummarizationPrompt(messages);
    expect(prompt).toContain('user: What is 2+2?');
    expect(prompt).toContain('assistant: The answer is 4.');
    expect(prompt).toContain('Summarize this conversation');
  });

  it('returns empty string for empty messages', () => {
    expect(buildSummarizationPrompt([])).toBe('');
  });

  it('handles messages with content block arrays', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'help' },
      {
        role: 'assistant',
        content: [
          { type: 'text' as const, text: 'Using a tool', citations: null },
          {
            type: 'tool_use' as const,
            id: 'toolu_1',
            name: 'Read',
            input: { path: 'file.ts' },
            caller: { type: 'direct' as const },
          },
        ],
      },
    ];
    const prompt = buildSummarizationPrompt(messages);
    expect(prompt).toContain('assistant: Using a tool');
    expect(prompt).toContain('[tool: Read]');
  });
});

// ── summarizeConversation ─────────────────────────────────────

describe('summarizeConversation', () => {
  beforeEach(() => {
    mockSendMessage.mockReset();
  });

  it('returns empty string for fewer than 2 messages without API call', async () => {
    const client = createClaudeClient('sk-test');
    const result = await summarizeConversation(client, [
      { role: 'user', content: 'hi' },
    ]);
    expect(result).toBe('');
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns empty string for zero messages', async () => {
    const client = createClaudeClient('sk-test');
    const result = await summarizeConversation(client, []);
    expect(result).toBe('');
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('calls sendMessage with haiku model by default', async () => {
    const summaryText = 'Summary: user asked about math.';
    mockSendMessage.mockResolvedValue(makeTextMessage(summaryText));

    const client = createClaudeClient('sk-test');
    const messages: ChatMessage[] = [
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: '4' },
    ];
    const result = await summarizeConversation(client, messages);

    expect(result).toBe(summaryText);
    expect(mockSendMessage).toHaveBeenCalledOnce();

    const callArgs = mockSendMessage.mock.calls[0];
    // Second arg is the messages array with summarization prompt
    expect(callArgs[1]).toHaveLength(1);
    expect(callArgs[1][0].role).toBe('user');
    // Third arg is options with haiku model
    expect(callArgs[2].model).toBe(MODEL_ALIASES['haiku']);
  });

  it('uses custom model when provided', async () => {
    mockSendMessage.mockResolvedValue(makeTextMessage('Custom summary'));

    const client = createClaudeClient('sk-test');
    const messages: ChatMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ];
    await summarizeConversation(client, messages, 'claude-sonnet-4-20250514');

    const callArgs = mockSendMessage.mock.calls[0];
    expect(callArgs[2].model).toBe('claude-sonnet-4-20250514');
  });
});

// ── buildFreshContext ─────────────────────────────────────────

describe('buildFreshContext', () => {
  const sampleMessages: ChatMessage[] = [
    { role: 'user', content: 'msg1' },
    { role: 'assistant', content: 'msg2' },
    { role: 'user', content: 'msg3' },
    { role: 'assistant', content: 'msg4' },
    { role: 'user', content: 'msg5' },
    { role: 'assistant', content: 'msg6' },
  ];

  it('places summary message first', () => {
    const result = buildFreshContext('My summary', sampleMessages);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toContain('My summary');
    expect(result[0].content).toContain('[Context from previous conversation]');
  });

  it('keeps only last N messages (default 4)', () => {
    const result = buildFreshContext('Summary', sampleMessages);
    // 1 summary + 4 recent = 5 total
    expect(result).toHaveLength(5);
    // Last 4 messages of sampleMessages are msg3..msg6
    expect((result[1].content as string)).toBe('msg3');
    expect((result[4].content as string)).toBe('msg6');
  });

  it('respects custom keepLastN', () => {
    const result = buildFreshContext('Summary', sampleMessages, 2);
    // 1 summary + 2 recent = 3 total
    expect(result).toHaveLength(3);
    expect((result[1].content as string)).toBe('msg5');
    expect((result[2].content as string)).toBe('msg6');
  });

  it('handles fewer messages than keepLastN', () => {
    const fewMessages: ChatMessage[] = [
      { role: 'user', content: 'only one' },
    ];
    const result = buildFreshContext('Summary', fewMessages, 10);
    // 1 summary + 1 message = 2 total
    expect(result).toHaveLength(2);
    expect((result[1].content as string)).toBe('only one');
  });

  it('handles empty recentMessages', () => {
    const result = buildFreshContext('Summary', []);
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain('Summary');
  });
});
