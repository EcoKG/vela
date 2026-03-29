import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock state ────────────────────────────────────────────────

/** Mock for SDK query(). */
let mockQuery: (params: { prompt: string; options?: Record<string, unknown> }) => AsyncGenerator<any, void>;

/** Mock for getClaudePath(). */
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
      return (params: { prompt: string; options?: Record<string, unknown> }) =>
        mockQuery(params);
    },
  };
});

vi.mock('../src/claude-code-readiness.js', () => ({
  getClaudePath: () => mockGetClaudePath(),
}));

// Import after mocks
import { sendMessage } from '../src/llm.js';
import type { ChatMessage, SendMessageOptions } from '../src/llm.js';

// ── Helpers ───────────────────────────────────────────────────

/** Build an async generator from an array of SDK messages. */
async function* asyncIter(events: any[]): AsyncGenerator<any, void> {
  for (const event of events) {
    yield event;
  }
}

/** Create an SDKAssistantMessage with text content. */
function assistantMessage(text: string, usage = { input_tokens: 10, output_tokens: 20 }): any {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      usage,
    },
    parent_tool_use_id: null,
    uuid: 'test-uuid',
    session_id: 'test-session',
  };
}

/** Create an SDKResultSuccess message. */
function resultMessage(
  text: string,
  usage = { input_tokens: 10, output_tokens: 20 },
): any {
  return {
    type: 'result',
    subtype: 'success',
    result: text,
    usage,
    total_cost_usd: 0.001,
    num_turns: 1,
    duration_ms: 100,
    session_id: 'test-session',
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('sendMessage (llm.ts)', () => {
  beforeEach(() => {
    sdkImportShouldFail = false;
    sdkImportError = null;
    mockGetClaudePath = () => '/usr/local/bin/claude';
    mockQuery = () => asyncIter([]);
  });

  // 1. Text streaming via onText callback
  it('streams text from SDKAssistantMessage via onText callback', async () => {
    const fullText = 'Hello from the LLM!';
    mockQuery = () => asyncIter([
      assistantMessage(fullText),
      resultMessage(fullText),
    ]);

    const chunks: string[] = [];
    const result = await sendMessage(
      [{ role: 'user', content: 'Hi' }],
      { onText: (t) => chunks.push(t) },
    );

    expect(chunks.join('')).toBe(fullText);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: 'text', text: fullText, citations: null });
  });

  // 2. Usage extraction — result overrides assistant (K017)
  it('returns usage from result event, overriding assistant usage', async () => {
    const resultUsage = { input_tokens: 42, output_tokens: 100 };
    mockQuery = () => asyncIter([
      assistantMessage('test', { input_tokens: 5, output_tokens: 8 }),
      resultMessage('test', resultUsage),
    ]);

    const result = await sendMessage([{ role: 'user', content: 'Hi' }]);

    expect(result.usage.input_tokens).toBe(42);
    expect(result.usage.output_tokens).toBe(100);
  });

  // 3. Message shape compatibility
  it('returns Anthropic Message-compatible shape', async () => {
    mockQuery = () => asyncIter([
      assistantMessage('response'),
      resultMessage('response'),
    ]);

    const result = await sendMessage([{ role: 'user', content: 'Hi' }]);

    expect(result.id).toMatch(/^vela-/);
    expect(result.type).toBe('message');
    expect(result.role).toBe('assistant');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.stop_reason).toBe('end_turn');
    expect(result.stop_sequence).toBeNull();
    expect(result.usage).toBeDefined();
  });

  // 4. Result-only text fallback (no assistant streaming)
  it('uses result.result text when no assistant message text was streamed', async () => {
    mockQuery = () => asyncIter([
      resultMessage('Result only text'),
    ]);

    const chunks: string[] = [];
    const result = await sendMessage(
      [{ role: 'user', content: 'Hi' }],
      { onText: (t) => chunks.push(t) },
    );

    expect(chunks.join('')).toBe('Result only text');
    expect(result.content[0].text).toBe('Result only text');
  });

  // 5. Prompt extraction — last user message (string)
  it('extracts only the last user message as prompt', async () => {
    let capturedPrompt = '';
    mockQuery = (params) => {
      capturedPrompt = params.prompt;
      return asyncIter([resultMessage('')]);
    };

    await sendMessage([
      { role: 'user', content: 'First message' },
      { role: 'assistant', content: 'Reply' },
      { role: 'user', content: 'Second message' },
    ]);

    expect(capturedPrompt).toBe('Second message');
  });

  // 6. Prompt extraction — ContentBlock[] user message
  it('extracts text from ContentBlock[] user message', async () => {
    let capturedPrompt = '';
    mockQuery = (params) => {
      capturedPrompt = params.prompt;
      return asyncIter([resultMessage('')]);
    };

    await sendMessage([
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

  // 7. Model and system prompt passthrough
  it('passes model, system prompt, and maxTurns to query options', async () => {
    let capturedOpts: Record<string, unknown> = {};
    mockQuery = (params) => {
      capturedOpts = (params.options ?? {}) as Record<string, unknown>;
      return asyncIter([resultMessage('')]);
    };

    await sendMessage(
      [{ role: 'user', content: 'Hi' }],
      { model: 'claude-opus-4-20250514', system: 'You are a pirate.', maxTurns: 3 },
    );

    expect(capturedOpts.model).toBe('claude-opus-4-20250514');
    expect(capturedOpts.systemPrompt).toBe('You are a pirate.');
    expect(capturedOpts.maxTurns).toBe(3);
    expect(capturedOpts.permissionMode).toBe('bypassPermissions');
  });

  // 8. Error on SDK not installed
  it('throws descriptive error when SDK is not installed', async () => {
    sdkImportShouldFail = true;
    sdkImportError = new Error("Cannot find module '@anthropic-ai/claude-agent-sdk'");

    await expect(
      sendMessage([{ role: 'user', content: 'Hi' }]),
    ).rejects.toThrow('Claude Code CLI SDK not installed');
  });

  // 9. Error on query failure
  it('re-throws query errors with context', async () => {
    mockQuery = () => {
      async function* failingStream(): AsyncGenerator<any, void> {
        throw new Error('Connection reset');
      }
      return failingStream();
    };

    await expect(
      sendMessage([{ role: 'user', content: 'Hi' }]),
    ).rejects.toThrow('LLM query failed: Connection reset');
  });

  // 10. Empty response
  it('handles empty response (no content)', async () => {
    mockQuery = () => asyncIter([resultMessage('')]);

    const result = await sendMessage([{ role: 'user', content: 'Hi' }]);

    expect(result.content).toHaveLength(0);
  });

  // 11. claudePath passthrough
  it('passes claudePath from getClaudePath to query', async () => {
    mockGetClaudePath = () => '/opt/custom/claude';
    let capturedOpts: Record<string, unknown> = {};
    mockQuery = (params) => {
      capturedOpts = (params.options ?? {}) as Record<string, unknown>;
      return asyncIter([resultMessage('')]);
    };

    await sendMessage([{ role: 'user', content: 'Hi' }]);

    expect(capturedOpts.pathToClaudeCodeExecutable).toBe('/opt/custom/claude');
  });

  // 12. claudePath null omission
  it('omits pathToClaudeCodeExecutable when getClaudePath returns null', async () => {
    mockGetClaudePath = () => null;
    let capturedOpts: Record<string, unknown> = {};
    mockQuery = (params) => {
      capturedOpts = (params.options ?? {}) as Record<string, unknown>;
      return asyncIter([resultMessage('')]);
    };

    await sendMessage([{ role: 'user', content: 'Hi' }]);

    expect(capturedOpts).not.toHaveProperty('pathToClaudeCodeExecutable');
  });

  // 13. Default maxTurns
  it('defaults maxTurns to 1 when not specified', async () => {
    let capturedOpts: Record<string, unknown> = {};
    mockQuery = (params) => {
      capturedOpts = (params.options ?? {}) as Record<string, unknown>;
      return asyncIter([resultMessage('')]);
    };

    await sendMessage([{ role: 'user', content: 'Hi' }]);

    expect(capturedOpts.maxTurns).toBe(1);
    expect(capturedOpts.allowDangerouslySkipPermissions).toBe(true);
  });

  // 14. Logs SDK import failure to stderr
  it('logs SDK import failure to stderr with Vela prefix', async () => {
    sdkImportShouldFail = true;
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    try {
      await sendMessage([{ role: 'user', content: 'Hi' }]);
    } catch {
      // expected
    }

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('⛵ [Vela] Claude Code CLI SDK not available'),
    );
    stderrSpy.mockRestore();
  });

  // 15. Empty messages array
  it('handles empty messages array gracefully', async () => {
    mockQuery = (params) => {
      expect(params.prompt).toBe('');
      return asyncIter([resultMessage('')]);
    };

    const result = await sendMessage([]);
    expect(result.type).toBe('message');
  });
});
