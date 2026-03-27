import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import type { StepDef, StepMode } from './pipeline.js';

// ── Types ──────────────────────────────────────────────────────────

export interface CustomPipelineDef {
  name: string;
  description?: string;
  steps: StepDef[];
}

// ── Validation ─────────────────────────────────────────────────────

const VALID_MODES: ReadonlySet<string> = new Set<StepMode>(['read', 'write', 'readwrite']);

/**
 * Validates a parsed JSON object as a CustomPipelineDef.
 * Returns an error message if invalid, or null if valid.
 */
export function validatePipelineDef(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return 'Pipeline definition must be a JSON object';
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.name !== 'string' || obj.name.trim() === '') {
    return 'Pipeline definition must have a non-empty "name" string';
  }

  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    return 'Pipeline definition must have a non-empty "steps" array';
  }

  for (let i = 0; i < obj.steps.length; i++) {
    const step = obj.steps[i] as Record<string, unknown>;
    if (typeof step !== 'object' || step === null) {
      return `Step ${i} must be an object`;
    }
    if (typeof step.id !== 'string' || step.id.trim() === '') {
      return `Step ${i} must have a non-empty "id" string`;
    }
    if (typeof step.name !== 'string' || step.name.trim() === '') {
      return `Step ${i} must have a non-empty "name" string`;
    }
    if (typeof step.mode !== 'string' || !VALID_MODES.has(step.mode)) {
      return `Step ${i} must have a "mode" of: read, write, or readwrite`;
    }
  }

  // Check for duplicate step IDs
  const ids = (obj.steps as StepDef[]).map((s) => s.id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    return 'Steps must have unique IDs';
  }

  return null;
}

// ── Loading ────────────────────────────────────────────────────────

/**
 * Loads a custom pipeline definition from .vela/pipelines/<name>.json.
 * Returns the parsed definition or an error.
 */
export function loadCustomPipeline(
  velaDir: string,
  name: string,
): { ok: true; pipeline: CustomPipelineDef } | { ok: false; error: string } {
  const pipelinesDir = join(velaDir, 'pipelines');
  const filePath = join(pipelinesDir, `${name}.json`);

  if (!existsSync(filePath)) {
    return { ok: false, error: `Custom pipeline "${name}" not found at ${filePath}` };
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    return { ok: false, error: `Failed to read ${filePath}: ${(err as Error).message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: `Invalid JSON in ${filePath}` };
  }

  const validationError = validatePipelineDef(parsed);
  if (validationError) {
    return { ok: false, error: `Invalid pipeline definition in ${filePath}: ${validationError}` };
  }

  const def = parsed as CustomPipelineDef;
  return { ok: true, pipeline: def };
}

/**
 * Lists all custom pipeline definitions in .vela/pipelines/.
 * Returns an array of pipeline names (without .json extension).
 */
export function listCustomPipelines(velaDir: string): string[] {
  const pipelinesDir = join(velaDir, 'pipelines');

  if (!existsSync(pipelinesDir)) {
    return [];
  }

  try {
    return readdirSync(pipelinesDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => basename(f, '.json'));
  } catch {
    return [];
  }
}
