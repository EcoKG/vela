/**
 * Tests for HelpOverlay Renderable component.
 *
 * HelpOverlay is a pure Renderable — no terminal/TUI dependency.
 * Tests cover rendering structure, command listing, shortcut listing,
 * Escape dismiss, and width handling.
 */

import { describe, it, expect, vi } from "vitest";
import stripAnsi from "strip-ansi";
import {
  HelpOverlay,
  SLASH_COMMANDS,
} from "../src/tui2/components/help-overlay.js";

function strip(lines: string[]): string[] {
  return lines.map((l) => stripAnsi(l));
}

describe("HelpOverlay rendering", () => {
  it("renders title and section headers", () => {
    const overlay = new HelpOverlay();
    const lines = overlay.render(50);
    const plain = strip(lines);

    expect(plain[0]).toContain("Help");
    // Separator line
    expect(plain[1]).toContain("─");

    // Section headers present somewhere in the output
    const joined = plain.join("\n");
    expect(joined).toContain("Slash Commands");
    expect(joined).toContain("Keyboard Shortcuts");
  });

  it("shows all slash commands", () => {
    const overlay = new HelpOverlay();
    const lines = overlay.render(60);
    const plain = strip(lines);
    const joined = plain.join("\n");

    for (const cmd of SLASH_COMMANDS) {
      expect(joined).toContain(cmd.command);
      expect(joined).toContain(cmd.description);
    }
  });

  it("shows keyboard shortcuts", () => {
    const overlay = new HelpOverlay();
    const lines = overlay.render(60);
    const plain = strip(lines);
    const joined = plain.join("\n");

    expect(joined).toContain("Ctrl+D");
    expect(joined).toContain("Ctrl+L");
    expect(joined).toContain("Ctrl+C");
    expect(joined).toContain("Escape");
  });

  it("shows dismiss instruction", () => {
    const overlay = new HelpOverlay();
    const lines = overlay.render(50);
    const plain = strip(lines);
    const joined = plain.join("\n");

    expect(joined).toContain("Press Escape to dismiss");
  });

  it("respects width parameter — border character present on each line", () => {
    const overlay = new HelpOverlay();
    const lines = overlay.render(30);
    const plain = strip(lines);

    for (const line of plain) {
      expect(line.startsWith("│")).toBe(true);
    }
  });

  it("renders at different widths without error", () => {
    const overlay = new HelpOverlay();

    // Narrow
    const narrow = overlay.render(20);
    expect(narrow.length).toBeGreaterThan(0);

    // Wide
    const wide = overlay.render(80);
    expect(wide.length).toBeGreaterThan(0);

    // Both should have the same number of lines (content doesn't wrap)
    expect(narrow.length).toBe(wide.length);
  });
});

describe("HelpOverlay handleInput", () => {
  it("calls onDismiss when Escape is pressed (legacy)", () => {
    const onDismiss = vi.fn();
    const overlay = new HelpOverlay(onDismiss);

    overlay.handleInput("\x1b");

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("calls onDismiss when Escape is pressed (Kitty protocol)", () => {
    const onDismiss = vi.fn();
    const overlay = new HelpOverlay(onDismiss);

    // Kitty protocol sends Escape as CSI 27 u
    overlay.handleInput("\x1b[27u");

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("does not call onDismiss for non-Escape input", () => {
    const onDismiss = vi.fn();
    const overlay = new HelpOverlay(onDismiss);

    overlay.handleInput("a");
    overlay.handleInput("\x03"); // Ctrl+C
    overlay.handleInput("\x1b[A"); // Arrow Up (CSI sequence starts with \x1b[ — but arrives as multi-byte)

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("does not throw when no onDismiss callback provided", () => {
    const overlay = new HelpOverlay();

    expect(() => overlay.handleInput("\x1b")).not.toThrow();
  });
});
