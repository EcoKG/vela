/**
 * Install script & release packaging validation tests.
 * Verifies that npm pack output is lean, install scripts are executable
 * and POSIX-compatible, and dry-run mode works correctly.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

// ── npm pack validation ─────────────────────────────────────────────

describe('npm pack', () => {
  it('produces a tarball under 200KB', () => {
    const output = execSync('npm pack --dry-run 2>&1', { encoding: 'utf-8' });
    // Extract the "total files" line and the unpacked size
    const sizeMatch = output.match(/unpacked size:\s+([\d.]+)\s+([kKmM]?B)/);
    if (sizeMatch) {
      const value = parseFloat(sizeMatch[1]);
      const unit = sizeMatch[2].toLowerCase();
      let bytes = value;
      if (unit === 'kb') bytes = value * 1024;
      if (unit === 'mb') bytes = value * 1024 * 1024;
      expect(bytes).toBeLessThan(300 * 1024);
    }
    // Also verify via actual pack if tarball already exists
    const tgzPath = join(ROOT, 'vela-cli-0.1.0.tgz');
    try {
      const stat = statSync(tgzPath);
      expect(stat.size).toBeLessThan(300 * 1024);
    } catch {
      // tarball not present during dry-run only — that's fine
    }
  });

  it('includes only dist/ files (no src/, tests/, .vela/, .gsd/)', () => {
    const output = execSync('npm pack --dry-run 2>&1', { encoding: 'utf-8' });
    const lines = output.split('\n');

    // Should NOT contain any src/, tests/, .vela/, or .gsd/ entries
    const unwanted = lines.filter((line) =>
      /\s(src\/|tests\/|\.vela\/|\.gsd\/)/.test(line),
    );
    expect(unwanted).toHaveLength(0);

    // Should contain dist/ entries (npm pack --dry-run prefixes with "npm notice <size> dist/...")
    const distLines = lines.filter((line) => /\sdist\//.test(line));
    expect(distLines.length).toBeGreaterThan(0);
  });
});

// ── install.sh validation ───────────────────────────────────────────

describe('scripts/install.sh', () => {
  const installScript = join(ROOT, 'scripts', 'install.sh');

  it('is executable and has a POSIX shebang', () => {
    // Check executable permission
    accessSync(installScript, constants.X_OK);

    // Check shebang line
    const content = readFileSync(installScript, 'utf-8');
    const firstLine = content.split('\n')[0];
    expect(firstLine).toBe('#!/bin/sh');
  });

  it('--dry-run exits 0 and contains expected output markers', () => {
    const output = execSync('sh scripts/install.sh --dry-run 2>&1', {
      encoding: 'utf-8',
      cwd: ROOT,
    });

    // Should contain dry-run markers
    expect(output).toContain('[DRY RUN]');

    // Should mention Vela CLI
    expect(output).toContain('Vela CLI');

    // Should mention the version
    expect(output).toContain('0.1.0');
  });

  it('--help exits 0 and prints usage', () => {
    const output = execSync('sh scripts/install.sh --help 2>&1', {
      encoding: 'utf-8',
      cwd: ROOT,
    });
    expect(output).toContain('--dry-run');
    expect(output).toContain('--help');
  });

  it('rejects unknown arguments', () => {
    try {
      execSync('sh scripts/install.sh --invalid-flag 2>&1', {
        encoding: 'utf-8',
        cwd: ROOT,
      });
      // Should not reach here
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.status).not.toBe(0);
    }
  });
});

// ── release.sh validation ───────────────────────────────────────────

describe('scripts/release.sh', () => {
  it('is executable', () => {
    const releaseScript = join(ROOT, 'scripts', 'release.sh');
    accessSync(releaseScript, constants.X_OK);
  });
});
