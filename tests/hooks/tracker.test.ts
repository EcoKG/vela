/**
 * Tests for tracker.cjs — PostToolUse hook.
 *
 * Invokes the real CJS script via child_process.execSync with mock stdin JSON.
 * Sets up a temp `.vela/` directory with an active pipeline so trace.jsonl
 * entries are written and can be verified.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

const TRACKER_PATH = path.resolve(__dirname, '../../src/hooks/tracker.cjs');

let tmpDir: string;

/**
 * Create a minimal .vela/ directory with an active pipeline so
 * `findActivePipeline()` returns a valid state with _artifactDir.
 */
function writeActivePipeline(
  cwd: string,
  opts: { step?: string; status?: string } = {},
): string {
  const velaDir = path.join(cwd, '.vela');
  const artDir = path.join(velaDir, 'artifacts', '2026-01-01_001_test');
  fs.mkdirSync(artDir, { recursive: true });
  fs.writeFileSync(
    path.join(artDir, 'pipeline-state.json'),
    JSON.stringify({
      status: opts.status ?? 'active',
      current_step: opts.step ?? 'execute',
      pipeline_type: 'standard',
    }),
  );
  return artDir;
}

/**
 * Invoke tracker.cjs with the given stdin payload.
 * Returns { exitCode, stdout, stderr }.
 */
function invokeTracker(
  stdinPayload: unknown,
): { exitCode: number; stdout: string; stderr: string } {
  const input =
    typeof stdinPayload === 'string'
      ? stdinPayload
      : JSON.stringify(stdinPayload);

  try {
    const stdout = execSync(`node "${TRACKER_PATH}"`, {
      input,
      timeout: 5000,
      encoding: 'utf-8',
      env: { ...process.env, NODE_PATH: '' },
    });
    return { exitCode: 0, stdout: stdout || '', stderr: '' };
  } catch (err: any) {
    return {
      exitCode: err.status ?? 1,
      stdout: (err.stdout || '').toString(),
      stderr: (err.stderr || '').toString(),
    };
  }
}

/**
 * Read trace.jsonl and return parsed entries.
 */
function readTrace(artDir: string): any[] {
  const tracePath = path.join(artDir, 'trace.jsonl');
  if (!fs.existsSync(tracePath)) return [];
  return fs
    .readFileSync(tracePath, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-tracker-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('tracker hook', () => {
  // ──────────────────────────────────────────────────────
  // Core: tool_use entry logging
  // ──────────────────────────────────────────────────────
  describe('tool_use tracing', () => {
    it('writes a tool_use entry to trace.jsonl with correct fields', () => {
      const artDir = writeActivePipeline(tmpDir);

      const result = invokeTracker({
        tool_name: 'Read',
        tool_input: { file_path: 'src/app.ts' },
        tool_output: 'file content here',
        session_id: 'sess-123',
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);

      const entries = readTrace(artDir);
      const toolUse = entries.find((e) => e.action === 'tool_use');
      expect(toolUse).toBeDefined();
      expect(toolUse.tool).toBe('Read');
      expect(toolUse.step).toBe('execute');
      expect(toolUse.timestamp).toBeTypeOf('number');
    });

    it('multiple tool calls append (not overwrite) to trace.jsonl', () => {
      const artDir = writeActivePipeline(tmpDir);

      invokeTracker({
        tool_name: 'Read',
        tool_input: {},
        cwd: tmpDir,
      });
      invokeTracker({
        tool_name: 'Write',
        tool_input: {},
        cwd: tmpDir,
      });
      invokeTracker({
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
        cwd: tmpDir,
      });

      const entries = readTrace(artDir);
      const toolUseEntries = entries.filter((e) => e.action === 'tool_use');
      expect(toolUseEntries.length).toBeGreaterThanOrEqual(3);
      expect(toolUseEntries[0].tool).toBe('Read');
      expect(toolUseEntries[1].tool).toBe('Write');
      expect(toolUseEntries[2].tool).toBe('Bash');
    });
  });

  // ──────────────────────────────────────────────────────
  // Agent dispatch detection
  // ──────────────────────────────────────────────────────
  describe('agent_dispatch detection', () => {
    it('writes agent_dispatch entry when tool_name is "Agent"', () => {
      const artDir = writeActivePipeline(tmpDir);

      const result = invokeTracker({
        tool_name: 'Agent',
        tool_input: { description: 'Run research sub-agent' },
        tool_output: 'agent output',
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);

      const entries = readTrace(artDir);
      const dispatch = entries.find((e) => e.action === 'agent_dispatch');
      expect(dispatch).toBeDefined();
      expect(dispatch.tool).toBe('Agent');
      expect(dispatch.description).toBe('Run research sub-agent');
      expect(dispatch.step).toBe('execute');
    });

    it('writes agent_dispatch entry when tool_name is "Task"', () => {
      const artDir = writeActivePipeline(tmpDir);

      invokeTracker({
        tool_name: 'Task',
        tool_input: { description: 'Execute sub-task' },
        cwd: tmpDir,
      });

      const entries = readTrace(artDir);
      const dispatch = entries.find((e) => e.action === 'agent_dispatch');
      expect(dispatch).toBeDefined();
      expect(dispatch.tool).toBe('Task');
    });

    it('writes agent_dispatch entry when tool_name is "dispatch_agent"', () => {
      const artDir = writeActivePipeline(tmpDir);

      invokeTracker({
        tool_name: 'dispatch_agent',
        tool_input: {},
        cwd: tmpDir,
      });

      const entries = readTrace(artDir);
      const dispatch = entries.find((e) => e.action === 'agent_dispatch');
      expect(dispatch).toBeDefined();
      expect(dispatch.tool).toBe('dispatch_agent');
    });

    it('does NOT write agent_dispatch for non-agent tools', () => {
      const artDir = writeActivePipeline(tmpDir);

      invokeTracker({
        tool_name: 'Read',
        tool_input: {},
        cwd: tmpDir,
      });

      const entries = readTrace(artDir);
      const dispatches = entries.filter((e) => e.action === 'agent_dispatch');
      expect(dispatches).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────
  // Build/test signal detection
  // ──────────────────────────────────────────────────────
  describe('build_test_signal detection', () => {
    it('detects build signal from "npm run build"', () => {
      const artDir = writeActivePipeline(tmpDir);

      invokeTracker({
        tool_name: 'Bash',
        tool_input: { command: 'npm run build' },
        tool_output: 'Build succeeded. 0 errors.',
        cwd: tmpDir,
      });

      const entries = readTrace(artDir);
      const signal = entries.find(
        (e) => e.action === 'build_test_signal' && e.signal_type === 'build',
      );
      expect(signal).toBeDefined();
      expect(signal.result).toBe('pass');
      expect(signal.command).toContain('npm run build');
    });

    it('detects test signal from "npx vitest"', () => {
      const artDir = writeActivePipeline(tmpDir);

      invokeTracker({
        tool_name: 'Bash',
        tool_input: { command: 'npx vitest run tests/' },
        tool_output: 'Tests: 10 passed, 0 failed',
        cwd: tmpDir,
      });

      const entries = readTrace(artDir);
      const signal = entries.find(
        (e) => e.action === 'build_test_signal' && e.signal_type === 'test',
      );
      expect(signal).toBeDefined();
      expect(signal.result).toBe('pass');
    });

    it('detects failed build signal', () => {
      const artDir = writeActivePipeline(tmpDir);

      invokeTracker({
        tool_name: 'Bash',
        tool_input: { command: 'npm run build' },
        tool_output: 'error TS2304: Cannot find name "foo".\n1 error found.',
        cwd: tmpDir,
      });

      const entries = readTrace(artDir);
      const signal = entries.find(
        (e) => e.action === 'build_test_signal' && e.signal_type === 'build',
      );
      expect(signal).toBeDefined();
      expect(signal.result).toBe('fail');
    });

    it('detects failed test signal', () => {
      const artDir = writeActivePipeline(tmpDir);

      invokeTracker({
        tool_name: 'Bash',
        tool_input: { command: 'npx vitest run' },
        tool_output: 'FAILED Tests: 2 failed, 8 passed',
        cwd: tmpDir,
      });

      const entries = readTrace(artDir);
      const signal = entries.find(
        (e) => e.action === 'build_test_signal' && e.signal_type === 'test',
      );
      expect(signal).toBeDefined();
      expect(signal.result).toBe('fail');
    });

    it('does NOT log build_test_signal for non-Bash tools', () => {
      const artDir = writeActivePipeline(tmpDir);

      invokeTracker({
        tool_name: 'Read',
        tool_input: { command: 'npm run build' },
        cwd: tmpDir,
      });

      const entries = readTrace(artDir);
      const signals = entries.filter((e) => e.action === 'build_test_signal');
      expect(signals).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────
  // Fail-open behavior
  // ──────────────────────────────────────────────────────
  describe('fail-open behavior', () => {
    it('exits 0 when no active pipeline exists', () => {
      // No .vela/artifacts at all
      fs.mkdirSync(path.join(tmpDir, '.vela'), { recursive: true });

      const result = invokeTracker({
        tool_name: 'Read',
        tool_input: {},
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when no .vela directory exists', () => {
      const result = invokeTracker({
        tool_name: 'Read',
        tool_input: {},
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('exits 0 on malformed stdin JSON', () => {
      const result = invokeTracker('this is not json {{{');
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 on empty stdin', () => {
      const result = invokeTracker('');
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when tool_name is missing', () => {
      writeActivePipeline(tmpDir);

      const result = invokeTracker({
        tool_input: { command: 'ls' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when cwd is missing', () => {
      const result = invokeTracker({
        tool_name: 'Read',
        tool_input: {},
      });

      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when pipeline status is completed (no active pipeline)', () => {
      writeActivePipeline(tmpDir, { status: 'completed' });

      const result = invokeTracker({
        tool_name: 'Read',
        tool_input: {},
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────
  // Negative tests — boundary conditions
  // ──────────────────────────────────────────────────────
  describe('negative tests / boundary conditions', () => {
    it('trace.jsonl is not created when no artifactDir exists', () => {
      // Pipeline exists but artifactDir has been removed after findActivePipeline
      // Actually, test: no active pipeline → no trace
      fs.mkdirSync(path.join(tmpDir, '.vela'), { recursive: true });

      invokeTracker({
        tool_name: 'Read',
        tool_input: {},
        cwd: tmpDir,
      });

      // No trace.jsonl anywhere under .vela/
      const artDir = path.join(tmpDir, '.vela', 'artifacts');
      expect(fs.existsSync(artDir)).toBe(false);
    });

    it('handles empty tool_output without crashing', () => {
      const artDir = writeActivePipeline(tmpDir);

      const result = invokeTracker({
        tool_name: 'Bash',
        tool_input: { command: 'npm run build' },
        tool_output: '',
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);

      const entries = readTrace(artDir);
      expect(entries.length).toBeGreaterThan(0);
    });

    it('handles very long tool_input without crashing', () => {
      const artDir = writeActivePipeline(tmpDir);
      const longInput = 'x'.repeat(100000);

      const result = invokeTracker({
        tool_name: 'Write',
        tool_input: { content: longInput },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);

      const entries = readTrace(artDir);
      expect(entries.some((e) => e.action === 'tool_use')).toBe(true);
    });

    it('handles null stdin JSON', () => {
      const result = invokeTracker('null');
      expect(result.exitCode).toBe(0);
    });

    it('handles missing tool_input field', () => {
      const artDir = writeActivePipeline(tmpDir);

      const result = invokeTracker({
        tool_name: 'Read',
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);

      const entries = readTrace(artDir);
      expect(entries.some((e) => e.action === 'tool_use')).toBe(true);
    });
  });
});
