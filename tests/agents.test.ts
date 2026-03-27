/**
 * Tests for agents module: listAgentRoles, getAgentPrompt, getAgentStrategy,
 * and CLI integration for agents commands.
 * Run `npm run build` before running these tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import {
  listAgentRoles,
  getAgentPrompt,
  getAgentStrategy,
  getBundledAgentsDir,
} from '../src/agents.js';
import type { AgentRole, AgentStrategy, AgentPromptResult } from '../src/agents.js';

const CLI = path.join(process.cwd(), 'dist', 'cli.js');

function runCli(args: string, cwd?: string): { stdout: string; code: number } {
  try {
    const stdout = execSync(`node ${CLI} ${args}`, {
      encoding: 'utf-8',
      cwd: cwd ?? process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return { stdout, code: 0 };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { stdout: (err.stdout ?? '').trim(), code: err.status ?? 1 };
  }
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-agents-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── getAgentStrategy ───────────────────────────────────────────────

describe('getAgentStrategy', () => {
  it('small → solo strategy with no roles', () => {
    const result = getAgentStrategy('small');
    expect(result.strategy).toBe('solo');
    expect(result.roles).toEqual([]);
    expect(result.description).toBeTruthy();
  });

  it('medium → scout strategy with researcher role', () => {
    const result = getAgentStrategy('medium');
    expect(result.strategy).toBe('scout');
    expect(result.roles).toEqual(['researcher']);
    expect(result.description).toBeTruthy();
  });

  it('large → role-separation strategy with 5 roles', () => {
    const result = getAgentStrategy('large');
    expect(result.strategy).toBe('role-separation');
    expect(result.roles).toEqual([
      'researcher',
      'planner',
      'executor',
      'debugger',
      'synthesizer',
    ]);
    expect(result.description).toBeTruthy();
  });

  it('all strategies have non-empty descriptions', () => {
    for (const scale of ['small', 'medium', 'large'] as const) {
      const result = getAgentStrategy(scale);
      expect(typeof result.description).toBe('string');
      expect(result.description.length).toBeGreaterThan(0);
    }
  });
});

// ── listAgentRoles ─────────────────────────────────────────────────

describe('listAgentRoles', () => {
  it('returns exactly 6 core roles', () => {
    const roles = listAgentRoles();
    expect(roles).toHaveLength(6);
    const names = roles.map((r) => r.name);
    expect(names).toEqual([
      'debugger',
      'executor',
      'planner',
      'pm',
      'researcher',
      'synthesizer',
    ]);
  });

  it('roles are sorted alphabetically by name', () => {
    const roles = listAgentRoles();
    const names = roles.map((r) => r.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it('each role has a non-empty description', () => {
    const roles = listAgentRoles();
    for (const role of roles) {
      expect(role.description.length).toBeGreaterThan(0);
    }
  });

  it('marks roles with subdirectories as hasModular: true', () => {
    const roles = listAgentRoles();
    // researcher, planner, executor have both top-level .md and subdirectories
    // debugger, synthesizer, pm only have subdirectories
    for (const role of roles) {
      expect(role.hasModular).toBe(true);
    }
  });

  it('excludes vela.md from roles list', () => {
    const roles = listAgentRoles();
    const names = roles.map((r) => r.name);
    expect(names).not.toContain('vela');
  });
});

// ── getAgentPrompt ─────────────────────────────────────────────────

describe('getAgentPrompt', () => {
  it('returns bundled content for known role (researcher)', () => {
    const result = getAgentPrompt('researcher');
    expect(result).not.toBeNull();
    expect(result!.source).toBe('bundled');
    expect(result!.content).toContain('Researcher');
  });

  it('returns bundled content for subdirectory-only role (debugger)', () => {
    const result = getAgentPrompt('debugger');
    expect(result).not.toBeNull();
    expect(result!.source).toBe('bundled');
    expect(result!.content).toContain('Debugger');
  });

  it('returns null for unknown role', () => {
    const result = getAgentPrompt('nonexistent');
    expect(result).toBeNull();
  });

  it('returns null for empty role name', () => {
    const result = getAgentPrompt('');
    expect(result).toBeNull();
  });

  it('returns bundled content for vela.md (not a core role but file exists)', () => {
    const result = getAgentPrompt('vela');
    expect(result).not.toBeNull();
    expect(result!.source).toBe('bundled');
  });

  describe('project-local override', () => {
    it('returns project version when override exists', () => {
      const agentsDir = path.join(tmpDir, '.vela', 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });
      fs.writeFileSync(
        path.join(agentsDir, 'researcher.md'),
        '# Custom Researcher\n\n> Custom override description\n\nCustom content here.',
      );

      const result = getAgentPrompt('researcher', tmpDir);
      expect(result).not.toBeNull();
      expect(result!.source).toBe('project');
      expect(result!.content).toContain('Custom Researcher');
    });

    it('falls back to bundled when no project override exists', () => {
      // tmpDir has no .vela/agents/ directory
      const result = getAgentPrompt('researcher', tmpDir);
      expect(result).not.toBeNull();
      expect(result!.source).toBe('bundled');
    });

    it('project override only applies to the specified role', () => {
      const agentsDir = path.join(tmpDir, '.vela', 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });
      fs.writeFileSync(
        path.join(agentsDir, 'researcher.md'),
        '# Custom Researcher',
      );

      // researcher is overridden
      const researcher = getAgentPrompt('researcher', tmpDir);
      expect(researcher!.source).toBe('project');

      // planner is still bundled
      const planner = getAgentPrompt('planner', tmpDir);
      expect(planner!.source).toBe('bundled');
    });
  });
});

// ── getBundledAgentsDir ────────────────────────────────────────────

describe('getBundledAgentsDir', () => {
  it('returns a path ending with /agents', () => {
    const dir = getBundledAgentsDir();
    expect(dir.endsWith('/agents')).toBe(true);
  });

  it('bundled directory exists on disk', () => {
    const dir = getBundledAgentsDir();
    expect(fs.existsSync(dir)).toBe(true);
  });
});

// ── CLI integration tests ──────────────────────────────────────────

describe('CLI agents commands', () => {
  it('agents list returns JSON with ok: true and roles array', () => {
    const { stdout, code } = runCli('agents list');
    expect(code).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.roles)).toBe(true);
    expect(json.roles.length).toBe(6);
  });

  it('agents list roles are sorted and have correct shape', () => {
    const { stdout } = runCli('agents list');
    const json = JSON.parse(stdout);
    const names = json.roles.map((r: AgentRole) => r.name);
    expect(names).toEqual([
      'debugger',
      'executor',
      'planner',
      'pm',
      'researcher',
      'synthesizer',
    ]);
    for (const role of json.roles) {
      expect(role).toHaveProperty('name');
      expect(role).toHaveProperty('description');
      expect(role).toHaveProperty('hasModular');
    }
  });

  it('agents show <role> returns content for known role', () => {
    const { stdout, code } = runCli('agents show researcher');
    expect(code).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.ok).toBe(true);
    expect(json.role).toBe('researcher');
    expect(json.content).toBeTruthy();
    expect(['project', 'bundled']).toContain(json.source);
  });

  it('agents show <role> returns error for unknown role', () => {
    const { stdout, code } = runCli('agents show nonexistent');
    expect(code).toBe(1);
    const json = JSON.parse(stdout);
    expect(json.ok).toBe(false);
    expect(json.error).toContain('nonexistent');
  });

  it('agents strategy --scale small returns solo', () => {
    const { stdout, code } = runCli('agents strategy --scale small');
    expect(code).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.ok).toBe(true);
    expect(json.strategy).toBe('solo');
    expect(json.roles).toEqual([]);
  });

  it('agents strategy --scale medium returns scout', () => {
    const { stdout, code } = runCli('agents strategy --scale medium');
    expect(code).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.ok).toBe(true);
    expect(json.strategy).toBe('scout');
    expect(json.roles).toEqual(['researcher']);
  });

  it('agents strategy --scale large returns role-separation', () => {
    const { stdout, code } = runCli('agents strategy --scale large');
    expect(code).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.ok).toBe(true);
    expect(json.strategy).toBe('role-separation');
    expect(json.roles).toHaveLength(5);
  });

  it('agents strategy --scale invalid returns error', () => {
    const { stdout, code } = runCli('agents strategy --scale invalid');
    expect(code).toBe(1);
    const json = JSON.parse(stdout);
    expect(json.ok).toBe(false);
    expect(json.error).toContain('invalid');
  });

  it('help lists agents command', () => {
    const output = execSync(`node ${CLI} help`, { encoding: 'utf-8' });
    expect(output).toContain('agents');
  });
});
