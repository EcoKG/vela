/**
 * Claude Code CLI readiness check.
 *
 * Detects whether the `claude` CLI binary is installed and reachable.
 * Results are cached for 30 seconds to avoid spawning a process on
 * every call in tight loops (e.g. model-router checks).
 */
import { execSync } from 'child_process';

// ── Cache state ───────────────────────────────────────────────

const CACHE_TTL_MS = 30_000;

let lastCheckTime = 0;
let lastReadyResult = false;

let lastPathCheckTime = 0;
let lastPathResult: string | null = null;

// ── Public API ────────────────────────────────────────────────

/**
 * Returns `true` if `claude --version` exits successfully.
 * Caches the result for 30 seconds.
 */
export function isClaudeCodeReady(): boolean {
  const now = Date.now();
  if (now - lastCheckTime < CACHE_TTL_MS) {
    return lastReadyResult;
  }

  try {
    execSync('claude --version', { stdio: 'pipe', timeout: 5_000 });
    lastReadyResult = true;
  } catch {
    lastReadyResult = false;
  }

  lastCheckTime = now;
  return lastReadyResult;
}

/**
 * Returns the absolute path to the `claude` binary, or `null` if not found.
 * Caches the result for 30 seconds.
 */
export function getClaudePath(): string | null {
  const now = Date.now();
  if (now - lastPathCheckTime < CACHE_TTL_MS) {
    return lastPathResult;
  }

  try {
    const raw = execSync('which claude', { stdio: 'pipe', timeout: 5_000 });
    lastPathResult = raw.toString().trim() || null;
  } catch {
    lastPathResult = null;
  }

  lastPathCheckTime = now;
  return lastPathResult;
}

/**
 * Clears the readiness and path caches. Exported for tests.
 */
export function clearReadinessCache(): void {
  lastCheckTime = 0;
  lastReadyResult = false;
  lastPathCheckTime = 0;
  lastPathResult = null;
}
