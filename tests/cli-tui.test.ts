import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { join } from 'path';

const CLI = join(__dirname, '..', 'dist', 'cli.js');

describe('CLI tui command', () => {
  it('shows help text for vela tui', () => {
    const out = execFileSync('node', [CLI, 'tui', '--help'], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    // Should mention dashboard or TUI in help output
    expect(out.toLowerCase()).toMatch(/dashboard|tui/);
  });

  it('tui command is registered in top-level help', () => {
    const out = execFileSync('node', [CLI, '--help'], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    expect(out).toContain('tui');
  });
});
