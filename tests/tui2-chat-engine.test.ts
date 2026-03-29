import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatMessage, SendMessageOptions } from '../src/llm.js';

// ── Mock state (K006 pattern: vi.mock + module-scoped variables) ──

/**
 * The mock sendMessage implementation, set per test.
 * Default: resolves immediately with no streaming.
 */
let mockSendMessage: (
  messages: ChatMessage[],
  options?: SendMessageOptions,
) => Promise<any>;

vi.mock('../src/llm.js', () => ({
  sendMessage: (messages: ChatMessage[], options?: SendMessageOptions) =>
    mockSendMessage(messages, options),
}));

// Import after mock registration
import {
  ChatEngine,
  type ChatEngineCallbacks,
  type ChatEngineMessage,
} from '../src/tui2/chat-engine.js';

// ── Helpers ───────────────────────────────────────────────────

/** Build a no-op callbacks object; individual tests override as needed. */
function makeCallbacks(
  overrides?: Partial<ChatEngineCallbacks>,
): ChatEngineCallbacks {
  return {
    onMessageStart: vi.fn(),
    onTextDelta: vi.fn(),
    onToolStart: vi.fn(),
    onToolDone: vi.fn(),
    onMessageComplete: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

/** Fake Message result returned by the mock sendMessage. */
const FAKE_MESSAGE = {
  id: 'vela-test',
  type: 'message' as const,
  role: 'assistant' as const,
  model: 'claude-sonnet-4-20250514',
  content: [{ type: 'text' as const, text: 'response', citations: null }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  container: null,
  usage: {
    input_tokens: 10,
    output_tokens: 20,
    cache_creation: null,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    inference_geo: null,
    server_tool_use: null,
    service_tier: null,
  },
};

// ── Tests ─────────────────────────────────────────────────────

describe('ChatEngine', () => {
  beforeEach(() => {
    // Default mock: invoke onText with "response", then resolve
    mockSendMessage = async (_msgs, opts) => {
      opts?.onText?.('response');
      return FAKE_MESSAGE;
    };
  });

  // 1. submit adds user message to history and calls onMessageStart
  it('submit adds user message to history and calls onMessageStart', async () => {
    const cb = makeCallbacks();
    const engine = new ChatEngine(cb);

    await engine.submit('hello');

    expect(engine.history[0]).toEqual({
      role: 'user',
      content: 'hello',
    });
    expect(cb.onMessageStart).toHaveBeenCalledTimes(1);
  });

  // 2. streaming text triggers onTextDelta callbacks
  it('streaming text triggers onTextDelta callbacks', async () => {
    mockSendMessage = async (_msgs, opts) => {
      opts?.onText?.('Hello ');
      opts?.onText?.('world');
      return FAKE_MESSAGE;
    };

    const deltas: string[] = [];
    const cb = makeCallbacks({
      onTextDelta: vi.fn((text: string) => deltas.push(text)),
    });
    const engine = new ChatEngine(cb);

    await engine.submit('hi');

    expect(deltas).toEqual(['Hello ', 'world']);
    expect(cb.onTextDelta).toHaveBeenCalledTimes(2);
  });

  // 3. tool events trigger onToolStart/onToolDone callbacks
  it('tool events trigger onToolStart/onToolDone callbacks', async () => {
    mockSendMessage = async (_msgs, opts) => {
      opts?.onToolStart?.('Read', 'tu_001');
      opts?.onToolDone?.('Read', 'tu_001', 'read 42 lines');
      opts?.onText?.('done');
      return FAKE_MESSAGE;
    };

    const starts: Array<{ name: string; id: string }> = [];
    const dones: Array<{ name: string; id: string; summary?: string }> = [];
    const cb = makeCallbacks({
      onToolStart: vi.fn((name: string, id: string) =>
        starts.push({ name, id }),
      ),
      onToolDone: vi.fn((name: string, id: string, summary?: string) =>
        dones.push({ name, id, summary }),
      ),
    });
    const engine = new ChatEngine(cb);

    await engine.submit('do it');

    expect(starts).toEqual([{ name: 'Read', id: 'tu_001' }]);
    expect(dones).toEqual([
      { name: 'Read', id: 'tu_001', summary: 'read 42 lines' },
    ]);

    // Verify tool activity in assistant message
    const assistantMsg = engine.history[1];
    expect(assistantMsg.toolCalls).toHaveLength(1);
    expect(assistantMsg.toolCalls![0].status).toBe('done');
    expect(assistantMsg.toolCalls![0].summary).toBe('read 42 lines');
  });

  // 4. successful completion calls onMessageComplete with assistant message
  it('successful completion calls onMessageComplete with assistant message', async () => {
    mockSendMessage = async (_msgs, opts) => {
      opts?.onText?.('answer');
      return FAKE_MESSAGE;
    };

    let completedMsg: ChatEngineMessage | null = null;
    const cb = makeCallbacks({
      onMessageComplete: vi.fn((msg: ChatEngineMessage) => {
        completedMsg = msg;
      }),
    });
    const engine = new ChatEngine(cb);

    await engine.submit('question');

    expect(cb.onMessageComplete).toHaveBeenCalledTimes(1);
    expect(completedMsg).not.toBeNull();
    expect(completedMsg!.role).toBe('assistant');
    expect(completedMsg!.content).toBe('answer');
  });

  // 5. error during sendMessage calls onError callback
  it('error during sendMessage calls onError callback', async () => {
    mockSendMessage = async () => {
      throw new Error('Connection refused');
    };

    const cb = makeCallbacks();
    const engine = new ChatEngine(cb);

    await engine.submit('fail');

    expect(cb.onError).toHaveBeenCalledWith('Connection refused');
    // isStreaming should be reset after error
    expect(engine.isStreaming).toBe(false);
  });

  // 6. double-submit while streaming is rejected (no-op)
  it('double-submit while streaming is rejected', async () => {
    // sendMessage blocks until we resolve it.
    // Use a signal to know when the mock has been entered (after dynamic import).
    let resolveMessage!: () => void;
    let mockEntered!: () => void;
    const mockEnteredPromise = new Promise<void>((r) => { mockEntered = r; });

    mockSendMessage = async (_msgs, opts) => {
      opts?.onText?.('streaming...');
      mockEntered(); // signal that we're inside the mock
      await new Promise<void>((resolve) => {
        resolveMessage = resolve;
      });
      return FAKE_MESSAGE;
    };

    const cb = makeCallbacks();
    const engine = new ChatEngine(cb);

    // Start first submit (won't resolve yet)
    const firstSubmit = engine.submit('first');

    // Wait for the mock to actually be entered (after dynamic import resolves)
    await mockEnteredPromise;

    // Engine is now streaming
    expect(engine.isStreaming).toBe(true);

    // Second submit should be a no-op
    await engine.submit('second');

    // Only one user message in history (second was rejected)
    expect(engine.history).toHaveLength(1);
    expect(engine.history[0].content).toBe('first');

    // onMessageStart called only once
    expect(cb.onMessageStart).toHaveBeenCalledTimes(1);

    // Resolve the first submit
    resolveMessage();
    await firstSubmit;

    // Now history has user + assistant
    expect(engine.history).toHaveLength(2);
    expect(engine.isStreaming).toBe(false);
  });

  // 7. clearHistory resets history array
  it('clearHistory resets history array', async () => {
    const cb = makeCallbacks();
    const engine = new ChatEngine(cb);

    await engine.submit('hello');
    expect(engine.history.length).toBeGreaterThan(0);

    engine.clearHistory();
    expect(engine.history).toHaveLength(0);
  });

  // 7b. restoreHistory replaces history with provided messages
  it('restoreHistory replaces existing history', async () => {
    const cb = makeCallbacks();
    const engine = new ChatEngine(cb);

    await engine.submit('original');
    expect(engine.history).toHaveLength(2); // user + assistant

    const restored: ChatEngineMessage[] = [
      { role: 'user', content: 'restored question' },
      { role: 'assistant', content: 'restored answer' },
      { role: 'user', content: 'follow up' },
    ];
    engine.restoreHistory(restored);

    expect(engine.history).toHaveLength(3);
    expect(engine.history[0].content).toBe('restored question');
    expect(engine.history[1].content).toBe('restored answer');
    expect(engine.history[2].content).toBe('follow up');
  });

  it('restoreHistory with empty array clears history', () => {
    const cb = makeCallbacks();
    const engine = new ChatEngine(cb);

    engine.restoreHistory([{ role: 'user', content: 'something' }]);
    expect(engine.history).toHaveLength(1);

    engine.restoreHistory([]);
    expect(engine.history).toHaveLength(0);
  });

  // 8. setModel updates model for subsequent messages
  it('setModel updates model for subsequent messages', async () => {
    let capturedModel: string | undefined;
    mockSendMessage = async (_msgs, opts) => {
      capturedModel = opts?.model;
      return FAKE_MESSAGE;
    };

    const cb = makeCallbacks();
    const engine = new ChatEngine(cb, { model: 'claude-sonnet-4-20250514' });

    engine.setModel('claude-opus-4-20250514');
    await engine.submit('hi');

    expect(capturedModel).toBe('claude-opus-4-20250514');
  });

  // 9. passes system prompt and maxTurns from options
  it('passes system prompt and maxTurns from constructor options', async () => {
    let capturedOpts: SendMessageOptions | undefined;
    mockSendMessage = async (_msgs, opts) => {
      capturedOpts = opts;
      return FAKE_MESSAGE;
    };

    const cb = makeCallbacks();
    const engine = new ChatEngine(cb, {
      system: 'You are a pirate.',
      maxTurns: 5,
    });

    await engine.submit('ahoy');

    expect(capturedOpts?.system).toBe('You are a pirate.');
    expect(capturedOpts?.maxTurns).toBe(5);
  });

  // 10. history is read-only (returns a frozen reference)
  it('history getter returns a read-only array', async () => {
    const cb = makeCallbacks();
    const engine = new ChatEngine(cb);

    await engine.submit('test');

    const history = engine.history;
    expect(history).toHaveLength(2);
    // readonly array — TypeScript prevents mutation, but runtime should still work
    expect(typeof history).toBe('object');
    expect(Array.isArray(history)).toBe(true);
  });

  // 11. onToolDone for unknown tool_use_id still records it
  it('onToolDone without prior onToolStart still records the tool activity', async () => {
    mockSendMessage = async (_msgs, opts) => {
      // onToolDone fires without a preceding onToolStart
      opts?.onToolDone?.('Write', 'tu_orphan', 'wrote file');
      opts?.onText?.('ok');
      return FAKE_MESSAGE;
    };

    const cb = makeCallbacks();
    const engine = new ChatEngine(cb);

    await engine.submit('go');

    const assistantMsg = engine.history[1];
    expect(assistantMsg.toolCalls).toHaveLength(1);
    expect(assistantMsg.toolCalls![0]).toEqual({
      toolName: 'Write',
      toolId: 'tu_orphan',
      status: 'done',
      summary: 'wrote file',
    });
  });

  // 12. conversation messages are passed to sendMessage
  it('passes conversation history as ChatMessage[] to sendMessage', async () => {
    let capturedMessages: ChatMessage[] = [];
    mockSendMessage = async (msgs, opts) => {
      capturedMessages = msgs;
      opts?.onText?.('reply');
      return FAKE_MESSAGE;
    };

    const cb = makeCallbacks();
    const engine = new ChatEngine(cb);

    // First exchange
    await engine.submit('hello');
    // Second exchange — should pass both user+assistant from first, plus new user
    await engine.submit('follow up');

    // capturedMessages should have user, assistant, user
    expect(capturedMessages).toHaveLength(3);
    expect(capturedMessages[0].role).toBe('user');
    expect(capturedMessages[0].content).toBe('hello');
    expect(capturedMessages[1].role).toBe('assistant');
    expect(capturedMessages[2].role).toBe('user');
    expect(capturedMessages[2].content).toBe('follow up');
  });

  // 13. no toolCalls field when no tools are used
  it('omits toolCalls field when no tools were invoked', async () => {
    mockSendMessage = async (_msgs, opts) => {
      opts?.onText?.('plain text');
      return FAKE_MESSAGE;
    };

    const cb = makeCallbacks();
    const engine = new ChatEngine(cb);

    await engine.submit('simple question');

    const assistantMsg = engine.history[1];
    expect(assistantMsg.toolCalls).toBeUndefined();
  });
});
