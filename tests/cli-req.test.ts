import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

// ── Helpers ────────────────────────────────────────────────────────

const CLI = join(__dirname, '..', 'dist', 'cli.js');

function run(args: string, cwd: string): { ok: boolean; [key: string]: unknown } {
  try {
    const stdout = execSync(`node ${CLI} ${args}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 10_000,
    });
    return JSON.parse(stdout.trim());
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string };
    if (execErr.stdout) {
      try {
        return JSON.parse(execErr.stdout.trim());
      } catch {
        // fall through
      }
    }
    throw err;
  }
}

describe('CLI req commands', () => {
  let tmpDir: string;

  beforeEach(() => {
    // Build first (idempotent)
    execSync('npm run build', { cwd: join(__dirname, '..'), encoding: 'utf-8', timeout: 30_000 });
    tmpDir = mkdtempSync(join(tmpdir(), 'vela-cli-req-'));
    // Initialize project
    run('init', tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('req create → creates a requirement with JSON output', () => {
    const result = run(
      'req create R001 --title "User auth" --class core-capability',
      tmpDir,
    );
    expect(result.ok).toBe(true);
    const req = result.requirement as Record<string, unknown>;
    expect(req.id).toBe('R001');
    expect(req.title).toBe('User auth');
    expect(req.req_class).toBe('core-capability');
    expect(req.status).toBe('active');
    expect(req.validation).toBe('unmapped');
  });

  it('req create with all options', () => {
    const result = run(
      'req create R100 --title "Full req" --class differentiator --status validated --description "A desc" --why "Important" --source user --owner M001/S01 --supporting M001/S02 --validation "5 tests" --notes "Note"',
      tmpDir,
    );
    expect(result.ok).toBe(true);
    const req = result.requirement as Record<string, unknown>;
    expect(req.status).toBe('validated');
    expect(req.description).toBe('A desc');
    expect(req.why_it_matters).toBe('Important');
    expect(req.source).toBe('user');
    expect(req.primary_owner).toBe('M001/S01');
  });

  it('req create with invalid class → error', () => {
    const result = run(
      'req create R001 --title "Bad" --class bogus',
      tmpDir,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid class');
  });

  it('req list → returns requirements array', () => {
    run('req create R001 --title "First" --class core-capability', tmpDir);
    run('req create R002 --title "Second" --class differentiator', tmpDir);

    const result = run('req list', tmpDir);
    expect(result.ok).toBe(true);
    const reqs = result.requirements as Record<string, unknown>[];
    expect(reqs).toHaveLength(2);
    expect(reqs[0]).toHaveProperty('id', 'R001');
    expect(reqs[1]).toHaveProperty('id', 'R002');
  });

  it('req list --status active → filters', () => {
    run('req create R001 --title "Active" --class core-capability', tmpDir);
    run('req create R002 --title "Validated" --class core-capability --status validated', tmpDir);

    const result = run('req list --status active', tmpDir);
    expect(result.ok).toBe(true);
    const reqs = result.requirements as Record<string, unknown>[];
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toHaveProperty('id', 'R001');
  });

  it('req update → updates fields', () => {
    run('req create R001 --title "Original" --class core-capability', tmpDir);

    const result = run('req update R001 --status validated --validation "10 tests pass"', tmpDir);
    expect(result.ok).toBe(true);
    const req = result.requirement as Record<string, unknown>;
    expect(req.status).toBe('validated');
    expect(req.validation).toBe('10 tests pass');
  });

  it('req update non-existent → error', () => {
    const result = run('req update R999 --status validated', tmpDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('req delete → deletes requirement', () => {
    run('req create R001 --title "To delete" --class core-capability', tmpDir);
    const delResult = run('req delete R001', tmpDir);
    expect(delResult.ok).toBe(true);
    expect(delResult.deleted).toBe('R001');

    const listResult = run('req list', tmpDir);
    expect((listResult.requirements as unknown[]).length).toBe(0);
  });

  it('req delete non-existent → error', () => {
    const result = run('req delete R999', tmpDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('req render → writes REQUIREMENTS.md', () => {
    run('req create R001 --title "Auth" --class core-capability --description "User authentication"', tmpDir);
    run('req create R002 --title "Perf" --class quality-attribute --status validated', tmpDir);

    const result = run('req render', tmpDir);
    expect(result.ok).toBe(true);

    const reqPath = join(tmpDir, '.vela', 'REQUIREMENTS.md');
    expect(existsSync(reqPath)).toBe(true);

    const content = readFileSync(reqPath, 'utf-8');
    expect(content).toContain('# Requirements');
    expect(content).toContain('### R001 — Auth');
    expect(content).toContain('### R002 — Perf');
    expect(content).toContain('## Traceability');
    expect(content).toContain('## Coverage Summary');
  });

  it('full lifecycle: create → list → update → render → verify', () => {
    // Create
    run('req create R100 --title "사용자 인증" --class core-capability', tmpDir);
    
    // List
    const listResult = run('req list', tmpDir);
    expect((listResult.requirements as unknown[]).length).toBe(1);

    // Update
    run('req update R100 --status validated --validation "E2E test passes"', tmpDir);

    // Render
    run('req render', tmpDir);

    // Verify
    const content = readFileSync(join(tmpDir, '.vela', 'REQUIREMENTS.md'), 'utf-8');
    expect(content).toContain('### R100 — 사용자 인증');
    expect(content).toContain('- Status: validated');
    expect(content).toContain('- Validation: E2E test passes');
    expect(content).toContain('- Validated: 1 (R100)');
  });
});
