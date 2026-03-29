/**
 * MessageList — Renderable component that displays conversation history
 * with role labels, Markdown-rendered assistant responses, and inline
 * tool activity indicators.
 *
 * Follows the tui2 render(width) → string[] contract (K029).
 * Uses raw ANSI SGR codes, not ink's color system (K028).
 */

import { Markdown, createMarkdownTheme } from './markdown.js';
import type { MarkdownTheme } from './markdown.js';
import { wrapTextWithAnsi, visibleWidth } from '../utils.js';
import { theme } from '../../tui/theme.js';

// ── ANSI SGR constants ──────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';

/** Map semantic color names to ANSI SGR foreground codes (K032: self-contained). */
const COLOR_MAP: Record<string, string> = {
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

/** Map semantic color names to ANSI SGR background codes (K032: self-contained). */
const BG_COLOR_MAP: Record<string, string> = {
  black: '\x1b[40m',
  red: '\x1b[41m',
  green: '\x1b[42m',
  yellow: '\x1b[43m',
  blue: '\x1b[44m',
  magenta: '\x1b[45m',
  cyan: '\x1b[46m',
  white: '\x1b[47m',
  gray: '\x1b[100m',
};

function sgr(color: string | undefined): string {
  if (!color) return '';
  return COLOR_MAP[color] ?? '';
}

function sgrBg(color: string | undefined): string {
  if (!color) return '';
  return BG_COLOR_MAP[color] ?? '';
}

// ── Public types ────────────────────────────────────────────────────────────

/** A display-ready message for the MessageList. */
export interface DisplayMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: { toolName: string; status: 'running' | 'done'; summary?: string }[];
}

// ── MessageList component ───────────────────────────────────────────────────

/**
 * MessageList renders conversation messages with role labels,
 * Markdown for assistant content, and tool activity indicators.
 *
 * Implements the Renderable interface: render(width) → string[].
 */
export class MessageList {
  private messages: DisplayMessage[] = [];
  private streamingText: string | null = null;
  private streamingTools: { toolName: string; status: 'running' | 'done' }[] = [];
  private thinkingTimer: ReturnType<typeof setInterval> | null = null;
  private thinkingDots = 0;
  private onThinkingTick?: () => void;
  private markdownTheme: MarkdownTheme;
  private markdown: Markdown;

  // Render cache
  private cacheKey: string | undefined;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  constructor() {
    this.markdownTheme = createMarkdownTheme(theme);
    this.markdown = new Markdown('', this.markdownTheme);
  }

  /** Append a message to the list. */
  addMessage(msg: DisplayMessage): void {
    this.messages.push(msg);
    this.invalidate();
  }

  /** Set or clear the streaming text accumulator. null = not streaming. */
  setStreamingText(text: string | null): void {
    this.streamingText = text;

    // Start thinking animation when waiting for first token (empty string)
    if (text === "") {
      this.startThinkingAnimation();
    } else {
      this.stopThinkingAnimation();
    }

    this.invalidate();
  }

  /** Register callback for thinking animation ticks (triggers re-render). */
  setOnThinkingTick(cb: () => void): void {
    this.onThinkingTick = cb;
  }

  private startThinkingAnimation(): void {
    if (this.thinkingTimer) return;
    this.thinkingDots = 0;
    this.thinkingTimer = setInterval(() => {
      this.thinkingDots = (this.thinkingDots + 1) % 4;
      this.invalidate();
      this.onThinkingTick?.();
    }, 400);
  }

  private stopThinkingAnimation(): void {
    if (this.thinkingTimer) {
      clearInterval(this.thinkingTimer);
      this.thinkingTimer = null;
      this.thinkingDots = 0;
    }
  }

  /** Add or update a tool in the streaming tool list. */
  addStreamingTool(toolName: string, status: 'running' | 'done'): void {
    const existing = this.streamingTools.find((t) => t.toolName === toolName);
    if (existing) {
      existing.status = status;
    } else {
      this.streamingTools.push({ toolName, status });
    }
    this.invalidate();
  }

  /** Clear the streaming tool list. */
  clearStreamingTools(): void {
    this.streamingTools = [];
    this.invalidate();
  }

  /** Reset all state. */
  clear(): void {
    this.messages = [];
    this.streamingText = null;
    this.streamingTools = [];
    this.stopThinkingAnimation();
    this.invalidate();
  }

  invalidate(): void {
    this.cacheKey = undefined;
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  /** Render the message list to terminal lines. */
  render(width: number): string[] {
    const key = this.computeCacheKey();
    if (this.cachedLines && this.cacheKey === key && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines: string[] = [];

    // Render committed messages
    for (let i = 0; i < this.messages.length; i++) {
      if (i > 0) {
        // Dim horizontal rule separator (~40% of width)
        const sepColor = sgr(theme.message.separator);
        const ruleLen = Math.max(4, Math.floor(width * 0.4));
        lines.push(`${sepColor}${DIM}${'─'.repeat(ruleLen)}${RESET}`);
      }
      lines.push(...this.renderMessage(this.messages[i]!, width));
    }

    // Render streaming state
    if (this.streamingText !== null) {
      if (this.messages.length > 0) {
        const sepColor = sgr(theme.message.separator);
        const ruleLen = Math.max(4, Math.floor(width * 0.4));
        lines.push(`${sepColor}${DIM}${'─'.repeat(ruleLen)}${RESET}`);
      }
      lines.push(...this.renderStreaming(width));
    }

    this.cacheKey = key;
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  // ── Private rendering ─────────────────────────────────────────────────

  private renderMessage(msg: DisplayMessage, width: number): string[] {
    switch (msg.role) {
      case 'user':
        return this.renderUserMessage(msg, width);
      case 'assistant':
        return this.renderAssistantMessage(msg, width);
      case 'system':
        return this.renderSystemMessage(msg, width);
    }
  }

  private renderUserMessage(msg: DisplayMessage, width: number): string[] {
    const labelColor = sgr(theme.userLabel);
    const label = 'You ▎';
    const labelW = visibleWidth(label);
    const pad = Math.max(0, width - labelW);
    const lines: string[] = [];

    // Right-aligned role label
    lines.push(`${' '.repeat(pad)}${labelColor}${BOLD}${label}${RESET}`);

    // Content with 2-space left indent
    const contentWidth = Math.max(1, width - 2);
    const wrapped = wrapTextWithAnsi(msg.content, contentWidth);
    for (const line of wrapped) {
      lines.push(`  ${line}`);
    }

    return lines;
  }

  private renderAssistantMessage(msg: DisplayMessage, width: number): string[] {
    const velaColor = sgr(theme.velaLabel);
    const dimColor = sgr(theme.dim);
    const lines: string[] = [];

    // Role label
    lines.push(`${velaColor}${BOLD}⛵ Vela${RESET}`);

    // Content via Markdown renderer with dim '▎ ' left border
    const borderPrefix = `${dimColor}▎${RESET} `;
    const borderW = visibleWidth('▎ ');
    const contentWidth = Math.max(1, width - borderW);
    this.markdown.setText(msg.content);
    const mdLines = this.markdown.render(contentWidth);
    for (const line of mdLines) {
      lines.push(`${borderPrefix}${line}`);
    }

    // Tool calls if present
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tool of msg.toolCalls) {
        lines.push(this.renderToolLine(tool.toolName, tool.status));
      }
    }

    return lines;
  }

  private renderSystemMessage(msg: DisplayMessage, width: number): string[] {
    const badgeBg = sgrBg(theme.message.systemBadgeBg);
    const badgeFg = sgr(theme.message.systemBadgeFg);
    const dimColor = sgr(theme.dim);
    const lines: string[] = [];

    // Badge line
    lines.push(`${badgeBg}${badgeFg}${BOLD} SYSTEM ${RESET}`);

    // Content as dim italic wrapped text
    lines.push(...wrapTextWithAnsi(`${dimColor}${ITALIC}${msg.content}${RESET}`, width));

    return lines;
  }

  private renderStreaming(width: number): string[] {
    const velaColor = sgr(theme.velaLabel);
    const dimColor = sgr(theme.dim);
    const lines: string[] = [];

    // Role label
    lines.push(`${velaColor}${BOLD}⛵ Vela${RESET}`);

    // Thinking indicator when waiting for first token
    if (this.streamingText === "") {
      const dots = '.'.repeat(this.thinkingDots);
      const pad = ' '.repeat(3 - this.thinkingDots);
      lines.push(`${dimColor}▎ Thinking${dots}${pad}${RESET}`);
    } else if (this.streamingText) {
      // Streaming text via Markdown with dim '▎ ' left border
      const borderPrefix = `${dimColor}▎${RESET} `;
      const borderW = visibleWidth('▎ ');
      const contentWidth = Math.max(1, width - borderW);
      this.markdown.setText(this.streamingText);
      const mdLines = this.markdown.render(contentWidth);
      for (const line of mdLines) {
        lines.push(`${borderPrefix}${line}`);
      }
    }

    // Active tool lines
    for (const tool of this.streamingTools) {
      lines.push(this.renderToolLine(tool.toolName, tool.status));
    }

    return lines;
  }

  private renderToolLine(toolName: string, status: 'running' | 'done'): string {
    const dimColor = sgr(theme.dim);
    if (status === 'running') {
      const runColor = sgr(theme.toolRunning);
      return `${dimColor}  ${runColor}⏳ ${toolName}${RESET}`;
    }
    const doneColor = sgr(theme.toolComplete);
    return `${dimColor}  ${doneColor}✓ ${toolName}${RESET}`;
  }

  private computeCacheKey(): string {
    // Simple serialization for cache invalidation
    return JSON.stringify({
      m: this.messages.length,
      last: this.messages.length > 0 ? this.messages[this.messages.length - 1]!.content.length : 0,
      st: this.streamingText,
      tools: this.streamingTools.length,
    });
  }
}
