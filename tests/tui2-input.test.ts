/**
 * Tests for Input Renderable component.
 *
 * Pure Renderable — no terminal/TUI dependency.
 * Tests cover default prompt rendering, custom prompt via setPrompt(),
 * ANSI prompt width handling, and model name display.
 */

import { describe, it, expect } from "vitest";
import stripAnsi from "strip-ansi";
import { Input } from "../src/tui2/components/input.js";
import { visibleWidth } from "../src/tui2/utils.js";

function strip(lines: string[]): string[] {
  return lines.map((l) => stripAnsi(l));
}

describe("Input", () => {
  describe("default prompt", () => {
    it("renders with default '> ' prompt", () => {
      const input = new Input();
      input.setValue("hello");
      input._focused = true;
      const lines = input.render(40);
      expect(lines).toHaveLength(1);
      const stripped = strip(lines)[0];
      expect(stripped.startsWith("> ")).toBe(true);
      expect(stripped).toContain("hello");
    });

    it("renders placeholder with default prompt", () => {
      const input = new Input();
      input.placeholder = "Type here…";
      input._focused = true;
      const lines = input.render(40);
      expect(lines).toHaveLength(1);
      const stripped = strip(lines)[0];
      expect(stripped.startsWith("> ")).toBe(true);
      expect(stripped).toContain("Type here");
    });
  });

  describe("setPrompt()", () => {
    it("uses custom plain-text prompt", () => {
      const input = new Input();
      input.setPrompt("$ ");
      input.setValue("ls -la");
      input._focused = true;
      const lines = input.render(40);
      const stripped = strip(lines)[0];
      expect(stripped.startsWith("$ ")).toBe(true);
      expect(stripped).toContain("ls -la");
    });

    it("getPrompt() returns the configured prompt", () => {
      const input = new Input();
      expect(input.getPrompt()).toBe("> ");
      input.setPrompt(">>> ");
      expect(input.getPrompt()).toBe(">>> ");
    });

    it("uses custom prompt with model name", () => {
      const input = new Input();
      input.setPrompt("› claude-sonnet ");
      input.setValue("hello");
      input._focused = true;
      const lines = input.render(60);
      const stripped = strip(lines)[0];
      expect(stripped.startsWith("› claude-sonnet ")).toBe(true);
      expect(stripped).toContain("hello");
    });
  });

  describe("ANSI prompt width handling", () => {
    it("computes available width correctly with ANSI prompt", () => {
      const input = new Input();
      // Simulate a colored prompt: cyan "›" + gray "model" + reset
      const ansiPrompt = "\x1b[36m›\x1b[0m \x1b[90mtest-model\x1b[0m ";
      input.setPrompt(ansiPrompt);
      input.setValue("x".repeat(30));
      input._focused = true;

      const totalWidth = 50;
      const lines = input.render(totalWidth);
      expect(lines).toHaveLength(1);

      // The rendered line's visible width should not exceed the total width
      const lineWidth = visibleWidth(lines[0]);
      expect(lineWidth).toBeLessThanOrEqual(totalWidth);
    });

    it("ANSI escapes do not eat into text space", () => {
      const input = new Input();

      // Plain prompt — 2 visible chars
      input.setPrompt("> ");
      input.setValue("abcdef");
      input._focused = true;
      const plainLines = input.render(20);

      // ANSI prompt — same 2 visible chars but with escape codes
      input.setPrompt("\x1b[36m>\x1b[0m ");
      const ansiLines = input.render(20);

      // Both should show the same text content
      const plainStripped = strip(plainLines)[0];
      const ansiStripped = strip(ansiLines)[0];
      expect(plainStripped).toBe(ansiStripped);
    });

    it("handles empty input with ANSI prompt", () => {
      const input = new Input();
      input.setPrompt("\x1b[36m›\x1b[0m \x1b[90mmodel\x1b[0m ");
      input.placeholder = "Type here…";
      input._focused = true;
      const lines = input.render(40);
      expect(lines).toHaveLength(1);
      const stripped = strip(lines)[0];
      expect(stripped).toContain("›");
      expect(stripped).toContain("model");
      expect(stripped).toContain("Type here");
    });
  });

  describe("model name display", () => {
    it("renders themed model prompt similar to VelaApp format", () => {
      const input = new Input();
      // Replicate VelaApp's updateInputPrompt() format
      const promptColor = "\x1b[36m"; // cyan
      const modelColor = "\x1b[90m"; // gray
      const reset = "\x1b[0m";
      input.setPrompt(`${promptColor}›${reset} ${modelColor}claude-sonnet${reset} `);
      input.setValue("hello world");
      input._focused = true;

      const lines = input.render(60);
      const stripped = strip(lines)[0];
      expect(stripped.startsWith("› claude-sonnet ")).toBe(true);
      expect(stripped).toContain("hello world");
    });

    it("adjusts available text width for long model names", () => {
      const input = new Input();
      input.setPrompt("› very-long-model-name-here ");
      input.setValue("short");
      input._focused = true;

      const lines = input.render(40);
      const lineWidth = visibleWidth(lines[0]);
      expect(lineWidth).toBeLessThanOrEqual(40);
    });

    it("handles width=0 gracefully", () => {
      const input = new Input();
      input.setPrompt("› model ");
      const lines = input.render(0);
      expect(lines).toHaveLength(1);
    });
  });
});
