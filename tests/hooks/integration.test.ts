/**
 * Integration tests: vela init → hook registration → hook blocking end-to-end.
 *
 * Exercises the real composition boundary: TypeScript init code produces
 * .vela/ structure → CJS hooks are copied → settings.local.json is written →
 * invoking the installed hooks actually blocks or allows based on input.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { initProject } from '../../src/init.js';
import { unregisterHooks } from '../../src/hook-registration.js';
import { getCostReport } from '../../src/cost.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-integration-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Enable sandbox in the config so gate-keeper enforces gates.
 */
function enableSandbox(cwd: string): void {
  const configPath = path.join(cwd, '.vela', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.sandbox = { enabled: true };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Enable gate_guard in the config so gate-guard enforces guards.
 */
function enableGateGuard(cwd: string): void {
  const configPath = path.join(cwd, '.vela', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.gate_guard = { enabled: true };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Invoke a hook script by path with the given stdin payload.
 * Returns { exitCode, stdout, stderr }.
 */
function invokeHook(
  scriptPath: string,
  stdinPayload: unknown,
): { exitCode: number; stdout: string; stderr: string } {
  const input = typeof stdinPayload === 'string'
    ? stdinPayload
    : JSON.stringify(stdinPayload);

  try {
    const stdout = execSync(`node "${scriptPath}"`, {
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
 * Extract the hook script path from settings.local.json for a given hookId.
 */
function getHookPath(cwd: string, hookId: string): string {
  const settingsPath = path.join(cwd, '.claude', 'settings.local.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  const entries = settings.hooks?.PreToolUse ?? [];
  for (const entry of entries) {
    for (const hook of entry.hooks ?? []) {
      if (hook.command?.includes(`${hookId}.cjs`)) {
        // Command is: node "/path/to/gate-keeper.cjs"
        const match = hook.command.match(/node\s+"([^"]+)"/);
        return match ? match[1] : '';
      }
    }
  }
  return '';
}

describe('hook integration', () => {
  describe('fresh project init installs hooks', () => {
    it('copies all hook files to .vela/hooks/', () => {
      const result = initProject(tmpDir);
      expect(result.ok).toBe(true);

      expect(fs.existsSync(path.join(tmpDir, '.vela', 'hooks', 'gate-keeper.cjs'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.vela', 'hooks', 'gate-guard.cjs'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.vela', 'hooks', 'shared', 'constants.cjs'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.vela', 'hooks', 'shared', 'pipeline.cjs'))).toBe(true);
    });

    it('creates settings.local.json with PreToolUse hooks pointing to correct paths', () => {
      initProject(tmpDir);

      const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
      expect(fs.existsSync(settingsPath)).toBe(true);

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.PreToolUse).toHaveLength(2);

      // Verify hook commands point to the project's .vela/hooks/ directory
      const keeperPath = getHookPath(tmpDir, 'gate-keeper');
      const guardPath = getHookPath(tmpDir, 'gate-guard');

      expect(keeperPath).toContain(path.join(tmpDir, '.vela', 'hooks', 'gate-keeper.cjs'));
      expect(guardPath).toContain(path.join(tmpDir, '.vela', 'hooks', 'gate-guard.cjs'));

      // Verify the hook scripts at those paths actually exist
      expect(fs.existsSync(keeperPath)).toBe(true);
      expect(fs.existsSync(guardPath)).toBe(true);
    });
  });

  describe('installed gate-keeper blocks secrets (VK-06)', () => {
    it('blocks writes containing secret patterns', () => {
      initProject(tmpDir);
      enableSandbox(tmpDir);

      // Set up a pipeline in readwrite mode so VK-04 (mode enforcement) passes
      // and the request reaches VK-06 (secret detection).
      const velaDir = path.join(tmpDir, '.vela');
      const artDir = path.join(velaDir, 'artifacts', '2026-01-01_001_test');
      fs.mkdirSync(artDir, { recursive: true });
      fs.writeFileSync(
        path.join(artDir, 'pipeline-state.json'),
        JSON.stringify({
          status: 'active',
          current_step: 'execute',
          pipeline_type: 'standard',
        }),
      );

      const templatesDir = path.join(velaDir, 'templates');
      fs.mkdirSync(templatesDir, { recursive: true });
      fs.writeFileSync(
        path.join(templatesDir, 'pipeline.json'),
        JSON.stringify({
          pipelines: {
            standard: {
              steps: [
                { id: 'research', mode: 'read' },
                { id: 'execute', mode: 'readwrite' },
              ],
            },
          },
        }),
      );

      // Delegation file so VK-07 doesn't block before VK-06
      const stateDir = path.join(velaDir, 'state');
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(stateDir, 'delegation.json'),
        JSON.stringify({ delegated: true }),
      );

      const keeperPath = getHookPath(tmpDir, 'gate-keeper');
      expect(keeperPath).toBeTruthy();

      const result = invokeHook(keeperPath, {
        tool_name: 'Write',
        tool_input: {
          file_path: 'src/config.ts',
          content: 'const key = "sk-ant-abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqr";',
        },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VK-06');
    });
  });

  describe('installed gate-keeper allows clean writes', () => {
    it('allows writes with no secrets and readwrite mode', () => {
      initProject(tmpDir);
      enableSandbox(tmpDir);

      // Set up a pipeline in readwrite mode so gate-keeper doesn't block on mode
      const velaDir = path.join(tmpDir, '.vela');
      const artDir = path.join(velaDir, 'artifacts', '2026-01-01_001_test');
      fs.mkdirSync(artDir, { recursive: true });
      fs.writeFileSync(
        path.join(artDir, 'pipeline-state.json'),
        JSON.stringify({
          status: 'active',
          current_step: 'execute',
          pipeline_type: 'standard',
        }),
      );

      const templatesDir = path.join(velaDir, 'templates');
      fs.mkdirSync(templatesDir, { recursive: true });
      fs.writeFileSync(
        path.join(templatesDir, 'pipeline.json'),
        JSON.stringify({
          pipelines: {
            standard: {
              steps: [
                { id: 'research', mode: 'read' },
                { id: 'execute', mode: 'readwrite' },
              ],
            },
          },
        }),
      );

      // Delegation file so VK-07 doesn't block
      const stateDir = path.join(velaDir, 'state');
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(stateDir, 'delegation.json'),
        JSON.stringify({ delegated: true }),
      );

      const keeperPath = getHookPath(tmpDir, 'gate-keeper');
      const result = invokeHook(keeperPath, {
        tool_name: 'Write',
        tool_input: {
          file_path: 'src/app.ts',
          content: 'console.log("hello world");',
        },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(0);
    });
  });

  describe('installed gate-guard blocks writes without pipeline (VG-EXPLORE)', () => {
    it('blocks Write tool when no active pipeline exists', () => {
      initProject(tmpDir);
      enableGateGuard(tmpDir);

      const guardPath = getHookPath(tmpDir, 'gate-guard');
      expect(guardPath).toBeTruthy();

      const result = invokeHook(guardPath, {
        tool_name: 'Write',
        tool_input: {
          file_path: 'src/app.ts',
          content: 'console.log("hello");',
        },
        cwd: tmpDir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('VG-EXPLORE');
    });
  });

  describe('re-init is idempotent', () => {
    it('does not create duplicate hook entries after double init', () => {
      initProject(tmpDir);
      initProject(tmpDir);

      const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

      expect(settings.hooks.PreToolUse).toHaveLength(2);

      // Verify exactly one gate-keeper and one gate-guard
      const keeperEntries = settings.hooks.PreToolUse.filter(
        (e: any) => e.hooks?.some((h: any) => h.command?.includes('gate-keeper')),
      );
      const guardEntries = settings.hooks.PreToolUse.filter(
        (e: any) => e.hooks?.some((h: any) => h.command?.includes('gate-guard')),
      );

      expect(keeperEntries).toHaveLength(1);
      expect(guardEntries).toHaveLength(1);
    });
  });

  describe('hook unregistration', () => {
    it('removes Vela hook entries from settings.local.json', () => {
      initProject(tmpDir);

      // Verify hooks are present
      const settingsBefore = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.claude', 'settings.local.json'), 'utf-8'),
      );
      expect(settingsBefore.hooks?.PreToolUse).toHaveLength(2);

      // Unregister
      const removed = unregisterHooks(tmpDir);
      expect(removed).toBe(3);

      // Verify hooks are gone
      const settingsAfter = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.claude', 'settings.local.json'), 'utf-8'),
      );
      expect(settingsAfter.hooks).toBeUndefined();
    });
  });
});

/**
 * Extract the hook script path from settings.local.json for a PostToolUse hookId.
 */
function getPostToolUseHookPath(cwd: string, hookId: string): string {
  const settingsPath = path.join(cwd, '.claude', 'settings.local.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  const entries = settings.hooks?.PostToolUse ?? [];
  for (const entry of entries) {
    for (const hook of entry.hooks ?? []) {
      if (hook.command?.includes(`${hookId}.cjs`)) {
        const match = hook.command.match(/node\s+"([^"]+)"/);
        return match ? match[1] : '';
      }
    }
  }
  return '';
}

describe('tracker integration', () => {
  describe('initProject copies tracker.cjs and registers PostToolUse hook', () => {
    it('copies tracker.cjs to .vela/hooks/', () => {
      const result = initProject(tmpDir);
      expect(result.ok).toBe(true);

      expect(fs.existsSync(path.join(tmpDir, '.vela', 'hooks', 'tracker.cjs'))).toBe(true);
    });

    it('creates PostToolUse entry in settings.local.json pointing to tracker.cjs', () => {
      initProject(tmpDir);

      const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

      expect(settings.hooks.PostToolUse).toBeDefined();
      expect(settings.hooks.PostToolUse).toHaveLength(1);

      const trackerPath = getPostToolUseHookPath(tmpDir, 'tracker');
      expect(trackerPath).toContain(path.join(tmpDir, '.vela', 'hooks', 'tracker.cjs'));
      expect(fs.existsSync(trackerPath)).toBe(true);
    });

    it('re-init is idempotent — no duplicate PostToolUse tracker entries', () => {
      initProject(tmpDir);
      initProject(tmpDir);
      initProject(tmpDir);

      const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

      expect(settings.hooks.PostToolUse).toHaveLength(1);

      // Verify exactly one tracker entry
      const trackerEntries = settings.hooks.PostToolUse.filter(
        (e: any) => e.hooks?.some((h: any) => h.command?.includes('tracker')),
      );
      expect(trackerEntries).toHaveLength(1);
    });
  });

  describe('tracker→trace.jsonl→getCostReport end-to-end pipeline', () => {
    it('invoking tracker.cjs with PostToolUse input creates trace.jsonl with tool_use entry', () => {
      initProject(tmpDir);

      // Set up an active pipeline so tracker can find it
      const velaDir = path.join(tmpDir, '.vela');
      const artDir = path.join(velaDir, 'artifacts', '2026-01-01', 'test-pipeline');
      fs.mkdirSync(artDir, { recursive: true });
      fs.writeFileSync(
        path.join(artDir, 'pipeline-state.json'),
        JSON.stringify({
          status: 'active',
          current_step: 'execute',
          pipeline_type: 'standard',
        }),
      );

      const trackerPath = getPostToolUseHookPath(tmpDir, 'tracker');
      expect(trackerPath).toBeTruthy();

      // Invoke tracker with a PostToolUse payload
      const result = invokeHook(trackerPath, {
        tool_name: 'Write',
        tool_input: {
          file_path: 'src/app.ts',
          content: 'console.log("hello");',
        },
        cwd: tmpDir,
      });

      // Tracker always exits 0 (fail-open)
      expect(result.exitCode).toBe(0);

      // Verify trace.jsonl was created with a tool_use entry
      const tracePath = path.join(artDir, 'trace.jsonl');
      expect(fs.existsSync(tracePath)).toBe(true);

      const traceContent = fs.readFileSync(tracePath, 'utf-8');
      const lines = traceContent.trim().split('\n').map(l => JSON.parse(l));
      const toolUseEntry = lines.find((e: any) => e.action === 'tool_use');
      expect(toolUseEntry).toBeDefined();
      expect(toolUseEntry.tool).toBe('Write');
      expect(toolUseEntry.step).toBe('execute');
    });

    it('tracker logs agent_dispatch for Agent tool invocations', () => {
      initProject(tmpDir);

      const velaDir = path.join(tmpDir, '.vela');
      const artDir = path.join(velaDir, 'artifacts', '2026-01-01', 'test-pipeline');
      fs.mkdirSync(artDir, { recursive: true });
      fs.writeFileSync(
        path.join(artDir, 'pipeline-state.json'),
        JSON.stringify({
          status: 'active',
          current_step: 'research',
          pipeline_type: 'standard',
        }),
      );

      const trackerPath = getPostToolUseHookPath(tmpDir, 'tracker');

      invokeHook(trackerPath, {
        tool_name: 'Agent',
        tool_input: { description: 'Research the codebase' },
        cwd: tmpDir,
      });

      const tracePath = path.join(artDir, 'trace.jsonl');
      const lines = fs.readFileSync(tracePath, 'utf-8').trim().split('\n').map(l => JSON.parse(l));

      // Should have both tool_use and agent_dispatch entries
      expect(lines.filter((e: any) => e.action === 'tool_use')).toHaveLength(1);
      expect(lines.filter((e: any) => e.action === 'agent_dispatch')).toHaveLength(1);

      const dispatch = lines.find((e: any) => e.action === 'agent_dispatch');
      expect(dispatch.tool).toBe('Agent');
      expect(dispatch.description).toBe('Research the codebase');
    });

    it('getCostReport reads tracker output and produces a valid cost report', () => {
      initProject(tmpDir);

      const velaDir = path.join(tmpDir, '.vela');
      const artDir = path.join(velaDir, 'artifacts', '2026-03-27', 'cost-e2e-test');
      fs.mkdirSync(artDir, { recursive: true });
      fs.writeFileSync(
        path.join(artDir, 'pipeline-state.json'),
        JSON.stringify({
          status: 'active',
          current_step: 'execute',
          pipeline_type: 'standard',
          request: 'Integration test task',
        }),
      );

      const trackerPath = getPostToolUseHookPath(tmpDir, 'tracker');

      // Simulate several tool uses through the tracker hook
      invokeHook(trackerPath, {
        tool_name: 'Read',
        tool_input: { file_path: 'package.json' },
        cwd: tmpDir,
      });
      invokeHook(trackerPath, {
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.ts', content: 'hello' },
        cwd: tmpDir,
      });
      invokeHook(trackerPath, {
        tool_name: 'Agent',
        tool_input: { description: 'Sub-task delegation' },
        cwd: tmpDir,
      });

      // Verify trace.jsonl has entries
      const tracePath = path.join(artDir, 'trace.jsonl');
      expect(fs.existsSync(tracePath)).toBe(true);

      // Now call getCostReport on the same .vela dir
      const costResult = getCostReport(velaDir);
      expect(costResult.ok).toBe(true);
      if (!costResult.ok) return;

      const { report } = costResult;
      expect(report.command).toBe('cost');
      expect(report.pipeline.type).toBe('standard');
      expect(report.pipeline.status).toBe('active');
      expect(report.pipeline.request).toBe('Integration test task');

      // Metrics: 3 tool_use entries (Read, Write, Agent), 1 agent_dispatch
      expect(report.metrics.tool_calls).toBe(3);
      expect(report.metrics.agent_dispatches).toBe(1);
      expect(report.metrics.step_breakdown['execute']).toBe(3);
    });
  });
});
