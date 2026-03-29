/**
 * VelaApp — top-level TUI application layout.
 *
 * Composes ProcessTerminal + TUI with a themed header bar, MessageList
 * for conversation display, and input bar. User messages are submitted
 * via ChatEngine which streams Claude responses through MessageList.
 *
 * Signal handlers ensure terminal state is always restored on exit —
 * critical for raw mode safety.
 */

import { theme } from "../tui/theme.js";
import { Input } from "./components/input.js";
import { MessageList } from "./components/message-list.js";
import { Dashboard } from "./components/dashboard.js";
import { HelpOverlay } from "./components/help-overlay.js";
import { TopStatusBar } from "./components/status-bar-top.js";
import { BottomStatusBar } from "./components/status-bar-bottom.js";
import { ChatEngine } from "./chat-engine.js";
import type { ChatEngineCallbacks, ChatEngineMessage } from "./chat-engine.js";
import { ProcessTerminal } from "./terminal.js";
import { TUI, type InputListenerResult, type OverlayHandle, type Renderable } from "./tui.js";
import { handleSlashCommand } from "../tui/shortcuts.js";
import type { SlashCommandContext } from "../tui/shortcuts.js";
import { openSessionDb, createSession, addMessage } from "../session.js";
import type { ChatMessageRow } from "../session.js";
import { DEFAULT_MODEL } from "../models.js";
import { BudgetManager } from "../budget-manager.js";
import { findProjectRoot } from "../config.js";
import { openStateDb } from "../state.js";
import { runPipeline } from "../pipeline-orchestrator.js";
import type { PipelineCallbacks } from "../pipeline-orchestrator.js";
import {
  getPipelineState,
  transitionPipeline,
  cancelPipeline,
} from "../pipeline.js";
import { selectModel } from "../model-router.js";
import type Database from "better-sqlite3";

// ── ANSI helpers for input prompt (K032) ─────────────────────────────────────

const INPUT_FG_MAP: Record<string, string> = {
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

const INPUT_RESET = "\x1b[0m";

function inputFg(name: string | undefined): string {
  if (!name) return "";
  return INPUT_FG_MAP[name] ?? "";
}

// ── VelaApp ─────────────────────────────────────────────────────────────────

/**
 * Minimum terminal rows before status bars are dropped.
 * Below this, only input + minimal messages render.
 */
const MIN_ROWS_FOR_STATUS_BARS = 5;

export class VelaApp {
  private terminal: ProcessTerminal;
  private tui: TUI;
  private topBar: TopStatusBar;
  private bottomBar: BottomStatusBar;
  private messageList: MessageList;
  private chatEngine: ChatEngine;
  private input: Input;
  private stopped = false;
  private dashboard: Dashboard;
  private dashboardHandle: OverlayHandle;
  private helpOverlayHandle: OverlayHandle | null = null;

  /** Accumulates text deltas for the current streaming response. */
  private streamingAccumulator = "";

  // ── Token / cost tracking for dashboard ─────────────────────────────
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private currentModel = DEFAULT_MODEL;
  private budgetManager = new BudgetManager();

  // ── Session database (nullable — failure doesn't block TUI) ─────────
  private db: Database.Database | null = null;

  /** Active session ID — set on first submit or /resume. */
  private sessionId: string | null = null;

  /** True when user explicitly chose a model via /model — needed by T02 auto-routing. */
  private isExplicitModel = false;

  // ── Pipeline state ──────────────────────────────────────────────
  /** True while a pipeline is running (guard against double-start). */
  private isPipelineRunning = false;

  /** State DB kept open during pipeline run for cancel access. */
  private pipelineDb: Database.Database | null = null;

  /** Auto-routing enabled — toggled by /auto. */
  private autoRoute = false;

  // Signal handlers — stored so we can remove them on stop
  private sigintHandler: () => void;
  private sigtermHandler: () => void;
  private uncaughtHandler: (err: Error) => void;

  constructor() {
    this.terminal = new ProcessTerminal();
    this.tui = new TUI(this.terminal);

    // ── Session database (best-effort, failure doesn't block TUI) ───────
    try {
      const root = findProjectRoot(process.cwd());
      const velaDir = root ? `${root}/.vela` : undefined;
      this.db = openSessionDb(velaDir);
    } catch {
      // DB unavailable — slash commands that need it will show an error
      this.db = null;
    }

    // ── Top status bar ────────────────────────────────────────────────────
    this.topBar = new TopStatusBar();
    this.topBar.setData({
      model: this.currentModel,
      sessionId: this.sessionId,
      pipelineStatus: this.isPipelineRunning ? "running" : null,
    });

    // ── Message list ────────────────────────────────────────────────────
    this.messageList = new MessageList();
    this.messageList.setOnThinkingTick(() => this.tui.requestRender());

    // Welcome message
    this.messageList.addMessage({
      role: "system",
      content: "Welcome to Vela. Type a message and press Enter.",
    });

    // ── Chat engine ─────────────────────────────────────────────────────
    const callbacks: ChatEngineCallbacks = {
      onMessageStart: () => {
        this.streamingAccumulator = "";
        this.messageList.setStreamingText("");
        this.tui.requestRender();
      },
      onTextDelta: (delta: string) => {
        this.streamingAccumulator += delta;
        this.messageList.setStreamingText(this.streamingAccumulator);
        this.tui.requestRender();
      },
      onToolStart: (toolName: string, _toolId: string) => {
        this.messageList.addStreamingTool(toolName, "running");
        this.tui.requestRender();
      },
      onToolDone: (toolName: string, _toolId: string, _summary?: string) => {
        this.messageList.addStreamingTool(toolName, "done");
        this.tui.requestRender();
      },
      onMessageComplete: (msg: ChatEngineMessage) => {
        this.messageList.setStreamingText(null);
        this.messageList.clearStreamingTools();
        this.messageList.addMessage({
          role: msg.role,
          content: msg.content,
          toolCalls: msg.toolCalls?.map((t) => ({
            toolName: t.toolName,
            status: t.status,
            summary: t.summary,
          })),
        });

        // Persist assistant message (K013 fail-open)
        if (this.sessionId && this.db) {
          try {
            addMessage(this.db, {
              session_id: this.sessionId,
              role: "assistant",
              display: msg.content,
              content: msg.content,
            });
          } catch {
            /* fail-open */
          }
        }

        // Accumulate token usage for dashboard
        if (msg.usage) {
          this.totalInputTokens += msg.usage.inputTokens;
          this.totalOutputTokens += msg.usage.outputTokens;
        }

        // Update dashboard with latest data
        this.dashboard.setData(this.getDashboardData());

        // Update bottom status bar with token/cost data
        const dashData = this.getDashboardData();
        this.bottomBar.setData({
          inputTokens: dashData.inputTokens,
          outputTokens: dashData.outputTokens,
          cost: dashData.cost,
        });

        // Restore input prompt to base model (auto-routing may have changed it)
        this.updateInputPrompt();

        this.tui.requestRender();
      },
      onError: (error: string) => {
        this.messageList.setStreamingText(null);
        this.messageList.clearStreamingTools();
        this.messageList.addMessage({
          role: "system",
          content: `Error: ${error}`,
        });
        this.tui.requestRender();
      },
    };
    this.chatEngine = new ChatEngine(callbacks);

    // ── Input bar ───────────────────────────────────────────────────────
    this.input = new Input();
    this.input.placeholder = "Type a message…";
    this.input.onSubmit = (value: string) => this.handleSubmit(value);
    this.updateInputPrompt();

    // ── Bottom status bar ──────────────────────────────────────────────────
    this.bottomBar = new BottomStatusBar();

    // ── Compose 3-panel layout via proxy Renderable ─────────────────────
    // Instead of addChild() which just concatenates, we use a single proxy
    // Renderable that assembles height-aware layout on every render call.
    const self = this;
    const layoutProxy: Renderable = {
      render(width: number): string[] {
        const rows = self.terminal.rows;

        // Very short terminal: skip status bars, show only input + messages
        if (rows < MIN_ROWS_FOR_STATUS_BARS) {
          const inputLines = self.input.render(width);
          const messageHeight = Math.max(1, rows - inputLines.length);
          const allMessages = self.messageList.render(width);
          const visibleMessages = allMessages.slice(-messageHeight);
          return [...visibleMessages, ...inputLines];
        }

        const topLines = self.topBar.render(width);
        const bottomLines = self.bottomBar.render(width);
        const inputLines = self.input.render(width);

        const fixedHeight = topLines.length + bottomLines.length + inputLines.length;
        const messageHeight = Math.max(1, rows - fixedHeight);
        const allMessages = self.messageList.render(width);
        const visibleMessages = allMessages.slice(-messageHeight);

        return [...topLines, ...visibleMessages, ...bottomLines, ...inputLines];
      },
    };

    this.tui.addChild(layoutProxy);
    this.tui.setFocus(this.input);

    // ── Ctrl+C handler via input listener ───────────────────────────────
    this.tui.addInputListener((data: string): InputListenerResult | void => {
      // Ctrl+C = \x03
      if (data === "\x03") {
        this.stop();
        process.exit(0);
      }
      // Ctrl+D = \x04 — toggle dashboard overlay
      if (data === "\x04") {
        this.dashboardHandle.setHidden(!this.dashboardHandle.isHidden());
        this.tui.requestRender();
        return { consume: true };
      }
    });

    // ── Dashboard overlay ───────────────────────────────────────────────
    this.dashboard = new Dashboard();
    this.dashboardHandle = this.tui.showOverlay(this.dashboard, {
      anchor: "top-right",
      width: 32,
      margin: { top: 2 },
      nonCapturing: true,
    });
    this.dashboardHandle.setHidden(true);

    // ── Signal handlers for clean exit ──────────────────────────────────
    this.sigintHandler = () => {
      this.stop();
      process.exit(0);
    };
    this.sigtermHandler = () => {
      this.stop();
      process.exit(0);
    };
    this.uncaughtHandler = (err: Error) => {
      this.stop();
      process.stderr.write(`[Vela] Uncaught: ${err.message}\n`);
      process.exit(1);
    };
  }

  // ── Dashboard data ───────────────────────────────────────────────────

  /** Returns current token/cost data for the dashboard overlay. */
  getDashboardData(): {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  } {
    const cost =
      (this.totalInputTokens * 3 + this.totalOutputTokens * 15) / 1_000_000;
    return {
      model: this.currentModel,
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
      cost,
    };
  }

  /** Update top status bar with current model, session, and pipeline state. */
  private updateTopBar(): void {
    this.topBar.setData({
      model: this.currentModel,
      sessionId: this.sessionId,
      pipelineStatus: this.isPipelineRunning ? "running" : null,
    });
  }

  /** Update input prompt with themed `› modelName ` string. */
  private updateInputPrompt(): void {
    const promptColor = inputFg(theme.input.prompt);
    const modelColor = inputFg(theme.input.promptModel);
    this.input.setPrompt(
      `${promptColor}›${INPUT_RESET} ${modelColor}${this.currentModel}${INPUT_RESET} `,
    );
  }

  // ── Submit handler ──────────────────────────────────────────────────────

  private handleSubmit(value: string): void {
    const trimmed = value.trim();
    if (!trimmed) return;

    // ── Slash command interception ────────────────────────────────────
    if (trimmed.startsWith("/")) {
      const ctx: SlashCommandContext = {
        db: this.db,
        model: this.currentModel,
      };
      const result = handleSlashCommand(trimmed, ctx);
      if (result) {
        this.dispatchSlashCommand(result);
        this.input.value = "";
        this.input.cursor = 0;
        this.tui.requestRender();
        return;
      }
    }

    // Double-submit prevention — ChatEngine guards this internally too
    if (this.chatEngine.isStreaming) return;

    // ── Session auto-create on first real message (K013 fail-open) ────
    if (!this.sessionId && this.db) {
      try {
        const session = createSession(this.db, {
          model: this.currentModel,
          title: trimmed.slice(0, 50),
        });
        this.sessionId = session.id;
        this.updateTopBar();
      } catch {
        /* fail-open: chat works without persistence */
      }
    }

    // Add user message to display
    this.messageList.addMessage({ role: "user", content: trimmed });

    // Persist user message (K013 fail-open)
    if (this.sessionId && this.db) {
      try {
        addMessage(this.db, {
          session_id: this.sessionId,
          role: "user",
          display: trimmed,
          content: trimmed,
        });
      } catch {
        /* fail-open */
      }
    }

    // ── Auto-routing: select model by message complexity (K018) ─────
    if (this.autoRoute) {
      try {
        const budgetStatus = this.budgetManager.checkBudget(
          this.getDashboardData().cost,
        );
        const routing = selectModel(
          trimmed,
          budgetStatus,
          this.currentModel,
          this.isExplicitModel,
        );
        if (routing.model !== this.currentModel) {
          this.addSystemMessage(
            `Auto-routed → ${routing.model} (${routing.reason})`,
          );
          // Temporary per-message override (K018): don't mutate this.currentModel
          this.chatEngine.setModel(routing.model);
          // Temporarily show routed model in input prompt
          this.input.setPrompt(
            `${inputFg(theme.input.prompt)}›${INPUT_RESET} ${inputFg(theme.input.promptModel)}${routing.model}${INPUT_RESET} `,
          );
        }
      } catch {
        // Fail-open: auto-routing error doesn't block submission
      }
    }

    // Fire-and-forget (K025): don't await in handler, callbacks drive state
    this.chatEngine.submit(trimmed).catch(() => {
      // Error already handled via onError callback
    });

    // Clear input
    this.input.value = "";
    this.input.cursor = 0;

    this.tui.requestRender();
  }

  // ── Slash command dispatch ──────────────────────────────────────────

  private dispatchSlashCommand(
    result: import("../tui/shortcuts.js").SlashCommandResult,
  ): void {
    switch (result.action) {
      case "help":
        this.showHelpOverlay();
        break;

      case "quit":
        this.stop();
        process.exit(0);
        break;

      case "clear":
        this.messageList.clear();
        this.chatEngine.clearHistory();
        break;

      case "fresh":
        this.messageList.clear();
        this.chatEngine.clearHistory();
        this.addSystemMessage("Context cleared.");
        break;

      case "sessions": {
        const sessions = result.sessions;
        if (sessions.length === 0) {
          this.addSystemMessage("No sessions found.");
        } else {
          const lines = sessions.map(
            (s) =>
              `• ${s.title ?? "(untitled)"} — ${s.model} (${s.updated_at})`,
          );
          this.addSystemMessage(`Sessions:\n${lines.join("\n")}`);
        }
        break;
      }

      case "resume": {
        // Clear current state and load restored session
        this.messageList.clear();
        this.chatEngine.clearHistory();

        const session = result.session;
        const messages: ChatMessageRow[] = result.messages;

        // Restore messages into MessageList and ChatEngine
        const engineHistory: ChatEngineMessage[] = [];
        for (const m of messages) {
          const role = m.role as "user" | "assistant" | "system";
          this.messageList.addMessage({ role, content: m.display });
          if (role === "user" || role === "assistant") {
            engineHistory.push({ role, content: m.display });
          }
        }
        this.chatEngine.restoreHistory(engineHistory);

        // Update session tracking and model
        this.sessionId = session.id;
        this.currentModel = session.model;
        this.chatEngine.setModel(session.model);
        this.updateTopBar();
        this.updateInputPrompt();

        this.addSystemMessage(
          `Resumed session: ${session.title ?? "(untitled)"} (${messages.length} messages)`,
        );
        break;
      }

      case "model":
        this.addSystemMessage(`Current model: ${result.model}`);
        break;

      case "model-switch":
        this.chatEngine.setModel(result.model);
        this.currentModel = result.model;
        this.isExplicitModel = true;
        this.updateTopBar();
        this.updateInputPrompt();
        this.addSystemMessage(`Model switched to: ${result.model}`);
        break;

      case "budget-set":
        this.budgetManager.setBudget(result.amount);
        this.addSystemMessage(`Budget set to $${result.amount.toFixed(2)}`);
        break;

      case "budget-status": {
        const status = this.budgetManager.getStatus();
        if (status.limit === null) {
          this.addSystemMessage("No budget set. Use /budget <amount> to set one.");
        } else {
          this.addSystemMessage(
            `Budget: $${status.spent.toFixed(4)} / $${status.limit.toFixed(2)} (${(status.percentage * 100).toFixed(1)}%)`,
          );
        }
        break;
      }

      case "init": {
        const r = result.result;
        if (r.alreadyInitialized) {
          this.addSystemMessage("Vela already initialized in this project.");
        } else {
          this.addSystemMessage(
            `Vela initialized. Created: ${r.created.join(", ")}`,
          );
        }
        break;
      }

      case "auto-toggle":
        this.autoRoute = !this.autoRoute;
        this.addSystemMessage(
          `Auto-routing ${this.autoRoute ? "enabled" : "disabled"}.`,
        );
        break;

      case "pipeline-start": {
        if (this.isPipelineRunning) {
          this.addSystemMessage("Pipeline already running.");
          break;
        }
        const request = result.request;
        if (!request) {
          this.addSystemMessage("Usage: /start <request>");
          break;
        }

        // Open state DB for pipeline run
        let stateDb: Database.Database;
        try {
          const root = findProjectRoot(process.cwd());
          const velaDir = root ? `${root}/.vela` : undefined;
          stateDb = openStateDb(velaDir);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.addSystemMessage(`Pipeline error: ${msg}`);
          break;
        }

        this.isPipelineRunning = true;
        this.pipelineDb = stateDb;
        this.updateTopBar();
        this.addSystemMessage(`Starting pipeline: ${request}`);

        const cwd = process.cwd();
        const callbacks: PipelineCallbacks = {
          onStepStart: (stage) => {
            this.addSystemMessage(`▸ Stage: ${stage}`);
          },
          onStepComplete: (stage, stepResult) => {
            this.addSystemMessage(
              `✓ ${stage} complete (${stepResult.toolCalls} tool calls)`,
            );
          },
          onText: (text) => {
            this.streamingAccumulator += text;
            this.messageList.setStreamingText(this.streamingAccumulator);
            this.tui.requestRender();
          },
          onError: (error, stage) => {
            this.addSystemMessage(`Pipeline error in ${stage}: ${error.message}`);
          },
        };

        // Fire-and-forget (K025): don't await in handler
        runPipeline(request, {
          cwd,
          db: stateDb,
          model: this.currentModel,
          callbacks,
          scale: result.scale as any,
          pipelineType: result.type as any,
        })
          .then((pipelineResult) => {
            if (pipelineResult.ok) {
              this.addSystemMessage("Pipeline completed successfully.");
            } else {
              this.addSystemMessage(`Pipeline failed: ${pipelineResult.error}`);
            }
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.addSystemMessage(`Pipeline error: ${msg}`);
          })
          .finally(() => {
            try {
              stateDb.close();
            } catch {
              /* ignore close errors */
            }
            this.isPipelineRunning = false;
            this.pipelineDb = null;
            this.updateTopBar();
            this.streamingAccumulator = "";
            this.messageList.setStreamingText(null);
            this.tui.requestRender();
          });
        break;
      }

      case "pipeline-state": {
        let stateDb: Database.Database | null = null;
        try {
          const root = findProjectRoot(process.cwd());
          const velaDir = root ? `${root}/.vela` : undefined;
          stateDb = openStateDb(velaDir);
          const pipeline = getPipelineState(stateDb);
          if (pipeline) {
            this.addSystemMessage(
              `Pipeline: ${pipeline.pipeline_type} [${pipeline.status}]\n` +
                `Step: ${pipeline.current_step}\n` +
                `Completed: ${pipeline.completed_steps.join(", ") || "(none)"}`,
            );
          } else {
            this.addSystemMessage("No active pipeline.");
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.addSystemMessage(`Pipeline state error: ${msg}`);
        } finally {
          try {
            stateDb?.close();
          } catch {
            /* ignore */
          }
        }
        break;
      }

      case "pipeline-transition": {
        let stateDb: Database.Database | null = null;
        try {
          const root = findProjectRoot(process.cwd());
          const velaDir = root ? `${root}/.vela` : undefined;
          stateDb = openStateDb(velaDir);
          const transResult = transitionPipeline(stateDb);
          if (transResult.ok) {
            this.addSystemMessage(
              `Transitioned to: ${transResult.pipeline.current_step}`,
            );
          } else {
            this.addSystemMessage(`Transition failed: ${transResult.error}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.addSystemMessage(`Transition error: ${msg}`);
        } finally {
          try {
            stateDb?.close();
          } catch {
            /* ignore */
          }
        }
        break;
      }

      case "pipeline-cancel": {
        // If pipeline is running, use its open DB handle
        if (this.isPipelineRunning && this.pipelineDb) {
          try {
            const cancelResult = cancelPipeline(this.pipelineDb);
            if (cancelResult.ok) {
              this.addSystemMessage("Pipeline cancelled.");
            } else {
              this.addSystemMessage(`Cancel failed: ${cancelResult.error}`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.addSystemMessage(`Cancel error: ${msg}`);
          }
        } else {
          // Open a fresh DB to cancel any persisted active pipeline
          let stateDb: Database.Database | null = null;
          try {
            const root = findProjectRoot(process.cwd());
            const velaDir = root ? `${root}/.vela` : undefined;
            stateDb = openStateDb(velaDir);
            const cancelResult = cancelPipeline(stateDb);
            if (cancelResult.ok) {
              this.addSystemMessage("Pipeline cancelled.");
            } else {
              this.addSystemMessage(`Cancel failed: ${cancelResult.error}`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.addSystemMessage(`Cancel error: ${msg}`);
          } finally {
            try {
              stateDb?.close();
            } catch {
              /* ignore */
            }
          }
        }
        break;
      }

      case "error":
        this.addSystemMessage(`Error: ${result.message}`);
        break;
    }
  }

  /** Convenience: add a system message and request render. */
  private addSystemMessage(content: string): void {
    this.messageList.addMessage({ role: "system", content });
    this.tui.requestRender();
  }

  /** Show the help overlay — dismiss on Escape. Only one at a time. */
  private showHelpOverlay(): void {
    // Dismiss existing help overlay if open
    if (this.helpOverlayHandle) {
      this.helpOverlayHandle.hide();
      this.helpOverlayHandle = null;
    }

    const helpOverlay = new HelpOverlay(() => {
      if (this.helpOverlayHandle) {
        this.helpOverlayHandle.hide();
        this.helpOverlayHandle = null;
      }
    });

    this.helpOverlayHandle = this.tui.showOverlay(helpOverlay, {
      anchor: "center",
      width: 50,
      maxHeight: "80%",
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  start(): void {
    if (this.stopped) return;

    process.on("SIGINT", this.sigintHandler);
    process.on("SIGTERM", this.sigtermHandler);
    process.on("uncaughtException", this.uncaughtHandler);

    this.tui.start();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;

    process.removeListener("SIGINT", this.sigintHandler);
    process.removeListener("SIGTERM", this.sigtermHandler);
    process.removeListener("uncaughtException", this.uncaughtHandler);

    this.tui.stop();
  }
}
