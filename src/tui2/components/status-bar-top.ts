/**
 * Top status bar component — model, session, and pipeline status.
 *
 * Self-contained ANSI color map (does NOT import ansiColor from app.ts).
 * Renders a single full-width line with theme-driven background fill.
 */

import { theme } from "../../tui/theme.js";
import { visibleWidth } from "../utils.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface StatusBarTopData {
  model: string;
  sessionId: string | null;
  pipelineStatus: string | null;
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

function bold(): string {
  return "\x1b[1m";
}

const SEP = " │ ";

// ── TopStatusBar component ──────────────────────────────────────────────────

export class TopStatusBar {
  private data: StatusBarTopData = {
    model: "",
    sessionId: null,
    pipelineStatus: null,
  };

  setData(data: StatusBarTopData): void {
    this.data = data;
  }

  render(width: number): string[] {
    const bgCode = bg(theme.statusBar.bg);
    const fgCode = fg(theme.statusBar.fg);
    const accentCode = fg(theme.statusBar.accent);
    const dimCode = fg(theme.statusBar.dim);

    // Build segments: brand │ model │ session: id │ pipeline: status
    const brand = "⛵ Vela";
    const segments: string[] = [brand];

    if (this.data.model) {
      segments.push(this.data.model);
    }

    if (this.data.sessionId) {
      segments.push(`session: ${this.data.sessionId}`);
    }

    if (this.data.pipelineStatus) {
      segments.push(`pipeline: ${this.data.pipelineStatus}`);
    }

    // Calculate available width for content (excluding separators)
    const separatorCount = segments.length - 1;
    const sepWidth = visibleWidth(SEP);
    const totalSepWidth = separatorCount * sepWidth;
    const availableForContent = width - totalSepWidth;

    // If very narrow, just show brand
    if (availableForContent < visibleWidth(brand) + 4) {
      const brandLine = brand;
      const pad = Math.max(0, width - visibleWidth(brandLine));
      return [
        `${bgCode}${fgCode}${accentCode}${bold()}${brandLine}${ANSI_RESET}${bgCode}${" ".repeat(pad)}${ANSI_RESET}`,
      ];
    }

    // Truncate model and session if needed
    const brandWidth = visibleWidth(brand);
    let remaining = availableForContent - brandWidth;

    const truncatedSegments: string[] = [brand];

    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i]!;
      const segWidth = visibleWidth(seg);
      if (segWidth <= remaining) {
        truncatedSegments.push(seg);
        remaining -= segWidth;
      } else if (remaining > 4) {
        // Truncate with ellipsis
        const truncated = seg.slice(0, Math.max(1, remaining - 1)) + "…";
        truncatedSegments.push(truncated);
        remaining = 0;
      }
      // else: skip segment entirely
    }

    // Build the colored line and track visible width
    let content = `${accentCode}${bold()}${truncatedSegments[0]}${ANSI_RESET}${bgCode}${fgCode}`;
    let contentWidth = visibleWidth(truncatedSegments[0]!);

    for (let i = 1; i < truncatedSegments.length; i++) {
      content += ` ${dimCode}│${ANSI_RESET}${bgCode}${fgCode} ${truncatedSegments[i]}`;
      contentWidth += sepWidth + visibleWidth(truncatedSegments[i]!);
    }

    const pad = Math.max(0, width - contentWidth);

    return [
      `${bgCode}${fgCode}${content}${bgCode}${" ".repeat(pad)}${ANSI_RESET}`,
    ];
  }
}
