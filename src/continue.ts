import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ── Types ──────────────────────────────────────────────────────────

export interface ContinuePoint {
  milestone_id: string;
  slice_id: string;
  task_id?: string;
  step?: string;
  timestamp: string;
  notes?: string;
}

export type ContinueResult =
  | { ok: true; point: ContinuePoint }
  | { ok: false; error: string };

// ── Helpers ────────────────────────────────────────────────────────

const CONTINUE_FILE = 'continue.md';

function continuePath(velaDir: string): string {
  return join(velaDir, CONTINUE_FILE);
}

/**
 * Render a ContinuePoint to markdown with YAML frontmatter.
 */
function renderContinueFile(point: ContinuePoint): string {
  const lines: string[] = ['---'];
  lines.push(`milestone_id: ${point.milestone_id}`);
  lines.push(`slice_id: ${point.slice_id}`);
  if (point.task_id !== undefined) {
    lines.push(`task_id: ${point.task_id}`);
  }
  if (point.step !== undefined) {
    lines.push(`step: ${point.step}`);
  }
  lines.push(`timestamp: ${point.timestamp}`);
  if (point.notes !== undefined) {
    lines.push(`notes: ${point.notes}`);
  }
  lines.push('---');
  lines.push('');
  lines.push('# Continue Here');
  lines.push('');

  const location = point.task_id
    ? `task ${point.task_id} in slice ${point.slice_id}`
    : `slice ${point.slice_id}`;
  lines.push(`Resume from ${location}.`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Parse YAML frontmatter from continue.md content.
 * Simple key: value parsing — no yaml library dependency.
 */
function parseFrontmatter(content: string): ContinuePoint | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) return null;

  // Find the closing ---
  const afterFirst = trimmed.indexOf('\n');
  if (afterFirst === -1) return null;

  const rest = trimmed.slice(afterFirst + 1);
  const closingIdx = rest.indexOf('\n---');
  if (closingIdx === -1) return null;

  const yamlBlock = rest.slice(0, closingIdx);
  const fields: Record<string, string> = {};

  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key && value) {
      fields[key] = value;
    }
  }

  // Validate required fields
  if (!fields.milestone_id || !fields.slice_id || !fields.timestamp) {
    return null;
  }

  const point: ContinuePoint = {
    milestone_id: fields.milestone_id,
    slice_id: fields.slice_id,
    timestamp: fields.timestamp,
  };

  if (fields.task_id) point.task_id = fields.task_id;
  if (fields.step) point.step = fields.step;
  if (fields.notes) point.notes = fields.notes;

  return point;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Save a continue point to `.vela/continue.md`.
 * Timestamp is auto-generated — omit it from input.
 */
export function saveContinuePoint(
  velaDir: string,
  point: Omit<ContinuePoint, 'timestamp'>,
): ContinueResult {
  try {
    const fullPoint: ContinuePoint = {
      ...point,
      timestamp: new Date().toISOString(),
    };

    const filePath = continuePath(velaDir);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, renderContinueFile(fullPoint), 'utf-8');

    return { ok: true, point: fullPoint };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to save continue point: ${message}` };
  }
}

/**
 * Load the continue point from `.vela/continue.md`.
 * Returns an error result if the file doesn't exist or can't be parsed.
 */
export function loadContinuePoint(velaDir: string): ContinueResult {
  const filePath = continuePath(velaDir);

  if (!existsSync(filePath)) {
    return { ok: false, error: 'No continue point found' };
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const point = parseFrontmatter(content);

    if (!point) {
      return { ok: false, error: 'Failed to parse continue point: invalid frontmatter' };
    }

    return { ok: true, point };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to load continue point: ${message}` };
  }
}

/**
 * Clear the continue point by deleting `.vela/continue.md`.
 * No-op if the file doesn't exist.
 */
export function clearContinuePoint(velaDir: string): ContinueResult {
  const filePath = continuePath(velaDir);

  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
    // Return a synthetic point for the ok: true shape —
    // callers check ok, not the point contents after clear.
    return { ok: true, point: { milestone_id: '', slice_id: '', timestamp: '' } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to clear continue point: ${message}` };
  }
}
