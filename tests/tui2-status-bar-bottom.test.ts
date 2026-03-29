/**
 * Tests for BottomStatusBar Renderable component.
 *
 * Pure Renderable — no terminal/TUI dependency.
 * Tests cover rendering structure, token/cost formatting, width handling.
 */

import { describe, it, expect } from "vitest";
import stripAnsi from "strip-ansi";
import { BottomStatusBar } from "../src/tui2/components/status-bar-bottom.js";
import { visibleWidth } from "../src/tui2/utils.js";

function strip(lines: string[]): string[] {
  return lines.map((l) => stripAnsi(l));
}

describe("BottomStatusBar rendering", () => {
  it("renders correct structure with default (zero) data", () => {
    const bar = new BottomStatusBar();
    const lines = bar.render(80);
    expect(lines).toHaveLength(1);
    const plain = strip(lines);
    expect(plain[0]).toContain("tokens:");
    expect(plain[0]).toContain("$0.00");
  });

  it("render() returns exactly 1 line", () => {
    const bar = new BottomStatusBar();
    bar.setData({ inputTokens: 1000, outputTokens: 500, cost: 0.05 });
    expect(bar.render(80)).toHaveLength(1);
    expect(bar.render(40)).toHaveLength(1);
    expect(bar.render(120)).toHaveLength(1);
  });

  it("setData updates rendered output", () => {
    const bar = new BottomStatusBar();
    bar.setData({ inputTokens: 12345, outputTokens: 6789, cost: 0.0523 });
    const plain = strip(bar.render(80));
    expect(plain[0]).toContain("12,345");
    expect(plain[0]).toContain("6,789");
    expect(plain[0]).toContain("$0.05");
  });

  it("formats token counts with commas", () => {
    const bar = new BottomStatusBar();
    bar.setData({ inputTokens: 1234567, outputTokens: 890, cost: 0 });
    const plain = strip(bar.render(100));
    expect(plain[0]).toContain("1,234,567");
    expect(plain[0]).toContain("890");
  });

  it("formats zero cost as $0.00", () => {
    const bar = new BottomStatusBar();
    bar.setData({ inputTokens: 0, outputTokens: 0, cost: 0 });
    const plain = strip(bar.render(80));
    expect(plain[0]).toContain("$0.00");
  });

  it("formats small cost with 4 decimal places", () => {
    const bar = new BottomStatusBar();
    bar.setData({ inputTokens: 0, outputTokens: 0, cost: 0.0052 });
    const plain = strip(bar.render(80));
    expect(plain[0]).toContain("$0.0052");
  });

  it("formats larger cost with 2 decimal places", () => {
    const bar = new BottomStatusBar();
    bar.setData({ inputTokens: 0, outputTokens: 0, cost: 1.50 });
    const plain = strip(bar.render(80));
    expect(plain[0]).toContain("$1.50");
  });

  it("shows shortcut hints when width is sufficient", () => {
    const bar = new BottomStatusBar();
    const plain = strip(bar.render(100));
    expect(plain[0]).toContain("Ctrl+D: dashboard");
    expect(plain[0]).toContain("/help");
    expect(plain[0]).toContain("/quit");
  });

  it("hides shortcuts when width is too narrow for both sides", () => {
    const bar = new BottomStatusBar();
    bar.setData({ inputTokens: 100, outputTokens: 50, cost: 0.01 });
    // At width 45, there isn't room for left + sep + shortcuts
    const plain = strip(bar.render(45));
    expect(plain[0]).toContain("tokens:");
    expect(plain[0]).not.toContain("/quit");
  });

  it("shows token format: N in / M out", () => {
    const bar = new BottomStatusBar();
    bar.setData({ inputTokens: 500, outputTokens: 200, cost: 0 });
    const plain = strip(bar.render(80));
    expect(plain[0]).toContain("500 in / 200 out");
  });

  it("uses │ separator between cost and shortcuts", () => {
    const bar = new BottomStatusBar();
    const plain = strip(bar.render(80));
    expect(plain[0]).toContain("│");
  });

  it("handles wide terminal (120 cols)", () => {
    const bar = new BottomStatusBar();
    bar.setData({ inputTokens: 9999, outputTokens: 1234, cost: 0.15 });
    const lines = bar.render(120);
    const plain = strip(lines);
    expect(visibleWidth(plain[0]!)).toBe(120);
  });

  it("handles very narrow width without crashing", () => {
    const bar = new BottomStatusBar();
    bar.setData({ inputTokens: 100, outputTokens: 50, cost: 0.01 });
    const lines = bar.render(10);
    expect(lines).toHaveLength(1);
    const plain = strip(lines);
    expect(plain[0]!.length).toBeGreaterThan(0);
  });

  it("line contains ANSI escape codes (colored output)", () => {
    const bar = new BottomStatusBar();
    const lines = bar.render(80);
    expect(lines[0]!.length).toBeGreaterThan(strip(lines)[0]!.length);
  });
});
