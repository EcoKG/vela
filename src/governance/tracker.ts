/**
 * Vela Tracker — tool use, agent dispatch, and build/test signal tracking.
 * Ported from src/hooks/tracker.cjs to typed ESM.
 *
 * All functions are fail-open: I/O errors are swallowed.
 * Trace entries match the TraceEntry interface in cost.ts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Build/Test Pattern Detection ───

export const BUILD_PATTERNS: RegExp[] = [
  /\b(npm|npx|yarn|pnpm)\s+(run\s+)?build\b/,
  /\btsc\b/,
  /\bgo\s+build\b/,
  /\bcargo\s+build\b/,
  /\bmake\b/,
  /\bgradlew?\s+build\b/,
  /\bmvn\s+(compile|package)\b/,
  /\bdotnet\s+build\b/,
];

export const TEST_PATTERNS: RegExp[] = [
  /\b(npm|npx|yarn|pnpm)\s+(run\s+)?test\b/,
  /\b(jest|vitest|mocha|ava)\b/,
  /\bpytest\b/,
  /\bgo\s+test\b/,
  /\bcargo\s+test\b/,
  /\bgradlew?\s+test\b/,
  /\bmvn\s+test\b/,
  /\bdotnet\s+test\b/,
];

export const FAIL_INDICATORS: RegExp[] = [
  /(?<!0\s)(error|fail|FAIL|ERROR)/i,
  /exit\s+code\s+[1-9]/,
  /FAILED/,
  /npm\s+ERR!/,
];

export const PASS_INDICATORS: RegExp[] = [
  /\bpass(ed)?\b/i,
  /\b0\s+(errors?|failures?)\b/i,
  /\ball\s+tests?\s+pass/i,
  /✓|✔|PASS/,
];

// ─── Trace helpers ───

/**
 * Append a JSONL entry to {artifactDir}/trace.jsonl.
 * Fail-open: swallows all write errors.
 */
function appendTraceEntry(artifactDir: string, entry: Record<string, unknown>): void {
  try {
    const tracePath = path.join(artifactDir, 'trace.jsonl');
    fs.appendFileSync(tracePath, JSON.stringify(entry) + '\n');
  } catch {
    // fail-open
  }
}

// ─── Public API ───

/**
 * Record a tool_use event to trace.jsonl.
 * Entry format: { action: 'tool_use', tool, step, timestamp }
 */
export function trackToolUse(
  artifactDir: string,
  entry: { tool: string; step: string | null },
): void {
  appendTraceEntry(artifactDir, {
    action: 'tool_use',
    tool: entry.tool,
    step: entry.step,
    timestamp: Date.now(),
  });
}

/**
 * Record an agent_dispatch event to trace.jsonl.
 * Entry format: { action: 'agent_dispatch', tool, description, step, timestamp }
 */
export function trackAgentDispatch(
  artifactDir: string,
  entry: { tool: string; description: string; step: string | null },
): void {
  appendTraceEntry(artifactDir, {
    action: 'agent_dispatch',
    tool: entry.tool,
    description: entry.description,
    step: entry.step,
    timestamp: Date.now(),
  });
}

/**
 * Classify a Bash command + output as a build or test signal.
 * Returns null if the command doesn't match any build/test pattern.
 */
export function classifyBashResult(
  command: string,
  output: string,
): { signalType: 'build' | 'test'; result: 'pass' | 'fail' | 'unknown' } | null {
  // Check build patterns first
  for (const pattern of BUILD_PATTERNS) {
    if (pattern.test(command)) {
      const isFail = FAIL_INDICATORS.some((fi) => fi.test(output));
      const isPass = PASS_INDICATORS.some((pi) => pi.test(output));
      return {
        signalType: 'build',
        result: isFail ? 'fail' : isPass ? 'pass' : 'unknown',
      };
    }
  }

  // Check test patterns
  for (const pattern of TEST_PATTERNS) {
    if (pattern.test(command)) {
      const isFail = FAIL_INDICATORS.some((fi) => fi.test(output));
      const isPass = PASS_INDICATORS.some((pi) => pi.test(output));
      return {
        signalType: 'test',
        result: isFail ? 'fail' : isPass ? 'pass' : 'unknown',
      };
    }
  }

  return null;
}

interface TrackerSignalEntry {
  type: string;
  result: string;
  timestamp: number;
}

/**
 * Record a build/test signal to both trace.jsonl and tracker-signals.json.
 * The signals file is a JSON array capped at 50 entries.
 * Fail-open on all I/O.
 */
export function trackBuildTestSignal(
  artifactDir: string,
  velaDir: string,
  signal: {
    signalType: string;
    result: string;
    command: string;
    step: string | null;
  },
): void {
  // 1. Append to trace.jsonl
  appendTraceEntry(artifactDir, {
    action: 'build_test_signal',
    signal_type: signal.signalType,
    result: signal.result,
    command: signal.command.substring(0, 200),
    step: signal.step,
    timestamp: Date.now(),
  });

  // 2. Write/update tracker-signals.json in velaDir root
  try {
    const signalsPath = path.join(velaDir, 'tracker-signals.json');
    let signals: TrackerSignalEntry[] = [];

    // Read existing signals
    try {
      const raw = fs.readFileSync(signalsPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        signals = parsed;
      }
    } catch {
      // File doesn't exist or corrupt — start fresh
    }

    // Append new entry
    signals.push({
      type: signal.signalType,
      result: signal.result,
      timestamp: Date.now(),
    });

    // Cap at 50 entries
    if (signals.length > 50) {
      signals = signals.slice(signals.length - 50);
    }

    fs.writeFileSync(signalsPath, JSON.stringify(signals), 'utf-8');
  } catch {
    // fail-open
  }
}
