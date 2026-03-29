/**
 * Bottom status bar component — token usage, cost, and keyboard shortcuts.
 *
 * Self-contained ANSI color map (does NOT import ansiColor from app.ts).
 * Renders a single full-width line with theme-driven background fill.
 */

import { theme } from "../../tui/theme.js";
import { formatNumber, formatCost } from "./dashboard.js";
import { visibleWidth } from "../utils.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface StatusBarBottomData {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

// ── Self-contained ANSI helpers (K032) ──────────────────────────────────────

const ANSI_RESET = "\x1b[0m";

const FG_MAP: Record<string, string> = {
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

const BG_MAP: Record<string, string> = {
  black: "\x1b[40m",
  red: "\x1b[41m",
  green: "\x1b[42m",
  yellow: "\x1b[43m",
  blue: "\x1b[44m",
  magenta: "\x1b[45m",
  cyan: "\x1b[46m",
  white: "\x1b[47m",
  gray: "\x1b[100m",
};

function fg(name: string | undefined): string {
  if (!name) return "";
  return FG_MAP[name] ?? "";
}

function bg(name: string | undefined): string {
  if (!name) return "";
  return BG_MAP[name] ?? "";
}

// ── BottomStatusBar component ───────────────────────────────────────────────

const SHORTCUTS = "Ctrl+D: dashboard  /help  /quit";

export class BottomStatusBar {
  private data: StatusBarBottomData = {
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
  };

  setData(data: StatusBarBottomData): void {
    this.data = data;
  }

  render(width: number): string[] {
    const bgCode = bg(theme.statusBar.bg);
    const fgCode = fg(theme.statusBar.fg);
    const dimCode = fg(theme.statusBar.dim);

    // Build left side: tokens: N in / M out │ $X.XX
    const inStr = formatNumber(this.data.inputTokens);
    const outStr = formatNumber(this.data.outputTokens);
    const costStr = formatCost(this.data.cost);
    const leftContent = `tokens: ${inStr} in / ${outStr} out │ ${costStr}`;

    // Build right side: shortcuts
    const rightContent = SHORTCUTS;
    const leftWidth = visibleWidth(leftContent);
    const rightWidth = visibleWidth(rightContent);

    // Calculate gap between left and right
    const sep = " │ ";
    const sepWidth = visibleWidth(sep);

    let plainContent: string;

    if (leftWidth + sepWidth + rightWidth <= width) {
      // Both sides fit — pad middle with spaces
      const gap = width - leftWidth - rightWidth;
      plainContent = leftContent + " ".repeat(gap) + rightContent;
    } else if (leftWidth + 2 <= width) {
      // Only left side fits — no shortcuts
      plainContent = leftContent;
    } else {
      // Very narrow — minimal info
      plainContent = `${costStr}`;
    }

    const contentWidth = visibleWidth(plainContent);
    const pad = Math.max(0, width - contentWidth);

    return [
      `${bgCode}${fgCode}${dimCode}${plainContent}${" ".repeat(pad)}${ANSI_RESET}`,
    ];
  }
}
