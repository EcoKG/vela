/**
 * Governance Gate Integration — executeTool with gate context.
 * Verifies that executeTool blocks/allows correctly when GateContext is provided.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { executeTool } from '../../src/tool-engine.js';
import type { ToolContext } from '../../src/tool-engine.js';
import type { GateContext } from '../../src/governance/gate.js';
import { RetryBudget } from '../../src/governance/retry-budget.js';

// ── Temp directory management ─────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vela-gate-int-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────

function readModeContext(): GateContext {
  return {
    cwd: tmpDir,
    velaDir: path.join(tmpDir, '.vela'),
    config: {
      sandbox: { enabled: true },
      gate_guard: { enabled: true },
    },
    pipelineState: {
      status: 'active',
      current_step: 'research',
      pipeline_type: 'standard',
      revisions: {},
      git: {},
    },
    pipelineDef: {
      pipelines: {
        standard: {
          steps: [
            { id: 'research', name: 'Research', mode: 'read' },
            { id: 'plan', name: 'Plan', mode: 'read' },
            { id: 'execute', name: 'Execute', mode: 'execute' },
            { id: 'verify', name: 'Verify', mode: 'read' },
          ],
        },
      },
    },
    stepDef: { id: 'research', name: 'Research', mode: 'read' },
    mode: 'read',
    currentStep: 'research',
  };
}

function executeModeContext(): GateContext {
  return {
    cwd: tmpDir,
    velaDir: path.join(tmpDir, '.vela'),
    config: {
      sandbox: { enabled: true },
      gate_guard: { enabled: true },
    },
    pipelineState: {
      status: 'active',
      current_step: 'execute',
      pipeline_type: 'standard',
      revisions: {},
      git: {},
    },
    pipelineDef: {
      pipelines: {
        standard: {
          steps: [
            { id: 'research', name: 'Research', mode: 'read' },
            { id: 'plan', name: 'Plan', mode: 'read' },
            { id: 'execute', name: 'Execute', mode: 'execute' },
            { id: 'verify', name: 'Verify', mode: 'read' },
          ],
        },
      },
    },
    stepDef: { id: 'execute', name: 'Execute', mode: 'execute' },
    mode: 'execute',
    currentStep: 'execute',
  };
}

// ═══════════════════════════════════════════════════════════════
// executeTool + gate context
// ═══════════════════════════════════════════════════════════════

describe('executeTool with gate context', () => {
  it('blocks Write in read mode (VK-04)', async () => {
    const target = path.join(tmpDir, 'test.ts');
    const { result, is_error } = await executeTool(
      'Write',
      { path: target, content: 'x' },
      readModeContext(),
    );

    expect(is_error).toBe(true);
    expect(result).toContain('BLOCKED');
    expect(result).toContain('VK-04');
  });

  it('allows Read in read mode', async () => {
    const target = path.join(tmpDir, 'readable.txt');
    await fs.writeFile(target, 'hello', 'utf-8');

    const { result, is_error } = await executeTool(
      'Read',
      { path: target },
      readModeContext(),
    );

    expect(is_error).toBe(false);
    expect(result).toBe('hello');
  });

  it('allows Write in execute mode', async () => {
    const target = path.join(tmpDir, 'writable.ts');
    const { result, is_error } = await executeTool(
      'Write',
      { path: target, content: 'written' },
      executeModeContext(),
    );

    expect(is_error).toBe(false);
    expect(result).toContain('Successfully wrote');
  });
});

// ═══════════════════════════════════════════════════════════════
// executeTool without gate context (backward compatibility)
// ═══════════════════════════════════════════════════════════════

describe('executeTool backward compatibility (no context)', () => {
  it('allows Write when no context is passed', async () => {
    const target = path.join(tmpDir, 'no-gate.txt');
    const { result, is_error } = await executeTool(
      'Write',
      { path: target, content: 'no gate' },
    );

    expect(is_error).toBe(false);
    expect(result).toContain('Successfully wrote');

    // Verify file was actually written
    const content = await fs.readFile(target, 'utf-8');
    expect(content).toBe('no gate');
  });

  it('Read works without context', async () => {
    const target = path.join(tmpDir, 'read-no-gate.txt');
    await fs.writeFile(target, 'data', 'utf-8');

    const { result, is_error } = await executeTool(
      'Read',
      { path: target },
    );

    expect(is_error).toBe(false);
    expect(result).toBe('data');
  });
});

// ═══════════════════════════════════════════════════════════════
// Gate block message format
// ═══════════════════════════════════════════════════════════════

describe('Gate block message format', () => {
  it('produces ⛵ [Vela] ✦ BLOCKED [CODE] format', async () => {
    const target = path.join(tmpDir, 'blocked.ts');
    const { result, is_error } = await executeTool(
      'Write',
      { path: target, content: 'x' },
      readModeContext(),
    );

    expect(is_error).toBe(true);
    expect(result).toMatch(/⛵ \[Vela\] ✦ BLOCKED \[VK-04\]/);
  });

  it('blocks pipeline-state.json with VK-03', async () => {
    const target = path.join(tmpDir, '.vela', 'pipeline-state.json');
    const { result, is_error } = await executeTool(
      'Write',
      { path: target, content: '{}' },
      executeModeContext(),
    );

    expect(is_error).toBe(true);
    expect(result).toContain('VK-03');
  });

  it('blocks Bash rm in read mode with VK-01', async () => {
    const { result, is_error } = await executeTool(
      'Bash',
      { command: 'rm -rf /tmp/stuff' },
      readModeContext(),
    );

    expect(is_error).toBe(true);
    expect(result).toContain('VK-01');
  });

  it('blocks secret in content with VK-06', async () => {
    const target = path.join(tmpDir, 'secrets.ts');
    const { result, is_error } = await executeTool(
      'Write',
      { path: target, content: 'key = "AKIAIOSFODNN7EXAMPLE"' },
      executeModeContext(),
    );

    expect(is_error).toBe(true);
    expect(result).toContain('VK-06');
    // Secret must not be echoed
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });
});

// ═══════════════════════════════════════════════════════════════
// executeTool + RetryBudget integration
// ═══════════════════════════════════════════════════════════════

describe('executeTool with RetryBudget', () => {
  it('records blocks on retry budget when gate blocks', async () => {
    const budget = new RetryBudget(5);
    const target = path.join(tmpDir, 'blocked.ts');
    const ctx: ToolContext = {
      gate: readModeContext(),
      retryBudget: budget,
    };

    await executeTool('Write', { path: target, content: 'x' }, ctx);
    await executeTool('Write', { path: target, content: 'y' }, ctx);

    // Budget should have 2 blocks for VK-04
    const check = budget.shouldTerminate();
    expect(check.terminate).toBe(false);
    expect(check.gateCode).toBeUndefined();
  });

  it('records success on retry budget after successful execution', async () => {
    const budget = new RetryBudget(5);
    const readTarget = path.join(tmpDir, 'readable.txt');
    await fs.writeFile(readTarget, 'hello', 'utf-8');

    // Block twice first
    const blockCtx: ToolContext = { gate: readModeContext(), retryBudget: budget };
    await executeTool('Write', { path: path.join(tmpDir, 'x.ts'), content: 'x' }, blockCtx);
    await executeTool('Write', { path: path.join(tmpDir, 'y.ts'), content: 'y' }, blockCtx);

    // Now succeed — should reset budget
    const readCtx: ToolContext = { gate: readModeContext(), retryBudget: budget };
    await executeTool('Read', { path: readTarget }, readCtx);

    const check = budget.shouldTerminate();
    expect(check.terminate).toBe(false);
  });

  it('budget reaches limit after consecutive blocks', async () => {
    const budget = new RetryBudget(3);
    const target = path.join(tmpDir, 'blocked.ts');
    const ctx: ToolContext = { gate: readModeContext(), retryBudget: budget };

    for (let i = 0; i < 3; i++) {
      await executeTool('Write', { path: target, content: `x${i}` }, ctx);
    }

    const check = budget.shouldTerminate();
    expect(check.terminate).toBe(true);
    expect(check.gateCode).toBe('VK-04');
    expect(check.count).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════
// executeTool + Tracker integration
// ═══════════════════════════════════════════════════════════════

describe('executeTool tracker integration', () => {
  let artifactDir: string;
  let velaDir: string;

  beforeEach(async () => {
    artifactDir = path.join(tmpDir, 'artifacts');
    velaDir = path.join(tmpDir, '.vela');
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.mkdir(velaDir, { recursive: true });
  });

  it('writes trace.jsonl after successful tool execution', async () => {
    const target = path.join(tmpDir, 'traceme.txt');
    await fs.writeFile(target, 'data', 'utf-8');

    const ctx: ToolContext = {
      artifactDir,
    };

    await executeTool('Read', { path: target }, ctx);

    const tracePath = path.join(artifactDir, 'trace.jsonl');
    const raw = await fs.readFile(tracePath, 'utf-8');
    const entries = raw.trim().split('\n').map((l) => JSON.parse(l));

    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('tool_use');
    expect(entries[0].tool).toBe('Read');
    expect(entries[0].step).toBeNull();
    expect(entries[0].timestamp).toBeTypeOf('number');
  });

  it('writes trace.jsonl with step from gate context', async () => {
    const target = path.join(tmpDir, 'traced-exec.txt');
    await fs.writeFile(target, 'data', 'utf-8');

    const gateCtx = executeModeContext();
    gateCtx.artifactDir = artifactDir;
    const ctx: ToolContext = {
      gate: gateCtx,
      artifactDir,
    };

    await executeTool('Read', { path: target }, ctx);

    const tracePath = path.join(artifactDir, 'trace.jsonl');
    const raw = await fs.readFile(tracePath, 'utf-8');
    const entries = raw.trim().split('\n').map((l) => JSON.parse(l));

    expect(entries[0].step).toBe('execute');
  });

  it('classifies Bash build commands and writes tracker-signals.json', async () => {
    const ctx: ToolContext = {
      artifactDir,
      velaDir,
    };

    // Run a command that looks like a build and produces pass-like output
    await executeTool('Bash', { command: 'echo "0 errors, build complete" && npm run build --version' }, ctx);

    // Check trace.jsonl has both tool_use and build_test_signal entries
    const tracePath = path.join(artifactDir, 'trace.jsonl');
    const raw = await fs.readFile(tracePath, 'utf-8');
    const entries = raw.trim().split('\n').map((l) => JSON.parse(l));

    // Should have at least the tool_use entry
    const toolUse = entries.find((e: Record<string, unknown>) => e.action === 'tool_use');
    expect(toolUse).toBeDefined();
    expect(toolUse.tool).toBe('Bash');
  });

  it('classifies test commands and writes to tracker-signals.json', async () => {
    const ctx: ToolContext = {
      artifactDir,
      velaDir,
    };

    // A command matching test patterns with pass indicators
    await executeTool('Bash', { command: 'echo "5 tests passed ✓" # vitest' }, ctx);

    const signalsPath = path.join(velaDir, 'tracker-signals.json');
    const exists = fsSync.existsSync(signalsPath);
    expect(exists).toBe(true);

    const signals = JSON.parse(await fs.readFile(signalsPath, 'utf-8'));
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('test');
    expect(signals[0].result).toBe('pass');
  });

  it('does not track when no artifactDir is provided', async () => {
    const target = path.join(tmpDir, 'no-track.txt');
    await fs.writeFile(target, 'data', 'utf-8');

    await executeTool('Read', { path: target });

    // No trace.jsonl should exist in any default location
    const tracePath = path.join(tmpDir, 'trace.jsonl');
    const exists = fsSync.existsSync(tracePath);
    expect(exists).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// E2E governance pipeline — gate → block → budget exhaustion
// ═══════════════════════════════════════════════════════════════

describe('E2E governance pipeline — gate → block → budget exhaustion', () => {
  it('gate blocks write in read mode, budget exhausts after limit reached', async () => {
    const budget = new RetryBudget(3);
    const target = path.join(tmpDir, 'e2e-blocked.ts');
    const ctx: ToolContext = {
      gate: readModeContext(),
      retryBudget: budget,
    };

    // Each call should be blocked and recorded on the budget
    for (let i = 0; i < 3; i++) {
      const { result, is_error } = await executeTool(
        'Write',
        { path: target, content: `attempt ${i}` },
        ctx,
      );

      expect(is_error).toBe(true);
      expect(result).toMatch(/BLOCKED \[VK-04\]/);
    }

    // After 3 consecutive blocks, budget should signal termination
    const check = budget.shouldTerminate();
    expect(check.terminate).toBe(true);
    expect(check.gateCode).toBe('VK-04');
    expect(check.count).toBe(3);

    // File should NOT have been written (all attempts blocked)
    expect(fsSync.existsSync(target)).toBe(false);
  });

  it('successful execution resets budget, preventing premature exhaustion', async () => {
    const budget = new RetryBudget(3);
    const target = path.join(tmpDir, 'e2e-reset.ts');
    const readTarget = path.join(tmpDir, 'e2e-readable.txt');
    await fs.writeFile(readTarget, 'readable', 'utf-8');

    const blockCtx: ToolContext = { gate: readModeContext(), retryBudget: budget };

    // Block twice
    await executeTool('Write', { path: target, content: 'x' }, blockCtx);
    await executeTool('Write', { path: target, content: 'y' }, blockCtx);
    expect(budget.shouldTerminate().terminate).toBe(false);

    // Successful read resets counter
    await executeTool('Read', { path: readTarget }, blockCtx);
    expect(budget.shouldTerminate().terminate).toBe(false);

    // Two more blocks after reset — still under limit
    await executeTool('Write', { path: target, content: 'a' }, blockCtx);
    await executeTool('Write', { path: target, content: 'b' }, blockCtx);
    expect(budget.shouldTerminate().terminate).toBe(false);

    // Third consecutive block after reset — now exhausted
    await executeTool('Write', { path: target, content: 'c' }, blockCtx);
    const check = budget.shouldTerminate();
    expect(check.terminate).toBe(true);
    expect(check.gateCode).toBe('VK-04');
  });
});
