import React, { useState, useRef, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';

import { Header } from './Header.js';
import { MessageList } from './MessageList.js';
import type { Message } from './MessageList.js';
import { ChatInput } from './ChatInput.js';
import { ToolStatus } from './ToolStatus.js';
import { GovernanceStatus } from './GovernanceStatus.js';
import { Dashboard } from './Dashboard.js';
import { HelpOverlay } from './HelpOverlay.js';
import { handleSlashCommand } from './shortcuts.js';
import { BudgetManager } from '../budget-manager.js';
import type { BudgetStatus } from '../budget-manager.js';

import {
  createClaudeClient,
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
import { sendMessageViaCli } from '../claude-code-adapter.js';
import { TokenTracker } from '../token-tracker.js';
import type { Provider } from '../provider.js';
import type { TokenState, CostEstimate } from '../token-tracker.js';
import type { ChatMessage, SendMessageOptions } from '../claude-client.js';
import { executeTool, TOOL_DEFINITIONS } from '../tool-engine.js';
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
    };
  }, []);

  // Prevent setState after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
    if (input === 'q' && !isStreamingRef.current) {
      exit();
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
            // Enabling: reset explicit flag so auto-routing takes effect
            isExplicitModelRef.current = false;
          } else {
            // Disabling: clear routed model display
            setRoutedModel(null);
          }
          setMessages((prev) => [
            ...prev,
            userMsg,
            { role: 'assistant', content: `[vela] 🔄 자동 라우팅 ${newAutoRoute ? '활성화' : '비활성화'}` },
          ]);
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
          // Context reset is only supported for API provider
          if (provider.type !== 'api') {
            setMessages((prev) => [
              ...prev,
              userMsg,
              { role: 'assistant', content: '[vela] 컨텍스트 리셋은 API 모드에서만 지원됩니다' },
            ]);
            return;
          }

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
            const client = createClaudeClient((provider as { type: 'api'; apiKey: string }).apiKey);
            const summary = await summarizeConversation(
              client,
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
      if (provider.type === 'cli') {
        // ── CLI provider path: delegate to Claude Code CLI ──────
        // No tool loop, no auto-routing, no auto context reset
        const cliResponse = await sendMessageViaCli(conversationRef.current, {
          model: currentModelRef.current,
          system,
          onText: (text) => {
            if (mountedRef.current) {
              setStreamingText((prev) => prev + text);
            }
          },
        });
        trackUsage(cliResponse);

        const finalText = cliResponse.content
          .filter((block): block is TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('');

        conversationRef.current = [
          ...conversationRef.current,
          {
            role: 'assistant',
            content: cliResponse.content as ContentBlockParam[],
          },
        ];

        if (mountedRef.current) {
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: finalText },
          ]);
          setStreamingText('');
          setStreamingState(false);
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
              content: cliResponse.content,
            });
          } catch (e) {
            process.stderr.write(`[vela] session save failed: ${e instanceof Error ? e.message : String(e)}\n`);
          }
        }
      } else {
      // ── API provider path: full Anthropic API + tool loop ──────
      const client = createClaudeClient(provider.apiKey);

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
        tools: TOOL_DEFINITIONS,
        onText: (text) => {
          if (mountedRef.current) {
            setStreamingText((prev) => prev + text);
          }
        },
      };

      let response = await sendMessage(client, conversationRef.current, opts);
      trackUsage(response);
      let iterations = 0;

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

        // Execute each tool
        const toolResults: ToolResultBlockParam[] = [];
        for (const block of toolBlocks) {
          if (mountedRef.current) {
            setCurrentTool(block.name);
          }

          const { result, is_error } = await executeTool(
            block.name,
            block.input as Record<string, unknown>,
            toolCtx,
          );

          // Detect gate blocks and update TUI state
          if (is_error && result.includes('BLOCKED')) {
            const match = result.match(/BLOCKED \[([^\]]+)\]/);
            const code = match?.[1] ?? 'UNKNOWN';
            if (mountedRef.current) {
              setGateVerdict({ blocked: true, code });
              setConsecutiveBlocks((prev) => prev + 1);
            }
          } else {
            if (mountedRef.current) {
              setGateVerdict(null);
              setConsecutiveBlocks(0);
            }
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
            ...(is_error ? { is_error: true } : {}),
          });
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
        response = await sendMessage(client, conversationRef.current, opts);
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
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: finalText },
        ]);
        setStreamingText('');
      }

      // Auto-trigger context reset when token threshold is exceeded
      if (provider.type === 'api' && shouldResetContext(tokenTrackerRef.current.getState().totalTokens)) {
        try {
          const summary = await summarizeConversation(
            client,
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

      if (mountedRef.current) {
        setStreamingState(false);
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
      } // end else (API provider path)
    } catch (err: unknown) {
      if (mountedRef.current) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStreamingState(false);
        setStreamingText('');
        setCurrentTool(null);
      }
    }
  }

  return (
    <Box flexDirection="column">
      <Header />
      <GovernanceStatus
        mode={pipelineMode}
        consecutiveBlocks={consecutiveBlocks}
        budgetLimit={DEFAULT_RETRY_BUDGET}
      />
      {dashboardVisible && (
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
        />
      )}
      <HelpOverlay visible={helpVisible} />
      <MessageList key={clearCount} messages={messages} streamingText={streamingText} />
      <ToolStatus
        toolName={currentTool ?? undefined}
        isRunning={currentTool !== null}
        gateVerdict={gateVerdict}
      />
      {error ? (
        <Box>
          <Text color="red">Error: {error}</Text>
        </Box>
      ) : null}
      <ChatInput onSubmit={handleSubmit} isDisabled={isStreaming} />
    </Box>
  );
}
