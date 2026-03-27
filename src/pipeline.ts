import Database from 'better-sqlite3';
import {
  openStateDb,
  createPipeline,
  updatePipeline,
  listPipelines,
} from './state.js';
import type { Pipeline } from './state.js';
import { loadCustomPipeline } from './custom-pipeline.js';

// ── Step definitions ───────────────────────────────────────────────

export type StepMode = 'read' | 'write' | 'readwrite';

export interface StepDef {
  id: string;
  name: string;
  mode: StepMode;
}

const STANDARD_STEPS: StepDef[] = [
  { id: 'init',        name: 'Initialize',     mode: 'readwrite' },
  { id: 'research',    name: 'Research',        mode: 'read'      },
  { id: 'plan',        name: 'Plan',            mode: 'readwrite' },
  { id: 'plan-check',  name: 'Plan Check',      mode: 'read'      },
  { id: 'checkpoint',  name: 'Checkpoint',      mode: 'read'      },
  { id: 'branch',      name: 'Branch',          mode: 'write'     },
  { id: 'execute',     name: 'Execute',         mode: 'readwrite' },
  { id: 'verify',      name: 'Verify',          mode: 'read'      },
  { id: 'commit',      name: 'Commit',          mode: 'write'     },
  { id: 'finalize',    name: 'Finalize',        mode: 'readwrite' },
];

const QUICK_STEPS: StepDef[] = [
  { id: 'init',     name: 'Initialize', mode: 'readwrite' },
  { id: 'plan',     name: 'Plan',       mode: 'readwrite' },
  { id: 'execute',  name: 'Execute',    mode: 'readwrite' },
  { id: 'verify',   name: 'Verify',     mode: 'read'      },
  { id: 'commit',   name: 'Commit',     mode: 'write'     },
  { id: 'finalize', name: 'Finalize',   mode: 'readwrite' },
];

const TRIVIAL_STEPS: StepDef[] = [
  { id: 'init',     name: 'Initialize', mode: 'readwrite' },
  { id: 'execute',  name: 'Execute',    mode: 'readwrite' },
  { id: 'commit',   name: 'Commit',     mode: 'write'     },
  { id: 'finalize', name: 'Finalize',   mode: 'readwrite' },
];

// ── Pipeline type → steps mapping ──────────────────────────────────

export type PipelineType = 'standard' | 'quick' | 'trivial';
export type Scale = 'small' | 'medium' | 'large';

const PIPELINE_STEPS: Record<PipelineType, StepDef[]> = {
  standard: STANDARD_STEPS,
  quick:    QUICK_STEPS,
  trivial:  TRIVIAL_STEPS,
};

const SCALE_TO_PIPELINE: Record<Scale, PipelineType> = {
  small:  'trivial',
  medium: 'quick',
  large:  'standard',
};

/** Returns the step definitions for a given pipeline type. */
export function getStepsForType(pipelineType: PipelineType): StepDef[] {
  return PIPELINE_STEPS[pipelineType];
}

/**
 * Returns step definitions for a pipeline type, including custom types.
 * For builtin types, returns from PIPELINE_STEPS.
 * For custom types, loads from .vela/pipelines/<name>.json.
 */
export function getStepsForTypeOrCustom(
  pipelineType: string,
  velaDir?: string,
): { ok: true; steps: StepDef[] } | { ok: false; error: string } {
  // Check builtin first
  if (pipelineType in PIPELINE_STEPS) {
    return { ok: true, steps: PIPELINE_STEPS[pipelineType as PipelineType] };
  }

  // Try custom
  if (!velaDir) {
    return { ok: false, error: `Unknown pipeline type "${pipelineType}". No project directory available to check custom types.` };
  }

  const result = loadCustomPipeline(velaDir, pipelineType);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, steps: result.pipeline.steps };
}

/** Resolves a scale to its pipeline type. */
export function scaleToType(scale: Scale): PipelineType {
  return SCALE_TO_PIPELINE[scale];
}

// ── Result types ───────────────────────────────────────────────────

export type PipelineResult =
  | { ok: true; pipeline: Pipeline }
  | { ok: false; error: string };

// ── ID generation ──────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function shortUid(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

export function generatePipelineId(request: string): string {
  const date = formatDate(new Date());
  const uid = shortUid();
  const slug = slugify(request);
  return `${date}_${uid}_${slug}`;
}

// ── Valid scale check ──────────────────────────────────────────────

const VALID_SCALES = new Set<string>(['small', 'medium', 'large']);

function isValidScale(s: string): s is Scale {
  return VALID_SCALES.has(s);
}

// ── Engine functions ───────────────────────────────────────────────

/**
 * Creates a new pipeline for the given request and scale.
 * Optionally accepts a custom pipeline type name.
 * Rejects if an active pipeline already exists or if the scale/type is invalid.
 */
export function initPipeline(
  db: Database.Database,
  request: string,
  scale: string,
  options?: { type?: string; velaDir?: string },
): PipelineResult {
  if (!isValidScale(scale)) {
    return { ok: false, error: `Invalid scale "${scale}". Must be one of: small, medium, large` };
  }

  // Check for existing active pipelines
  const active = listPipelines(db, { status: 'active' });
  if (active.length > 0) {
    return {
      ok: false,
      error: `An active pipeline already exists: ${active[0].id}. Cancel or complete it first.`,
    };
  }

  let pipelineType: string;
  let stepIds: string[];

  if (options?.type) {
    // Custom or explicit type
    const stepsResult = getStepsForTypeOrCustom(options.type, options.velaDir);
    if (!stepsResult.ok) {
      return { ok: false, error: stepsResult.error };
    }
    pipelineType = options.type;
    stepIds = stepsResult.steps.map((s) => s.id);
  } else {
    // Default: derive from scale
    const builtinType = scaleToType(scale);
    pipelineType = builtinType;
    const steps = getStepsForType(builtinType);
    stepIds = steps.map((s) => s.id);
  }

  const id = generatePipelineId(request);

  const pipeline = createPipeline(db, {
    id,
    pipeline_type: pipelineType,
    request,
    scale,
    current_step: stepIds[0],
    steps: stepIds,
    completed_steps: [],
  });

  return { ok: true, pipeline };
}

/**
 * Returns the currently active pipeline, or null if none exists.
 */
export function getPipelineState(db: Database.Database): Pipeline | null {
  const active = listPipelines(db, { status: 'active' });
  return active.length > 0 ? active[0] : null;
}

/**
 * Transitions the active pipeline to its next step.
 * Moves current_step to completed_steps and advances to the next step.
 * If no more steps remain, marks the pipeline as completed.
 */
export function transitionPipeline(db: Database.Database): PipelineResult {
  const pipeline = getPipelineState(db);
  if (!pipeline) {
    return { ok: false, error: 'No active pipeline found' };
  }

  if (pipeline.status !== 'active') {
    return { ok: false, error: `Pipeline is ${pipeline.status}, not active` };
  }

  const { steps, current_step, completed_steps } = pipeline;
  const currentIndex = steps.indexOf(current_step);

  if (currentIndex === -1) {
    return { ok: false, error: `Current step "${current_step}" not found in steps array` };
  }

  const newCompleted = [...completed_steps, current_step];
  const nextIndex = currentIndex + 1;

  if (nextIndex >= steps.length) {
    // Pipeline is done
    const updated = updatePipeline(db, pipeline.id, {
      status: 'completed',
      current_step,
      completed_steps: newCompleted,
    });
    return updated
      ? { ok: true, pipeline: updated }
      : { ok: false, error: 'Failed to update pipeline' };
  }

  const nextStep = steps[nextIndex];
  const updated = updatePipeline(db, pipeline.id, {
    current_step: nextStep,
    completed_steps: newCompleted,
  });
  return updated
    ? { ok: true, pipeline: updated }
    : { ok: false, error: 'Failed to update pipeline' };
}

/**
 * Cancels the currently active pipeline.
 */
export function cancelPipeline(db: Database.Database): PipelineResult {
  const pipeline = getPipelineState(db);
  if (!pipeline) {
    return { ok: false, error: 'No active pipeline found' };
  }

  const updated = updatePipeline(db, pipeline.id, { status: 'cancelled' });
  return updated
    ? { ok: true, pipeline: updated }
    : { ok: false, error: 'Failed to cancel pipeline' };
}
