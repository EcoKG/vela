import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { act } from 'react';

// ── Captured callback (K009) ─────────────────────────────────

let capturedOnSubmit: ((text: string) => void) | null = null;
let capturedIsStreaming = false;

vi.mock('../src/tui/ChatInput.js', () => ({
  ChatInput: ({ onSubmit, isStreaming }: { onSubmit: (text: string) => void; isStreaming?: boolean }) => {
    capturedOnSubmit = onSubmit;
    capturedIsStreaming = !!isStreaming;
    return <Text>{isStreaming ? '[streaming]' : '> '}</Text>;
  },
}));

// ── Claude/tool mocks (same as tui-chatapp) ─────────────────

const mockSendMessage = vi.fn();
const mockExtractToolUseBlocks = vi.fn();
const mockIsToolUseResponse = vi.fn();
const mockExecuteTool = vi.fn();

vi.mock('../src/claude-client.js', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  extractToolUseBlocks: (...args: unknown[]) => mockExtractToolUseBlocks(...args),
  isToolUseResponse: (...args: unknown[]) => mockIsToolUseResponse(...args),
}));

vi.mock('../src/tool-engine.js', () => ({
  executeTool: (...args: unknown[]) => mockExecuteTool(...args),
  executeToolsParallel: async (blocks: Array<{ name: string; id: string; input: Record<string, unknown> }>, ctx?: unknown) => {
    const results = [];
    for (const block of blocks) {
      const { result, is_error } = await mockExecuteTool(block.name, block.input, ctx);
      results.push({ type: 'tool_result' as const, tool_use_id: block.id, content: result as string, is_error: !!is_error });
    }
    return results;
  },
  TOOL_DEFINITIONS: [],
}));

vi.mock('../src/governance/index.js', () => ({
  buildGateContext: () => ({ mode: 'read', velaDir: '/tmp/.vela', artifactDir: '/tmp/artifacts' }),
  RetryBudget: class MockRetryBudget {
    shouldTerminate() { return { terminate: false }; }
  },
  DEFAULT_RETRY_BUDGET: 3,
}));

// Session mocks
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
vi.mock('../src/context-manager.js', () => ({
  shouldResetContext: () => false,
  summarizeConversation: vi.fn().mockResolvedValue('summary'),
  buildFreshContext: vi.fn().mockReturnValue([]),
}));

// Model router mock
const mockSelectModel = vi.fn();
vi.mock('../src/model-router.js', () => ({
  selectModel: (...args: unknown[]) => mockSelectModel(...args),
}));

// ── Pipeline-specific mocks (K006) ──────────────────────────

// runPipeline mock via globalThis indirection
vi.mock('../src/pipeline-orchestrator.js', () => ({
  runPipeline: (...args: unknown[]) => (globalThis as Record<string, unknown>).__mockRunPipeline(...(args as [unknown, unknown])),
}));

// cancelPipeline mock via globalThis indirection
const mockInitPipeline = vi.fn();
const mockGetPipelineState = vi.fn();
vi.mock('../src/pipeline.js', () => ({
  initPipeline: (...args: unknown[]) => mockInitPipeline(...args),
  getPipelineState: (...args: unknown[]) => mockGetPipelineState(...args),
  transitionPipeline: vi.fn().mockReturnValue({ ok: true }),
  cancelPipeline: (...args: unknown[]) => (globalThis as Record<string, unknown>).__mockCancelPipeline(...args),
}));

// config.js — findProjectRoot
const mockFindProjectRoot = vi.fn();
vi.mock('../src/config.js', () => ({
  findProjectRoot: (...args: unknown[]) => mockFindProjectRoot(...args),
}));

// state.js — openStateDb
const mockOpenStateDb = vi.fn();
vi.mock('../src/state.js', () => ({
  openStateDb: (...args: unknown[]) => mockOpenStateDb(...args),
}));

// db.js — closeDb
const mockCloseDb = vi.fn();
vi.mock('../src/db.js', () => ({
  closeDb: (...args: unknown[]) => mockCloseDb(...args),
}));

// ── Import after mocks ──────────────────────────────────────

import { ChatApp } from '../src/tui/ChatApp.js';

// ── Tests ────────────────────────────────────────────────────

describe('Pipeline TUI integration', () => {
  const fakeDb = { close: vi.fn(), exec: vi.fn(), prepare: vi.fn() };
  const fakeSessionDb = { close: vi.fn() };

  beforeEach(() => {
    capturedOnSubmit = null;
    capturedIsStreaming = false;

    // Reset all mocks
    mockSendMessage.mockReset();
    mockExtractToolUseBlocks.mockReset();
    mockIsToolUseResponse.mockReset();
    mockExecuteTool.mockReset();
    mockSelectModel.mockReset();
    mockSelectModel.mockReturnValue({ model: 'claude-sonnet-4-20250514', reason: 'default' });

    // Session mocks
    mockOpenSessionDb.mockReset();
    mockCreateSession.mockReset();
    mockAddMessage.mockReset();
    mockUpdateSession.mockReset();
    mockListSessions.mockReset();
    fakeSessionDb.close.mockReset();
    mockOpenSessionDb.mockReturnValue(fakeSessionDb);
    mockCreateSession.mockReturnValue({ id: 'sess-pipe', title: 'Pipeline test', model: 'claude-sonnet-4-20250514', system: null, created_at: '', updated_at: '' });

    // Pipeline mocks
    mockFindProjectRoot.mockReset();
    mockFindProjectRoot.mockReturnValue('/tmp/test-project');
    mockOpenStateDb.mockReset();
    fakeDb.close.mockReset();
    fakeDb.exec.mockReset();
    fakeDb.prepare.mockReset();
    mockOpenStateDb.mockReturnValue(fakeDb);
    mockCloseDb.mockReset();
    mockInitPipeline.mockReset();
    mockGetPipelineState.mockReset();

    // Default runPipeline mock — resolves immediately with success
    (globalThis as Record<string, unknown>).__mockRunPipeline = vi.fn().mockResolvedValue({
      ok: true,
      steps: [{ stage: 'research', output: 'researched', toolCalls: 3 }],
      pipelineId: 'p-test-1',
    });

    // Default cancelPipeline mock
    (globalThis as Record<string, unknown>).__mockCancelPipeline = vi.fn().mockReturnValue({ ok: true });
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__mockRunPipeline;
    delete (globalThis as Record<string, unknown>).__mockCancelPipeline;
  });

  // ── Test 1: /start triggers runPipeline ────────────────────

  it('/start triggers runPipeline() with correct options', async () => {
    const mockRun = vi.fn().mockResolvedValue({
      ok: true,
      steps: [{ stage: 'research', output: 'done', toolCalls: 2 }],
      pipelineId: 'p1',
    });
    (globalThis as Record<string, unknown>).__mockRunPipeline = mockRun;

    render(<ChatApp provider={{ type: 'api', apiKey: 'test-key' }} />);

    await act(async () => {
      capturedOnSubmit!('/start implement feature X');
    });

    // Wait for runPipeline to be called
    await vi.waitFor(() => {
      expect(mockRun).toHaveBeenCalledTimes(1);
    });

    const [request, options] = mockRun.mock.calls[0] as [string, Record<string, unknown>];
    expect(request).toBe('implement feature X');
    expect(options).toHaveProperty('db');
    expect(options).toHaveProperty('cwd', '/tmp/test-project');
    expect(options).toHaveProperty('callbacks');
  });

  // ── Test 2: Callbacks produce messages ─────────────────────

  it('pipeline callbacks produce stage messages in chat', async () => {
    const mockRun = vi.fn().mockImplementation(async (_req: string, opts: { callbacks?: { onStepStart?: (s: string) => void; onStepComplete?: (s: string, r: { stage: string; output: string; toolCalls: number }) => void } }) => {
      // Simulate callback sequence
      opts.callbacks?.onStepStart?.('research');
      opts.callbacks?.onStepComplete?.('research', { stage: 'research', output: 'findings', toolCalls: 3 });
      opts.callbacks?.onStepStart?.('plan');
      opts.callbacks?.onStepComplete?.('plan', { stage: 'plan', output: 'planned', toolCalls: 5 });
      return { ok: true, steps: [{ stage: 'research', output: 'findings', toolCalls: 3 }, { stage: 'plan', output: 'planned', toolCalls: 5 }], pipelineId: 'p2' };
    });
    (globalThis as Record<string, unknown>).__mockRunPipeline = mockRun;

    const { lastFrame } = render(<ChatApp provider={{ type: 'api', apiKey: 'test-key' }} />);

    await act(async () => {
      capturedOnSubmit!('/start build login');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('[research] 시작');
    });

    const frame = lastFrame()!;
    expect(frame).toContain('[research] 완료');
    expect(frame).toContain('[plan] 시작');
    expect(frame).toContain('[plan] 완료');
  });

  // ── Test 3: CLI provider can now run /start (unified path) ───

  it('CLI provider runs /start via unified path (no API guard)', async () => {
    const mockRun = vi.fn().mockResolvedValue({
      ok: true,
      steps: [{ stage: 'research', output: 'researched', toolCalls: 1 }],
      pipelineId: 'p-cli-1',
    });
    (globalThis as Record<string, unknown>).__mockRunPipeline = mockRun;

    const { lastFrame } = render(<ChatApp provider={{ type: 'cli' }} />);

    await act(async () => {
      capturedOnSubmit!('/start do something');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('파이프라인 시작');
    });

    // runPipeline SHOULD have been called (no CLI guard)
    await vi.waitFor(() => {
      expect(mockRun).toHaveBeenCalled();
    });
  });

  // ── Test 4: /cancel during active pipeline ─────────────────

  it('/cancel during active pipeline calls cancelPipeline', async () => {
    const mockCancel = vi.fn().mockReturnValue({ ok: true });
    (globalThis as Record<string, unknown>).__mockCancelPipeline = mockCancel;

    // runPipeline hangs (never resolves) to simulate active pipeline
    let resolvePipeline!: (v: unknown) => void;
    const hangingPipeline = new Promise((resolve) => { resolvePipeline = resolve; });
    const mockRun = vi.fn().mockReturnValue(hangingPipeline);
    (globalThis as Record<string, unknown>).__mockRunPipeline = mockRun;

    const { lastFrame } = render(<ChatApp provider={{ type: 'api', apiKey: 'test-key' }} />);

    // Start pipeline
    await act(async () => {
      capturedOnSubmit!('/start task');
    });

    // Wait for pipeline to be running
    await vi.waitFor(() => {
      expect(mockRun).toHaveBeenCalledTimes(1);
    });

    // Cancel it
    await act(async () => {
      capturedOnSubmit!('/cancel');
    });

    await vi.waitFor(() => {
      expect(mockCancel).toHaveBeenCalledTimes(1);
    });

    const frame = lastFrame()!;
    expect(frame).toContain('취소되었습니다');

    // Clean up hanging promise
    resolvePipeline({ ok: false, error: 'cancelled', steps: [] });
  });

  // ── Test 5: Concurrent pipeline start shows error ──────────

  it('concurrent /start shows already-running error', async () => {
    // First runPipeline hangs
    let resolvePipeline!: (v: unknown) => void;
    const hangingPipeline = new Promise((resolve) => { resolvePipeline = resolve; });
    const mockRun = vi.fn().mockReturnValue(hangingPipeline);
    (globalThis as Record<string, unknown>).__mockRunPipeline = mockRun;

    const { lastFrame } = render(<ChatApp provider={{ type: 'api', apiKey: 'test-key' }} />);

    // Start first pipeline
    await act(async () => {
      capturedOnSubmit!('/start task1');
    });

    await vi.waitFor(() => {
      expect(mockRun).toHaveBeenCalledTimes(1);
    });

    // Attempt second pipeline start
    await act(async () => {
      capturedOnSubmit!('/start task2');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('이미 실행 중');
    });

    // runPipeline should only have been called once
    expect(mockRun).toHaveBeenCalledTimes(1);

    // Clean up
    resolvePipeline({ ok: false, error: 'cancelled', steps: [] });
  });

  // ── Test 6: Pipeline completion shows summary ──────────────

  it('pipeline completion shows summary with stage/tool counts', async () => {
    const mockRun = vi.fn().mockResolvedValue({
      ok: true,
      steps: [
        { stage: 'research', output: 'findings', toolCalls: 3 },
        { stage: 'plan', output: 'planned', toolCalls: 5 },
      ],
      pipelineId: 'p-summary',
    });
    (globalThis as Record<string, unknown>).__mockRunPipeline = mockRun;

    const { lastFrame } = render(<ChatApp provider={{ type: 'api', apiKey: 'test-key' }} />);

    await act(async () => {
      capturedOnSubmit!('/start build feature');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('파이프라인 완료');
      expect(frame).toContain('2단계');
      expect(frame).toContain('8회'); // 3 + 5 tool calls
    });
  });

  // ── Test 7: Pipeline failure shows error ───────────────────

  it('pipeline failure shows error message', async () => {
    const mockRun = vi.fn().mockResolvedValue({
      ok: false,
      error: 'Stage research failed: timeout',
      steps: [],
    });
    (globalThis as Record<string, unknown>).__mockRunPipeline = mockRun;

    const { lastFrame } = render(<ChatApp provider={{ type: 'api', apiKey: 'test-key' }} />);

    await act(async () => {
      capturedOnSubmit!('/start build feature');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('파이프라인 실패');
      expect(frame).toContain('timeout');
    });
  });

  // ── Test 8: Pipeline exception shows error ─────────────────

  it('runPipeline rejection shows error in chat', async () => {
    const mockRun = vi.fn().mockRejectedValue(new Error('Network error'));
    (globalThis as Record<string, unknown>).__mockRunPipeline = mockRun;

    const { lastFrame } = render(<ChatApp provider={{ type: 'api', apiKey: 'test-key' }} />);

    await act(async () => {
      capturedOnSubmit!('/start build feature');
    });

    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('파이프라인 오류');
      expect(frame).toContain('Network error');
    });
  });
});
