import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { act } from 'react';

// ── Mocks ──────────────────────────────────────────────────────────

// Capture the onSubmit callback from ChatInput to trigger it programmatically
let capturedOnSubmit: ((text: string) => void) | null = null;
let capturedIsDisabled = false;

vi.mock('../src/tui/ChatInput.js', () => ({
  ChatInput: ({ onSubmit, isDisabled }: { onSubmit: (text: string) => void; isDisabled?: boolean }) => {
    capturedOnSubmit = onSubmit;
    capturedIsDisabled = !!isDisabled;
    return <Text>{isDisabled ? '[input disabled]' : '> '}</Text>;
  },
}));

const mockSendMessage = vi.fn();
const mockCreateClaudeClient = vi.fn();
const mockExtractToolUseBlocks = vi.fn();
const mockIsToolUseResponse = vi.fn();
const mockExecuteTool = vi.fn();

vi.mock('../src/claude-client.js', () => ({
  createClaudeClient: (...args: unknown[]) => mockCreateClaudeClient(...args),
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  extractToolUseBlocks: (...args: unknown[]) => mockExtractToolUseBlocks(...args),
  isToolUseResponse: (...args: unknown[]) => mockIsToolUseResponse(...args),
}));

vi.mock('../src/tool-engine.js', () => ({
  executeTool: (...args: unknown[]) => mockExecuteTool(...args),
  TOOL_DEFINITIONS: [],
}));

vi.mock('../src/governance/index.js', () => ({
  buildGateContext: () => ({ mode: 'read', velaDir: '/tmp/.vela', artifactDir: '/tmp/artifacts' }),
  RetryBudget: class MockRetryBudget {
    shouldTerminate() { return { terminate: false }; }
  },
  DEFAULT_RETRY_BUDGET: 3,
}));

// Session module mock
const mockOpenSessionDb = vi.fn();
const mockCreateSession = vi.fn();
const mockAddMessage = vi.fn();
const mockUpdateSession = vi.fn();
const mockListSessions = vi.fn();

vi.mock('../src/session.js', () => ({
  openSessionDb: (...args: unknown[]) => mockOpenSessionDb(...args),
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  addMessage: (...args: unknown[]) => mockAddMessage(...args),
  updateSession: (...args: unknown[]) => mockUpdateSession(...args),
  listSessions: (...args: unknown[]) => mockListSessions(...args),
}));

// Context-manager mock
const mockShouldResetContext = vi.fn();
const mockSummarizeConversation = vi.fn();
const mockBuildFreshContext = vi.fn();

vi.mock('../src/context-manager.js', () => ({
  shouldResetContext: (...args: unknown[]) => mockShouldResetContext(...args),
  summarizeConversation: (...args: unknown[]) => mockSummarizeConversation(...args),
  buildFreshContext: (...args: unknown[]) => mockBuildFreshContext(...args),
}));

// Model router mock
const mockSelectModel = vi.fn();

vi.mock('../src/model-router.js', () => ({
  selectModel: (...args: unknown[]) => mockSelectModel(...args),
}));

// Import after mocks are registered
import { ChatApp } from '../src/tui/ChatApp.js';

// ── ChatApp ────────────────────────────────────────────────────────

describe('ChatApp', () => {
  const fakeDb = { close: vi.fn() };

  beforeEach(() => {
    capturedOnSubmit = null;
    capturedIsDisabled = false;
    mockSendMessage.mockReset();
    mockCreateClaudeClient.mockReset();
    mockExtractToolUseBlocks.mockReset();
    mockIsToolUseResponse.mockReset();
    mockExecuteTool.mockReset();
    mockCreateClaudeClient.mockReturnValue({});

    // Session mocks
    mockOpenSessionDb.mockReset();
    mockCreateSession.mockReset();
    mockAddMessage.mockReset();
    mockUpdateSession.mockReset();
    mockListSessions.mockReset();
    fakeDb.close.mockReset();
    mockOpenSessionDb.mockReturnValue(fakeDb);
    mockCreateSession.mockReturnValue({ id: 'sess-001', title: 'Test', model: 'claude-sonnet-4-20250514', system: null, created_at: '', updated_at: '' });

    // Context-manager mocks — default: no auto-trigger
    mockShouldResetContext.mockReset();
    mockSummarizeConversation.mockReset();
    mockBuildFreshContext.mockReset();
    mockShouldResetContext.mockReturnValue(false);
    mockSummarizeConversation.mockResolvedValue('Test summary of conversation');
    mockBuildFreshContext.mockReturnValue([
      { role: 'user', content: '[Context from previous conversation]\n\nTest summary of conversation\n\n[Continuing conversation]' },
    ]);

    // Model router mock — default: return same model (no change)
    mockSelectModel.mockReset();
    mockSelectModel.mockReturnValue({ model: 'claude-sonnet-4-20250514', reason: 'Auto-routed: moderate' });
  });

  it('renders Header and input prompt on mount', () => {
    const { lastFrame } = render(<ChatApp apiKey="sk-test" />);
    const frame = lastFrame()!;
    expect(frame).toContain('Vela');
    expect(frame).toContain('>');
  });

  it('shows user message and assistant response after submission', async () => {
    mockSendMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Hello back!' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    mockIsToolUseResponse.mockReturnValue(false);

    const { lastFrame } = render(<ChatApp apiKey="sk-test" />);

    await act(async () => {
      capturedOnSubmit!('Hello');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('Hello back!');
    });

    const frame = lastFrame()!;
    expect(frame).toContain('You:');
    expect(frame).toContain('Hello');
    expect(frame).toContain('Claude:');
    expect(frame).toContain('Hello back!');
  });

  it('shows error message when sendMessage throws', async () => {
    mockSendMessage.mockRejectedValue(new Error('API key invalid'));

    const { lastFrame } = render(<ChatApp apiKey="sk-bad" />);

    await act(async () => {
      capturedOnSubmit!('Test');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('API key invalid');
    });

    const frame = lastFrame()!;
    expect(frame).toContain('Error:');
    expect(frame).toContain('API key invalid');
    // Input should be re-enabled after error
    expect(frame).not.toContain('[input disabled]');
  });

  it('shows tool status during tool execution', async () => {
    // Control when executeTool resolves so we can observe intermediate state
    let resolveToolExecution!: (value: { result: string; is_error: boolean }) => void;
    const toolPromise = new Promise<{ result: string; is_error: boolean }>((resolve) => {
      resolveToolExecution = resolve;
    });

    mockSendMessage
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me read that.' },
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { path: '/tmp/test.txt' } },
        ],
        usage: { input_tokens: 80, output_tokens: 30 },
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'File contains hello.' }],
        usage: { input_tokens: 120, output_tokens: 40 },
      });

    mockIsToolUseResponse
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    mockExtractToolUseBlocks.mockReturnValue([
      { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { path: '/tmp/test.txt' } },
    ]);

    mockExecuteTool.mockReturnValue(toolPromise);

    const { lastFrame } = render(<ChatApp apiKey="sk-test" />);

    // Don't await — let the async flow run until tool pause
    act(() => {
      capturedOnSubmit!('Read file');
    });

    // Wait for tool status to appear
    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('Running tool: Read');
    });

    // Input should be disabled while streaming
    expect(lastFrame()!).toContain('[input disabled]');

    // Resolve tool execution
    await act(async () => {
      resolveToolExecution({ result: 'hello', is_error: false });
    });

    // Wait for final response
    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('File contains hello.');
    });

    // Verify executeTool was called correctly
    expect(mockExecuteTool).toHaveBeenCalledWith('Read', { path: '/tmp/test.txt' }, expect.anything());
  });

  it('ignores empty input submission', async () => {
    render(<ChatApp apiKey="sk-test" />);

    await act(async () => {
      capturedOnSubmit!('');
    });

    // Give a tick for any async work
    await new Promise((resolve) => setTimeout(resolve, 50));

    // sendMessage should never have been called
    expect(mockSendMessage).not.toHaveBeenCalled();

    // Also test whitespace-only
    await act(async () => {
      capturedOnSubmit!('   ');
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('shows BLOCKED with gate code when tool is blocked', async () => {
    // First response triggers a tool use
    mockSendMessage
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me write that.' },
          { type: 'tool_use', id: 'toolu_1', name: 'Write', input: { path: '/tmp/test.ts', content: 'x' } },
        ],
        usage: { input_tokens: 50, output_tokens: 20 },
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Write was blocked.' }],
        usage: { input_tokens: 60, output_tokens: 30 },
      });

    mockIsToolUseResponse
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    mockExtractToolUseBlocks.mockReturnValue([
      { type: 'tool_use', id: 'toolu_1', name: 'Write', input: { path: '/tmp/test.ts', content: 'x' } },
    ]);

    // executeTool returns BLOCKED result
    mockExecuteTool.mockResolvedValue({
      result: '⛵ [Vela] ✦ BLOCKED [VK-04] Write blocked in read mode',
      is_error: true,
    });

    const { lastFrame } = render(<ChatApp apiKey="sk-test" />);

    await act(async () => {
      capturedOnSubmit!('Write file');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('BLOCKED');
      expect(frame).toContain('VK-04');
    });
  });

  it('does not show BLOCKED for successful tool execution', async () => {
    let resolveToolExecution!: (value: { result: string; is_error: boolean }) => void;
    const toolPromise = new Promise<{ result: string; is_error: boolean }>((resolve) => {
      resolveToolExecution = resolve;
    });

    mockSendMessage
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me read.' },
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { path: '/tmp/test.txt' } },
        ],
        usage: { input_tokens: 70, output_tokens: 25 },
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Done reading.' }],
        usage: { input_tokens: 90, output_tokens: 35 },
      });

    mockIsToolUseResponse
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    mockExtractToolUseBlocks.mockReturnValue([
      { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { path: '/tmp/test.txt' } },
    ]);

    mockExecuteTool.mockReturnValue(toolPromise);

    const { lastFrame } = render(<ChatApp apiKey="sk-test" />);

    act(() => {
      capturedOnSubmit!('Read file');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('Running tool: Read');
    });

    await act(async () => {
      resolveToolExecution({ result: 'file content', is_error: false });
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('Done reading.');
    });

    const frame = lastFrame()!;
    expect(frame).not.toContain('BLOCKED');
  });

  it('renders GovernanceStatus with mode from gate context', async () => {
    const { lastFrame } = render(<ChatApp apiKey="sk-test" />);

    // useEffect sets pipelineMode asynchronously — wait for it
    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('Mode:');
      expect(frame).toContain('read');
    });
  });

  // ── Session persistence tests ──────────────────────────────────

  it('renders initialMessages on mount', () => {
    const initial = [
      { role: 'user' as const, content: 'Previous question' },
      { role: 'assistant' as const, content: 'Previous answer' },
    ];
    const { lastFrame } = render(
      <ChatApp apiKey="sk-test" initialMessages={initial} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Previous question');
    expect(frame).toContain('Previous answer');
  });

  it('creates a session and saves messages after a successful exchange', async () => {
    mockSendMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Saved response' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    mockIsToolUseResponse.mockReturnValue(false);

    render(<ChatApp apiKey="sk-test" />);

    await act(async () => {
      capturedOnSubmit!('First message');
    });

    await vi.waitFor(() => {
      // Session should have been created on first submit
      expect(mockCreateSession).toHaveBeenCalledWith(
        fakeDb,
        expect.objectContaining({ model: 'claude-sonnet-4-20250514', title: 'First message' }),
      );
    });

    // Both user and assistant messages should be saved
    await vi.waitFor(() => {
      expect(mockAddMessage).toHaveBeenCalledTimes(2);
    });

    expect(mockAddMessage).toHaveBeenCalledWith(fakeDb, expect.objectContaining({
      session_id: 'sess-001',
      role: 'user',
      display: 'First message',
    }));
    expect(mockAddMessage).toHaveBeenCalledWith(fakeDb, expect.objectContaining({
      session_id: 'sess-001',
      role: 'assistant',
      display: 'Saved response',
    }));
  });

  it('calls onSessionCreated when a new session is auto-created', async () => {
    mockSendMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Hi' }],
      usage: { input_tokens: 50, output_tokens: 20 },
    });
    mockIsToolUseResponse.mockReturnValue(false);

    const onCreated = vi.fn();
    render(<ChatApp apiKey="sk-test" onSessionCreated={onCreated} />);

    await act(async () => {
      capturedOnSubmit!('Hello');
    });

    await vi.waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith('sess-001');
    });
  });

  it('does not crash when session save fails (fail-open)', async () => {
    mockAddMessage.mockImplementation(() => {
      throw new Error('DB write failed');
    });

    mockSendMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Response despite DB failure' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    mockIsToolUseResponse.mockReturnValue(false);

    const { lastFrame } = render(<ChatApp apiKey="sk-test" />);

    await act(async () => {
      capturedOnSubmit!('Test');
    });

    // Chat still works — response is visible
    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('Response despite DB failure');
    });

    // No Error: banner shown — the DB failure is silent
    const frame = lastFrame()!;
    expect(frame).not.toContain('Error:');
  });

  it('does not create a duplicate session on second message', async () => {
    mockSendMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Reply' }],
      usage: { input_tokens: 50, output_tokens: 25 },
    });
    mockIsToolUseResponse.mockReturnValue(false);

    render(<ChatApp apiKey="sk-test" />);

    await act(async () => {
      capturedOnSubmit!('First');
    });

    await vi.waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
    });

    // Second message
    await act(async () => {
      capturedOnSubmit!('Second');
    });

    await vi.waitFor(() => {
      // addMessage called 2 (user+assistant) × 2 messages = 4
      expect(mockAddMessage).toHaveBeenCalledTimes(4);
    });

    // Still only one session created
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
  });

  it('skips session creation when sessionId is provided (resume)', async () => {
    mockSendMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Resumed reply' }],
      usage: { input_tokens: 80, output_tokens: 40 },
    });
    mockIsToolUseResponse.mockReturnValue(false);

    render(<ChatApp apiKey="sk-test" sessionId="existing-session-id" />);

    await act(async () => {
      capturedOnSubmit!('Continue chat');
    });

    await vi.waitFor(() => {
      expect(mockAddMessage).toHaveBeenCalled();
    });

    // Should NOT create a new session — using the provided one
    expect(mockCreateSession).not.toHaveBeenCalled();

    // Messages saved with the provided session ID
    expect(mockAddMessage).toHaveBeenCalledWith(fakeDb, expect.objectContaining({
      session_id: 'existing-session-id',
    }));
  });

  // ── Dashboard integration tests ──────────────────────────────

  it('shows dashboard with token counts after a successful exchange', async () => {
    mockSendMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Answer' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    mockIsToolUseResponse.mockReturnValue(false);

    const { lastFrame } = render(<ChatApp apiKey="sk-test" />);

    await act(async () => {
      capturedOnSubmit!('Question');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('Dashboard');
    });

    const frame = lastFrame()!;
    // Token counts rendered by Dashboard component
    expect(frame).toContain('100');
    expect(frame).toContain('50');
    expect(frame).toContain('150');
  });

  it('accumulates tokens across multiple turns', async () => {
    mockSendMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Reply' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    mockIsToolUseResponse.mockReturnValue(false);

    const { lastFrame } = render(<ChatApp apiKey="sk-test" />);

    // First turn
    await act(async () => {
      capturedOnSubmit!('First');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('150');
    });

    // Second turn — totals should accumulate (200 in, 100 out, 300 total)
    await act(async () => {
      capturedOnSubmit!('Second');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('200');
      expect(frame).toContain('300');
    });
  });

  // ── Keyboard shortcut tests ────────────────────────────────────

  it('Ctrl+D toggles dashboard visibility', async () => {
    // Trigger a message exchange so dashboard has tokens to render
    mockSendMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Reply' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    mockIsToolUseResponse.mockReturnValue(false);

    const { lastFrame, stdin } = render(<ChatApp apiKey="sk-test" />);

    // Send a message to populate dashboard with tokens
    await act(async () => {
      capturedOnSubmit!('Hello');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('Dashboard');
    });

    // Ctrl+D hides dashboard
    await act(async () => {
      stdin.write('\x04'); // Ctrl+D
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).not.toContain('Dashboard');
    });

    // Ctrl+D shows dashboard again
    await act(async () => {
      stdin.write('\x04');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('Dashboard');
    });
  });

  // ── Slash command tests ────────────────────────────────────────

  it('/help shows help overlay', async () => {
    const { lastFrame } = render(<ChatApp apiKey="sk-test" />);

    await act(async () => {
      capturedOnSubmit!('/help');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('Keyboard Shortcuts');
      expect(frame).toContain('Press Escape to close');
    });

    // API should not be called
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('/clear resets message state', async () => {
    // First populate with a message
    mockSendMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Existing reply' }],
      usage: { input_tokens: 50, output_tokens: 25 },
    });
    mockIsToolUseResponse.mockReturnValue(false);

    const { lastFrame } = render(<ChatApp apiKey="sk-test" />);

    await act(async () => {
      capturedOnSubmit!('Hello');
    });

    await vi.waitFor(() => {
      expect(lastFrame()!).toContain('Existing reply');
    });

    // /clear via slash command — verify it's intercepted (no API call)
    await act(async () => {
      capturedOnSubmit!('/clear');
    });

    // Only the initial 'Hello' caused an API call — /clear did not
    expect(mockSendMessage).toHaveBeenCalledTimes(1);

    // After /clear, a new message starts with a fresh conversation
    // This proves messages state was reset, even though Static renders
    // persist in ink's terminal output (ink Static is append-only by design)
    mockSendMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Fresh start' }],
      usage: { input_tokens: 30, output_tokens: 15 },
    });

    await act(async () => {
      capturedOnSubmit!('New question');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('Fresh start');
    });

    // Total API calls: 1 (Hello) + 1 (New question) = 2. /clear was intercepted.
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
  });

  it('unknown slash command shows error message', async () => {
    const { lastFrame } = render(<ChatApp apiKey="sk-test" />);

    await act(async () => {
      capturedOnSubmit!('/xyz');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('[vela]');
      expect(frame).toContain('Unknown command: /xyz');
    });

    // API should not be called
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('/model shows current model', async () => {
    const { lastFrame } = render(<ChatApp apiKey="sk-test" model="claude-sonnet-4-20250514" />);

    await act(async () => {
      capturedOnSubmit!('/model');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('[vela] Model: claude-sonnet-4-20250514');
    });

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('/sessions shows session list', async () => {
    mockListSessions.mockReturnValue([
      { id: 'aaaa-bbbb-cccc-dddd', title: 'My chat', model: 'claude-sonnet-4-20250514', system: null, created_at: '2026-01-01', updated_at: '2026-01-02' },
    ]);

    const { lastFrame } = render(<ChatApp apiKey="sk-test" />);

    await act(async () => {
      capturedOnSubmit!('/sessions');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('[vela] Sessions:');
      expect(frame).toContain('My chat');
    });

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('Escape dismisses help overlay', async () => {
    const { lastFrame, stdin } = render(<ChatApp apiKey="sk-test" />);

    // Show help
    await act(async () => {
      capturedOnSubmit!('/help');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('Keyboard Shortcuts');
    });

    // Escape hides it
    await act(async () => {
      stdin.write('\x1b'); // Escape
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).not.toContain('Keyboard Shortcuts');
    });
  });

  // ── Context reset tests ────────────────────────────────────────

  it('/fresh command triggers context reset and shows summary message', async () => {
    // Pre-populate conversation with enough messages (>= 4)
    const initialConversation = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there' },
      { role: 'user' as const, content: 'Tell me about X' },
      { role: 'assistant' as const, content: 'X is interesting because...' },
    ];

    const { lastFrame } = render(
      <ChatApp apiKey="sk-test" initialConversation={initialConversation} />,
    );

    await act(async () => {
      capturedOnSubmit!('/fresh');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('컨텍스트가 리셋되었습니다');
      expect(frame).toContain('Test summary of conversation');
    });

    // Verify summarizeConversation was called
    expect(mockSummarizeConversation).toHaveBeenCalled();
    expect(mockBuildFreshContext).toHaveBeenCalled();

    // API should NOT be called for the /fresh command itself
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('/fresh on short conversation shows warning', async () => {
    // No initialConversation → empty conversation (< 4 messages)
    const { lastFrame } = render(<ChatApp apiKey="sk-test" />);

    await act(async () => {
      capturedOnSubmit!('/fresh');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('대화가 너무 짧아 요약할 수 없습니다');
    });

    // Summarization should NOT be called
    expect(mockSummarizeConversation).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('auto-trigger fires when token threshold exceeded', async () => {
    // Configure auto-trigger to fire
    mockShouldResetContext.mockReturnValue(true);

    mockSendMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Normal reply' }],
      usage: { input_tokens: 50000, output_tokens: 55000 },
    });
    mockIsToolUseResponse.mockReturnValue(false);

    const { lastFrame } = render(<ChatApp apiKey="sk-test" />);

    await act(async () => {
      capturedOnSubmit!('Test message');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('토큰 사용량이 임계치를 초과하여 자동으로 컨텍스트를 리셋했습니다');
    });

    // Both the normal reply and auto-reset message should be visible
    const frame = lastFrame()!;
    expect(frame).toContain('Normal reply');
    expect(frame).toContain('Test summary of conversation');

    expect(mockShouldResetContext).toHaveBeenCalled();
    expect(mockSummarizeConversation).toHaveBeenCalled();
    expect(mockBuildFreshContext).toHaveBeenCalled();
  });

  // ── Auto-routing tests ─────────────────────────────────────────

  it('/auto toggles auto-routing on and shows Korean status message', async () => {
    const { lastFrame } = render(<ChatApp apiKey="sk-test" />);

    await act(async () => {
      capturedOnSubmit!('/auto');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('[vela] 🔄 자동 라우팅 활성화');
    });

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('/auto toggles off when already on', async () => {
    const { lastFrame } = render(<ChatApp apiKey="sk-test" autoRoute={true} />);

    await act(async () => {
      capturedOnSubmit!('/auto');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('[vela] 🔄 자동 라우팅 비활성화');
    });

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('auto-routing calls selectModel and uses returned model for API call', async () => {
    // selectModel returns haiku (different from default sonnet)
    mockSelectModel.mockReturnValue({ model: 'claude-haiku-4-20250514', reason: 'Auto-routed: simple' });

    mockSendMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Quick reply' }],
      usage: { input_tokens: 30, output_tokens: 15 },
    });
    mockIsToolUseResponse.mockReturnValue(false);

    const { lastFrame } = render(<ChatApp apiKey="sk-test" autoRoute={true} />);

    await act(async () => {
      capturedOnSubmit!('hi');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('Quick reply');
    });

    // Verify selectModel was called
    expect(mockSelectModel).toHaveBeenCalled();

    // Verify sendMessage was called with haiku model
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ model: 'claude-haiku-4-20250514' }),
    );

    // Routing system message should appear
    const frame = lastFrame()!;
    expect(frame).toContain('[vela] 🔄 자동 라우팅: claude-haiku-4-20250514');
  });

  it('auto-routing does NOT show routing message when model stays the same', async () => {
    // selectModel returns the default model (no change)
    mockSelectModel.mockReturnValue({ model: 'claude-sonnet-4-20250514', reason: 'Auto-routed: moderate' });

    mockSendMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Normal reply' }],
      usage: { input_tokens: 50, output_tokens: 25 },
    });
    mockIsToolUseResponse.mockReturnValue(false);

    const { lastFrame } = render(<ChatApp apiKey="sk-test" autoRoute={true} />);

    await act(async () => {
      capturedOnSubmit!('moderate question');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('Normal reply');
    });

    const frame = lastFrame()!;
    expect(frame).not.toContain('자동 라우팅:');
  });

  it('auto-routing is NOT called when autoRoute is off', async () => {
    mockSendMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Reply' }],
      usage: { input_tokens: 50, output_tokens: 25 },
    });
    mockIsToolUseResponse.mockReturnValue(false);

    render(<ChatApp apiKey="sk-test" />);

    await act(async () => {
      capturedOnSubmit!('hello');
    });

    await vi.waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalled();
    });

    // selectModel should NOT be called when auto-routing is off
    expect(mockSelectModel).not.toHaveBeenCalled();
  });

  it('/model sets explicit choice flag, respected by router', async () => {
    // Start with auto-routing on
    mockSelectModel.mockReturnValue({ model: 'claude-opus-4-20250514', reason: 'User choice' });

    mockSendMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Opus reply' }],
      usage: { input_tokens: 80, output_tokens: 40 },
    });
    mockIsToolUseResponse.mockReturnValue(false);

    const { lastFrame } = render(<ChatApp apiKey="sk-test" autoRoute={true} />);

    // User explicitly sets model
    await act(async () => {
      capturedOnSubmit!('/model opus');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('Model switched to: claude-opus-4-20250514');
    });

    // Send a message — selectModel should be called with isExplicit=true
    await act(async () => {
      capturedOnSubmit!('complex code question');
    });

    await vi.waitFor(() => {
      expect(mockSelectModel).toHaveBeenCalled();
    });

    // Fourth argument to selectModel is isExplicitChoice
    const lastCall = mockSelectModel.mock.calls[0]!;
    expect(lastCall[3]).toBe(true);
  });

  it('auto-routing with no budget set works normally', async () => {
    mockSelectModel.mockReturnValue({ model: 'claude-haiku-4-20250514', reason: 'Auto-routed: simple' });

    mockSendMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Budget-free reply' }],
      usage: { input_tokens: 20, output_tokens: 10 },
    });
    mockIsToolUseResponse.mockReturnValue(false);

    const { lastFrame } = render(<ChatApp apiKey="sk-test" autoRoute={true} />);

    await act(async () => {
      capturedOnSubmit!('hi');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('Budget-free reply');
    });

    // Should work fine without budget
    expect(mockSelectModel).toHaveBeenCalled();
  });
});
