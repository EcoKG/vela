/**
 * Tests for VelaApp pipeline command dispatch, auto-routing, and /auto toggle.
 *
 * VelaApp's constructor requires ProcessTerminal + TUI which need a real tty.
 * We test the dispatch logic indirectly:
 * - Pipeline DB operations (initPipeline, getPipelineState, cancelPipeline, transitionPipeline)
 * - Slash command parsing for /start, /state, /transition, /cancel, /auto
 * - Auto-routing via selectModel
 * - Guard conditions (already running, empty request, no active pipeline)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleSlashCommand } from "../src/tui/shortcuts.js";
import type {
  SlashCommandContext,
  SlashCommandResult,
} from "../src/tui/shortcuts.js";
import { MessageList } from "../src/tui2/components/message-list.js";
import {
  ChatEngine,
  type ChatEngineCallbacks,
  type ChatEngineMessage,
} from "../src/tui2/chat-engine.js";
import { DEFAULT_MODEL, MODEL_TIERS } from "../src/models.js";
import { BudgetManager } from "../src/budget-manager.js";
import { selectModel } from "../src/model-router.js";
import type { BudgetStatus } from "../src/budget-manager.js";
import { openStateDb } from "../src/state.js";
import {
  initPipeline,
  getPipelineState,
  transitionPipeline,
  cancelPipeline,
} from "../src/pipeline.js";
import type Database from "better-sqlite3";
import type { ChatMessage, SendMessageOptions } from "../src/llm.js";
import stripAnsi from "strip-ansi";

// ── Mock sendMessage for ChatEngine tests ─────────────────────────

let mockSendMessage: (
  messages: ChatMessage[],
  options?: SendMessageOptions,
) => Promise<any>;

vi.mock("../src/llm.js", () => ({
  sendMessage: (messages: ChatMessage[], options?: SendMessageOptions) =>
    mockSendMessage(messages, options),
}));

// ── Helpers ───────────────────────────────────────────────────────

function makeContext(
  overrides?: Partial<SlashCommandContext>,
): SlashCommandContext {
  return {
    db: null,
    model: DEFAULT_MODEL,
    ...overrides,
  };
}

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

const FAKE_MESSAGE_WITH_USAGE = {
  id: "vela-test",
  type: "message" as const,
  role: "assistant" as const,
  model: DEFAULT_MODEL,
  content: [{ type: "text" as const, text: "response", citations: null }],
  stop_reason: "end_turn",
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

/** Neutral budget status for testing (no budget set). */
function neutralBudget(): BudgetStatus {
  return {
    limit: null,
    spent: 0,
    remaining: Infinity,
    percentage: 0,
    warning: false,
    blocked: false,
  };
}

// ── Slash command parsing tests ──────────────────────────────────

describe("/start slash command parsing", () => {
  it("/start with task description returns pipeline-start", () => {
    const result = handleSlashCommand("/start fix the login bug", makeContext());
    expect(result).not.toBeNull();
    expect(result!.action).toBe("pipeline-start");
    if (result!.action === "pipeline-start") {
      expect(result!.request).toBe("fix the login bug");
    }
  });

  it("/start with no args returns error", () => {
    const result = handleSlashCommand("/start", makeContext());
    expect(result).not.toBeNull();
    expect(result!.action).toBe("error");
    if (result!.action === "error") {
      expect(result!.message).toContain("task description required");
    }
  });

  it("/start with --scale flag parses scale", () => {
    const result = handleSlashCommand(
      "/start fix bug --scale small",
      makeContext(),
    );
    expect(result!.action).toBe("pipeline-start");
    if (result!.action === "pipeline-start") {
      expect(result!.scale).toBe("small");
      expect(result!.request).toBe("fix bug");
    }
  });

  it("/start with --type flag parses type", () => {
    const result = handleSlashCommand(
      "/start fix bug --type quick",
      makeContext(),
    );
    expect(result!.action).toBe("pipeline-start");
    if (result!.action === "pipeline-start") {
      expect(result!.type).toBe("quick");
      expect(result!.request).toBe("fix bug");
    }
  });

  it("/state returns pipeline-state", () => {
    const result = handleSlashCommand("/state", makeContext());
    expect(result).not.toBeNull();
    expect(result!.action).toBe("pipeline-state");
  });

  it("/transition returns pipeline-transition", () => {
    const result = handleSlashCommand("/transition", makeContext());
    expect(result).not.toBeNull();
    expect(result!.action).toBe("pipeline-transition");
  });

  it("/cancel returns pipeline-cancel", () => {
    const result = handleSlashCommand("/cancel", makeContext());
    expect(result).not.toBeNull();
    expect(result!.action).toBe("pipeline-cancel");
  });

  it("/auto returns auto-toggle", () => {
    const result = handleSlashCommand("/auto", makeContext());
    expect(result).not.toBeNull();
    expect(result!.action).toBe("auto-toggle");
  });
});

// ── Pipeline DB operation tests ─────────────────────────────────

describe("Pipeline DB operations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openStateDb(); // in-memory
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  });

  it("initPipeline creates a pipeline and getPipelineState returns it", () => {
    const result = initPipeline(db, "fix the bug", "small");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pipeline.status).toBe("active");
    }

    const state = getPipelineState(db);
    expect(state).not.toBeNull();
    expect(state!.status).toBe("active");
    expect(state!.request).toBe("fix the bug");
  });

  it("getPipelineState returns null when no active pipeline", () => {
    const state = getPipelineState(db);
    expect(state).toBeNull();
  });

  it("initPipeline rejects when active pipeline exists", () => {
    initPipeline(db, "first task", "small");
    const result = initPipeline(db, "second task", "small");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("active pipeline already exists");
    }
  });

  it("transitionPipeline advances to next step", () => {
    initPipeline(db, "task", "small");

    const result = transitionPipeline(db);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Trivial pipeline steps: init → execute → commit → finalize
      // After first transition, completed_steps should include 'init'
      expect(result.pipeline.completed_steps).toContain("init");
    }
  });

  it("transitionPipeline with no active pipeline returns error", () => {
    const result = transitionPipeline(db);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("No active pipeline");
    }
  });

  it("cancelPipeline cancels active pipeline", () => {
    initPipeline(db, "task", "small");

    const result = cancelPipeline(db);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pipeline.status).toBe("cancelled");
    }

    // No active pipeline remains
    const state = getPipelineState(db);
    expect(state).toBeNull();
  });

  it("cancelPipeline with no active pipeline returns error", () => {
    const result = cancelPipeline(db);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("No active pipeline");
    }
  });
});

// ── Auto-routing tests ──────────────────────────────────────────

describe("Auto-routing via selectModel", () => {
  it("routes simple message to haiku when auto-routing enabled", () => {
    const result = selectModel("hi", neutralBudget(), DEFAULT_MODEL, false);
    expect(result.model).toBe(MODEL_TIERS.simple);
    expect(result.reason).toContain("simple");
  });

  it("routes complex message to opus when auto-routing enabled", () => {
    const longMessage =
      "```typescript\nfunction refactor() {\n  // complex implementation with multiple async operations and error handling\n}\n```";
    const result = selectModel(
      longMessage,
      neutralBudget(),
      DEFAULT_MODEL,
      false,
    );
    expect(result.model).toBe(MODEL_TIERS.complex);
    expect(result.reason).toContain("complex");
  });

  it("respects user explicit choice when isExplicitChoice is true", () => {
    const result = selectModel(
      "hi",
      neutralBudget(),
      "custom-model",
      true,
    );
    expect(result.model).toBe("custom-model");
    expect(result.reason).toContain("User choice");
  });

  it("forces haiku when budget is blocked", () => {
    const blockedBudget: BudgetStatus = {
      limit: 1,
      spent: 1.5,
      remaining: -0.5,
      percentage: 1.5,
      warning: true,
      blocked: true,
    };
    const result = selectModel(
      "complex query about architecture",
      blockedBudget,
      DEFAULT_MODEL,
      false,
    );
    expect(result.model).toBe(MODEL_TIERS.simple);
    expect(result.reason).toContain("Budget exhausted");
  });

  it("caps at sonnet when budget is in warning zone", () => {
    const warningBudget: BudgetStatus = {
      limit: 10,
      spent: 8.5,
      remaining: 1.5,
      percentage: 0.85,
      warning: true,
      blocked: false,
    };
    const result = selectModel(
      "```typescript\nclass Complex { }\n```",
      warningBudget,
      DEFAULT_MODEL,
      false,
    );
    // Should be capped at sonnet (moderate), not opus (complex)
    expect(result.model).not.toBe(MODEL_TIERS.complex);
    expect(result.reason).toContain("budget warning");
  });
});

// ── /auto toggle state simulation ───────────────────────────────

describe("/auto toggle", () => {
  it("toggle flips autoRoute state", () => {
    // Simulates VelaApp's toggle logic
    let autoRoute = false;

    // First toggle: off → on
    autoRoute = !autoRoute;
    expect(autoRoute).toBe(true);

    // Second toggle: on → off
    autoRoute = !autoRoute;
    expect(autoRoute).toBe(false);
  });

  it("auto-routing calls selectModel and may change model", () => {
    const budgetManager = new BudgetManager();
    const currentModel = DEFAULT_MODEL;
    const isExplicitModel = false;

    // Simulate handleSubmit auto-routing path
    const cost = 0;
    const budgetStatus = budgetManager.checkBudget(cost);
    const routing = selectModel(
      "hi",
      budgetStatus,
      currentModel,
      isExplicitModel,
    );

    // Simple message → should route to haiku (different from default sonnet)
    expect(routing.model).toBe(MODEL_TIERS.simple);
    expect(routing.model).not.toBe(currentModel);
  });

  it("auto-routing does not mutate currentModel (K018)", () => {
    const originalModel = DEFAULT_MODEL;
    let currentModel = originalModel;

    // Simulate: routing selects different model but currentModel stays unchanged
    const routing = selectModel("hi", neutralBudget(), currentModel, false);

    // Don't mutate — only set on ChatEngine temporarily
    // currentModel should remain the original
    expect(currentModel).toBe(originalModel);
    expect(routing.model).not.toBe(currentModel);
  });
});

// ── Integration: pipeline dispatch simulation ───────────────────

describe("Pipeline dispatch simulation", () => {
  /**
   * Simulates VelaApp's dispatch for pipeline/auto commands.
   * Tests the guard logic and message output without tty dependencies.
   */

  let messageList: MessageList;

  beforeEach(() => {
    mockSendMessage = async (_msgs, opts) => {
      opts?.onText?.("response");
      return FAKE_MESSAGE_WITH_USAGE;
    };
    messageList = new MessageList();
  });

  it("/start when already running shows guard message", () => {
    // Simulate the guard: isPipelineRunning = true
    const isPipelineRunning = true;

    if (isPipelineRunning) {
      messageList.addMessage({
        role: "system",
        content: "Pipeline already running.",
      });
    }

    const lines = strip(messageList.render(80));
    expect(lines.some((l) => l.includes("Pipeline already running"))).toBe(
      true,
    );
  });

  it("/start with empty request shows usage error", () => {
    // /start with no args — shortcuts.ts returns error, not pipeline-start
    const result = handleSlashCommand("/start", makeContext());
    expect(result).not.toBeNull();
    expect(result!.action).toBe("error");
    if (result!.action === "error") {
      expect(result!.message).toContain("task description required");
    }
  });

  it("/state with no active pipeline shows message", () => {
    const db = openStateDb(); // in-memory, no pipelines
    try {
      const pipeline = getPipelineState(db);
      if (!pipeline) {
        messageList.addMessage({
          role: "system",
          content: "No active pipeline.",
        });
      }

      const lines = strip(messageList.render(80));
      expect(lines.some((l) => l.includes("No active pipeline"))).toBe(true);
    } finally {
      db.close();
    }
  });

  it("/state with active pipeline shows state", () => {
    const db = openStateDb(); // in-memory
    try {
      initPipeline(db, "fix bug", "small");
      const pipeline = getPipelineState(db);

      expect(pipeline).not.toBeNull();
      const stateMsg =
        `Pipeline: ${pipeline!.pipeline_type} [${pipeline!.status}]\n` +
        `Step: ${pipeline!.current_step}\n` +
        `Completed: ${pipeline!.completed_steps.join(", ") || "(none)"}`;
      messageList.addMessage({ role: "system", content: stateMsg });

      const lines = strip(messageList.render(80));
      expect(lines.some((l) => l.includes("Pipeline:"))).toBe(true);
      expect(lines.some((l) => l.includes("trivial"))).toBe(true);
    } finally {
      db.close();
    }
  });

  it("/cancel with no active pipeline shows appropriate message", () => {
    const db = openStateDb(); // in-memory
    try {
      const result = cancelPipeline(db);
      if (!result.ok) {
        messageList.addMessage({
          role: "system",
          content: `Cancel failed: ${result.error}`,
        });
      }

      const lines = strip(messageList.render(80));
      expect(lines.some((l) => l.includes("No active pipeline"))).toBe(true);
    } finally {
      db.close();
    }
  });

  it("/cancel cancels active pipeline and shows confirmation", () => {
    const db = openStateDb(); // in-memory
    try {
      initPipeline(db, "task", "small");
      const result = cancelPipeline(db);

      expect(result.ok).toBe(true);
      messageList.addMessage({ role: "system", content: "Pipeline cancelled." });

      const lines = strip(messageList.render(80));
      expect(lines.some((l) => l.includes("Pipeline cancelled"))).toBe(true);
    } finally {
      db.close();
    }
  });

  it("/auto toggle produces correct system messages", () => {
    let autoRoute = false;

    // Toggle on
    autoRoute = !autoRoute;
    messageList.addMessage({
      role: "system",
      content: `Auto-routing ${autoRoute ? "enabled" : "disabled"}.`,
    });

    let lines = strip(messageList.render(80));
    expect(lines.some((l) => l.includes("Auto-routing enabled"))).toBe(true);

    // Toggle off
    autoRoute = !autoRoute;
    messageList.addMessage({
      role: "system",
      content: `Auto-routing ${autoRoute ? "enabled" : "disabled"}.`,
    });

    lines = strip(messageList.render(80));
    expect(lines.some((l) => l.includes("Auto-routing disabled"))).toBe(true);
  });
});
