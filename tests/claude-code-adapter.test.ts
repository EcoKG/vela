import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock state ────────────────────────────────────────────────

/** Mock for SDK query(). Receives the params object from query({ prompt, options }). */
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
import { sendMessageViaCli } from '../src/claude-code-adapter.js';

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

describe('sendMessageViaCli', () => {
  beforeEach(() => {
    sdkImportShouldFail = false;
    sdkImportError = null;
    mockGetClaudePath = () => '/usr/local/bin/claude';
    mockQuery = () => asyncIter([]);
  });

  it('streams text from SDKAssistantMessage via onText callback', async () => {
    const fullText = 'Hello from CLI!';
    mockQuery = () => asyncIter([
      assistantMessage(fullText),
      resultMessage(fullText),
    ]);

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
    mockQuery = () => asyncIter([
      assistantMessage('test', { input_tokens: 5, output_tokens: 8 }),
      resultMessage('test', usage),
    ]);

    const result = await sendMessageViaCli([
      { role: 'user', content: 'Hi' },
    ]);

    // Result usage should override assistant usage
    expect(result.usage.input_tokens).toBe(42);
    expect(result.usage.output_tokens).toBe(100);
  });

  it('returns Anthropic Message-compatible shape', async () => {
    mockQuery = () => asyncIter([
      assistantMessage('response'),
      resultMessage('response'),
    ]);

    const result = await sendMessageViaCli([
      { role: 'user', content: 'Hi' },
    ]);

    expect(result.id).toMatch(/^cli-/);
    expect(result.type).toBe('message');
    expect(result.role).toBe('assistant');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.stop_reason).toBe('end_turn');
    expect(result.stop_sequence).toBeNull();
    expect(result.usage).toBeDefined();
  });

  it('uses result.result text when no assistant message text was streamed', async () => {
    mockQuery = () => asyncIter([
      resultMessage('Result only text'),
    ]);

    const chunks: string[] = [];
    const result = await sendMessageViaCli(
      [{ role: 'user', content: 'Hi' }],
      { onText: (t) => chunks.push(t) },
    );

    expect(chunks.join('')).toBe('Result only text');
    expect(result.content[0].text).toBe('Result only text');
  });

  it('extracts only the last user message prompt', async () => {
    let capturedPrompt = '';
    mockQuery = (params) => {
      capturedPrompt = params.prompt;
      return asyncIter([resultMessage('')]);
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
    mockQuery = (params) => {
      capturedPrompt = params.prompt;
      return asyncIter([resultMessage('')]);
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
      async function* failingStream(): AsyncGenerator<any, void> {
        throw new Error('Connection reset');
      }
      return failingStream();
    };

    await expect(
      sendMessageViaCli([{ role: 'user', content: 'Hi' }]),
    ).rejects.toThrow('Claude Code CLI query failed: Connection reset');
  });

  it('handles empty response (no content)', async () => {
    mockQuery = () => asyncIter([resultMessage('')]);

    const result = await sendMessageViaCli([
      { role: 'user', content: 'Hi' },
    ]);

    expect(result.content).toHaveLength(0);
  });

  it('handles empty messages array gracefully', async () => {
    mockQuery = (params) => {
      expect(params.prompt).toBe('');
      return asyncIter([resultMessage('')]);
    };

    const result = await sendMessageViaCli([]);
    expect(result.type).toBe('message');
  });

  it('passes model and system prompt to query options', async () => {
    let capturedOpts: Record<string, unknown> = {};
    mockQuery = (params) => {
      capturedOpts = (params.options ?? {}) as Record<string, unknown>;
      return asyncIter([resultMessage('')]);
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
    mockQuery = (params) => {
      capturedOpts = (params.options ?? {}) as Record<string, unknown>;
      return asyncIter([resultMessage('')]);
    };

    await sendMessageViaCli([{ role: 'user', content: 'Hi' }]);

    expect(capturedOpts.pathToClaudeCodeExecutable).toBe('/opt/custom/claude');
  });

  it('omits pathToClaudeCodeExecutable when getClaudePath returns null', async () => {
    mockGetClaudePath = () => null;
    let capturedOpts: Record<string, unknown> = {};
    mockQuery = (params) => {
      capturedOpts = (params.options ?? {}) as Record<string, unknown>;
      return asyncIter([resultMessage('')]);
    };

    await sendMessageViaCli([{ role: 'user', content: 'Hi' }]);

    expect(capturedOpts).not.toHaveProperty('pathToClaudeCodeExecutable');
  });

  it('sets maxTurns: 1 and allowDangerouslySkipPermissions: true', async () => {
    let capturedOpts: Record<string, unknown> = {};
    mockQuery = (params) => {
      capturedOpts = (params.options ?? {}) as Record<string, unknown>;
      return asyncIter([resultMessage('')]);
    };

    await sendMessageViaCli([{ role: 'user', content: 'Hi' }]);

    expect(capturedOpts.maxTurns).toBe(1);
    expect(capturedOpts.allowDangerouslySkipPermissions).toBe(true);
  });
});
