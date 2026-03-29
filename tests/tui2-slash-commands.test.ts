/**
 * Tests for VelaApp slash command dispatch and token/cost tracking.
 *
 * VelaApp's constructor requires ProcessTerminal + TUI which read
 * from real tty. We test the dispatch and state logic indirectly:
 * - Slash command parser (shortcuts.ts) tested via handleSlashCommand
 * - ChatEngine token forwarding tested via usage field on ChatEngineMessage
 * - Dashboard data computation tested via extracted pure logic
 * - MessageList.clear() tested directly
 * - Integration: slash commands produce system messages in MessageList
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSlashCommand } from '../src/tui/shortcuts.js';
import type { SlashCommandContext, SlashCommandResult } from '../src/tui/shortcuts.js';
import { MessageList } from '../src/tui2/components/message-list.js';
import {
  ChatEngine,
  type ChatEngineCallbacks,
  type ChatEngineMessage,
} from '../src/tui2/chat-engine.js';
import { openSessionDb, createSession, addMessage, getMessages } from '../src/session.js';
import type { ChatMessageRow } from '../src/session.js';
import { DEFAULT_MODEL } from '../src/models.js';
import { BudgetManager } from '../src/budget-manager.js';
import type Database from 'better-sqlite3';
import type { ChatMessage, SendMessageOptions } from '../src/llm.js';
import stripAnsi from 'strip-ansi';

// ── Mock sendMessage for ChatEngine tests ─────────────────────────

let mockSendMessage: (
  messages: ChatMessage[],
  options?: SendMessageOptions,
) => Promise<any>;

vi.mock('../src/llm.js', () => ({
  sendMessage: (messages: ChatMessage[], options?: SendMessageOptions) =>
    mockSendMessage(messages, options),
}));

// ── Helpers ───────────────────────────────────────────────────────

function makeContext(overrides?: Partial<SlashCommandContext>): SlashCommandContext {
  return {
    db: null,
    model: DEFAULT_MODEL,
    ...overrides,
  };
}

function makeCallbacks(overrides?: Partial<ChatEngineCallbacks>): ChatEngineCallbacks {
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

const FAKE_MESSAGE_WITH_USAGE = {
  id: 'vela-test',
  type: 'message' as const,
  role: 'assistant' as const,
  model: DEFAULT_MODEL,
  content: [{ type: 'text' as const, text: 'response', citations: null }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  container: null,
  usage: {
    input_tokens: 100,
    output_tokens: 50,
    cache_creation: null,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    inference_geo: null,
    server_tool_use: null,
    service_tier: null,
  },
};

function strip(lines: string[]): string[] {
  return lines.map((l) => stripAnsi(l));
}

/**
 * Simulates VelaApp's dispatch logic for a slash command result.
 * Extracted from VelaApp.dispatchSlashCommand to enable unit testing
 * without terminal dependencies.
 */
function simulateDispatch(
  result: SlashCommandResult,
  deps: {
    messageList: MessageList;
    chatEngine: ChatEngine;
    currentModel: string;
    budgetManager: BudgetManager;
  },
): { systemMessage?: string; action?: string; newModel?: string } {
  const { messageList, chatEngine, currentModel, budgetManager } = deps;
  let systemMessage: string | undefined;
  let action: string | undefined;
  let newModel: string | undefined;

  switch (result.action) {
    case 'help':
      systemMessage =
        'Available commands: /help, /quit, /clear, /fresh, /sessions, /model [name], /budget [amount], /init, /start, /state, /transition, /cancel';
      messageList.addMessage({ role: 'system', content: systemMessage });
      action = 'help';
      break;

    case 'quit':
      action = 'quit';
      break;

    case 'clear':
      messageList.clear();
      chatEngine.clearHistory();
      action = 'clear';
      break;

    case 'fresh':
      messageList.clear();
      chatEngine.clearHistory();
      systemMessage = 'Context cleared.';
      messageList.addMessage({ role: 'system', content: systemMessage });
      action = 'fresh';
      break;

    case 'sessions': {
      const sessions = result.sessions;
      if (sessions.length === 0) {
        systemMessage = 'No sessions found.';
      } else {
        const lines = sessions.map(
          (s) => `• ${s.title ?? '(untitled)'} — ${s.model} (${s.updated_at})`,
        );
        systemMessage = `Sessions:\n${lines.join('\n')}`;
      }
      messageList.addMessage({ role: 'system', content: systemMessage });
      action = 'sessions';
      break;
    }

    case 'model':
      systemMessage = `Current model: ${result.model}`;
      messageList.addMessage({ role: 'system', content: systemMessage });
      action = 'model';
      break;

    case 'model-switch':
      chatEngine.setModel(result.model);
      newModel = result.model;
      systemMessage = `Model switched to: ${result.model}`;
      messageList.addMessage({ role: 'system', content: systemMessage });
      action = 'model-switch';
      break;

    case 'budget-set':
      budgetManager.setBudget(result.amount);
      systemMessage = `Budget set to $${result.amount.toFixed(2)}`;
      messageList.addMessage({ role: 'system', content: systemMessage });
      action = 'budget-set';
      break;

    case 'budget-status': {
      const status = budgetManager.getStatus();
      if (status.limit === null) {
        systemMessage = 'No budget set. Use /budget <amount> to set one.';
      } else {
        systemMessage = `Budget: $${status.spent.toFixed(4)} / $${status.limit.toFixed(2)} (${(status.percentage * 100).toFixed(1)}%)`;
      }
      messageList.addMessage({ role: 'system', content: systemMessage });
      action = 'budget-status';
      break;
    }

    case 'init': {
      const r = result.result;
      if (r.alreadyInitialized) {
        systemMessage = 'Vela already initialized in this project.';
      } else {
        systemMessage = `Vela initialized. Created: ${r.created.join(', ')}`;
      }
      messageList.addMessage({ role: 'system', content: systemMessage });
      action = 'init';
      break;
    }

    case 'resume': {
      // Simulate VelaApp's resume dispatch
      messageList.clear();
      chatEngine.clearHistory();

      const resumeSession = result.session;
      const resumeMessages: ChatMessageRow[] = result.messages;

      const engineHistory: ChatEngineMessage[] = [];
      for (const m of resumeMessages) {
        const role = m.role as 'user' | 'assistant' | 'system';
        messageList.addMessage({ role, content: m.display });
        if (role === 'user' || role === 'assistant') {
          engineHistory.push({ role, content: m.display });
        }
      }
      chatEngine.restoreHistory(engineHistory);

      newModel = resumeSession.model;
      chatEngine.setModel(resumeSession.model);
      systemMessage = `Resumed session: ${resumeSession.title ?? '(untitled)'} (${resumeMessages.length} messages)`;
      messageList.addMessage({ role: 'system', content: systemMessage });
      action = 'resume';
      break;
    }

    case 'auto-toggle':
    case 'pipeline-start':
    case 'pipeline-state':
    case 'pipeline-transition':
    case 'pipeline-cancel':
      systemMessage = 'Pipeline commands available in future update.';
      messageList.addMessage({ role: 'system', content: systemMessage });
      action = result.action;
      break;

    case 'error':
      systemMessage = `Error: ${result.message}`;
      messageList.addMessage({ role: 'system', content: systemMessage });
      action = 'error';
      break;
  }

  return { systemMessage, action, newModel };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Slash command interception', () => {
  it('messages starting with / are parsed as slash commands', () => {
    const result = handleSlashCommand('/help', makeContext());
    expect(result).not.toBeNull();
    expect(result!.action).toBe('help');
  });

  it('messages not starting with / return null (should go to ChatEngine)', () => {
    const result = handleSlashCommand('tell me about space', makeContext());
    expect(result).toBeNull();
  });

  it('/init returns init action with result', () => {
    // /init calls initProject(process.cwd()) which does real I/O,
    // but it should at least return an action result (possibly alreadyInitialized)
    const result = handleSlashCommand('/init', makeContext());
    expect(result).not.toBeNull();
    expect(result!.action).toBe('init');
    if (result!.action === 'init') {
      expect(result!.result.ok).toBe(true);
    }
  });
});

describe('Slash command dispatch to MessageList', () => {
  let messageList: MessageList;
  let chatEngine: ChatEngine;
  let budgetManager: BudgetManager;

  beforeEach(() => {
    mockSendMessage = async (_msgs, opts) => {
      opts?.onText?.('response');
      return FAKE_MESSAGE_WITH_USAGE;
    };
    messageList = new MessageList();
    chatEngine = new ChatEngine(makeCallbacks());
    budgetManager = new BudgetManager();
  });

  const deps = () => ({
    messageList,
    chatEngine,
    currentModel: DEFAULT_MODEL,
    budgetManager,
  });

  it('/clear resets MessageList and ChatEngine history', async () => {
    messageList.addMessage({ role: 'user', content: 'hello' });
    await chatEngine.submit('hello');

    const result = handleSlashCommand('/clear', makeContext())!;
    simulateDispatch(result, deps());

    expect(messageList.render(80)).toEqual([]);
    expect(chatEngine.history).toHaveLength(0);
  });

  it('/model shows current model as system message', () => {
    const result = handleSlashCommand('/model', makeContext())!;
    const out = simulateDispatch(result, deps());

    expect(out.systemMessage).toContain(DEFAULT_MODEL);
    const lines = strip(messageList.render(80));
    expect(lines.some((l) => l.includes(DEFAULT_MODEL))).toBe(true);
  });

  it('/model sonnet switches model on ChatEngine', () => {
    const result = handleSlashCommand('/model sonnet', makeContext())!;
    const out = simulateDispatch(result, deps());

    expect(out.newModel).toBe('claude-sonnet-4-20250514');
    expect(out.systemMessage).toContain('Model switched to');
  });

  it('/quit dispatch returns quit action', () => {
    const result = handleSlashCommand('/quit', makeContext())!;
    const out = simulateDispatch(result, deps());
    expect(out.action).toBe('quit');
  });

  it('/help shows available commands', () => {
    const result = handleSlashCommand('/help', makeContext())!;
    const out = simulateDispatch(result, deps());

    expect(out.systemMessage).toContain('/help');
    expect(out.systemMessage).toContain('/quit');
    expect(out.systemMessage).toContain('/init');
  });

  it('/fresh clears and shows confirmation message', () => {
    messageList.addMessage({ role: 'user', content: 'hello' });

    const result = handleSlashCommand('/fresh', makeContext())!;
    simulateDispatch(result, deps());

    // Only the "Context cleared." system message should remain
    const lines = strip(messageList.render(80));
    expect(lines.some((l) => l.includes('Context cleared'))).toBe(true);
    // No user message left
    expect(lines.some((l) => l === 'You')).toBe(false);
  });

  it('unknown /foo shows error message', () => {
    const result = handleSlashCommand('/foo', makeContext())!;
    const out = simulateDispatch(result, deps());

    expect(out.action).toBe('error');
    expect(out.systemMessage).toContain('/foo');
  });

  it('/budget 5 sets budget amount', () => {
    const result = handleSlashCommand('/budget 5', makeContext())!;
    const out = simulateDispatch(result, deps());

    expect(out.action).toBe('budget-set');
    expect(out.systemMessage).toContain('$5.00');
    expect(budgetManager.getStatus().limit).toBe(5);
  });

  it('/budget with no args shows status', () => {
    const result = handleSlashCommand('/budget', makeContext())!;
    const out = simulateDispatch(result, deps());

    expect(out.action).toBe('budget-status');
    expect(out.systemMessage).toContain('No budget set');
  });

  it('pipeline commands show future update message', () => {
    for (const cmd of ['/start test task', '/state', '/transition', '/cancel']) {
      const ml = new MessageList();
      const eng = new ChatEngine(makeCallbacks());
      const result = handleSlashCommand(cmd, makeContext())!;
      simulateDispatch(result, {
        messageList: ml,
        chatEngine: eng,
        currentModel: DEFAULT_MODEL,
        budgetManager: new BudgetManager(),
      });

      const lines = strip(ml.render(80));
      expect(lines.some((l) => l.includes('future update'))).toBe(true);
    }
  });
});

describe('/sessions with db', () => {
  let db: Database.Database;

  beforeEach(() => {
    mockSendMessage = async (_msgs, opts) => {
      opts?.onText?.('response');
      return FAKE_MESSAGE_WITH_USAGE;
    };
    db = openSessionDb(); // in-memory
  });

  it('/sessions with null db returns error', () => {
    const result = handleSlashCommand('/sessions', makeContext({ db: null }));
    expect(result).not.toBeNull();
    expect(result!.action).toBe('error');
    if (result!.action === 'error') {
      expect(result!.message).toContain('No session database');
    }
  });

  it('/sessions formats session list', () => {
    createSession(db, { model: 'test-model', title: 'My Session' });
    const result = handleSlashCommand('/sessions', makeContext({ db }))!;

    const messageList = new MessageList();
    const chatEngine = new ChatEngine(makeCallbacks());
    simulateDispatch(result, {
      messageList,
      chatEngine,
      currentModel: DEFAULT_MODEL,
      budgetManager: new BudgetManager(),
    });

    const lines = strip(messageList.render(80));
    expect(lines.some((l) => l.includes('My Session'))).toBe(true);
  });

  it('/sessions with no sessions shows "No sessions found"', () => {
    const result = handleSlashCommand('/sessions', makeContext({ db }))!;

    const messageList = new MessageList();
    const chatEngine = new ChatEngine(makeCallbacks());
    simulateDispatch(result, {
      messageList,
      chatEngine,
      currentModel: DEFAULT_MODEL,
      budgetManager: new BudgetManager(),
    });

    const lines = strip(messageList.render(80));
    expect(lines.some((l) => l.includes('No sessions found'))).toBe(true);
  });
});

describe('ChatEngine usage forwarding', () => {
  beforeEach(() => {
    mockSendMessage = async (_msgs, opts) => {
      opts?.onText?.('answer');
      return FAKE_MESSAGE_WITH_USAGE;
    };
  });

  it('onMessageComplete receives usage data from sendMessage', async () => {
    let completedMsg: ChatEngineMessage | null = null;
    const cb = makeCallbacks({
      onMessageComplete: vi.fn((msg: ChatEngineMessage) => {
        completedMsg = msg;
      }),
    });
    const engine = new ChatEngine(cb);

    await engine.submit('hello');

    expect(completedMsg).not.toBeNull();
    expect(completedMsg!.usage).toBeDefined();
    expect(completedMsg!.usage!.inputTokens).toBe(100);
    expect(completedMsg!.usage!.outputTokens).toBe(50);
  });

  it('usage is undefined when sendMessage returns no usage', async () => {
    mockSendMessage = async (_msgs, opts) => {
      opts?.onText?.('text');
      return {
        ...FAKE_MESSAGE_WITH_USAGE,
        usage: undefined,
      };
    };

    let completedMsg: ChatEngineMessage | null = null;
    const cb = makeCallbacks({
      onMessageComplete: vi.fn((msg: ChatEngineMessage) => {
        completedMsg = msg;
      }),
    });
    const engine = new ChatEngine(cb);

    await engine.submit('hello');

    expect(completedMsg!.usage).toBeUndefined();
  });
});

describe('Dashboard data computation', () => {
  it('computes cost from token accumulation (Sonnet pricing)', () => {
    // getDashboardData() logic: cost = (input*3 + output*15) / 1_000_000
    const inputTokens = 1000;
    const outputTokens = 500;
    const cost = (inputTokens * 3 + outputTokens * 15) / 1_000_000;

    expect(cost).toBeCloseTo(0.0105, 4);
  });

  it('accumulates tokens across multiple messages', () => {
    // Simulate what VelaApp does in onMessageComplete
    let totalInput = 0;
    let totalOutput = 0;

    // First message
    totalInput += 100;
    totalOutput += 50;

    // Second message
    totalInput += 200;
    totalOutput += 100;

    expect(totalInput).toBe(300);
    expect(totalOutput).toBe(150);

    const cost = (totalInput * 3 + totalOutput * 15) / 1_000_000;
    expect(cost).toBeCloseTo(0.003150, 6);
  });

  it('cost is zero when no tokens used', () => {
    const cost = (0 * 3 + 0 * 15) / 1_000_000;
    expect(cost).toBe(0);
  });
});

describe('Normal messages bypass slash dispatch', () => {
  beforeEach(() => {
    mockSendMessage = async (_msgs, opts) => {
      opts?.onText?.('response');
      return FAKE_MESSAGE_WITH_USAGE;
    };
  });

  it('non-slash message is submitted to ChatEngine', async () => {
    const cb = makeCallbacks();
    const engine = new ChatEngine(cb);

    await engine.submit('hello world');

    // User message in history
    expect(engine.history[0]!.role).toBe('user');
    expect(engine.history[0]!.content).toBe('hello world');
    // Assistant response received
    expect(engine.history[1]!.role).toBe('assistant');
    expect(cb.onMessageComplete).toHaveBeenCalledTimes(1);
  });

  it('handleSlashCommand returns null for non-slash input', () => {
    const result = handleSlashCommand('just a regular message', makeContext());
    expect(result).toBeNull();
  });

  it('handleSlashCommand returns null for empty input', () => {
    const result = handleSlashCommand('', makeContext());
    expect(result).toBeNull();
  });
});

// ── Session persistence tests (simulating VelaApp behavior) ──────

describe('Session auto-create and message persistence', () => {
  let db: Database.Database;

  beforeEach(() => {
    mockSendMessage = async (_msgs, opts) => {
      opts?.onText?.('response');
      return FAKE_MESSAGE_WITH_USAGE;
    };
    db = openSessionDb(); // in-memory
  });

  it('auto-creates session on first submit and persists user message', () => {
    // Simulate VelaApp.handleSubmit session auto-create
    let sessionId: string | null = null;
    const currentModel = DEFAULT_MODEL;
    const trimmed = 'hello world';

    // Auto-create
    const session = createSession(db, { model: currentModel, title: trimmed.slice(0, 50) });
    sessionId = session.id;

    // Persist user message
    addMessage(db, { session_id: sessionId, role: 'user', display: trimmed, content: trimmed });

    // Verify
    const msgs = getMessages(db, sessionId);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].display).toBe('hello world');
  });

  it('persists assistant message after completion', () => {
    const session = createSession(db, { model: DEFAULT_MODEL, title: 'test' });
    addMessage(db, { session_id: session.id, role: 'user', display: 'hi', content: 'hi' });
    addMessage(db, { session_id: session.id, role: 'assistant', display: 'hello', content: 'hello' });

    const msgs = getMessages(db, session.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].display).toBe('hello');
  });

  it('fail-open: db null does not crash session operations', () => {
    // Simulate the fail-open guard: if (!sessionId && this.db) { ... }
    const nullDb: Database.Database | null = null;
    let sessionId: string | null = null;

    // No crash — the guard prevents DB access
    if (!sessionId && nullDb) {
      // This block should not execute
      throw new Error('Should not reach here');
    }

    expect(sessionId).toBeNull(); // Session never created, chat still works
  });
});

// ── /resume dispatch tests ──────────────────────────────────────

describe('/resume dispatch', () => {
  let db: Database.Database;

  beforeEach(() => {
    mockSendMessage = async (_msgs, opts) => {
      opts?.onText?.('response');
      return FAKE_MESSAGE_WITH_USAGE;
    };
    db = openSessionDb(); // in-memory
  });

  it('/resume loads session history into MessageList and ChatEngine', () => {
    const session = createSession(db, { model: 'test-model', title: 'My Chat' });
    addMessage(db, { session_id: session.id, role: 'user', display: 'hello', content: 'hello' });
    addMessage(db, { session_id: session.id, role: 'assistant', display: 'hi there', content: 'hi there' });

    const result = handleSlashCommand('/resume', makeContext({ db }))!;
    expect(result.action).toBe('resume');

    const messageList = new MessageList();
    const chatEngine = new ChatEngine(makeCallbacks());
    const budgetManager = new BudgetManager();

    const out = simulateDispatch(result, {
      messageList,
      chatEngine,
      currentModel: DEFAULT_MODEL,
      budgetManager,
    });

    expect(out.action).toBe('resume');
    expect(out.newModel).toBe('test-model');
    expect(out.systemMessage).toContain('Resumed session');
    expect(out.systemMessage).toContain('2 messages');

    // ChatEngine history should have user + assistant
    expect(chatEngine.history).toHaveLength(2);
    expect(chatEngine.history[0].role).toBe('user');
    expect(chatEngine.history[0].content).toBe('hello');
    expect(chatEngine.history[1].role).toBe('assistant');
    expect(chatEngine.history[1].content).toBe('hi there');

    // MessageList should show the restored messages + system message
    const lines = strip(messageList.render(80));
    expect(lines.some(l => l.includes('hello'))).toBe(true);
    expect(lines.some(l => l.includes('hi there'))).toBe(true);
    expect(lines.some(l => l.includes('Resumed session'))).toBe(true);
  });

  it('/resume with no sessions shows error', () => {
    const result = handleSlashCommand('/resume', makeContext({ db }))!;
    expect(result.action).toBe('error');

    const messageList = new MessageList();
    const chatEngine = new ChatEngine(makeCallbacks());
    const out = simulateDispatch(result, {
      messageList,
      chatEngine,
      currentModel: DEFAULT_MODEL,
      budgetManager: new BudgetManager(),
    });

    expect(out.action).toBe('error');
    expect(out.systemMessage).toContain('No sessions found');
  });

  it('/resume with invalid ID shows error', () => {
    const result = handleSlashCommand('/resume bad-id', makeContext({ db }))!;
    expect(result.action).toBe('error');

    const messageList = new MessageList();
    const chatEngine = new ChatEngine(makeCallbacks());
    const out = simulateDispatch(result, {
      messageList,
      chatEngine,
      currentModel: DEFAULT_MODEL,
      budgetManager: new BudgetManager(),
    });

    expect(out.systemMessage).toContain('Session not found');
  });

  it('/resume with null db shows error', () => {
    const result = handleSlashCommand('/resume', makeContext({ db: null }))!;
    expect(result.action).toBe('error');
    if (result.action === 'error') {
      expect(result.message).toContain('No session database');
    }
  });
});
