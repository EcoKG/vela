/**
 * CLI chat command tests.
 * Tests --resume flag and sessions subcommand.
 * Runs against the compiled output in dist/.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openSessionDb,
  createSession,
  addMessage,
} from '../src/session.js';
import { closeDb } from '../src/db.js';

const CLI = join(process.cwd(), 'dist', 'cli.js');

function runCli(
  args: string,
  cwd: string,
  env?: Record<string, string>,
): { stdout: string; stderr: string; code: number } {
  const result = spawnSync('node', [CLI, ...args.split(' ')], {
    encoding: 'utf-8',
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    timeout: 5000,
  });
  return {
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    code: result.status ?? 1,
  };
}

function initVelaProject(tempDir: string): string {
  const velaDir = join(tempDir, '.vela');
  mkdirSync(join(velaDir, 'state'), { recursive: true });
  writeFileSync(
    join(velaDir, 'config.json'),
    JSON.stringify({ version: '1.0', pipeline: { default: 'standard', scales: ['trivial', 'quick', 'standard'] } }),
  );
  return velaDir;
}

describe('CLI chat sessions subcommand', () => {
  let tempDir: string;
  let velaDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `vela-cli-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    velaDir = initVelaProject(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('sessions returns ok:true with empty list when no sessions exist', () => {
    const db = openSessionDb(velaDir);
    closeDb(db);

    const { stdout, code } = runCli('chat sessions', tempDir);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.sessions).toEqual([]);
  });

  it('sessions returns saved sessions', () => {
    const db = openSessionDb(velaDir);
    createSession(db, { model: 'claude-sonnet-4-20250514', title: 'Test Chat' });
    closeDb(db);

    const { stdout, code } = runCli('chat sessions', tempDir);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0].title).toBe('Test Chat');
    expect(parsed.sessions[0].model).toBe('claude-sonnet-4-20250514');
  });
});

describe('CLI chat --resume', () => {
  let tempDir: string;
  let velaDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `vela-cli-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    velaDir = initVelaProject(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('--resume with no sessions prints error to stderr and exits 1', () => {
    const db = openSessionDb(velaDir);
    closeDb(db);

    const { stderr, code } = runCli('chat --resume', tempDir, {
      ANTHROPIC_API_KEY: 'sk-test-fake-key',
    });
    expect(code).toBe(1);
    expect(stderr).toContain('No saved sessions found');
  });

  it('--resume <bad-id> prints session-not-found error', () => {
    const db = openSessionDb(velaDir);
    closeDb(db);

    const { stderr, code } = runCli('chat --resume nonexistent-id', tempDir, {
      ANTHROPIC_API_KEY: 'sk-test-fake-key',
    });
    expect(code).toBe(1);
    expect(stderr).toContain('not found');
  });

  it('--resume <valid-id> prints resuming message', () => {
    const db = openSessionDb(velaDir);
    const session = createSession(db, {
      model: 'claude-sonnet-4-20250514',
      title: 'Resumable',
    });
    addMessage(db, {
      session_id: session.id,
      role: 'user',
      display: 'hello',
      content: 'hello',
    });
    addMessage(db, {
      session_id: session.id,
      role: 'assistant',
      display: 'hi there',
      content: [{ type: 'text', text: 'hi there' }],
    });
    closeDb(db);

    // The TUI render will fail in a non-TTY test environment,
    // but the resume message should appear on stderr before that.
    const { stderr } = runCli(`chat --resume ${session.id}`, tempDir, {
      ANTHROPIC_API_KEY: 'sk-test-fake-key',
    });
    expect(stderr).toContain('Resuming session');
    expect(stderr).toContain(session.id);
  });
});
