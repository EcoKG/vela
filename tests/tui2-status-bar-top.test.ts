/**
 * Tests for TopStatusBar Renderable component.
 *
 * Pure Renderable — no terminal/TUI dependency.
 * Tests cover rendering structure, data updates, truncation, and width handling.
 */

import { describe, it, expect } from "vitest";
import stripAnsi from "strip-ansi";
import { TopStatusBar } from "../src/tui2/components/status-bar-top.js";
import { visibleWidth } from "../src/tui2/utils.js";

function strip(lines: string[]): string[] {
  return lines.map((l) => stripAnsi(l));
}

describe("TopStatusBar rendering", () => {
  it("renders correct structure with default (zero) data", () => {
    const bar = new TopStatusBar();
    const lines = bar.render(80);
    expect(lines).toHaveLength(1);
    const plain = strip(lines);
    expect(plain[0]).toContain("⛵ Vela");
  });

  it("render() returns exactly 1 line", () => {
    const bar = new TopStatusBar();
    bar.setData({ model: "test", sessionId: "abc", pipelineStatus: "active" });
    expect(bar.render(80)).toHaveLength(1);
    expect(bar.render(40)).toHaveLength(1);
    expect(bar.render(120)).toHaveLength(1);
  });

  it("setData updates rendered output with model", () => {
    const bar = new TopStatusBar();
    bar.setData({ model: "claude-sonnet-4-20250514", sessionId: null, pipelineStatus: null });
    const plain = strip(bar.render(80));
    expect(plain[0]).toContain("claude-sonnet-4-20250514");
  });

  it("shows session ID when provided", () => {
    const bar = new TopStatusBar();
    bar.setData({ model: "test-model", sessionId: "sess_abc123", pipelineStatus: null });
    const plain = strip(bar.render(80));
    expect(plain[0]).toContain("session: sess_abc123");
  });

  it("shows pipeline status when provided", () => {
    const bar = new TopStatusBar();
    bar.setData({ model: "test-model", sessionId: null, pipelineStatus: "active" });
    const plain = strip(bar.render(80));
    expect(plain[0]).toContain("pipeline: active");
  });

  it("omits session and pipeline when null", () => {
    const bar = new TopStatusBar();
    bar.setData({ model: "test-model", sessionId: null, pipelineStatus: null });
    const plain = strip(bar.render(80));
    expect(plain[0]).not.toContain("session:");
    expect(plain[0]).not.toContain("pipeline:");
  });

  it("shows all segments when width is sufficient", () => {
    const bar = new TopStatusBar();
    bar.setData({ model: "claude-sonnet-4-20250514", sessionId: "sess_abc", pipelineStatus: "review" });
    const plain = strip(bar.render(120));
    expect(plain[0]).toContain("⛵ Vela");
    expect(plain[0]).toContain("claude-sonnet-4-20250514");
    expect(plain[0]).toContain("session: sess_abc");
    expect(plain[0]).toContain("pipeline: review");
  });

  it("uses │ as separator between segments", () => {
    const bar = new TopStatusBar();
    bar.setData({ model: "m", sessionId: "s", pipelineStatus: "p" });
    const plain = strip(bar.render(80));
    expect(plain[0]).toContain("│");
  });

  it("truncates model name when terminal is narrow", () => {
    const bar = new TopStatusBar();
    bar.setData({
      model: "claude-sonnet-4-20250514-extra-long-model-name",
      sessionId: null,
      pipelineStatus: null,
    });
    const plain = strip(bar.render(30));
    // Should have an ellipsis if truncated
    expect(plain[0]).toContain("…");
    expect(plain[0]).toContain("⛵ Vela");
  });

  it("handles very narrow width (< 20) without crashing", () => {
    const bar = new TopStatusBar();
    bar.setData({ model: "claude-sonnet-4-20250514", sessionId: "sess_abc", pipelineStatus: "active" });
    const lines = bar.render(10);
    expect(lines).toHaveLength(1);
    // Should at least contain brand or partial
    const plain = strip(lines);
    expect(plain[0]!.length).toBeGreaterThan(0);
  });

  it("handles wide terminal (120 cols)", () => {
    const bar = new TopStatusBar();
    bar.setData({ model: "claude-sonnet-4-20250514", sessionId: "s1", pipelineStatus: "idle" });
    const lines = bar.render(120);
    const plain = strip(lines);
    // visibleWidth counts terminal columns (⛵ = 2 cols)
    expect(visibleWidth(plain[0]!)).toBe(120);
  });

  it("line is padded to full width", () => {
    const bar = new TopStatusBar();
    bar.setData({ model: "test", sessionId: null, pipelineStatus: null });
    const lines = bar.render(60);
    const plain = strip(lines);
    // visibleWidth counts terminal columns (⛵ = 2 cols)
    expect(visibleWidth(plain[0]!)).toBe(60);
  });

  it("line contains ANSI escape codes (colored output)", () => {
    const bar = new TopStatusBar();
    bar.setData({ model: "test", sessionId: null, pipelineStatus: null });
    const lines = bar.render(60);
    // Raw line should be longer than plain due to ANSI codes
    expect(lines[0]!.length).toBeGreaterThan(strip(lines)[0]!.length);
  });
});
