/**
 * Tracker Module — Unit Tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  trackToolUse,
  trackAgentDispatch,
  classifyBashResult,
  trackBuildTestSignal,
} from '../../src/governance/tracker.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-tracker-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════
// trackToolUse
// ═══════════════════════════════════════════════════════════════

describe('trackToolUse', () => {
  it('writes correct JSONL entry format', () => {
    trackToolUse(tmpDir, { tool: 'Read', step: 'research' });

    const tracePath = path.join(tmpDir, 'trace.jsonl');
    expect(fs.existsSync(tracePath)).toBe(true);

    const line = fs.readFileSync(tracePath, 'utf-8').trim();
    const entry = JSON.parse(line);
    expect(entry.action).toBe('tool_use');
    expect(entry.tool).toBe('Read');
    expect(entry.step).toBe('research');
    expect(typeof entry.timestamp).toBe('number');
  });

  it('appends multiple entries as separate lines', () => {
    trackToolUse(tmpDir, { tool: 'Read', step: null });
    trackToolUse(tmpDir, { tool: 'Write', step: 'execute' });

    const lines = fs.readFileSync(path.join(tmpDir, 'trace.jsonl'), 'utf-8')
      .trim().split('\n');
    expect(lines.length).toBe(2);

    const e1 = JSON.parse(lines[0]);
    const e2 = JSON.parse(lines[1]);
    expect(e1.tool).toBe('Read');
    expect(e2.tool).toBe('Write');
  });

  it('handles null step', () => {
    trackToolUse(tmpDir, { tool: 'Bash', step: null });

    const entry = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'trace.jsonl'), 'utf-8').trim(),
    );
    expect(entry.step).toBeNull();
  });

  it('fail-open: does not throw with invalid artifactDir', () => {
    expect(() => {
      trackToolUse('/nonexistent/path/that/does/not/exist', { tool: 'Read', step: null });
    }).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// trackAgentDispatch
// ═══════════════════════════════════════════════════════════════

describe('trackAgentDispatch', () => {
  it('writes agent_dispatch entry', () => {
    trackAgentDispatch(tmpDir, {
      tool: 'Agent',
      description: 'Run code review',
      step: 'execute',
    });

    const entry = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'trace.jsonl'), 'utf-8').trim(),
    );
    expect(entry.action).toBe('agent_dispatch');
    expect(entry.tool).toBe('Agent');
    expect(entry.description).toBe('Run code review');
    expect(entry.step).toBe('execute');
    expect(typeof entry.timestamp).toBe('number');
  });
});

// ═══════════════════════════════════════════════════════════════
// classifyBashResult
// ═══════════════════════════════════════════════════════════════

describe('classifyBashResult', () => {
  it('detects npm test as test signal', () => {
    const result = classifyBashResult('npm test', 'all tests passed');
    expect(result).not.toBeNull();
    expect(result!.signalType).toBe('test');
    expect(result!.result).toBe('pass');
  });

  it('detects npm run build as build signal', () => {
    const result = classifyBashResult('npm run build', '0 errors, build complete');
    expect(result).not.toBeNull();
    expect(result!.signalType).toBe('build');
    expect(result!.result).toBe('pass');
  });

  it('detects vitest as test signal', () => {
    const result = classifyBashResult('npx vitest run', 'Tests passed');
    expect(result).not.toBeNull();
    expect(result!.signalType).toBe('test');
    expect(result!.result).toBe('pass');
  });

  it('detects tsc as build signal', () => {
    const result = classifyBashResult('tsc --noEmit', '');
    expect(result).not.toBeNull();
    expect(result!.signalType).toBe('build');
    expect(result!.result).toBe('unknown');
  });

  it('detects jest as test signal', () => {
    const result = classifyBashResult('jest --coverage', 'PASS src/index.test.ts');
    expect(result).not.toBeNull();
    expect(result!.signalType).toBe('test');
    expect(result!.result).toBe('pass');
  });

  it('detects pytest as test signal', () => {
    const result = classifyBashResult('pytest -v', '3 passed');
    expect(result).not.toBeNull();
    expect(result!.signalType).toBe('test');
    expect(result!.result).toBe('pass');
  });

  it('detects cargo build as build signal', () => {
    const result = classifyBashResult('cargo build --release', 'error[E0308]');
    expect(result).not.toBeNull();
    expect(result!.signalType).toBe('build');
    expect(result!.result).toBe('fail');
  });

  it('returns null for non-build/test commands', () => {
    expect(classifyBashResult('ls -la', '')).toBeNull();
    expect(classifyBashResult('cat README.md', '')).toBeNull();
    expect(classifyBashResult('git status', '')).toBeNull();
    expect(classifyBashResult('echo hello', '')).toBeNull();
  });

  it('classifies fail correctly', () => {
    const result = classifyBashResult('npm test', 'FAILED 3 tests');
    expect(result).not.toBeNull();
    expect(result!.result).toBe('fail');
  });

  it('classifies unknown when no pass/fail indicators', () => {
    const result = classifyBashResult('npm test', '');
    expect(result).not.toBeNull();
    expect(result!.result).toBe('unknown');
  });

  it('fail takes priority over pass', () => {
    // When both fail and pass indicators are present, fail wins
    const result = classifyBashResult('npm test', '3 tests passed, 1 FAILED');
    expect(result).not.toBeNull();
    expect(result!.result).toBe('fail');
  });
});

// ═══════════════════════════════════════════════════════════════
// trackBuildTestSignal
// ═══════════════════════════════════════════════════════════════

describe('trackBuildTestSignal', () => {
  it('writes to both trace.jsonl and tracker-signals.json', () => {
    const velaDir = path.join(tmpDir, '.vela');
    fs.mkdirSync(velaDir, { recursive: true });

    trackBuildTestSignal(tmpDir, velaDir, {
      signalType: 'test',
      result: 'pass',
      command: 'npm test',
      step: 'execute',
    });

    // Check trace.jsonl
    const traceLine = fs.readFileSync(path.join(tmpDir, 'trace.jsonl'), 'utf-8').trim();
    const traceEntry = JSON.parse(traceLine);
    expect(traceEntry.action).toBe('build_test_signal');
    expect(traceEntry.signal_type).toBe('test');
    expect(traceEntry.result).toBe('pass');
    expect(traceEntry.command).toBe('npm test');
    expect(traceEntry.step).toBe('execute');

    // Check tracker-signals.json
    const signalsPath = path.join(velaDir, 'tracker-signals.json');
    expect(fs.existsSync(signalsPath)).toBe(true);
    const signals = JSON.parse(fs.readFileSync(signalsPath, 'utf-8'));
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('test');
    expect(signals[0].result).toBe('pass');
  });

  it('truncates command to 200 chars in trace entry', () => {
    const velaDir = path.join(tmpDir, '.vela');
    fs.mkdirSync(velaDir, { recursive: true });
    const longCmd = 'npm test -- ' + 'a'.repeat(300);

    trackBuildTestSignal(tmpDir, velaDir, {
      signalType: 'test',
      result: 'pass',
      command: longCmd,
      step: null,
    });

    const entry = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'trace.jsonl'), 'utf-8').trim(),
    );
    expect(entry.command.length).toBe(200);
  });

  it('caps tracker-signals.json at 50 entries', () => {
    const velaDir = path.join(tmpDir, '.vela');
    fs.mkdirSync(velaDir, { recursive: true });

    // Pre-populate with 49 entries
    const existing = Array.from({ length: 49 }, (_, i) => ({
      type: 'test',
      result: 'pass',
      timestamp: Date.now() - (49 - i) * 1000,
    }));
    fs.writeFileSync(
      path.join(velaDir, 'tracker-signals.json'),
      JSON.stringify(existing),
      'utf-8',
    );

    // Add 3 more → total would be 52, should cap at 50
    trackBuildTestSignal(tmpDir, velaDir, {
      signalType: 'build', result: 'pass', command: 'npm run build', step: null,
    });
    trackBuildTestSignal(tmpDir, velaDir, {
      signalType: 'test', result: 'fail', command: 'npm test', step: null,
    });
    trackBuildTestSignal(tmpDir, velaDir, {
      signalType: 'build', result: 'pass', command: 'tsc', step: null,
    });

    const signals = JSON.parse(
      fs.readFileSync(path.join(velaDir, 'tracker-signals.json'), 'utf-8'),
    );
    expect(signals.length).toBe(50);

    // Last entry should be the most recent
    expect(signals[49].type).toBe('build');
    expect(signals[49].result).toBe('pass');
  });

  it('fail-open: does not throw when velaDir does not exist', () => {
    expect(() => {
      trackBuildTestSignal(
        '/nonexistent/artifact',
        '/nonexistent/vela',
        { signalType: 'test', result: 'pass', command: 'npm test', step: null },
      );
    }).not.toThrow();
  });

  it('starts fresh when tracker-signals.json is corrupt', () => {
    const velaDir = path.join(tmpDir, '.vela');
    fs.mkdirSync(velaDir, { recursive: true });
    fs.writeFileSync(path.join(velaDir, 'tracker-signals.json'), 'NOT JSON', 'utf-8');

    trackBuildTestSignal(tmpDir, velaDir, {
      signalType: 'test', result: 'pass', command: 'npm test', step: null,
    });

    const signals = JSON.parse(
      fs.readFileSync(path.join(velaDir, 'tracker-signals.json'), 'utf-8'),
    );
    expect(signals).toHaveLength(1);
  });
});
