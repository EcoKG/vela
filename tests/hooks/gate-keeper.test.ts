/**
 * Tests for gate-keeper.cjs — PreToolUse hook.
 *
 * Invokes the real CJS script via child_process.execSync with mock stdin JSON.
 * Sets up a temp `.vela/` directory with config.json and optional pipeline state
 * to control which gates fire.
 *
 * Gates tested:
 *   VK-01: Bash write command in read-only mode
 *   VK-04: Write operation in read-only mode
 *   VK-05: Cannot write to sensitive file
 *   VK-06: Secret/credential detected in write content
 *   VK-02/VK-03/VK-07: Lightly tested (PM delegation concerns)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

const GATE_KEEPER_PATH = path.resolve(__dirname, '../../src/hooks/gate-keeper.cjs');

let tmpDir: string;

/** Minimal .vela/config.json that enables the sandbox */
function writeConfig(
  cwd: string,
  overrides: Record<string, unknown> = {},
): void {
  const velaDir = path.join(cwd, '.vela');
  fs.mkdirSync(velaDir, { recursive: true });
  const config = {
    sandbox: { enabled: true },
    ...overrides,
  };
  fs.writeFileSync(
    path.join(velaDir, 'config.json'),
    JSON.stringify(config),
  );
}

/**
 * Create a fake pipeline state so `getCurrentMode()` returns the given mode.
 *
 * The pipeline helpers read:
 *   1. .vela/artifacts/{date}_{id}_{slug}/pipeline-state.json  → active pipeline
 *   2. .vela/templates/pipeline.json                           → step mode lookup
 *
 * We create both to control `getCurrentMode()`.
 * Also creates delegation.json so VK-07 (PM source code prohibition) doesn't
 * block test writes to source files before VK-05/VK-06 get a chance to fire.
 */
function writePipelineState(
  cwd: string,
  mode: 'read' | 'readwrite' = 'read',
  pipelineStatus: string = 'active',
): void {
  const velaDir = path.join(cwd, '.vela');

  // Artifacts dir with a fake pipeline state
  const artDir = path.join(velaDir, 'artifacts', '2026-01-01_001_test');
  fs.mkdirSync(artDir, { recursive: true });
  fs.writeFileSync(
    path.join(artDir, 'pipeline-state.json'),
    JSON.stringify({
      status: pipelineStatus,
      current_step: 'execute',
      pipeline_type: 'standard',
    }),
  );

  // Pipeline definition that maps the step id → mode
  const templatesDir = path.join(velaDir, 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });
  fs.writeFileSync(
    path.join(templatesDir, 'pipeline.json'),
    JSON.stringify({
      pipelines: {
        standard: {
          steps: [
            { id: 'research', mode: 'read' },
            { id: 'plan', mode: 'read' },
            { id: 'execute', mode },
            { id: 'review', mode: 'read' },
          ],
        },
      },
    }),
  );

  // Delegation file so VK-07 (PM source code prohibition) doesn't
  // block writes to source files. Simulates subagent delegation.
  const stateDir = path.join(velaDir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, 'delegation.json'),
    JSON.stringify({ delegated: true }),
  );
}

/**
 * Invoke gate-keeper.cjs with the given stdin payload.
 * Returns { exitCode, stdout, stderr }.
 */
function invokeGateKeeper(
  stdinPayload: unknown,
): { exitCode: number; stdout: string; stderr: string } {
  const input =
    typeof stdinPayload === 'string'
      ? stdinPayload
      : JSON.stringify(stdinPayload);

  try {
    const stdout = execSync(`node "${GATE_KEEPER_PATH}"`, {
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-gk-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ──────────────────────────────────────────────────────
// VK-04: Mode enforcement — write tools in read mode
// ──────────────────────────────────────────────────────
describe('gate-keeper', () => {
  describe('VK-04: mode enforcement', () => {
    it('blocks Write tool in read mode', () => {
      writeConfig(tmpDir);
      writePipelineState(tmpDir, 'read');

      const result = invokeGateKeeper({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'hello' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-04');
    });

    it('blocks Edit tool in read mode', () => {
      writeConfig(tmpDir);
      writePipelineState(tmpDir, 'read');

      const result = invokeGateKeeper({
        tool_name: 'Edit',
        tool_input: { file_path: 'src/main.ts', new_string: 'updated' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-04');
    });

    it('allows Write tool in readwrite mode', () => {
      writeConfig(tmpDir);
      writePipelineState(tmpDir, 'readwrite');

      const result = invokeGateKeeper({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'hello' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows writing to .vela/ internal files even in read mode', () => {
      writeConfig(tmpDir);
      writePipelineState(tmpDir, 'read');

      const result = invokeGateKeeper({
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
      writeConfig(tmpDir);
      writePipelineState(tmpDir, 'read');

      const result = invokeGateKeeper({
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
    // In readwrite mode so only the secret gate fires, not mode-enforcement.
    function writeReadWriteConfig(): void {
      writeConfig(tmpDir);
      writePipelineState(tmpDir, 'readwrite');
    }

    it('blocks AWS access key (AKIA...)', () => {
      writeReadWriteConfig();
      const result = invokeGateKeeper({
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
      const result = invokeGateKeeper({
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
      const result = invokeGateKeeper({
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
      const result = invokeGateKeeper({
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
      // sk-ant- followed by 90+ alphanumeric/dash chars
      const longSuffix = 'a'.repeat(90);
      const result = invokeGateKeeper({
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
      const result = invokeGateKeeper({
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
      const result = invokeGateKeeper({
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
      const result = invokeGateKeeper({
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
      const result = invokeGateKeeper({
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
      const result = invokeGateKeeper({
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
      const result = invokeGateKeeper({
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
      const result = invokeGateKeeper({
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
      const result = invokeGateKeeper({
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
      const result = invokeGateKeeper({
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
      const result = invokeGateKeeper({
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
      const result = invokeGateKeeper({
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
      writeConfig(tmpDir);
      writePipelineState(tmpDir, 'readwrite');
    }

    it('blocks write to .env', () => {
      writeReadWriteConfig();
      const result = invokeGateKeeper({
        tool_name: 'Write',
        tool_input: { file_path: '.env', content: 'API_KEY=test' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-05');
    });

    it('blocks write to credentials.json', () => {
      writeReadWriteConfig();
      const result = invokeGateKeeper({
        tool_name: 'Write',
        tool_input: { file_path: 'credentials.json', content: '{}' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-05');
    });

    it('blocks write to .env.local', () => {
      writeReadWriteConfig();
      const result = invokeGateKeeper({
        tool_name: 'Write',
        tool_input: { file_path: '.env.local', content: 'SECRET=val' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-05');
    });

    it('blocks write to secrets.yaml', () => {
      writeReadWriteConfig();
      const result = invokeGateKeeper({
        tool_name: 'Write',
        tool_input: { file_path: 'secrets.yaml', content: 'key: val' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-05');
    });

    it('blocks write to id_rsa', () => {
      writeReadWriteConfig();
      const result = invokeGateKeeper({
        tool_name: 'Write',
        tool_input: { file_path: 'id_rsa', content: 'private key data' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-05');
    });

    it('allows write to .env.example (template)', () => {
      writeReadWriteConfig();
      const result = invokeGateKeeper({
        tool_name: 'Write',
        tool_input: { file_path: '.env.example', content: 'API_KEY=' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows write to regular source file', () => {
      writeReadWriteConfig();
      const result = invokeGateKeeper({
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
      writeConfig(tmpDir);
      writePipelineState(tmpDir, 'read');

      const result = invokeGateKeeper({
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf src/' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-01');
    });

    it('blocks cp command in read mode', () => {
      writeConfig(tmpDir);
      writePipelineState(tmpDir, 'read');

      const result = invokeGateKeeper({
        tool_name: 'Bash',
        tool_input: { command: 'cp file1 file2' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-01');
    });

    it('blocks npm install in read mode', () => {
      writeConfig(tmpDir);
      writePipelineState(tmpDir, 'read');

      const result = invokeGateKeeper({
        tool_name: 'Bash',
        tool_input: { command: 'npm install express' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-01');
    });

    it('allows ls in read mode (safe read)', () => {
      writeConfig(tmpDir);
      writePipelineState(tmpDir, 'read');

      const result = invokeGateKeeper({
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows git status in read mode (safe read)', () => {
      writeConfig(tmpDir);
      writePipelineState(tmpDir, 'read');

      const result = invokeGateKeeper({
        tool_name: 'Bash',
        tool_input: { command: 'git status' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });

    it('allows grep in read mode (safe read)', () => {
      writeConfig(tmpDir);
      writePipelineState(tmpDir, 'read');

      const result = invokeGateKeeper({
        tool_name: 'Bash',
        tool_input: { command: 'grep -r "TODO" src/' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────
  // VK-02/VK-03: Light tests for PM delegation gates
  // ──────────────────────────────────────────────────────
  describe('VK-02: bash restricted in sandbox', () => {
    it('blocks arbitrary bash when no safe pattern matches', () => {
      writeConfig(tmpDir);
      writePipelineState(tmpDir, 'readwrite');

      const result = invokeGateKeeper({
        tool_name: 'Bash',
        tool_input: { command: 'curl https://example.com' },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-02');
    });
  });

  describe('VK-03: pipeline-state.json protection', () => {
    it('blocks direct write to pipeline-state.json in read mode', () => {
      writeConfig(tmpDir);
      writePipelineState(tmpDir, 'read');

      const result = invokeGateKeeper({
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
  });

  // ──────────────────────────────────────────────────────
  // Graceful handling — fail-open behavior
  // ──────────────────────────────────────────────────────
  describe('graceful handling (fail-open)', () => {
    it('exits 0 for malformed stdin (not JSON)', () => {
      const result = invokeGateKeeper('this is not json');
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 for empty stdin', () => {
      const result = invokeGateKeeper('');
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 for null JSON', () => {
      const result = invokeGateKeeper('null');
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when tool_name is missing', () => {
      const result = invokeGateKeeper({
        tool_input: { command: 'ls' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when cwd is missing', () => {
      const result = invokeGateKeeper({
        tool_name: 'Write',
        tool_input: { file_path: 'foo.ts', content: 'x' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when no .vela/config.json exists (not a Vela project)', () => {
      // tmpDir has no .vela/ directory at all
      const result = invokeGateKeeper({
        tool_name: 'Write',
        tool_input: { file_path: 'foo.ts', content: 'x' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when sandbox is disabled', () => {
      writeConfig(tmpDir, { sandbox: { enabled: false } });
      const result = invokeGateKeeper({
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

      const result = invokeGateKeeper({
        tool_name: 'Write',
        tool_input: { file_path: 'foo.ts', content: 'x' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when pipeline state is missing (defaults to read but no pipeline = pass)', () => {
      writeConfig(tmpDir);
      // No pipeline state → getCurrentMode returns 'read' via default
      // But Read tool should pass even in read mode
      const result = invokeGateKeeper({
        tool_name: 'Read',
        tool_input: { file_path: 'src/app.ts' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────
  // Negative tests — boundary conditions
  // ──────────────────────────────────────────────────────
  describe('negative tests / boundary conditions', () => {
    it('allows empty content string (no secrets to detect)', () => {
      writeConfig(tmpDir);
      writePipelineState(tmpDir, 'readwrite');

      const result = invokeGateKeeper({
        tool_name: 'Write',
        tool_input: { file_path: 'src/empty.ts', content: '' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows content with partial pattern match that is not a full secret', () => {
      writeConfig(tmpDir);
      writePipelineState(tmpDir, 'readwrite');

      // "sk-" alone is too short to be a real OpenAI key (needs 48 chars after sk-)
      const result = invokeGateKeeper({
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
      writeConfig(tmpDir);
      writePipelineState(tmpDir, 'readwrite');

      const result = invokeGateKeeper({
        tool_name: 'Write',
        tool_input: {
          file_path: 'src/short.ts',
          content: 'const x = "ghp_short";', // Only 5 chars after ghp_, need 36
        },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('detects secret in new_string (Edit tool) not just content (Write tool)', () => {
      writeConfig(tmpDir);
      writePipelineState(tmpDir, 'readwrite');

      const result = invokeGateKeeper({
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
      writeConfig(tmpDir);
      writePipelineState(tmpDir, 'read');

      const result = invokeGateKeeper({
        tool_name: 'Bash',
        tool_input: { command: 'node .vela/cli/vela-engine.js status' },
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });
  });
});
