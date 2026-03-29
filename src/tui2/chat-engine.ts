/**
 * Chat engine — pure logic module for conversation state and LLM streaming.
 *
 * No rendering, no terminal I/O. Encapsulates conversation history,
 * double-submit guard, and wires sendMessage() callbacks to ChatEngineCallbacks.
 */

import type { SendMessageOptions, ChatMessage } from '../llm.js';

// ── Public types ──────────────────────────────────────────────

/** Tool activity tracked per assistant message. */
export interface ToolActivity {
  toolName: string;
  toolId: string;
  status: 'running' | 'done';
  summary?: string;
}

/** A message in the chat engine's conversation history. */
export interface ChatEngineMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolActivity[];
  /** Token usage from the LLM response (assistant messages only). */
  usage?: { inputTokens: number; outputTokens: number };
}

/** Callbacks the UI layer provides to receive streaming events. */
export interface ChatEngineCallbacks {
  onMessageStart: () => void;
  onTextDelta: (text: string) => void;
  onToolStart: (toolName: string, toolId: string) => void;
  onToolDone: (toolName: string, toolId: string, summary?: string) => void;
  onMessageComplete: (message: ChatEngineMessage) => void;
  onError: (error: string) => void;
}

/** Configuration options for the chat engine. */
export interface ChatEngineOptions {
  model?: string;
  system?: string;
  maxTurns?: number;
}

// ── ChatEngine class ──────────────────────────────────────────

export class ChatEngine {
  private _history: ChatEngineMessage[] = [];
  private _isStreaming = false;
  private _callbacks: ChatEngineCallbacks;
  private _model?: string;
  private _system?: string;
  private _maxTurns?: number;

  constructor(callbacks: ChatEngineCallbacks, options?: ChatEngineOptions) {
    this._callbacks = callbacks;
    this._model = options?.model;
    this._system = options?.system;
    this._maxTurns = options?.maxTurns;
  }

  /** Read-only access to conversation history. */
  get history(): readonly ChatEngineMessage[] {
    return this._history;
  }

  /** Whether a streaming request is in progress. */
  get isStreaming(): boolean {
    return this._isStreaming;
  }

  /** Update the model for subsequent messages. */
  setModel(model: string): void {
    this._model = model;
  }

  /** Reset conversation history. */
  clearHistory(): void {
    this._history = [];
  }

  /**
   * Replace conversation history with a set of restored messages.
   * Used by /resume to inject a prior session's history.
   */
  restoreHistory(messages: ChatEngineMessage[]): void {
    this._history = [...messages];
  }

  /**
   * Submit a user message. Guards against double-submit.
   * Pushes user message to history, calls sendMessage() with streaming
   * callbacks wired to ChatEngineCallbacks, and pushes assistant message
   * on completion.
   */
  async submit(text: string): Promise<void> {
    if (this._isStreaming) return;

    this._isStreaming = true;

    // Push user message
    const userMsg: ChatEngineMessage = { role: 'user', content: text };
    this._history.push(userMsg);

    this._callbacks.onMessageStart();

    // Accumulate assistant response
    let assistantText = '';
    const toolCalls: ToolActivity[] = [];

    try {
      // Dynamic import to match ESM pattern and enable test mocking
      const { sendMessage } = await import('../llm.js');

      // Build ChatMessage array for sendMessage
      const messages: ChatMessage[] = this._history
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const options: SendMessageOptions = {
        model: this._model,
        system: this._system,
        maxTurns: this._maxTurns,
        onText: (delta: string) => {
          assistantText += delta;
          this._callbacks.onTextDelta(delta);
        },
        onToolStart: (toolName: string, toolId: string) => {
          toolCalls.push({ toolName, toolId, status: 'running' });
          this._callbacks.onToolStart(toolName, toolId);
        },
        onToolDone: (toolName: string, toolId: string, summary?: string) => {
          // Update existing tool activity to done
          const existing = toolCalls.find((t) => t.toolId === toolId);
          if (existing) {
            existing.status = 'done';
            existing.summary = summary;
          } else {
            toolCalls.push({ toolName, toolId, status: 'done', summary });
          }
          this._callbacks.onToolDone(toolName, toolId, summary);
        },
      };

      const result = await sendMessage(messages, options);

      // Extract usage data from LLM response (K017: merge assistant + result usage)
      const usage = result.usage
        ? { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens }
        : undefined;

      // Push assistant message to history
      const assistantMsg: ChatEngineMessage = {
        role: 'assistant',
        content: assistantText,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage,
      };
      this._history.push(assistantMsg);

      this._callbacks.onMessageComplete(assistantMsg);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this._callbacks.onError(msg);
    } finally {
      this._isStreaming = false;
    }
  }
}
