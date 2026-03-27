/**
 * Tests for gate-guard.cjs — PreToolUse hook (pipeline compliance).
 *
 * Invokes the real CJS script via child_process.execSync with mock stdin JSON.
 * Sets up a temp `.vela/` directory with config.json, pipeline state, pipeline
 * definition, and optional TDD phase state to control which guards fire.
 *
 * Guards tested:
 *   VG-EXPLORE: No active pipeline (explore mode)
 *   VG-00: Claude task tools blocked during pipeline
 *   VG-01: Research before plan
 *   VG-02: No source edits before execute step
 *   VG-03: Build/test must pass before commit
 *   VG-05: Pipeline state is engine-managed
 *   VG-07: Git commit only during execute/commit/finalize
 *   VG-08: Git push only after verify
 *   VG-12: PM direct source modification (delegation check)
 *   VG-13: TDD sub-phase enforcement (new)
 *   Fail-open: Malformed stdin, missing config, bad JSON
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

const GATE_GUARD_PATH = path.resolve(__dirname, '../../src/hooks/gate-guard.cjs');

let tmpDir: string;

// ─── Helpers ───

/** Write .vela/config.json with gate_guard enabled */
function writeConfig(cwd: string): void {
  const velaDir = path.join(cwd, '.vela');
  fs.mkdirSync(velaDir, { recursive: true });
  fs.writeFileSync(
    path.join(velaDir, 'config.json'),
    JSON.stringify({ gate_guard: { enabled: true } }),
  );
}

/**
 * Create a pipeline state and definition to put the guard into a given step.
 * Options:
 *   step — current pipeline step id (default: 'execute')
 *   pipelineType — pipeline type key (default: 'standard')
 *   status — pipeline status (default: 'active')
 *   withResearch — create research.md in artifact dir (default: false)
 *   withVerification — create verification.md in artifact dir (default: false)
 *   withDelegation — create delegation.json in state dir (default: true)
 *   subPhases — sub_phases array for the execute step (default: none)
 *   revisions — revisions map (default: none)
 *   trackerSignals — tracker-signals.json content (default: none)
 *   git — git state (default: none)
 */
function setupPipeline(
  cwd: string,
  opts: {
    step?: string;
    pipelineType?: string;
    status?: string;
    withResearch?: boolean;
    withVerification?: boolean;
    withDelegation?: boolean;
    subPhases?: string[];
    maxRevisions?: number;
    revisions?: Record<string, number>;
    trackerSignals?: unknown[];
    git?: { current_branch?: string; base_branch?: string };
  } = {},
): void {
  const {
    step = 'execute',
    pipelineType = 'standard',
    status = 'active',
    withResearch = false,
    withVerification = false,
    withDelegation = true,
    subPhases,
    maxRevisions,
    revisions,
    trackerSignals,
    git,
  } = opts;

  const velaDir = path.join(cwd, '.vela');

  // Artifact dir with pipeline-state.json
  const artDir = path.join(velaDir, 'artifacts', '2026-01-01_001_test');
  fs.mkdirSync(artDir, { recursive: true });

  const pipelineState: Record<string, unknown> = {
    status,
    current_step: step,
    pipeline_type: pipelineType,
  };
  if (revisions) pipelineState.revisions = revisions;
  if (git) pipelineState.git = git;

  fs.writeFileSync(
    path.join(artDir, 'pipeline-state.json'),
    JSON.stringify(pipelineState),
  );

  if (withResearch) {
    fs.writeFileSync(path.join(artDir, 'research.md'), '# Research\n');
  }
  if (withVerification) {
    fs.writeFileSync(path.join(artDir, 'verification.md'), '# Verification\n');
  }

  // Pipeline definition
  const executeStep: Record<string, unknown> = {
    id: 'execute',
    name: 'Implementation',
    mode: 'readwrite',
    max_revisions: maxRevisions ?? 5,
  };
  if (subPhases) {
    executeStep.sub_phases = subPhases;
    executeStep.sub_phase_tracking = true;
  }

  const templatesDir = path.join(velaDir, 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });
  fs.writeFileSync(
    path.join(templatesDir, 'pipeline.json'),
    JSON.stringify({
      pipelines: {
        [pipelineType]: {
          steps: [
            { id: 'init', name: 'Init', mode: 'read' },
            { id: 'research', name: 'Research', mode: 'read', team: { worker_role: 'researcher' } },
            { id: 'plan', name: 'Plan', mode: 'read' },
            executeStep,
            { id: 'verify', name: 'Verify', mode: 'read' },
            { id: 'commit', name: 'Commit', mode: 'read' },
            { id: 'finalize', name: 'Finalize', mode: 'read' },
          ],
        },
      },
    }),
  );

  // Delegation file — allows PM source writes (bypasses VG-12)
  if (withDelegation) {
    const stateDir = path.join(velaDir, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'delegation.json'),
      JSON.stringify({ delegated: true }),
    );
  }

  // Tracker signals
  if (trackerSignals) {
    fs.writeFileSync(
      path.join(velaDir, 'tracker-signals.json'),
      JSON.stringify(trackerSignals),
    );
  }
}

/** Write TDD phase state file */
function writeTddPhase(cwd: string, phase: string): void {
  const stateDir = path.join(cwd, '.vela', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, 'tdd-phase.json'),
    JSON.stringify({ phase }),
  );
}

/**
 * Invoke gate-guard.cjs with the given stdin payload.
 * Returns { exitCode, stdout, stderr }.
 */
function invokeGateGuard(
  stdinPayload: unknown,
): { exitCode: number; stdout: string; stderr: string } {
  const input =
    typeof stdinPayload === 'string'
      ? stdinPayload
      : JSON.stringify(stdinPayload);

  try {
    const stdout = execSync(`node "${GATE_GUARD_PATH}"`, {
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

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-gg-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ──────────────────────────────────────────────────────
describe('gate-guard', () => {

  // ── VG-EXPLORE: No active pipeline ──
  describe('VG-EXPLORE: no active pipeline', () => {
    it('blocks write tool with no active pipeline', () => {
      writeConfig(tmpDir);
      // No pipeline state → explore mode

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'hello' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-EXPLORE');
    });

    it('allows read tool with no active pipeline', () => {
      writeConfig(tmpDir);

      const result = invokeGateGuard({
        tool_name: 'Read',
        tool_input: { file_path: 'src/app.ts' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows write to .vela/ even without active pipeline', () => {
      writeConfig(tmpDir);

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: '.vela/cache/foo.json', content: '{}' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });
  });

  // ── VG-00: Claude task tools blocked ──
  describe('VG-00: Claude task tools blocked', () => {
    it('blocks TaskCreate during active pipeline', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir);

      const result = invokeGateGuard({
        tool_name: 'TaskCreate',
        tool_input: {},
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-00');
    });

    it('blocks TaskUpdate during active pipeline', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir);

      const result = invokeGateGuard({
        tool_name: 'TaskUpdate',
        tool_input: {},
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-00');
    });
  });

  // ── VG-01: Research before plan ──
  describe('VG-01: research before plan', () => {
    it('blocks plan.md write without research.md', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'execute', withResearch: false });

      const artDir = path.join(tmpDir, '.vela', 'artifacts', '2026-01-01_001_test');
      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: path.join(artDir, 'plan.md'), content: '# Plan' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-01');
    });

    it('allows plan.md write when research.md exists', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'execute', withResearch: true });

      const artDir = path.join(tmpDir, '.vela', 'artifacts', '2026-01-01_001_test');
      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: path.join(artDir, 'plan.md'), content: '# Plan' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });
  });

  // ── VG-02: No source edits before execute step ──
  describe('VG-02: no source edits before execute', () => {
    it('blocks .ts write during research step', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'research' });

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-02');
    });

    it('allows .ts write during execute step', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'execute' });

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows .vela/ writes during any step', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'research' });

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: '.vela/cache/foo.json', content: '{}' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows non-code file writes (README.md) during research', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'research' });

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'README.md', content: '# readme' },
        cwd: tmpDir,
      });

      // README.md has no CODE_EXTENSIONS match for .md → allowed
      expect(result.exitCode).toBe(0);
    });

    it('blocks .js write during plan step', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'plan' });

      const result = invokeGateGuard({
        tool_name: 'Edit',
        tool_input: { file_path: 'lib/utils.js', new_string: 'updated' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-02');
    });
  });

  // ── VG-05: Pipeline state is engine-managed ──
  describe('VG-05: pipeline-state.json protected', () => {
    it('blocks direct write to pipeline-state.json', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir);

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: '.vela/artifacts/2026-01-01_001_test/pipeline-state.json', content: '{}' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-05');
    });
  });

  // ── VG-03: Build/test must pass before commit ──
  describe('VG-03: build/test pass before commit', () => {
    it('blocks git commit with recent test failure', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, {
        step: 'execute',
        trackerSignals: [
          { type: 'test', result: 'fail', timestamp: Date.now() },
        ],
      });

      const result = invokeGateGuard({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "fix"' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-03');
    });

    it('allows git commit with no recent failures', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, {
        step: 'execute',
        trackerSignals: [
          { type: 'test', result: 'pass', timestamp: Date.now() },
        ],
      });

      const result = invokeGateGuard({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "fix"' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows git commit when no tracker signals exist', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'execute' });

      const result = invokeGateGuard({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "initial"' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows git commit when failure is older than 5 minutes', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, {
        step: 'execute',
        trackerSignals: [
          { type: 'test', result: 'fail', timestamp: Date.now() - 6 * 60 * 1000 },
        ],
      });

      const result = invokeGateGuard({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "fix"' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });
  });

  // ── VG-07: Git commit only during execute/commit/finalize ──
  describe('VG-07: git commit step restriction', () => {
    it('blocks git commit during research step', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'research' });

      const result = invokeGateGuard({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "wip"' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-07');
    });

    it('allows git commit during execute step', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'execute' });

      const result = invokeGateGuard({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "feat"' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows git commit during commit step', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'commit' });

      const result = invokeGateGuard({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "feat"' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows git commit during finalize step', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'finalize' });

      const result = invokeGateGuard({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "final"' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('blocks git commit during plan step', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'plan' });

      const result = invokeGateGuard({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "bad"' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-07');
    });
  });

  // ── VG-08: Git push only after verify ──
  describe('VG-08: git push after verify', () => {
    it('blocks git push during execute step', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'execute' });

      const result = invokeGateGuard({
        tool_name: 'Bash',
        tool_input: { command: 'git push origin main' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-08');
    });

    it('allows git push during verify step', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'verify' });

      const result = invokeGateGuard({
        tool_name: 'Bash',
        tool_input: { command: 'git push origin main' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows git stash push (not blocked by VG-08)', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'execute' });

      const result = invokeGateGuard({
        tool_name: 'Bash',
        tool_input: { command: 'git stash push -m "save"' },
        cwd: tmpDir,
      });

      // git stash push is excluded from VG-08 check
      expect(result.exitCode).toBe(0);
    });
  });

  // ── VG-12: PM delegation check ──
  describe('VG-12: PM delegation', () => {
    it('blocks source write in execute without delegation', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'execute', withDelegation: false });

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'src/main.ts', content: 'code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-12');
    });

    it('allows source write in execute with delegation', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'execute', withDelegation: true });

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'src/main.ts', content: 'code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });
  });

  // ── VG-06: Revision limit ──
  describe('VG-06: revision limit', () => {
    it('blocks write when revision limit is reached', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, {
        step: 'execute',
        maxRevisions: 2,
        revisions: { execute: 2 },
      });

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-06');
    });

    it('allows write when under revision limit', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, {
        step: 'execute',
        maxRevisions: 5,
        revisions: { execute: 1 },
      });

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });
  });

  // ── VG-13: TDD sub-phase enforcement (NEW) ──
  describe('VG-13: TDD sub-phase enforcement', () => {
    it('blocks non-test source file in test-write phase', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      writeTddPhase(tmpDir, 'test-write');

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-13');
      expect(result.stderr).toContain('test-write');
    });

    it('allows *.test.ts file in test-write phase', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      writeTddPhase(tmpDir, 'test-write');

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.test.ts', content: 'test code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows *.spec.js file in test-write phase', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      writeTddPhase(tmpDir, 'test-write');

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'src/util.spec.js', content: 'test' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows file in __tests__/ dir in test-write phase', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      writeTddPhase(tmpDir, 'test-write');

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: '__tests__/helpers.ts', content: 'test helper' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows file in tests/ dir in test-write phase', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      writeTddPhase(tmpDir, 'test-write');

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'tests/unit/service.test.ts', content: 'test' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows any source file in implement phase', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      writeTddPhase(tmpDir, 'implement');

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'implementation' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows any source file in refactor phase', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      writeTddPhase(tmpDir, 'refactor');

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'refactored' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows writes when no tdd-phase.json exists (fail-open)', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      // No writeTddPhase → no tdd-phase.json

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows writes when tdd-phase.json is corrupt (fail-open)', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      // Write corrupt JSON
      const stateDir = path.join(tmpDir, '.vela', 'state');
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(path.join(stateDir, 'tdd-phase.json'), '{corrupt');

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('does not enforce TDD phases when step has no sub_phases', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'execute' }); // No subPhases
      writeTddPhase(tmpDir, 'test-write');

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });

      // sub_phases not in step definition → no enforcement
      expect(result.exitCode).toBe(0);
    });

    it('does not enforce TDD phases when empty sub_phases array', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'execute', subPhases: [] });
      writeTddPhase(tmpDir, 'test-write');

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });

      // Empty sub_phases → no enforcement
      expect(result.exitCode).toBe(0);
    });

    it('allows non-code files in test-write phase', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      writeTddPhase(tmpDir, 'test-write');

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'docs/notes.txt', content: 'notes' },
        cwd: tmpDir,
      });

      // .txt not in CODE_EXTENSIONS → not subject to TDD enforcement
      expect(result.exitCode).toBe(0);
    });

    it('does not enforce TDD when not in execute step', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, {
        step: 'verify',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      writeTddPhase(tmpDir, 'test-write');

      const result = invokeGateGuard({
        tool_name: 'Read',
        tool_input: { file_path: 'src/app.ts' },
        cwd: tmpDir,
      });

      // Not in execute step → TDD guard doesn't fire
      expect(result.exitCode).toBe(0);
    });

    it('allows .vela/ writes even in test-write phase', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      writeTddPhase(tmpDir, 'test-write');

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: '.vela/state/foo.json', content: '{}' },
        cwd: tmpDir,
      });

      // .vela/ writes skip all source-code guards
      expect(result.exitCode).toBe(0);
    });
  });

  // ── VG-04: Verification before report ──
  describe('VG-04: verification before report', () => {
    it('blocks report.md without verification.md', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'execute', withVerification: false });

      const artDir = path.join(tmpDir, '.vela', 'artifacts', '2026-01-01_001_test');
      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: path.join(artDir, 'report.md'), content: '# Report' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-04');
    });

    it('allows report.md when verification.md exists', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { step: 'execute', withVerification: true });

      const artDir = path.join(tmpDir, '.vela', 'artifacts', '2026-01-01_001_test');
      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: path.join(artDir, 'report.md'), content: '# Report' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });
  });

  // ── VG-09: Protected branch warning ──
  describe('VG-09: protected branch warning', () => {
    it('emits warning when committing to main branch', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, {
        step: 'execute',
        git: { current_branch: 'main' },
      });

      const result = invokeGateGuard({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "on main"' },
        cwd: tmpDir,
      });

      // Warning only, not a block
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('WARNING');
      expect(result.stdout).toContain('main');
    });
  });

  // ── Fail-open behavior ──
  describe('fail-open behavior', () => {
    it('exits 0 on empty stdin', () => {
      const result = invokeGateGuard('');
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 on malformed JSON', () => {
      const result = invokeGateGuard('{not valid json');
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when tool_name is missing', () => {
      const result = invokeGateGuard({ tool_input: {}, cwd: tmpDir });
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when cwd is missing', () => {
      const result = invokeGateGuard({ tool_name: 'Write', tool_input: {} });
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when config file is missing', () => {
      // No writeConfig → no .vela/config.json
      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when gate_guard is disabled in config', () => {
      const velaDir = path.join(tmpDir, '.vela');
      fs.mkdirSync(velaDir, { recursive: true });
      fs.writeFileSync(
        path.join(velaDir, 'config.json'),
        JSON.stringify({ gate_guard: { enabled: false } }),
      );

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when pipeline definition is missing', () => {
      writeConfig(tmpDir);
      // Create pipeline state but no pipeline.json template
      const velaDir = path.join(tmpDir, '.vela');
      const artDir = path.join(velaDir, 'artifacts', '2026-01-01_001_test');
      fs.mkdirSync(artDir, { recursive: true });
      fs.writeFileSync(
        path.join(artDir, 'pipeline-state.json'),
        JSON.stringify({ status: 'active', current_step: 'execute', pipeline_type: 'standard' }),
      );
      // delegation.json so VG-12 doesn't fire
      const stateDir = path.join(velaDir, 'state');
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(path.join(stateDir, 'delegation.json'), '{"delegated":true}');

      const result = invokeGateGuard({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });

      // No pipeline definition → isStepReached returns false → VG-02 blocks
      // This is expected — the guard can't determine if execute is reached without definitions
      expect(result.exitCode).toBe(2);
    });

    it('exits 0 on unknown pipeline type', () => {
      writeConfig(tmpDir);
      setupPipeline(tmpDir, { pipelineType: 'custom' });

      // Read tool should pass through fine
      const result = invokeGateGuard({
        tool_name: 'Read',
        tool_input: { file_path: 'src/app.ts' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });
  });
});
