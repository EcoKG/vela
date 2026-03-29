/**
 * Help overlay component — lists all slash commands and keyboard shortcuts.
 *
 * Self-contained ANSI color map (K032 pattern — does NOT import ansiColor from app.ts).
 * Rendered as a TUI overlay anchored center, dismissable via Escape.
 */

import { theme } from "../../tui/theme.js";
import { SHORTCUT_LIST } from "../../tui/shortcuts.js";
import type { ShortcutDef } from "../../tui/shortcuts.js";
import { matchesKey } from "../keys.js";

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

// ── Slash command definitions ───────────────────────────────────────────────

export interface CommandDef {
  command: string;
  description: string;
}

export const SLASH_COMMANDS: CommandDef[] = [
  { command: "/help", description: "Show this help overlay" },
  { command: "/quit", description: "Exit Vela" },
  { command: "/clear", description: "Clear messages and history" },
  { command: "/fresh", description: "Clear context, keep session" },
  { command: "/sessions", description: "List saved sessions" },
  { command: "/model [name]", description: "Show or switch model" },
  { command: "/budget [amt]", description: "Show or set budget" },
  { command: "/init", description: "Initialize Vela project" },
  { command: "/start <task>", description: "Start a pipeline task" },
  { command: "/state", description: "Show pipeline state" },
  { command: "/transition", description: "Advance pipeline step" },
  { command: "/cancel", description: "Cancel active pipeline" },
];

// ── Keyboard shortcut definitions for display ───────────────────────────────

const DISPLAY_SHORTCUTS: ShortcutDef[] = [
  ...SHORTCUT_LIST,
  { keys: "Ctrl+C", description: "Exit Vela" },
];

// ── HelpOverlay component ───────────────────────────────────────────────────

export class HelpOverlay {
  private onDismiss: (() => void) | null;

  constructor(onDismiss?: () => void) {
    this.onDismiss = onDismiss ?? null;
  }

  handleInput(data: string): void {
    // Escape key — works with both legacy (\x1b) and Kitty protocol (\x1b[27u)
    if (matchesKey(data, "escape")) {
      this.onDismiss?.();
    }
  }

  render(width: number): string[] {
    const accentColor = ansi(theme.dashboard.title);
    const dimColor = ansi("gray");
    const borderColor = ansi(theme.dashboard.border);
    const innerWidth = Math.max(1, width - 4); // 2 border + 2 padding

    const border = `${borderColor}│${ANSI_RESET}`;
    const lines: string[] = [];

    // ── Title ─────────────────────────────────────────────────────────
    lines.push(`${border} ${accentColor}${bold()}Help${ANSI_RESET}`);

    // ── Separator ─────────────────────────────────────────────────────
    const sep = "─".repeat(innerWidth);
    lines.push(`${border} ${dimColor}${sep}${ANSI_RESET}`);

    // ── Slash Commands section ────────────────────────────────────────
    lines.push(`${border} ${accentColor}${bold()}Slash Commands${ANSI_RESET}`);

    for (const cmd of SLASH_COMMANDS) {
      const cmdText = cmd.command;
      const descText = cmd.description;
      lines.push(
        `${border}   ${ansi("cyan")}${cmdText}${ANSI_RESET}  ${dimColor}${descText}${ANSI_RESET}`,
      );
    }

    // ── Blank separator ───────────────────────────────────────────────
    lines.push(`${border}`);

    // ── Keyboard Shortcuts section ────────────────────────────────────
    lines.push(
      `${border} ${accentColor}${bold()}Keyboard Shortcuts${ANSI_RESET}`,
    );

    for (const shortcut of DISPLAY_SHORTCUTS) {
      lines.push(
        `${border}   ${ansi("yellow")}${shortcut.keys}${ANSI_RESET}  ${dimColor}${shortcut.description}${ANSI_RESET}`,
      );
    }

    // ── Footer ────────────────────────────────────────────────────────
    lines.push(`${border}`);
    lines.push(
      `${border} ${dimColor}Press Escape to dismiss${ANSI_RESET}`,
    );

    return lines;
  }
}
