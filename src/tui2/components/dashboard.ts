/**
 * Dashboard overlay component — displays model, token usage, and cost.
 *
 * Self-contained ANSI color map (does NOT import ansiColor from app.ts).
 * Rendered as a TUI overlay anchored top-right, toggled via Ctrl+D.
 */

import { theme } from "../../tui/theme.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DashboardData {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

// ── Self-contained ANSI helpers ─────────────────────────────────────────────

const ANSI_RESET = "\x1b[0m";

const COLOR_MAP: Record<string, string> = {
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

function ansi(name: string | undefined): string {
  if (!name) return "";
  return COLOR_MAP[name] ?? "";
}

function bold(): string {
  return "\x1b[1m";
}

// ── Formatting helpers ──────────────────────────────────────────────────────

/** Format a number with comma separators: 12345 → "12,345" */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/** Format cost as dollar string: 0.0523 → "$0.0523", 0 → "$0.00" */
export function formatCost(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

// ── Dashboard component ─────────────────────────────────────────────────────

export class Dashboard {
  private data: DashboardData = {
    model: "",
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
  };

  setData(data: DashboardData): void {
    this.data = data;
  }

  render(width: number): string[] {
    const titleColor = ansi(theme.dashboard.title);
    const borderColor = ansi(theme.dashboard.border);
    const dimColor = ansi("gray");

    const border = `${borderColor}│${ANSI_RESET}`;
    // Inner width is width minus the border character and the space after it
    const innerWidth = Math.max(1, width - 2);

    const lines: string[] = [];

    // Title line: │ ⛵ Dashboard
    const titleText = `${titleColor}${bold()}⛵ Dashboard${ANSI_RESET}`;
    lines.push(`${border} ${titleText}`);

    // Separator: │ ─────────
    const separator = "─".repeat(innerWidth);
    lines.push(`${border} ${dimColor}${separator}${ANSI_RESET}`);

    // Model: truncated to fit inner width
    const modelLabel = "Model: ";
    const modelMaxLen = Math.max(1, innerWidth - modelLabel.length);
    const modelName =
      this.data.model.length > modelMaxLen
        ? this.data.model.slice(0, modelMaxLen - 1) + "…"
        : this.data.model;
    lines.push(`${border} ${dimColor}${modelLabel}${ANSI_RESET}${modelName}`);

    // Input tokens
    const inputStr = formatNumber(this.data.inputTokens);
    lines.push(
      `${border} ${dimColor}Input:  ${ANSI_RESET}${inputStr}`,
    );

    // Output tokens
    const outputStr = formatNumber(this.data.outputTokens);
    lines.push(
      `${border} ${dimColor}Output: ${ANSI_RESET}${outputStr}`,
    );

    // Cost
    const costStr = formatCost(this.data.cost);
    lines.push(
      `${border} ${dimColor}Cost:   ${ANSI_RESET}${costStr}`,
    );

    return lines;
  }
}
