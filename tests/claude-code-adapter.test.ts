import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MessageEvent } from '../src/claude-code-types.js';

// ── Mock state ────────────────────────────────────────────────

/** Module-level mock for SDK query(). Set per test via globalThis. */
let mockQuery: (
  prompt: string,
  options?: unknown,
) => AsyncIterable<MessageEvent>;

/** Module-level mock for getClaudePath(). */
let mockGetClaudePath: () => string | null;

/** Controls whether the dynamic import succeeds or throws. */
let sdkImportShouldFail = false;
let sdkImportError: Error | null = null;

// ── Mocks (K006 pattern: vi.mock + globalThis) ────────────────

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  return {
    get query() {
      if (sdkImportShouldFail) {
        throw sdkImportError ?? new Error('Cannot find module');
      }
      return (...args: unknown[]) =>
        mockQuery(args[0] as string, args[1]);
    },
  };
});

vi.mock('../src/claude-code-readiness.js', () => ({
  getClaudePath: () => mockGetClaudePath(),
}));

// Import after mocks
import { sendMessageViaCli } from '../src/claude-code-adapter.js';

// ── Helpers ───────────────────────────────────────────────────

/** Build an async iterable from an array of MessageEvents. */
function asyncIter(events: MessageEvent[]): AsyncIterable<MessageEvent> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < events.length) {
            return { value: events[i++], done: false };
          }
          return {
            value: undefined as unknown as MessageEvent,
            done: true,
          };
        },
      };
    },
  };
}

/** Create text delta stream events for a given text, split into chunks. */
function textDeltaEvents(text: string): MessageEvent[] {
  const chunks = text.match(/.{1,5}/g) ?? [text];
  return chunks.map((chunk) => ({
    type: 'stream_event' as const,
    event: {
      type: 'content_block_delta' as const,
      delta: { type: 'text_delta' as const, text: chunk },
    },
  }));
}

/** Create a result event with usage data. */
function resultEvent(
  text: string,
  usage = { input_tokens: 10, output_tokens: 20 },
): MessageEvent {
  return {
    type: 'result',
    result: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      usage,
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('sendMessageViaCli', () => {
  beforeEach(() => {
    sdkImportShouldFail = false;
    sdkImportError = null;
    mockGetClaudePath = () => '/usr/local/bin/claude';
    // Default: empty stream
    mockQuery = () => asyncIter([]);
  });

  it('streams text deltas via onText callback in order', async () => {
    const fullText = 'Hello from CLI!';
    const events: MessageEvent[] = [
      ...textDeltaEvents(fullText),
      resultEvent(fullText),
    ];
    mockQuery = () => asyncIter(events);

    const chunks: string[] = [];
    const result = await sendMessageViaCli(
      [{ role: 'user', content: 'Hi' }],
      { onText: (t) => chunks.push(t) },
    );

    expect(chunks.join('')).toBe(fullText);
    expect(result.type).toBe('message');
    expect(result.role).toBe('assistant');
    expect(result.stop_reason).toBe('end_turn');
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: 'text', text: fullText, citations: null });
  });

  it('returns Message with correct usage data from result event', async () => {
    const usage = { input_tokens: 42, output_tokens: 100 };
    mockQuery = () =>
      asyncIter([
        ...textDeltaEvents('test'),
        resultEvent('test', usage),
      ]);

    const result = await sendMessageViaCli([
      { role: 'user', content: 'Hi' },
    ]);

    expect(result.usage.input_tokens).toBe(42);
    expect(result.usage.output_tokens).toBe(100);
  });

  it('returns Anthropic Message-compatible shape', async () => {
    mockQuery = () =>
      asyncIter([
        ...textDeltaEvents('response'),
        resultEvent('response'),
      ]);

    const result = await sendMessageViaCli([
      { role: 'user', content: 'Hi' },
    ]);

    // Check all required Message fields
    expect(result.id).toMatch(/^cli-/);
    expect(result.type).toBe('message');
    expect(result.role).toBe('assistant');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.stop_reason).toBe('end_turn');
    expect(result.stop_sequence).toBeNull();
    expect(result.usage).toBeDefined();
  });

  it('strips tool-use blocks from returned content', async () => {
    // Result event with mixed content: text + tool_use
    const events: MessageEvent[] = [
      ...textDeltaEvents('Here is the answer'),
      {
        type: 'result',
        result: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Here is the answer' },
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'read_file',
              input: { path: '/tmp/x' },
            },
          ],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 20 },
        },
      },
    ];
    mockQuery = () => asyncIter(events);

    const result = await sendMessageViaCli([
      { role: 'user', content: 'Read a file' },
    ]);

    // Only text blocks in returned content
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
  });

  it('extracts only the last user message prompt', async () => {
    let capturedPrompt = '';
    mockQuery = (prompt: string) => {
      capturedPrompt = prompt;
      return asyncIter([resultEvent('')]);
    };

    await sendMessageViaCli([
      { role: 'user', content: 'First message' },
      { role: 'assistant', content: 'Reply' },
      { role: 'user', content: 'Second message' },
    ]);

    expect(capturedPrompt).toBe('Second message');
  });

  it('extracts text from ContentBlock[] user message', async () => {
    let capturedPrompt = '';
    mockQuery = (prompt: string) => {
      capturedPrompt = prompt;
      return asyncIter([resultEvent('')]);
    };

    await sendMessageViaCli([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Part one' },
          { type: 'text', text: 'Part two' },
        ],
      },
    ]);

    expect(capturedPrompt).toBe('Part one\nPart two');
  });

  it('throws descriptive error when SDK is not installed', async () => {
    sdkImportShouldFail = true;
    sdkImportError = new Error(
      "Cannot find module '@anthropic-ai/claude-agent-sdk'",
    );

    await expect(
      sendMessageViaCli([{ role: 'user', content: 'Hi' }]),
    ).rejects.toThrow('Claude Code CLI SDK not installed');
  });

  it('logs SDK import failure to stderr', async () => {
    sdkImportShouldFail = true;
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    try {
      await sendMessageViaCli([{ role: 'user', content: 'Hi' }]);
    } catch {
      // expected
    }

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('⛵ [Vela] Claude Code CLI SDK not available'),
    );
    stderrSpy.mockRestore();
  });

  it('re-throws query errors with context', async () => {
    mockQuery = () => {
      // Return an iterable that throws on iteration
      return {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<MessageEvent>> {
              throw new Error('Connection reset');
            },
          };
        },
      };
    };

    await expect(
      sendMessageViaCli([{ role: 'user', content: 'Hi' }]),
    ).rejects.toThrow('Claude Code CLI query failed: Connection reset');
  });

  it('handles empty response (no text deltas)', async () => {
    mockQuery = () =>
      asyncIter([
        {
          type: 'result',
          result: {
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4-20250514',
            stop_reason: 'end_turn',
            usage: { input_tokens: 5, output_tokens: 0 },
          },
        },
      ]);

    const result = await sendMessageViaCli([
      { role: 'user', content: 'Hi' },
    ]);

    // No text content → empty content array
    expect(result.content).toHaveLength(0);
  });

  it('handles response with only tool-use blocks (no text)', async () => {
    mockQuery = () =>
      asyncIter([
        {
          type: 'result',
          result: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'bash',
                input: { cmd: 'ls' },
              },
            ],
            model: 'claude-sonnet-4-20250514',
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 15 },
          },
        },
      ]);

    const result = await sendMessageViaCli([
      { role: 'user', content: 'Hi' },
    ]);

    // Tool-use blocks stripped, no text → empty content
    expect(result.content).toHaveLength(0);
  });

  it('handles empty messages array gracefully', async () => {
    mockQuery = (prompt: string) => {
      expect(prompt).toBe('');
      return asyncIter([resultEvent('')]);
    };

    const result = await sendMessageViaCli([]);
    expect(result.type).toBe('message');
  });

  it('passes model and system prompt to query options', async () => {
    let capturedOpts: Record<string, unknown> = {};
    mockQuery = (_prompt: string, opts?: unknown) => {
      capturedOpts = (opts ?? {}) as Record<string, unknown>;
      return asyncIter([resultEvent('')]);
    };

    await sendMessageViaCli(
      [{ role: 'user', content: 'Hi' }],
      { model: 'claude-opus-4-20250514', system: 'You are a pirate.' },
    );

    expect(capturedOpts.model).toBe('claude-opus-4-20250514');
    expect(capturedOpts.systemPrompt).toBe('You are a pirate.');
    expect(capturedOpts.permissionMode).toBe('bypassPermissions');
  });

  it('passes claude binary path from getClaudePath to query', async () => {
    mockGetClaudePath = () => '/opt/custom/claude';
    let capturedOpts: Record<string, unknown> = {};
    mockQuery = (_prompt: string, opts?: unknown) => {
      capturedOpts = (opts ?? {}) as Record<string, unknown>;
      return asyncIter([resultEvent('')]);
    };

    await sendMessageViaCli([{ role: 'user', content: 'Hi' }]);

    expect(capturedOpts.pathToClaudeCodeExecutable).toBe('/opt/custom/claude');
  });

  it('omits pathToClaudeCodeExecutable when getClaudePath returns null', async () => {
    mockGetClaudePath = () => null;
    let capturedOpts: Record<string, unknown> = {};
    mockQuery = (_prompt: string, opts?: unknown) => {
      capturedOpts = (opts ?? {}) as Record<string, unknown>;
      return asyncIter([resultEvent('')]);
    };

    await sendMessageViaCli([{ role: 'user', content: 'Hi' }]);

    expect(capturedOpts).not.toHaveProperty('pathToClaudeCodeExecutable');
  });
});
