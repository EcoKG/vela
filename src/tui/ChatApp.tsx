import React, { useState, useRef, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';

import { Header } from './Header.js';
import { FullscreenLayout } from './FullscreenLayout.js';
import { MessageList } from './MessageList.js';
import type { Message } from './MessageList.js';
import type { ToolCallInfo } from './ToolCallBlock.js';
import { ChatInput } from './ChatInput.js';
import { ToolStatus } from './ToolStatus.js';
import { GovernanceStatus } from './GovernanceStatus.js';
import { Dashboard } from './Dashboard.js';
import { HelpOverlay } from './HelpOverlay.js';
import { handleSlashCommand } from './shortcuts.js';
import { theme } from './theme.js';
import { BudgetManager } from '../budget-manager.js';
import type { BudgetStatus } from '../budget-manager.js';

import {
  sendMessage,
  extractToolUseBlocks,
  isToolUseResponse,
} from '../claude-client.js';
import {
  shouldResetContext,
  summarizeConversation,
  buildFreshContext,
} from '../context-manager.js';
import { DEFAULT_MODEL } from '../models.js';
import { selectModel } from '../model-router.js';
import { TokenTracker } from '../token-tracker.js';
import type { Provider } from '../provider.js';
import type { TokenState, CostEstimate } from '../token-tracker.js';
import type { ChatMessage, SendMessageOptions } from '../claude-client.js';
import { executeTool, executeToolsParallel } from '../tool-engine.js';
import { buildGateContext, DEFAULT_RETRY_BUDGET } from '../governance/index.js';
import { RetryBudget } from '../governance/index.js';
import type { GateContext } from '../governance/index.js';
import type { GateVerdict } from './ToolStatus.js';
import type { ToolContext } from '../tool-engine.js';
import {
  openSessionDb,
  createSession,
  addMessage as addSessionMessage,
  updateSession,
} from '../session.js';
import {
  initPipeline,
  getPipelineState,
  transitionPipeline,
  cancelPipeline,
} from '../pipeline.js';
import type { Scale } from '../pipeline.js';
import { runPipeline } from '../pipeline-orchestrator.js';
import type { PipelineCallbacks } from '../pipeline-orchestrator.js';
import { findProjectRoot } from '../config.js';
import { openStateDb } from '../state.js';
import { closeDb } from '../db.js';
import { join } from 'node:path';

import type {
  ToolResultBlockParam,
  ContentBlockParam,
  TextBlock,
} from '@anthropic-ai/sdk/resources/messages/messages.js';

import type Database from 'better-sqlite3';

// ── Props ─────────────────────────────────────────────────────

export interface ChatAppProps {
  provider: Provider;
  model?: string;
  maxTokens?: number;
  system?: string;
  /** If provided, operate on this existing session. */
  sessionId?: string;
  /** Pre-populate MessageList on mount (for resume). */
  initialMessages?: Message[];
  /** Pre-populate the conversation array for API continuity (for resume). */
  initialConversation?: ChatMessage[];
  /** Callback when a new session is auto-created. */
  onSessionCreated?: (id: string) => void;
  /** Session budget limit in USD. */
  budget?: number;
  /** Enable automatic model routing based on message complexity. */
  autoRoute?: boolean;
}

// ── Constants ─────────────────────────────────────────────────

const MAX_TOOL_ITERATIONS = 10;
const MAX_QUEUE_SIZE = 5;

// ── Component ─────────────────────────────────────────────────

export function ChatApp({
  provider,
  model,
  maxTokens,
  system,
  sessionId: initialSessionId,
  initialMessages,
  initialConversation,
  onSessionCreated,
  budget,
  autoRoute: initialAutoRoute,
}: ChatAppProps) {
  const { exit } = useApp();

  // Model state — lifted from immutable prop to useState for runtime switching
  const [currentModel, setCurrentModel] = useState(model ?? DEFAULT_MODEL);
  // Ref mirrors currentModel for async closure safety (avoids stale captures in handleSubmit)
  const currentModelRef = useRef(currentModel);

  const [messages, setMessages] = useState<Message[]>(initialMessages ?? []);
  const [dashboardVisible, setDashboardVisible] = useState(true);
  const [helpVisible, setHelpVisible] = useState(false);
  const [clearCount, setClearCount] = useState(0);
  const [isStreaming, setIsStreaming] = useState(false);
  // Ref mirrors isStreaming for useInput closure (avoids stale captures)
  const isStreamingRef = useRef(false);

  // Message queue for async input during streaming
  const messageQueueRef = useRef<string[]>([]);
  const [queueLength, setQueueLength] = useState(0);

  /** Update both state and ref to keep them synchronized. */
  function setStreamingState(value: boolean) {
    isStreamingRef.current = value;
    setIsStreaming(value);
  }
  const [streamingText, setStreamingText] = useState('');
  const [currentTool, setCurrentTool] = useState<string | null>(null);

  // Auto-routing state (K016: useState + useRef mirror for async closure safety)
  const [autoRoute, setAutoRoute] = useState(initialAutoRoute ?? false);
  const autoRouteRef = useRef(initialAutoRoute ?? false);
  const isExplicitModelRef = useRef(false);
  const [routedModel, setRoutedModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gateVerdict, setGateVerdict] = useState<GateVerdict | null>(null);
  const [consecutiveBlocks, setConsecutiveBlocks] = useState(0);
  const [pipelineMode, setPipelineMode] = useState<string | null>(null);

  // Pipeline execution state (K016: useState + useRef mirror for async closure safety)
  const [isPipelineRunning, setIsPipelineRunning] = useState(false);
  const isPipelineRunningRef = useRef(false);
  const pipelineDbRef = useRef<Database.Database | null>(null);

  // Scroll state removed — MessageList now uses column-reverse for auto-scroll

  // Token tracking
  const tokenTrackerRef = useRef(new TokenTracker());
  const [dashboardState, setDashboardState] = useState<TokenState>({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  const [costState, setCostState] = useState<CostEstimate>({ inputCost: 0, outputCost: 0, totalCost: 0 });

  // Session persistence refs — avoid stale closures in handleSubmit
  const sessionDbRef = useRef<Database.Database | null>(null);
  const sessionIdRef = useRef<string | null>(initialSessionId ?? null);

  // Persistent conversation ref — maintains full ContentBlockParam[] history for API continuity
  const conversationRef = useRef<ChatMessage[]>(initialConversation ?? []);

  // Budget tracking (K016: useState + useRef mirror for async closure safety)
  const budgetManagerRef = useRef(new BudgetManager());
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatus>(budgetManagerRef.current.getStatus());

  // Build governance gate context once on mount
  const gateContextRef = useRef<GateContext | null>(null);
  const retryBudgetRef = useRef<RetryBudget | null>(null);
  useEffect(() => {
    gateContextRef.current = buildGateContext(process.cwd());
    retryBudgetRef.current = new RetryBudget();
    if (gateContextRef.current?.mode) {
      setPipelineMode(gateContextRef.current.mode);
    }

    // Initialize budget from CLI --budget prop
    if (budget != null && budget > 0) {
      budgetManagerRef.current.setBudget(budget);
      setBudgetStatus(budgetManagerRef.current.getStatus());
    }

    // Open session DB (fail-open: errors are non-fatal)
    try {
      const velaDir = gateContextRef.current?.velaDir;
      sessionDbRef.current = openSessionDb(velaDir ?? undefined);
    } catch (e) {
      process.stderr.write(`[vela] session db open failed: ${e instanceof Error ? e.message : String(e)}\n`);
    }

    return () => {
      // Close session DB on unmount
      try {
        sessionDbRef.current?.close();
      } catch { /* ignore close errors */ }
      // Close pipeline DB if still open from an active pipeline
      try {
        pipelineDbRef.current?.close();
      } catch { /* ignore close errors */ }
    };
  }, []);

  // Prevent setState after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Auto-scroll handled by column-reverse layout

  // Keyboard shortcuts
  useInput((input, key) => {
    if (key.ctrl && input === 'd' && !isStreamingRef.current) {
      setDashboardVisible((prev) => !prev);
      return;
    }
    if (key.ctrl && input === 'l' && !isStreamingRef.current) {
      setMessages([]);
      setClearCount((c) => c + 1);
      return;
    }
    if (key.escape) {
      setHelpVisible(false);
      return;
    }
  });

  /** Track usage from an API response and update dashboard state. */
  function trackUsage(response: { usage?: { input_tokens: number; output_tokens: number } }) {
    if (response.usage) {
      tokenTrackerRef.current.addUsage(response.usage);
      const newDashboard = tokenTrackerRef.current.getState();
      const newCost = tokenTrackerRef.current.getCost(currentModelRef.current);
      setDashboardState(newDashboard);
      setCostState(newCost);

      // Update budget status after each API response
      const newBudget = budgetManagerRef.current.checkBudget(newCost.totalCost);
      setBudgetStatus(newBudget);

      // Show warning message when threshold is crossed (but not blocked)
      if (newBudget.warning && !newBudget.blocked && newBudget.limit != null) {
        const pct = Math.round(newBudget.percentage * 100);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `[vela] ⚠️ 예산 경고 — 사용량이 한도의 ${pct}%에 도달했습니다. (잔여: $${newBudget.remaining.toFixed(4)})` },
        ]);
      }
    }
  }

  async function handleSubmit(input: string) {
    // Guard: ignore empty/whitespace input
    if (!input.trim()) return;

    // Intercept slash commands before API call
    const slashResult = handleSlashCommand(input, {
      db: sessionDbRef.current,
      model: currentModelRef.current,
    });

    if (slashResult) {
      // Show the user's command in the message list
      const userMsg: Message = { role: 'user', content: input };

      switch (slashResult.action) {
        case 'help':
          setMessages((prev) => [...prev, userMsg]);
          setHelpVisible(true);
          return;
        case 'quit':
          exit();
          return;
        case 'clear':
          setMessages([]);
          setClearCount((c) => c + 1);
          return;
        case 'sessions': {
          const formatted = slashResult.sessions.length === 0
            ? '[vela] No sessions found.'
            : '[vela] Sessions:\n' +
              slashResult.sessions
                .map((s) => `  ${s.id.slice(0, 8)}  ${s.title ?? '(untitled)'}  ${s.updated_at}`)
                .join('\n');
          setMessages((prev) => [
            ...prev,
            userMsg,
            { role: 'assistant', content: formatted },
          ]);
          return;
        }
        case 'model':
          setMessages((prev) => [
            ...prev,
            userMsg,
            { role: 'assistant', content: `[vela] Model: ${slashResult.model}` },
          ]);
          return;
        case 'model-switch':
          currentModelRef.current = slashResult.model;
          setCurrentModel(slashResult.model);
          isExplicitModelRef.current = true;
          setMessages((prev) => [
            ...prev,
            userMsg,
            { role: 'assistant', content: `[vela] Model switched to: ${slashResult.model}` },
          ]);
          return;
        case 'budget-set': {
          budgetManagerRef.current.setBudget(slashResult.amount);
          const newStatus = budgetManagerRef.current.checkBudget(costState.totalCost);
          setBudgetStatus(newStatus);
          setMessages((prev) => [
            ...prev,
            userMsg,
            { role: 'assistant', content: `[vela] 예산 한도 설정: $${slashResult.amount.toFixed(2)}` },
          ]);
          return;
        }
        case 'budget-status': {
          const status = budgetManagerRef.current.checkBudget(costState.totalCost);
          setBudgetStatus(status);
          const statusText = status.limit != null
            ? `[vela] 💰 예산 현황\n  한도: $${status.limit.toFixed(4)}\n  사용: $${status.spent.toFixed(4)}\n  잔여: $${status.remaining.toFixed(4)}\n  사용률: ${Math.round(status.percentage * 100)}%${status.blocked ? '\n  ⛔ 차단됨' : status.warning ? '\n  ⚠️ 경고' : ''}`
            : '[vela] 예산 한도가 설정되지 않았습니다. /budget <금액> 으로 설정하세요.';
          setMessages((prev) => [
            ...prev,
            userMsg,
            { role: 'assistant', content: statusText },
          ]);
          return;
        }
        case 'auto-toggle': {
          const newAutoRoute = !autoRouteRef.current;
          autoRouteRef.current = newAutoRoute;
          setAutoRoute(newAutoRoute);
          if (newAutoRoute) {
            isExplicitModelRef.current = false;
          } else {
            setRoutedModel(null);
          }
          setMessages((prev) => [
            ...prev,
            userMsg,
            { role: 'assistant', content: `[vela] 🔄 자동 라우팅 ${newAutoRoute ? '활성화' : '비활성화'}` },
          ]);
          return;
        }

        // ── Pipeline commands ────────────────────────────────
        case 'pipeline-start': {
          // Guard: prevent concurrent pipelines
          if (isPipelineRunningRef.current) {
            setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '[vela] ❌ 파이프라인이 이미 실행 중입니다.' }]);
            return;
          }

          try {
            const projectRoot = findProjectRoot(process.cwd());
            if (!projectRoot) {
              setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '[vela] ❌ Vela 프로젝트를 찾을 수 없습니다. `vela init`을 먼저 실행하세요.' }]);
              return;
            }

            const db = openStateDb(join(projectRoot, '.vela'));
            pipelineDbRef.current = db;

            // Set pipeline-running state (K016 mirror)
            isPipelineRunningRef.current = true;
            setIsPipelineRunning(true);
            setStreamingState(true);

            setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: `[vela] 🚀 파이프라인 시작: ${slashResult.request}` }]);

            const callbacks: PipelineCallbacks = {
              onStepStart: (stage) => {
                if (mountedRef.current) {
                  setPipelineMode(stage);
                  setMessages((prev) => [...prev, { role: 'assistant', content: `[vela] ⛵ [${stage}] 시작...` }]);
                }
              },
              onStepComplete: (stage, result) => {
                if (mountedRef.current) {
                  setMessages((prev) => [...prev, { role: 'assistant', content: `[vela] ✅ [${stage}] 완료 (tools: ${result.toolCalls})` }]);
                }
              },
              onText: (text) => {
                if (mountedRef.current) {
                  setStreamingText((prev) => prev + text);
                }
              },
              onToolCall: (name) => {
                if (mountedRef.current) {
                  setCurrentTool(name);
                }
              },
              onError: (error, stage) => {
                if (mountedRef.current) {
                  setMessages((prev) => [...prev, { role: 'assistant', content: `[vela] ❌ [${stage}] 오류: ${error.message}` }]);
                }
              },
            };

            // Fire-and-forget with .then/.catch/.finally cleanup
            runPipeline(slashResult.request, {
              db,
              cwd: projectRoot,
              model: currentModelRef.current,
              maxTokens,
              callbacks,
              scale: (slashResult.scale ?? undefined) as Scale | undefined,
              pipelineType: slashResult.type as import('../pipeline.js').PipelineType | undefined,
            }).then((result) => {
              if (!mountedRef.current) return;
              if (result.ok) {
                const totalTools = result.steps.reduce((sum, s) => sum + s.toolCalls, 0);
                setMessages((prev) => [...prev, { role: 'assistant', content: `[vela] 🎉 파이프라인 완료 — ${result.steps.length}단계, 도구 호출 ${totalTools}회` }]);
              } else {
                setMessages((prev) => [...prev, { role: 'assistant', content: `[vela] ❌ 파이프라인 실패: ${result.error}` }]);
              }
            }).catch((err: unknown) => {
              if (!mountedRef.current) return;
              const msg = err instanceof Error ? err.message : String(err);
              setMessages((prev) => [...prev, { role: 'assistant', content: `[vela] ❌ 파이프라인 오류: ${msg}` }]);
            }).finally(() => {
              // Close DB and reset pipeline state
              try { pipelineDbRef.current?.close(); } catch { /* ignore close errors */ }
              pipelineDbRef.current = null;
              if (mountedRef.current) {
                isPipelineRunningRef.current = false;
                setIsPipelineRunning(false);
                setStreamingState(false);
                setPipelineMode(null);
                setCurrentTool(null);
                setStreamingText('');
              }
            });
          } catch (e) {
            // Sync errors (findProjectRoot, openStateDb)
            pipelineDbRef.current = null;
            isPipelineRunningRef.current = false;
            setIsPipelineRunning(false);
            setStreamingState(false);
            setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: `[vela] ❌ ${e instanceof Error ? e.message : String(e)}` }]);
          }
          return;
        }
        case 'pipeline-state': {
          try {
            const projectRoot = findProjectRoot(process.cwd());
            if (!projectRoot) {
              setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '[vela] ❌ Vela 프로젝트를 찾을 수 없습니다.' }]);
              return;
            }
            const db = openStateDb(join(projectRoot, '.vela'));
            try {
              const pipeline = getPipelineState(db);
              if (pipeline) {
                const info = `[vela] 📋 Pipeline State\n  ID: ${pipeline.id}\n  Type: ${pipeline.type}\n  Scale: ${pipeline.scale}\n  Status: ${pipeline.status}\n  Step: ${pipeline.current_step}\n  Request: ${pipeline.request}`;
                setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: info }]);
              } else {
                setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '[vela] 활성 파이프라인이 없습니다.' }]);
              }
            } finally { closeDb(db); }
          } catch (e) {
            setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: `[vela] ❌ ${e instanceof Error ? e.message : String(e)}` }]);
          }
          return;
        }
        case 'pipeline-transition': {
          try {
            const projectRoot = findProjectRoot(process.cwd());
            if (!projectRoot) {
              setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '[vela] ❌ Vela 프로젝트를 찾을 수 없습니다.' }]);
              return;
            }
            const db = openStateDb(join(projectRoot, '.vela'));
            try {
              const result = transitionPipeline(db);
              if (result.ok) {
                setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: `[vela] ⏭️ 다음 단계로 전환 완료` }]);
              } else {
                setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: `[vela] ❌ ${(result as { error?: string }).error ?? 'Transition failed'}` }]);
              }
            } finally { closeDb(db); }
          } catch (e) {
            setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: `[vela] ❌ ${e instanceof Error ? e.message : String(e)}` }]);
          }
          return;
        }
        case 'pipeline-cancel': {
          // If a pipeline is actively running, cancel via the live DB handle
          if (isPipelineRunningRef.current && pipelineDbRef.current) {
            try {
              cancelPipeline(pipelineDbRef.current);
              setPipelineMode(null);
              setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '[vela] 🛑 파이프라인이 취소되었습니다. (진행 중인 API 호출 완료 후 중단됩니다)' }]);
            } catch (e) {
              setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: `[vela] ❌ ${e instanceof Error ? e.message : String(e)}` }]);
            }
            return;
          }
          // Fallback: cancel a pipeline that was started but not actively running
          try {
            const projectRoot = findProjectRoot(process.cwd());
            if (!projectRoot) {
              setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '[vela] ❌ Vela 프로젝트를 찾을 수 없습니다.' }]);
              return;
            }
            const db = openStateDb(join(projectRoot, '.vela'));
            try {
              const result = cancelPipeline(db);
              if (result.ok) {
                setPipelineMode(null);
                setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '[vela] 🛑 파이프라인이 취소되었습니다.' }]);
              } else {
                setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: `[vela] ❌ ${(result as { error?: string }).error ?? 'Cancel failed'}` }]);
              }
            } finally { closeDb(db); }
          } catch (e) {
            setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: `[vela] ❌ ${e instanceof Error ? e.message : String(e)}` }]);
          }
          return;
        }

        case 'error':
          setMessages((prev) => [
            ...prev,
            userMsg,
            { role: 'assistant', content: `[vela] ${slashResult.message}` },
          ]);
          return;
        case 'fresh': {
          // Guard: need at least 4 messages for meaningful summarization
          if (conversationRef.current.length < 4) {
            setMessages((prev) => [
              ...prev,
              userMsg,
              { role: 'assistant', content: '[vela] 대화가 너무 짧아 요약할 수 없습니다.' },
            ]);
            return;
          }

          setMessages((prev) => [...prev, userMsg]);
          setStreamingState(true);

          try {
            const summary = await summarizeConversation(
              conversationRef.current,
              'claude-haiku-4-20250514',
            );
            const freshConversation = buildFreshContext(summary, conversationRef.current);
            conversationRef.current = freshConversation;

            // Reset token tracker — counts restart from fresh context
            tokenTrackerRef.current.reset();
            setDashboardState(tokenTrackerRef.current.getState());
            setCostState(tokenTrackerRef.current.getCost(currentModelRef.current));

            const resetMsg = `[vela] 컨텍스트가 리셋되었습니다. 이전 대화 요약:\n${summary}`;

            if (mountedRef.current) {
              setMessages((prev) => [
                ...prev,
                { role: 'assistant', content: resetMsg },
              ]);
            }

            // Persist reset message to session DB (fail-open per K013)
            if (sessionDbRef.current && sessionIdRef.current) {
              try {
                addSessionMessage(sessionDbRef.current, {
                  session_id: sessionIdRef.current,
                  role: 'assistant',
                  display: resetMsg,
                  content: resetMsg,
                });
              } catch { /* fail-open */ }
            }

            process.stderr.write('[vela] context reset: conversation replaced\n');
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (mountedRef.current) {
              setMessages((prev) => [
                ...prev,
                { role: 'assistant', content: `[vela] 컨텍스트 리셋 실패: ${msg}` },
              ]);
            }
            // Fail-open: keep original conversation
            process.stderr.write(`[vela] context reset failed: ${msg}\n`);
          } finally {
            setStreamingState(false);
          }
          return;
        }
      }
    }

    // Queue logic: if streaming, queue the message instead of processing directly
    if (isStreamingRef.current) {
      if (messageQueueRef.current.length >= MAX_QUEUE_SIZE) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `[vela] 큐가 가득 찼습니다 (${MAX_QUEUE_SIZE}/${MAX_QUEUE_SIZE})` },
        ]);
      } else {
        messageQueueRef.current.push(input);
        const len = messageQueueRef.current.length;
        setQueueLength(len);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `[vela] 메시지가 큐에 추가되었습니다 (${len}/${MAX_QUEUE_SIZE})` },
        ]);
      }
      return;
    }

    processMessage(input);
  }

  /** Core message processing — separated from handleSubmit for queue support. */
  async function processMessage(input: string) {
    const userMessage: Message = { role: 'user', content: input };

    // Budget check — block BEFORE sending to API
    const currentBudget = budgetManagerRef.current.checkBudget(costState.totalCost);
    setBudgetStatus(currentBudget);
    if (currentBudget.blocked) {
      setMessages((prev) => [
        ...prev,
        userMessage,
        { role: 'assistant', content: `[vela] 예산 한도 초과 — 메시지를 보낼 수 없습니다. (한도: $${currentBudget.limit!.toFixed(4)}, 사용: $${currentBudget.spent.toFixed(4)})` },
      ]);
      return;
    }

    // Append user message to persistent conversation ref
    conversationRef.current = [
      ...conversationRef.current,
      { role: 'user' as const, content: input },
    ];

    if (mountedRef.current) {
      setMessages((prev) => [...prev, userMessage]);
      setStreamingState(true);
      setError(null);
      setStreamingText('');
    }

    // Auto-create session on first submit if none exists
    if (!sessionIdRef.current && sessionDbRef.current) {
      try {
        const title = input.slice(0, 50);
        const session = createSession(sessionDbRef.current, {
          model: currentModelRef.current,
          system: system ?? null,
          title,
        });
        sessionIdRef.current = session.id;
        onSessionCreated?.(session.id);
      } catch (e) {
        process.stderr.write(`[vela] session create failed: ${e instanceof Error ? e.message : String(e)}\n`);
      }
    }

    try {
      // ── Unified message path: shim + full tool loop ──────

      // Auto-routing: select model based on message complexity and budget
      let effectiveModel = currentModelRef.current;
      if (autoRouteRef.current) {
        const routing = selectModel(input, currentBudget, currentModelRef.current, isExplicitModelRef.current);
        if (routing.model !== currentModelRef.current) {
          // Show system message about routing decision
          if (mountedRef.current) {
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', content: `[vela] 🔄 자동 라우팅: ${routing.model} (${routing.reason})` },
            ]);
          }
          process.stderr.write(`[vela] auto-route: ${routing.model} (${routing.reason})\n`);
        }
        effectiveModel = routing.model;
        setRoutedModel(routing.model !== currentModelRef.current ? routing.model : null);
      }

      const opts: SendMessageOptions = {
        model: effectiveModel,
        maxTokens,
        system,
        onText: (text) => {
          if (mountedRef.current) {
            setStreamingText((prev) => prev + text);
          }
        },
      };

      let response = await sendMessage(null, conversationRef.current, opts);
      trackUsage(response);
      let iterations = 0;

      // Accumulate tool call metadata across all iterations
      const allToolCalls: ToolCallInfo[] = [];

      // Tool loop: keep going while Claude wants to use tools
      while (isToolUseResponse(response) && iterations < MAX_TOOL_ITERATIONS) {
        // Check retry budget before executing
        if (retryBudgetRef.current) {
          const check = retryBudgetRef.current.shouldTerminate();
          if (check.terminate) break;
        }

        iterations++;

        const toolBlocks = extractToolUseBlocks(response);

        // Push assistant content to persistent conversation ref
        conversationRef.current = [
          ...conversationRef.current,
          {
            role: 'assistant',
            content: response.content as ContentBlockParam[],
          },
        ];

        // Build ToolContext for this iteration
        const gateCtx = gateContextRef.current ?? undefined;
        const toolCtx: ToolContext | undefined = gateCtx
          ? {
              gate: gateCtx,
              retryBudget: retryBudgetRef.current ?? undefined,
              artifactDir: gateCtx.artifactDir,
              velaDir: gateCtx.velaDir,
            }
          : undefined;

        // Execute tools — parallel where safe, sequential for file conflicts
        if (mountedRef.current) {
          setCurrentTool(toolBlocks.length === 1 ? toolBlocks[0].name : `${toolBlocks.length} tools`);
        }

        const toolResults = await executeToolsParallel(toolBlocks, toolCtx);

        // Process results for TUI state tracking
        for (let i = 0; i < toolBlocks.length; i++) {
          const block = toolBlocks[i];
          const tr = toolResults[i];
          const result = tr.content as string;
          const is_error = !!tr.is_error;

          // Build ToolCallInfo for inline display
          let tcStatus: ToolCallInfo['status'] = 'complete';
          let tcGateCode: string | undefined;
          if (is_error && result.includes('BLOCKED')) {
            tcStatus = 'blocked';
            const match = result.match(/BLOCKED \[([^\]]+)\]/);
            tcGateCode = match?.[1] ?? 'UNKNOWN';
          }

          allToolCalls.push({
            name: block.name,
            status: tcStatus,
            result,
            isError: is_error || undefined,
            gateCode: tcGateCode,
          });

          // Detect gate blocks and update TUI state
          if (tcStatus === 'blocked') {
            if (mountedRef.current) {
              setGateVerdict({ blocked: true, code: tcGateCode! });
              setConsecutiveBlocks((prev) => prev + 1);
            }
          } else {
            if (mountedRef.current) {
              setGateVerdict(null);
              setConsecutiveBlocks(0);
            }
          }
        }

        if (mountedRef.current) {
          setCurrentTool(null);
          setStreamingText('');
        }

        // Push tool results to persistent conversation ref
        conversationRef.current = [
          ...conversationRef.current,
          {
            role: 'user',
            content: toolResults as ContentBlockParam[],
          },
        ];

        // Send next turn
        response = await sendMessage(null, conversationRef.current, opts);
        trackUsage(response);
      }

      // Finalize: extract text from final response
      const finalText = response.content
        .filter((block): block is TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      // Push final assistant response to persistent conversation ref
      conversationRef.current = [
        ...conversationRef.current,
        {
          role: 'assistant',
          content: response.content as ContentBlockParam[],
        },
      ];

      if (mountedRef.current) {
        const assistantMsg: Message = {
          role: 'assistant',
          content: finalText,
          ...(allToolCalls.length > 0 ? { toolCalls: allToolCalls } : {}),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingText('');
      }

      // Auto-trigger context reset when token threshold is exceeded
      if (shouldResetContext(tokenTrackerRef.current.getState().totalTokens)) {
        try {
          const summary = await summarizeConversation(
            conversationRef.current,
            'claude-haiku-4-20250514',
          );
          const freshConversation = buildFreshContext(summary, conversationRef.current);
          conversationRef.current = freshConversation;

          // Reset token tracker
          tokenTrackerRef.current.reset();
          setDashboardState(tokenTrackerRef.current.getState());
          setCostState(tokenTrackerRef.current.getCost(currentModelRef.current));

          const autoResetMsg = `[vela] 토큰 사용량이 임계치를 초과하여 자동으로 컨텍스트를 리셋했습니다.\n요약:\n${summary}`;

          if (mountedRef.current) {
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', content: autoResetMsg },
            ]);
          }

          // Persist auto-reset message to session DB (fail-open per K013)
          if (sessionDbRef.current && sessionIdRef.current) {
            try {
              addSessionMessage(sessionDbRef.current, {
                session_id: sessionIdRef.current,
                role: 'assistant',
                display: autoResetMsg,
                content: autoResetMsg,
              });
            } catch { /* fail-open */ }
          }

          process.stderr.write('[vela] context reset: conversation replaced\n');
        } catch (autoErr: unknown) {
          // Fail-open: continue with original conversation silently
          process.stderr.write(
            `[vela] auto context reset failed: ${autoErr instanceof Error ? autoErr.message : String(autoErr)}\n`,
          );
        }
      }

      // Save messages to session DB (fail-open per K013)
      if (sessionDbRef.current && sessionIdRef.current) {
        try {
          addSessionMessage(sessionDbRef.current, {
            session_id: sessionIdRef.current,
            role: 'user',
            display: input,
            content: input,
          });
          addSessionMessage(sessionDbRef.current, {
            session_id: sessionIdRef.current,
            role: 'assistant',
            display: finalText,
            content: response.content,
          });
        } catch (e) {
          process.stderr.write(`[vela] session save failed: ${e instanceof Error ? e.message : String(e)}\n`);
        }
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStreamingText('');
        setCurrentTool(null);
      }
    } finally {
      if (mountedRef.current) {
        setStreamingState(false);
      }

      // Queue drain: process next queued message if any (K016 — ref reads latest state)
      if (messageQueueRef.current.length > 0) {
        const next = messageQueueRef.current.shift()!;
        setQueueLength(messageQueueRef.current.length);
        // Do NOT await — fire-and-forget to avoid stacking (processMessage sets isStreaming internally)
        processMessage(next);
      }
    }
  }

  // Compute body height for MessageList scroll — use stdout rows with fallback
  const screenRows = process.stdout.rows ?? 24;
  const bodyHeight = Math.max(screenRows - 3 - 3, 4); // header=3, input=3

  return (
    <FullscreenLayout
      headerHeight={3}
      inputHeight={3}
      sidebarVisible={dashboardVisible}
      sidebar={
        <Dashboard
          inputTokens={dashboardState.inputTokens}
          outputTokens={dashboardState.outputTokens}
          totalTokens={dashboardState.totalTokens}
          estimatedCost={costState}
          model={currentModel}
          pipelineMode={pipelineMode}
          sessionId={sessionIdRef.current}
          sessionTitle={null}
          budgetLimit={budgetStatus.limit}
          budgetSpent={budgetStatus.spent}
          budgetRemaining={budgetStatus.remaining}
          budgetPercentage={budgetStatus.percentage}
          budgetWarning={budgetStatus.warning}
          budgetBlocked={budgetStatus.blocked}
          routedModel={routedModel}
          providerType={provider.type}
          workspacePath={process.cwd()}
        />
      }
      header={
        <Box flexDirection="column">
          <Header />
          <GovernanceStatus
            mode={pipelineMode}
            consecutiveBlocks={consecutiveBlocks}
            budgetLimit={DEFAULT_RETRY_BUDGET}
          />
        </Box>
      }
      body={
        <Box flexDirection="column" flexGrow={1}>
          <HelpOverlay visible={helpVisible} />
          <MessageList key={clearCount} messages={messages} streamingText={streamingText} isStreaming={isStreaming} height={bodyHeight} />
          <ToolStatus
            toolName={currentTool ?? undefined}
            isRunning={currentTool !== null}
            gateVerdict={gateVerdict}
          />
          {error ? (
            <Box>
              <Text color={theme.error}>Error: {error}</Text>
            </Box>
          ) : null}
        </Box>
      }
      input={
        <Box flexDirection="column">
          <ChatInput onSubmit={handleSubmit} isStreaming={isStreaming} />
          {queueLength > 0 ? (
            <Box paddingLeft={2}>
              <Text color={theme.highlight}>queued: {queueLength}/{MAX_QUEUE_SIZE}</Text>
            </Box>
          ) : null}
        </Box>
      }
    />
  );
}
