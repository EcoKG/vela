/**
 * Tests for vela-gate.cjs — Unified PreToolUse hook.
 *
 * Merged from gate-keeper.test.ts (~40 tests) and gate-guard.test.ts (~50 tests).
 * Invokes the real CJS script via child_process.execSync with mock stdin JSON.
 * Sets up a temp `.vela/` directory with config.json, pipeline state, pipeline
 * definition, and optional TDD phase state to control which gates fire.
 *
 * Gate-keeper gates (VK-*):
 *   VK-01: Bash write command in read-only mode
 *   VK-02: Bash restricted in sandbox
 *   VK-03: Pipeline-state.json protection (unified — also covers former VG-05)
 *   VK-04: Write operation in read-only mode
 *   VK-05: Cannot write to sensitive file
 *   VK-06: Secret/credential detected in write content
 *   VK-07: PM source code access prohibition
 *
 * Gate-guard guards (VG-*):
 *   VG-EXPLORE: No active pipeline (explore mode)
 *   VG-00: Claude task tools blocked during pipeline
 *   VG-01: Research before plan
 *   VG-02: No source edits before execute step
 *   VG-03: Build/test must pass before commit
 *   VG-04: Verification before report
 *   VG-06: Revision limit
 *   VG-07: Git commit only during execute/commit/finalize
 *   VG-08: Git push only after verify
 *   VG-09: Protected branch warning
 *   VG-12: PM direct source modification (delegation check)
 *   VG-13: TDD sub-phase enforcement
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

const VELA_GATE_PATH = path.resolve(__dirname, '../../src/hooks/vela-gate.cjs');

let tmpDir: string;

// ─── Helpers ───

/**
 * Write .vela/config.json with configurable feature flags.
 *
 * VK-* gates require `sandbox.enabled: true`.
 * VG-* guards require `gate_guard.enabled: true`.
 * Some tests need both.
 */
function writeConfig(
  cwd: string,
  opts: {
    sandbox?: boolean;
    gate_guard?: boolean;
    extra?: Record<string, unknown>;
  } = {},
): void {
  const { sandbox = false, gate_guard = false, extra = {} } = opts;
  const velaDir = path.join(cwd, '.vela');
  fs.mkdirSync(velaDir, { recursive: true });
  const config: Record<string, unknown> = { ...extra };
  if (sandbox) config.sandbox = { enabled: true };
  if (gate_guard) config.gate_guard = { enabled: true };
  fs.writeFileSync(
    path.join(velaDir, 'config.json'),
    JSON.stringify(config),
  );
}

/**
 * Create a pipeline state and definition to put the hook into a given step.
 *
 * The 7-step pipeline (init/research/plan/execute/verify/commit/finalize)
 * is used as the canonical pipeline structure. Gate-keeper tests that only
 * care about mode (read/readwrite) work with any pipeline shape since
 * they just check the mode of the current step.
 */
function setupPipeline(
  cwd: string,
  opts: {
    step?: string;
    pipelineType?: string;
    status?: string;
    mode?: 'read' | 'readwrite';
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
    mode,
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

  // Pipeline definition — 7-step canonical pipeline.
  // When `mode` is provided (from gate-keeper tests), override the execute step's mode.
  const executeMode = mode ?? 'readwrite';
  const executeStep: Record<string, unknown> = {
    id: 'execute',
    name: 'Implementation',
    mode: executeMode,
    max_revisions: maxRevisions ?? 5,
  };
  if (subPhases) {
    executeStep.sub_phases = subPhases;
    executeStep.sub_phase_tracking = true;
  }

  // For gate-keeper tests that need 'read' mode on the current step,
  // override the step's mode if step !== 'execute'.
  const stepMode = (step === 'execute') ? executeMode : (mode ?? 'read');

  const templatesDir = path.join(velaDir, 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });

  const steps = [
    { id: 'init', name: 'Init', mode: 'read' },
    { id: 'research', name: 'Research', mode: 'read', team: { worker_role: 'researcher' } },
    { id: 'plan', name: 'Plan', mode: 'read' },
    executeStep,
    { id: 'verify', name: 'Verify', mode: 'read' },
    { id: 'commit', name: 'Commit', mode: 'read' },
    { id: 'finalize', name: 'Finalize', mode: 'read' },
  ];

  fs.writeFileSync(
    path.join(templatesDir, 'pipeline.json'),
    JSON.stringify({
      pipelines: {
        [pipelineType]: { steps },
      },
    }),
  );

  // Delegation file — allows PM source writes (bypasses VK-07 / VG-12)
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
 * Invoke vela-gate.cjs with the given stdin payload.
 * Returns { exitCode, stdout, stderr }.
 */
function invokeHook(
  stdinPayload: unknown,
): { exitCode: number; stdout: string; stderr: string } {
  const input =
    typeof stdinPayload === 'string'
      ? stdinPayload
      : JSON.stringify(stdinPayload);

  try {
    const stdout = execSync(`node "${VELA_GATE_PATH}"`, {
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-gate-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ══════════════════════════════════════════════════════════
// GATE-KEEPER GATES (VK-*)
// ══════════════════════════════════════════════════════════
describe('gate-keeper gates (VK-*)', () => {

  // ──────────────────────────────────────────────────────
  // VK-04: Mode enforcement — write tools in read mode
  // ──────────────────────────────────────────────────────
  describe('VK-04: mode enforcement', () => {
    it('blocks Write tool in read mode', () => {
      writeConfig(tmpDir, { sandbox: true });
      setupPipeline(tmpDir, { mode: 'read' });

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'hello' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-04');
    });

    it('blocks Edit tool in read mode', () => {
      writeConfig(tmpDir, { sandbox: true });
      setupPipeline(tmpDir, { mode: 'read' });

      const result = invokeHook({
        tool_name: 'Edit',
        tool_input: { file_path: 'src/main.ts', new_string: 'updated' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-04');
    });

    it('allows Write tool in readwrite mode', () => {
      writeConfig(tmpDir, { sandbox: true });
      setupPipeline(tmpDir, { mode: 'readwrite' });

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'hello' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows writing to .vela/ internal files even in read mode', () => {
      writeConfig(tmpDir, { sandbox: true });
      setupPipeline(tmpDir, { mode: 'read' });

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: path.join(tmpDir, '.vela/state/session.json'),
          content: '{}',
        },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows Read tool in read mode', () => {
      writeConfig(tmpDir, { sandbox: true });
      setupPipeline(tmpDir, { mode: 'read' });

      const result = invokeHook({
        tool_name: 'Read',
        tool_input: { file_path: 'src/app.ts' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────
  // VK-06: Secret detection — all 15 patterns
  // ──────────────────────────────────────────────────────
  describe('VK-06: secret detection', () => {
    function writeReadWriteConfig(): void {
      writeConfig(tmpDir, { sandbox: true });
      setupPipeline(tmpDir, { mode: 'readwrite' });
    }

    it('blocks AWS access key (AKIA...)', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: 'config.js',
          content: `const key = "${'AKIA' + 'IOSFODNN7EXAMPLE'}";`,
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-06');
    });

    it('blocks GitHub PAT (ghp_...)', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: 'config.js',
          content: `const token = "${'ghp_' + 'A'.repeat(36)}";`,
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-06');
    });

    it('blocks GitHub OAuth token (gho_...)', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: 'config.js',
          content: `const token = "${'gho_' + 'A'.repeat(36)}";`,
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-06');
    });

    it('blocks OpenAI key (sk-...)', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: 'config.js',
          content: `const key = "${'sk-' + 'A'.repeat(48)}";`,
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-06');
    });

    it('blocks Anthropic key (sk-ant-...)', () => {
      writeReadWriteConfig();
      const longSuffix = 'a'.repeat(90);
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: 'config.js',
          content: `const key = "sk-ant-${longSuffix}";`,
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-06');
    });

    it('blocks JWT token (eyJ...)', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: 'config.js',
          content:
            `const jwt = "${'eyJ' + 'hbGciOiJIUzI1NiJ9.' + 'eyJzdWIiOiIxMjM0NTY3ODkwIn0.'}";`,
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-06');
    });

    it('blocks Stripe live key (sk_live_...)', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: 'config.js',
          content: `const key = "${'sk_live_' + 'X'.repeat(26)}";`,
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-06');
    });

    it('blocks Stripe restricted key (rk_live_...)', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: 'config.js',
          content: `const key = "${'rk_live_' + 'X'.repeat(26)}";`,
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-06');
    });

    it('blocks MongoDB connection string', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: 'config.js',
          content: `const uri = "${'mongodb+srv://' + 'admin:secret123@cluster.mongodb.net/db'}";`,
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-06');
    });

    it('blocks PostgreSQL connection string', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: 'config.js',
          content: `const uri = "${'postgresql://' + 'user:pass@localhost:5432/mydb'}";`,
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-06');
    });

    it('blocks MySQL connection string', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: 'config.js',
          content: `const uri = "${'mysql://' + 'root:password@localhost:3306/db'}";`,
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-06');
    });

    it('blocks private key (-----BEGIN...)', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: 'key.pem',
          content: `${'-----BEGIN RSA' + ' PRIVATE KEY-----'}\nMIIBogIBAAJ...`,
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-06');
    });

    it('blocks Slack token (xox...)', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: 'config.js',
          content: `const token = "${'xoxb-' + '1234567890-abcdefghij'}";`,
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-06');
    });

    it('blocks Google API key (AIza...)', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: 'config.js',
          content: `const key = "${'AIza' + 'SyBx7ABCDEFGHIJKLMNOPQRSTUVWXYZ01234'}";`,
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-06');
    });

    it('blocks SendGrid key (SG...)', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: 'config.js',
          content:
            `const key = "${'SG.' + 'a'.repeat(22) + '.' + 'A'.repeat(43)}";`,
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-06');
    });

    it('allows clean content with no secrets', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: 'src/utils.ts',
          content: 'export function add(a: number, b: number) { return a + b; }',
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────
  // VK-05: Sensitive file protection
  // ──────────────────────────────────────────────────────
  describe('VK-05: sensitive file protection', () => {
    function writeReadWriteConfig(): void {
      writeConfig(tmpDir, { sandbox: true });
      setupPipeline(tmpDir, { mode: 'readwrite' });
    }

    it('blocks write to .env', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: '.env', content: 'API_KEY=test' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-05');
    });

    it('blocks write to credentials.json', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'credentials.json', content: '{}' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-05');
    });

    it('blocks write to .env.local', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: '.env.local', content: 'SECRET=val' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-05');
    });

    it('blocks write to secrets.yaml', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'secrets.yaml', content: 'key: val' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-05');
    });

    it('blocks write to id_rsa', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'id_rsa', content: 'private key data' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-05');
    });

    it('allows write to .env.example (template)', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: '.env.example', content: 'API_KEY=' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows write to regular source file', () => {
      writeReadWriteConfig();
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: 'src/index.ts',
          content: 'console.log("hello");',
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────
  // VK-01: Bash write in read mode
  // ──────────────────────────────────────────────────────
  describe('VK-01: bash write in read mode', () => {
    it('blocks rm -rf in read mode', () => {
      writeConfig(tmpDir, { sandbox: true });
      setupPipeline(tmpDir, { mode: 'read' });

      const result = invokeHook({
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf src/' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-01');
    });

    it('blocks cp command in read mode', () => {
      writeConfig(tmpDir, { sandbox: true });
      setupPipeline(tmpDir, { mode: 'read' });

      const result = invokeHook({
        tool_name: 'Bash',
        tool_input: { command: 'cp file1 file2' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-01');
    });

    it('blocks npm install in read mode', () => {
      writeConfig(tmpDir, { sandbox: true });
      setupPipeline(tmpDir, { mode: 'read' });

      const result = invokeHook({
        tool_name: 'Bash',
        tool_input: { command: 'npm install express' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-01');
    });

    it('allows ls in read mode (safe read)', () => {
      writeConfig(tmpDir, { sandbox: true });
      setupPipeline(tmpDir, { mode: 'read' });

      const result = invokeHook({
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows git status in read mode (safe read)', () => {
      writeConfig(tmpDir, { sandbox: true });
      setupPipeline(tmpDir, { mode: 'read' });

      const result = invokeHook({
        tool_name: 'Bash',
        tool_input: { command: 'git status' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows grep in read mode (safe read)', () => {
      writeConfig(tmpDir, { sandbox: true });
      setupPipeline(tmpDir, { mode: 'read' });

      const result = invokeHook({
        tool_name: 'Bash',
        tool_input: { command: 'grep -r "TODO" src/' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────
  // VK-02: Bash restricted in sandbox
  // ──────────────────────────────────────────────────────
  describe('VK-02: bash restricted in sandbox', () => {
    it('blocks arbitrary bash when no safe pattern matches', () => {
      writeConfig(tmpDir, { sandbox: true });
      setupPipeline(tmpDir, { mode: 'readwrite' });

      const result = invokeHook({
        tool_name: 'Bash',
        tool_input: { command: 'curl https://example.com' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-02');
    });
  });

  // ──────────────────────────────────────────────────────
  // VK-03: pipeline-state.json protection (unified)
  // ──────────────────────────────────────────────────────
  describe('VK-03: pipeline-state.json protection', () => {
    it('blocks direct write to pipeline-state.json with sandbox enabled', () => {
      writeConfig(tmpDir, { sandbox: true });
      setupPipeline(tmpDir, { mode: 'read' });

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: path.join(tmpDir, '.vela/artifacts/2026-01-01_001_test/pipeline-state.json'),
          content: '{}',
        },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-03');
    });

    it('blocks direct write to pipeline-state.json with guard enabled', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir);

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: '.vela/artifacts/2026-01-01_001_test/pipeline-state.json', content: '{}' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-03');
    });
  });

  // ──────────────────────────────────────────────────────
  // Gate-keeper fail-open behavior
  // ──────────────────────────────────────────────────────
  describe('gate-keeper fail-open', () => {
    it('exits 0 for malformed stdin (not JSON)', () => {
      const result = invokeHook('this is not json');
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 for empty stdin', () => {
      const result = invokeHook('');
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 for null JSON', () => {
      const result = invokeHook('null');
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when tool_name is missing', () => {
      const result = invokeHook({
        tool_input: { command: 'ls' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when cwd is missing', () => {
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'foo.ts', content: 'x' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when no .vela/config.json exists (not a Vela project)', () => {
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'foo.ts', content: 'x' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when sandbox is disabled', () => {
      writeConfig(tmpDir, { sandbox: false });
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'foo.ts', content: 'x' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when config.json is corrupt', () => {
      const velaDir = path.join(tmpDir, '.vela');
      fs.mkdirSync(velaDir, { recursive: true });
      fs.writeFileSync(path.join(velaDir, 'config.json'), '{ broken json');

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'foo.ts', content: 'x' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when pipeline state is missing (Read tool passes)', () => {
      writeConfig(tmpDir, { sandbox: true });
      const result = invokeHook({
        tool_name: 'Read',
        tool_input: { file_path: 'src/app.ts' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────
  // Gate-keeper negative tests / boundary conditions
  // ──────────────────────────────────────────────────────
  describe('gate-keeper boundary conditions', () => {
    it('allows empty content string (no secrets to detect)', () => {
      writeConfig(tmpDir, { sandbox: true });
      setupPipeline(tmpDir, { mode: 'readwrite' });

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/empty.ts', content: '' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows content with partial pattern match that is not a full secret', () => {
      writeConfig(tmpDir, { sandbox: true });
      setupPipeline(tmpDir, { mode: 'readwrite' });

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: 'src/short.ts',
          content: 'const prefix = "sk-short";',
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows content with "ghp_" substring that is too short for a real PAT', () => {
      writeConfig(tmpDir, { sandbox: true });
      setupPipeline(tmpDir, { mode: 'readwrite' });

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: {
          file_path: 'src/short.ts',
          content: 'const x = "ghp_short";',
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('detects secret in new_string (Edit tool) not just content (Write tool)', () => {
      writeConfig(tmpDir, { sandbox: true });
      setupPipeline(tmpDir, { mode: 'readwrite' });

      const result = invokeHook({
        tool_name: 'Edit',
        tool_input: {
          file_path: 'src/config.ts',
          new_string: `const key = "${'AKIA' + 'IOSFODNN7EXAMPLE'}";`,
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-06');
    });

    it('allows Vela CLI bash command even in strict mode', () => {
      writeConfig(tmpDir, { sandbox: true });
      setupPipeline(tmpDir, { mode: 'read' });

      const result = invokeHook({
        tool_name: 'Bash',
        tool_input: { command: 'node .vela/cli/vela-engine.js status' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });
  });
});

// ══════════════════════════════════════════════════════════
// GATE-GUARD GUARDS (VG-*)
// ══════════════════════════════════════════════════════════
describe('gate-guard guards (VG-*)', () => {

  // ── VG-EXPLORE: No active pipeline ──
  describe('VG-EXPLORE: no active pipeline', () => {
    it('blocks write tool with no active pipeline', () => {
      writeConfig(tmpDir, { gate_guard: true });

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'hello' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-EXPLORE');
    });

    it('allows read tool with no active pipeline', () => {
      writeConfig(tmpDir, { gate_guard: true });

      const result = invokeHook({
        tool_name: 'Read',
        tool_input: { file_path: 'src/app.ts' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows write to .vela/ even without active pipeline', () => {
      writeConfig(tmpDir, { gate_guard: true });

      const result = invokeHook({
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
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir);

      const result = invokeHook({
        tool_name: 'TaskCreate',
        tool_input: {},
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-00');
    });

    it('blocks TaskUpdate during active pipeline', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir);

      const result = invokeHook({
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
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'execute', withResearch: false });

      const artDir = path.join(tmpDir, '.vela', 'artifacts', '2026-01-01_001_test');
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: path.join(artDir, 'plan.md'), content: '# Plan' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-01');
    });

    it('allows plan.md write when research.md exists', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'execute', withResearch: true });

      const artDir = path.join(tmpDir, '.vela', 'artifacts', '2026-01-01_001_test');
      const result = invokeHook({
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
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'research' });

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-02');
    });

    it('allows .ts write during execute step', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'execute' });

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows .vela/ writes during any step', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'research' });

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: '.vela/cache/foo.json', content: '{}' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows non-code file writes (README.md) during research', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'research' });

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'README.md', content: '# readme' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('blocks .js write during plan step', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'plan' });

      const result = invokeHook({
        tool_name: 'Edit',
        tool_input: { file_path: 'lib/utils.js', new_string: 'updated' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-02');
    });
  });

  // ── VG-03: Build/test must pass before commit ──
  describe('VG-03: build/test pass before commit', () => {
    it('blocks git commit with recent test failure', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, {
        step: 'execute',
        trackerSignals: [
          { type: 'test', result: 'fail', timestamp: Date.now() },
        ],
      });

      const result = invokeHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "fix"' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-03');
    });

    it('allows git commit with no recent failures', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, {
        step: 'execute',
        trackerSignals: [
          { type: 'test', result: 'pass', timestamp: Date.now() },
        ],
      });

      const result = invokeHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "fix"' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows git commit when no tracker signals exist', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'execute' });

      const result = invokeHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "initial"' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows git commit when failure is older than 5 minutes', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, {
        step: 'execute',
        trackerSignals: [
          { type: 'test', result: 'fail', timestamp: Date.now() - 6 * 60 * 1000 },
        ],
      });

      const result = invokeHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "fix"' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });
  });

  // ── VG-04: Verification before report ──
  describe('VG-04: verification before report', () => {
    it('blocks report.md without verification.md', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'execute', withVerification: false });

      const artDir = path.join(tmpDir, '.vela', 'artifacts', '2026-01-01_001_test');
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: path.join(artDir, 'report.md'), content: '# Report' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-04');
    });

    it('allows report.md when verification.md exists', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'execute', withVerification: true });

      const artDir = path.join(tmpDir, '.vela', 'artifacts', '2026-01-01_001_test');
      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: path.join(artDir, 'report.md'), content: '# Report' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });
  });

  // ── VG-06: Revision limit ──
  describe('VG-06: revision limit', () => {
    it('blocks write when revision limit is reached', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, {
        step: 'execute',
        maxRevisions: 2,
        revisions: { execute: 2 },
      });

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-06');
    });

    it('allows write when under revision limit', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, {
        step: 'execute',
        maxRevisions: 5,
        revisions: { execute: 1 },
      });

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });
  });

  // ── VG-07: Git commit only during execute/commit/finalize ──
  describe('VG-07: git commit step restriction', () => {
    it('blocks git commit during research step', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'research' });

      const result = invokeHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "wip"' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-07');
    });

    it('allows git commit during execute step', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'execute' });

      const result = invokeHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "feat"' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows git commit during commit step', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'commit' });

      const result = invokeHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "feat"' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows git commit during finalize step', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'finalize' });

      const result = invokeHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "final"' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('blocks git commit during plan step', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'plan' });

      const result = invokeHook({
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
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'execute' });

      const result = invokeHook({
        tool_name: 'Bash',
        tool_input: { command: 'git push origin main' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-08');
    });

    it('allows git push during verify step', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'verify' });

      const result = invokeHook({
        tool_name: 'Bash',
        tool_input: { command: 'git push origin main' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows git stash push (not blocked by VG-08)', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'execute' });

      const result = invokeHook({
        tool_name: 'Bash',
        tool_input: { command: 'git stash push -m "save"' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });
  });

  // ── VG-09: Protected branch warning ──
  describe('VG-09: protected branch warning', () => {
    it('emits warning when committing to main branch', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, {
        step: 'execute',
        git: { current_branch: 'main' },
      });

      const result = invokeHook({
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

  // ── VG-12: PM delegation check ──
  describe('VG-12: PM delegation', () => {
    it('blocks source write in execute without delegation', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'execute', withDelegation: false });

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/main.ts', content: 'code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-12');
    });

    it('allows source write in execute with delegation', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'execute', withDelegation: true });

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/main.ts', content: 'code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });
  });

  // ── VG-13: TDD sub-phase enforcement ──
  describe('VG-13: TDD sub-phase enforcement', () => {
    it('blocks non-test source file in test-write phase', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      writeTddPhase(tmpDir, 'test-write');

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-13');
      expect(result.stderr).toContain('test-write');
    });

    it('allows *.test.ts file in test-write phase', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      writeTddPhase(tmpDir, 'test-write');

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.test.ts', content: 'test code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows *.spec.js file in test-write phase', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      writeTddPhase(tmpDir, 'test-write');

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/util.spec.js', content: 'test' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows file in __tests__/ dir in test-write phase', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      writeTddPhase(tmpDir, 'test-write');

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: '__tests__/helpers.ts', content: 'test helper' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows file in tests/ dir in test-write phase', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      writeTddPhase(tmpDir, 'test-write');

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'tests/unit/service.test.ts', content: 'test' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows any source file in implement phase', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      writeTddPhase(tmpDir, 'implement');

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'implementation' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows any source file in refactor phase', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      writeTddPhase(tmpDir, 'refactor');

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'refactored' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows writes when no tdd-phase.json exists (fail-open)', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows writes when tdd-phase.json is corrupt (fail-open)', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      const stateDir = path.join(tmpDir, '.vela', 'state');
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(path.join(stateDir, 'tdd-phase.json'), '{corrupt');

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('does not enforce TDD phases when step has no sub_phases', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'execute' });
      writeTddPhase(tmpDir, 'test-write');

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('does not enforce TDD phases when empty sub_phases array', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { step: 'execute', subPhases: [] });
      writeTddPhase(tmpDir, 'test-write');

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows non-code files in test-write phase', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      writeTddPhase(tmpDir, 'test-write');

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'docs/notes.txt', content: 'notes' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('does not enforce TDD when not in execute step', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, {
        step: 'verify',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      writeTddPhase(tmpDir, 'test-write');

      const result = invokeHook({
        tool_name: 'Read',
        tool_input: { file_path: 'src/app.ts' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows .vela/ writes even in test-write phase', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, {
        step: 'execute',
        subPhases: ['test-write', 'implement', 'refactor'],
      });
      writeTddPhase(tmpDir, 'test-write');

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: '.vela/state/foo.json', content: '{}' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });
  });

  // ── Gate-guard fail-open behavior ──
  describe('gate-guard fail-open', () => {
    it('exits 0 on empty stdin', () => {
      const result = invokeHook('');
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 on malformed JSON', () => {
      const result = invokeHook('{not valid json');
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when tool_name is missing', () => {
      const result = invokeHook({ tool_input: {}, cwd: tmpDir });
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when cwd is missing', () => {
      const result = invokeHook({ tool_name: 'Write', tool_input: {} });
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when config file is missing', () => {
      const result = invokeHook({
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

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when pipeline definition is missing', () => {
      writeConfig(tmpDir, { gate_guard: true });
      // Create pipeline state but no pipeline.json template
      const velaDir = path.join(tmpDir, '.vela');
      const artDir = path.join(velaDir, 'artifacts', '2026-01-01_001_test');
      fs.mkdirSync(artDir, { recursive: true });
      fs.writeFileSync(
        path.join(artDir, 'pipeline-state.json'),
        JSON.stringify({ status: 'active', current_step: 'execute', pipeline_type: 'standard' }),
      );
      const stateDir = path.join(velaDir, 'state');
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(path.join(stateDir, 'delegation.json'), '{"delegated":true}');

      const result = invokeHook({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'code' },
        cwd: tmpDir,
      });

      // No pipeline definition → isStepReached returns false → VG-02 blocks
      expect(result.exitCode).toBe(2);
    });

    it('exits 0 on unknown pipeline type (read tool)', () => {
      writeConfig(tmpDir, { gate_guard: true });
      setupPipeline(tmpDir, { pipelineType: 'custom' });

      const result = invokeHook({
        tool_name: 'Read',
        tool_input: { file_path: 'src/app.ts' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });
  });
});
