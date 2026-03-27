/**
 * Tests for discuss module: 6-stage state machine, prompt templates,
 * session file persistence, and context document rendering.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createSession,
  advanceStage,
  getStagePrompt,
  getSessionStatus,
  renderContext,
  readSession,
  writeSession,
  findLatestSession,
  getNextStage,
  isValidTransition,
  STAGE_ORDER,
  STAGE_PROMPTS,
} from '../src/discuss.js';
import type {
  DiscussStage,
  DiscussSession,
  StagePrompt,
} from '../src/discuss.js';

import { execSync } from 'node:child_process';

let tmpDir: string;
let velaDir: string;

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

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-discuss-test-'));
  velaDir = path.join(tmpDir, '.vela');
  fs.mkdirSync(velaDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Stage ordering & validation ────────────────────────────────────

describe('STAGE_ORDER', () => {
  it('contains all 6 stages in correct order', () => {
    expect(STAGE_ORDER).toEqual([
      'vision',
      'reflection',
      'qa',
      'depth-check',
      'requirements',
      'roadmap',
    ]);
  });
});

describe('getNextStage', () => {
  it('returns reflection after vision', () => {
    expect(getNextStage('vision')).toBe('reflection');
  });

  it('returns null for roadmap (final stage)', () => {
    expect(getNextStage('roadmap')).toBeNull();
  });

  it('returns correct successor for each stage', () => {
    expect(getNextStage('vision')).toBe('reflection');
    expect(getNextStage('reflection')).toBe('qa');
    expect(getNextStage('qa')).toBe('depth-check');
    expect(getNextStage('depth-check')).toBe('requirements');
    expect(getNextStage('requirements')).toBe('roadmap');
  });
});

describe('isValidTransition', () => {
  it('allows vision → reflection', () => {
    expect(isValidTransition('vision', 'reflection')).toBe(true);
  });

  it('rejects backward transitions (reflection → vision)', () => {
    expect(isValidTransition('reflection', 'vision')).toBe(false);
  });

  it('rejects skipping stages (vision → qa)', () => {
    expect(isValidTransition('vision', 'qa')).toBe(false);
  });

  it('rejects same-stage transition', () => {
    expect(isValidTransition('vision', 'vision')).toBe(false);
  });
});

// ── Prompt templates ───────────────────────────────────────────────

describe('getStagePrompt', () => {
  it('returns valid prompt for each of 6 stages', () => {
    for (const stage of STAGE_ORDER) {
      const result = getStagePrompt(stage);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.prompt.stage).toBe(stage);
        expect(result.prompt.title).toBeTruthy();
        expect(result.prompt.system_prompt).toBeTruthy();
        expect(result.prompt.user_instructions).toBeTruthy();
        expect(result.prompt.expected_output).toBeTruthy();
      }
    }
  });

  it('returns error for invalid stage name', () => {
    const result = getStagePrompt('invalid-stage');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Invalid stage');
    }
  });

  it('STAGE_PROMPTS has entries for all 6 stages', () => {
    for (const stage of STAGE_ORDER) {
      expect(STAGE_PROMPTS[stage]).toBeDefined();
      expect(STAGE_PROMPTS[stage].stage).toBe(stage);
    }
  });
});

// ── createSession ──────────────────────────────────────────────────

describe('createSession', () => {
  it('returns ok:true with session at vision stage', () => {
    const result = createSession(velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.stage).toBe('vision');
      expect(result.session.stages_completed).toEqual([]);
      expect(result.session.id).toBeTruthy();
      expect(result.session.created_at).toBeTruthy();
      expect(result.session.updated_at).toBeTruthy();
    }
  });

  it('creates session file on disk', () => {
    const result = createSession(velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const filePath = path.join(velaDir, 'state', `discuss-${result.session.id}.json`);
      expect(fs.existsSync(filePath)).toBe(true);
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(raw.id).toBe(result.session.id);
      expect(raw.stage).toBe('vision');
    }
  });

  it('generates unique session IDs across calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const result = createSession(velaDir);
      expect(result.ok).toBe(true);
      if (result.ok) ids.add(result.session.id);
    }
    expect(ids.size).toBe(10);
  });

  it('creates .vela/state/ directory if missing', () => {
    const freshVelaDir = path.join(tmpDir, 'fresh-vela');
    fs.mkdirSync(freshVelaDir, { recursive: true });
    const result = createSession(freshVelaDir);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(freshVelaDir, 'state'))).toBe(true);
  });
});

// ── advanceStage ───────────────────────────────────────────────────

describe('advanceStage', () => {
  it('progresses through all 6 stages linearly', () => {
    const createResult = createSession(velaDir);
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    const sessionId = createResult.session.id;

    const expectedTransitions: [DiscussStage, DiscussStage][] = [
      ['vision', 'reflection'],
      ['reflection', 'qa'],
      ['qa', 'depth-check'],
      ['depth-check', 'requirements'],
      ['requirements', 'roadmap'],
    ];

    for (const [from, to] of expectedTransitions) {
      const result = advanceStage(velaDir, sessionId, `Data for ${from}`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.session.stage).toBe(to);
        expect(result.session.stages_completed).toContain(from);
        expect(result.session.data[from]).toBe(`Data for ${from}`);
      }
    }
  });

  it('rejects advance past roadmap (final stage)', () => {
    const createResult = createSession(velaDir);
    if (!createResult.ok) return;
    const sessionId = createResult.session.id;

    // Advance through all stages
    for (let i = 0; i < 5; i++) {
      advanceStage(velaDir, sessionId, `Data ${i}`);
    }

    // Now at roadmap — try to advance
    const result = advanceStage(velaDir, sessionId, 'extra data');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Cannot advance past final stage');
    }
  });

  it('returns error for non-existent session', () => {
    const result = advanceStage(velaDir, 'nonexistent-id', 'data');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
  });

  it('accepts empty data (graceful degradation)', () => {
    const createResult = createSession(velaDir);
    if (!createResult.ok) return;
    const sessionId = createResult.session.id;

    const result = advanceStage(velaDir, sessionId, '');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.data['vision']).toBe('');
      expect(result.session.stage).toBe('reflection');
    }
  });

  it('persists updated session to disk after advance', () => {
    const createResult = createSession(velaDir);
    if (!createResult.ok) return;
    const sessionId = createResult.session.id;

    advanceStage(velaDir, sessionId, 'My vision');

    const readResult = readSession(velaDir, sessionId);
    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      expect(readResult.session.stage).toBe('reflection');
      expect(readResult.session.data['vision']).toBe('My vision');
    }
  });
});

// ── getSessionStatus ───────────────────────────────────────────────

describe('getSessionStatus', () => {
  it('returns current session state by ID', () => {
    const createResult = createSession(velaDir);
    if (!createResult.ok) return;

    const result = getSessionStatus(velaDir, createResult.session.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.id).toBe(createResult.session.id);
      expect(result.session.stage).toBe('vision');
    }
  });

  it('returns most recent session when no ID given', () => {
    createSession(velaDir);
    // Create a second session — this should be the "latest"
    const secondResult = createSession(velaDir);
    if (!secondResult.ok) return;

    // Advance the second session and explicitly set a later timestamp
    // to avoid sub-millisecond timing races in fast test runs
    advanceStage(velaDir, secondResult.session.id, 'latest data');
    const readResult = readSession(velaDir, secondResult.session.id);
    if (!readResult.ok) return;
    readResult.session.updated_at = '2099-01-01T00:00:00.000Z';
    writeSession(velaDir, readResult.session);

    const result = getSessionStatus(velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.id).toBe(secondResult.session.id);
    }
  });

  it('returns error for non-existent session', () => {
    const result = getSessionStatus(velaDir, 'nonexistent');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
  });

  it('returns error when no sessions exist', () => {
    const result = getSessionStatus(velaDir);
    expect(result.ok).toBe(false);
  });
});

// ── renderContext ──────────────────────────────────────────────────

describe('renderContext', () => {
  function createCompletedSession(): string {
    const createResult = createSession(velaDir);
    if (!createResult.ok) throw new Error('Failed to create session');
    const sessionId = createResult.session.id;

    const stageData: Record<string, string> = {
      vision: 'Build a task manager for teams.',
      reflection: 'Timeline: 3 months. Team: 2 devs.',
      qa: 'Needs real-time sync and offline support.',
      'depth-check': 'All requirements confirmed.',
      requirements: 'FR-01: Task CRUD. FR-02: Team views.',
    };

    for (const [, data] of Object.entries(stageData)) {
      advanceStage(velaDir, sessionId, data);
    }

    // Store data for roadmap stage directly (since we can't advance past it)
    const readResult = readSession(velaDir, sessionId);
    if (!readResult.ok) throw new Error('Failed to read session');
    const session = readResult.session;
    session.data['roadmap'] = 'M1: Core CRUD. M2: Team features. M3: Sync.';
    session.stages_completed.push('roadmap');
    writeSession(velaDir, session);

    return sessionId;
  }

  it('produces markdown with all 6 sections', () => {
    const sessionId = createCompletedSession();
    const result = renderContext(velaDir, sessionId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('# Project Context');
      expect(result.content).toContain('## Project Vision');
      expect(result.content).toContain('## Reflection & Constraints');
      expect(result.content).toContain('## Q&A Deep Dive');
      expect(result.content).toContain('## Depth Check');
      expect(result.content).toContain('## Requirements Synthesis');
      expect(result.content).toContain('## Roadmap Skeleton');
      expect(result.content).toContain('Build a task manager for teams.');
      expect(result.content).toContain('M1: Core CRUD');
    }
  });

  it('fails when stages are incomplete', () => {
    const createResult = createSession(velaDir);
    if (!createResult.ok) return;
    const sessionId = createResult.session.id;

    // Only advance one stage — most stages still missing
    advanceStage(velaDir, sessionId, 'vision data');

    const result = renderContext(velaDir, sessionId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Incomplete session');
      expect(result.error).toContain('missing data');
    }
  });

  it('writes to outputPath when provided', () => {
    const sessionId = createCompletedSession();
    const outputPath = path.join(tmpDir, 'output', 'context.md');

    const result = renderContext(velaDir, sessionId, outputPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe(outputPath);
      expect(fs.existsSync(outputPath)).toBe(true);
      const written = fs.readFileSync(outputPath, 'utf-8');
      expect(written).toContain('# Project Context');
    }
  });

  it('returns error for non-existent session', () => {
    const result = renderContext(velaDir, 'nonexistent');
    expect(result.ok).toBe(false);
  });
});

// ── findLatestSession ──────────────────────────────────────────────

describe('findLatestSession', () => {
  it('returns the most recently updated session', () => {
    const first = createSession(velaDir);
    const second = createSession(velaDir);
    if (!first.ok || !second.ok) return;

    // Advance second session and set explicit future timestamp
    // to avoid sub-millisecond timing races
    advanceStage(velaDir, second.session.id, 'newer data');
    const readResult = readSession(velaDir, second.session.id);
    if (!readResult.ok) return;
    readResult.session.updated_at = '2099-01-01T00:00:00.000Z';
    writeSession(velaDir, readResult.session);

    const result = findLatestSession(velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.id).toBe(second.session.id);
    }
  });

  it('returns error when no sessions exist', () => {
    const result = findLatestSession(velaDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('No');
    }
  });
});

// ── Session file structure ─────────────────────────────────────────

describe('session file structure', () => {
  it('session file is valid JSON with expected fields', () => {
    const createResult = createSession(velaDir);
    if (!createResult.ok) return;

    const filePath = path.join(velaDir, 'state', `discuss-${createResult.session.id}.json`);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed).toHaveProperty('id');
    expect(parsed).toHaveProperty('stage');
    expect(parsed).toHaveProperty('stages_completed');
    expect(parsed).toHaveProperty('data');
    expect(parsed).toHaveProperty('created_at');
    expect(parsed).toHaveProperty('updated_at');
    expect(typeof parsed.id).toBe('string');
    expect(typeof parsed.stage).toBe('string');
    expect(Array.isArray(parsed.stages_completed)).toBe(true);
    expect(typeof parsed.data).toBe('object');
  });
});

// ── Discriminated union pattern ────────────────────────────────────

describe('discriminated union pattern (K007)', () => {
  it('all functions return { ok: true } or { ok: false, error }', () => {
    // Success cases
    const create = createSession(velaDir);
    expect(create).toHaveProperty('ok');
    expect(create.ok).toBe(true);
    if (create.ok) expect(create).toHaveProperty('session');

    // Error cases
    const badAdvance = advanceStage(velaDir, 'none', 'data');
    expect(badAdvance).toHaveProperty('ok');
    expect(badAdvance.ok).toBe(false);
    if (!badAdvance.ok) expect(badAdvance).toHaveProperty('error');

    const badPrompt = getStagePrompt('invalid');
    expect(badPrompt.ok).toBe(false);
    if (!badPrompt.ok) expect(badPrompt).toHaveProperty('error');

    const badStatus = getSessionStatus(velaDir, 'nonexistent');
    expect(badStatus.ok).toBe(false);
    if (!badStatus.ok) expect(badStatus).toHaveProperty('error');

    const badRender = renderContext(velaDir, 'nonexistent');
    expect(badRender.ok).toBe(false);
    if (!badRender.ok) expect(badRender).toHaveProperty('error');
  });
});

// ── CLI integration tests ──────────────────────────────────────────

describe('vela discuss CLI', () => {
  let cliTmpDir: string;
  let cliVelaDir: string;

  beforeEach(() => {
    cliTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-discuss-cli-'));
    cliVelaDir = path.join(cliTmpDir, '.vela');
    fs.mkdirSync(path.join(cliVelaDir, 'state'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(cliTmpDir, { recursive: true, force: true });
  });

  describe('vela discuss start', () => {
    it('returns ok:true JSON with session and prompt', () => {
      const { stdout, code } = runCli('discuss start', cliTmpDir);
      expect(code).toBe(0);
      const result = JSON.parse(stdout);
      expect(result.ok).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.session.id).toBeTruthy();
      expect(result.session.stage).toBe('vision');
      expect(result.prompt).toBeDefined();
      expect(result.prompt.stage).toBe('vision');
    });

    it('returns error without vela project', () => {
      const noProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-no-proj-'));
      try {
        const { stdout, code } = runCli('discuss start', noProjectDir);
        expect(code).toBe(1);
        const result = JSON.parse(stdout);
        expect(result.ok).toBe(false);
        expect(result.error).toContain('No Vela project');
      } finally {
        fs.rmSync(noProjectDir, { recursive: true, force: true });
      }
    });
  });

  describe('vela discuss status', () => {
    it('returns current session state', () => {
      // Create a session first
      const { stdout: startOut } = runCli('discuss start', cliTmpDir);
      const startResult = JSON.parse(startOut);
      const sessionId = startResult.session.id;

      const { stdout, code } = runCli(`discuss status --session ${sessionId}`, cliTmpDir);
      expect(code).toBe(0);
      const result = JSON.parse(stdout);
      expect(result.ok).toBe(true);
      expect(result.session.id).toBe(sessionId);
      expect(result.session.stage).toBe('vision');
    });

    it('returns most recent session without --session flag', () => {
      runCli('discuss start', cliTmpDir);
      const { stdout: startOut2 } = runCli('discuss start', cliTmpDir);
      const secondId = JSON.parse(startOut2).session.id;
      // Advance second to ensure it's latest
      runCli(`discuss advance --data "vision text" --session ${secondId}`, cliTmpDir);

      const { stdout, code } = runCli('discuss status', cliTmpDir);
      expect(code).toBe(0);
      const result = JSON.parse(stdout);
      expect(result.ok).toBe(true);
      expect(result.session.id).toBe(secondId);
    });

    it('returns error with no sessions', () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-empty-'));
      fs.mkdirSync(path.join(emptyDir, '.vela', 'state'), { recursive: true });
      try {
        const { stdout, code } = runCli('discuss status', emptyDir);
        expect(code).toBe(1);
        const result = JSON.parse(stdout);
        expect(result.ok).toBe(false);
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });

  describe('vela discuss advance', () => {
    it('advances from vision to reflection', () => {
      const { stdout: startOut } = runCli('discuss start', cliTmpDir);
      const sessionId = JSON.parse(startOut).session.id;

      const { stdout, code } = runCli(`discuss advance --data "My project vision" --session ${sessionId}`, cliTmpDir);
      expect(code).toBe(0);
      const result = JSON.parse(stdout);
      expect(result.ok).toBe(true);
      expect(result.session.stage).toBe('reflection');
      expect(result.session.data.vision).toBe('My project vision');
      expect(result.prompt).toBeDefined();
      expect(result.prompt.stage).toBe('reflection');
    });

    it('returns error when advancing past final stage', () => {
      const { stdout: startOut } = runCli('discuss start', cliTmpDir);
      const sessionId = JSON.parse(startOut).session.id;

      // Advance through all 5 transitions
      const stages = ['vision', 'reflection', 'qa', 'depth-check', 'requirements'];
      for (const stage of stages) {
        runCli(`discuss advance --data "data for ${stage}" --session ${sessionId}`, cliTmpDir);
      }

      // Now at roadmap — try to advance past it
      const { stdout, code } = runCli(`discuss advance --data "extra" --session ${sessionId}`, cliTmpDir);
      expect(code).toBe(1);
      const result = JSON.parse(stdout);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Cannot advance past final stage');
    });
  });

  describe('vela discuss render', () => {
    function createCompletedSessionCli(): string {
      const { stdout: startOut } = runCli('discuss start', cliTmpDir);
      const sessionId = JSON.parse(startOut).session.id;

      const stages = ['vision', 'reflection', 'qa', 'depth-check', 'requirements'];
      for (const stage of stages) {
        runCli(`discuss advance --data "data for ${stage}" --session ${sessionId}`, cliTmpDir);
      }

      // Manually write roadmap data (since we can't advance past it via CLI)
      const sessionFile = path.join(cliVelaDir, 'state', `discuss-${sessionId}.json`);
      const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      session.data['roadmap'] = 'Roadmap: M1 core, M2 features';
      session.stages_completed.push('roadmap');
      fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));

      return sessionId;
    }

    it('renders context document for completed session', () => {
      const sessionId = createCompletedSessionCli();
      const { stdout, code } = runCli(`discuss render --session ${sessionId}`, cliTmpDir);
      expect(code).toBe(0);
      const result = JSON.parse(stdout);
      expect(result.ok).toBe(true);
      expect(result.content).toContain('# Project Context');
    });

    it('writes to custom output path', () => {
      const sessionId = createCompletedSessionCli();
      const outputPath = path.join(cliTmpDir, 'output', 'context.md');
      const { stdout, code } = runCli(`discuss render --session ${sessionId} --output ${outputPath}`, cliTmpDir);
      expect(code).toBe(0);
      const result = JSON.parse(stdout);
      expect(result.ok).toBe(true);
      expect(result.path).toBe(outputPath);
      expect(fs.existsSync(outputPath)).toBe(true);
      const content = fs.readFileSync(outputPath, 'utf-8');
      expect(content).toContain('# Project Context');
    });

    it('returns error for incomplete session', () => {
      const { stdout: startOut } = runCli('discuss start', cliTmpDir);
      const sessionId = JSON.parse(startOut).session.id;

      const { stdout, code } = runCli(`discuss render --session ${sessionId}`, cliTmpDir);
      expect(code).toBe(1);
      const result = JSON.parse(stdout);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Incomplete session');
    });
  });

  describe('full CLI flow', () => {
    it('start → advance through all stages → render', () => {
      const { stdout: startOut, code: startCode } = runCli('discuss start', cliTmpDir);
      expect(startCode).toBe(0);
      const sessionId = JSON.parse(startOut).session.id;

      const stages = ['vision', 'reflection', 'qa', 'depth-check', 'requirements'];
      for (const stage of stages) {
        const { code } = runCli(`discuss advance --data "content for ${stage}" --session ${sessionId}`, cliTmpDir);
        expect(code).toBe(0);
      }

      // Verify we're at roadmap
      const { stdout: statusOut } = runCli(`discuss status --session ${sessionId}`, cliTmpDir);
      const status = JSON.parse(statusOut);
      expect(status.session.stage).toBe('roadmap');
      expect(status.session.stages_completed).toHaveLength(5);

      // Complete roadmap data and render
      const sessionFile = path.join(cliVelaDir, 'state', `discuss-${sessionId}.json`);
      const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      session.data['roadmap'] = 'M1: Core. M2: Extensions.';
      session.stages_completed.push('roadmap');
      fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));

      const outputPath = path.join(cliTmpDir, 'project-context.md');
      const { stdout: renderOut, code: renderCode } = runCli(`discuss render --session ${sessionId} --output ${outputPath}`, cliTmpDir);
      expect(renderCode).toBe(0);
      const renderResult = JSON.parse(renderOut);
      expect(renderResult.ok).toBe(true);
      expect(fs.existsSync(outputPath)).toBe(true);
    });
  });

  describe('CLI output format', () => {
    it('all outputs are valid JSON with ok field', () => {
      // Success case
      const { stdout: startOut } = runCli('discuss start', cliTmpDir);
      const startResult = JSON.parse(startOut);
      expect(startResult).toHaveProperty('ok');

      // Error case
      const noProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-json-'));
      try {
        const { stdout: errOut } = runCli('discuss start', noProjectDir);
        const errResult = JSON.parse(errOut);
        expect(errResult).toHaveProperty('ok');
        expect(errResult.ok).toBe(false);
      } finally {
        fs.rmSync(noProjectDir, { recursive: true, force: true });
      }
    });
  });

  describe('regression', () => {
    it('existing agents list command still works', () => {
      const { stdout, code } = runCli('agents list');
      expect(code).toBe(0);
      const result = JSON.parse(stdout);
      expect(result.ok).toBe(true);
      expect(result.roles).toBeDefined();
    });
  });
});
