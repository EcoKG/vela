/**
 * Vela Pipeline State Helpers
 * Typed utilities for reading and managing pipeline state across governance gates.
 * Ported from src/hooks/shared/pipeline.cjs to typed ESM.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { VelaConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface PipelineState {
  status: string;
  current_step: string;
  pipeline_type: string;
  revisions: Record<string, unknown>;
  git: Record<string, unknown>;
  _path?: string;
  _artifactDir?: string;
  _stale?: boolean;
  [key: string]: unknown;
}

export interface GovernanceConfig extends VelaConfig {
  sandbox?: {
    enabled?: boolean;
    [key: string]: unknown;
  };
  gate_guard?: {
    enabled?: boolean;
    [key: string]: unknown;
  };
}

export interface StepDef {
  id: string;
  name: string;
  mode: string;
  team?: string;
  max_revisions?: number;
  sub_phases?: Array<{ id: string; name: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

interface PipelineDef {
  pipelines: Record<string, {
    steps: StepDef[];
    inherits?: string;
    steps_only?: string[];
    overrides?: Record<string, Partial<StepDef>>;
  }>;
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Find the most recent active (non-completed) pipeline state.
 * Searches .vela/artifacts/{date}_{id}_{slug}/pipeline-state.json
 * and the legacy nested structure artifacts/{date}/{slug}/.
 */
export function findActivePipeline(velaDir: string): PipelineState | null {
  const artifactsDir = path.join(velaDir, 'artifacts');
  if (!fs.existsSync(artifactsDir)) return null;

  try {
    // Flat structure: artifacts/{date}_{id}_{slug}/pipeline-state.json
    const dirs = fs.readdirSync(artifactsDir)
      .filter(d =>
        /^\d{4}-\d{2}-\d{2}_/.test(d) &&
        fs.statSync(path.join(artifactsDir, d)).isDirectory(),
      )
      .sort()
      .reverse();

    for (const dir of dirs) {
      const dirPath = path.join(artifactsDir, dir);
      const statePath = path.join(dirPath, 'pipeline-state.json');
      if (!fs.existsSync(statePath)) continue;

      try {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as PipelineState;
        if (state.status === 'completed' || state.status === 'cancelled') continue;

        // Mark stale if untouched for 24 hours
        const mtime = fs.statSync(statePath).mtimeMs;
        if (Date.now() - mtime > 24 * 60 * 60 * 1000) {
          state._stale = true;
        }

        state._path = statePath;
        state._artifactDir = dirPath;
        return state;
      } catch {
        continue;
      }
    }

    // Backward compatibility: nested structure artifacts/{date}/{slug}/
    const dateDirs = fs.readdirSync(artifactsDir)
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .reverse();

    for (const dateDir of dateDirs) {
      const datePath = path.join(artifactsDir, dateDir);
      const slugDirs = fs.readdirSync(datePath)
        .filter(d => fs.statSync(path.join(datePath, d)).isDirectory())
        .sort()
        .reverse();

      for (const slugDir of slugDirs) {
        const statePath = path.join(datePath, slugDir, 'pipeline-state.json');
        if (!fs.existsSync(statePath)) continue;

        try {
          const state = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as PipelineState;
          if (state.status === 'completed' || state.status === 'cancelled') continue;

          const mtime = fs.statSync(statePath).mtimeMs;
          if (Date.now() - mtime > 24 * 60 * 60 * 1000) {
            state._stale = true;
          }

          state._path = statePath;
          state._artifactDir = path.join(datePath, slugDir);
          return state;
        } catch {
          continue;
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Check if an active pipeline exists in the project.
 */
export function hasActivePipeline(cwd: string): boolean {
  const velaDir = path.join(cwd, '.vela');
  if (!fs.existsSync(velaDir)) return false;
  return findActivePipeline(velaDir) !== null;
}

/**
 * Read the Vela config from the project.
 * Returns the extended GovernanceConfig which may include sandbox/gate_guard fields.
 */
export function readGovernanceConfig(cwd: string): GovernanceConfig | null {
  const configPath = path.join(cwd, '.vela', 'config.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as GovernanceConfig;
  } catch {
    return null;
  }
}

/**
 * Read pipeline definition from .vela/templates/pipeline.json.
 */
export function readPipelineDefinition(cwd: string): PipelineDef | null {
  const pipelinePath = path.join(cwd, '.vela', 'templates', 'pipeline.json');
  if (!fs.existsSync(pipelinePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pipelinePath, 'utf-8')) as PipelineDef;
  } catch {
    return null;
  }
}

/**
 * Get the current step definition from the pipeline.
 */
export function getCurrentStepDef(
  pipelineDef: PipelineDef | null,
  state: PipelineState | null,
): StepDef | null {
  if (!pipelineDef || !state) return null;

  const pipelineType = state.pipeline_type || 'standard';
  const pipeline = pipelineDef.pipelines[pipelineType];
  if (!pipeline) return null;

  let steps = pipeline.steps;

  if (pipeline.inherits && pipeline.steps_only) {
    const parent = pipelineDef.pipelines[pipeline.inherits];
    if (parent) {
      steps = parent.steps.filter(s => pipeline.steps_only!.includes(s.id));
      // Apply overrides
      if (pipeline.overrides) {
        steps = steps.map(s => {
          const override = pipeline.overrides![s.id];
          if (override) {
            return { ...s, ...override } as StepDef;
          }
          return s;
        });
      }
    }
  }

  return steps.find(s => s.id === state.current_step) ?? null;
}

/**
 * Get the mode for the current pipeline step.
 * Defaults to 'read' when no active pipeline exists.
 */
export function getCurrentMode(cwd: string): string {
  const velaDir = path.join(cwd, '.vela');
  const state = findActivePipeline(velaDir);
  if (!state) return 'read';

  const pipelineDef = readPipelineDefinition(cwd);
  const stepDef = getCurrentStepDef(pipelineDef, state);
  if (!stepDef) return 'read';

  return stepDef.mode || 'read';
}

/**
 * Get session state file path (project-local).
 */
export function getSessionStatePath(sessionId: string, cwd?: string): string {
  const velaStateDir = path.join(cwd ?? process.cwd(), '.vela', 'state');
  return path.join(velaStateDir, `vela-${sessionId}.json`);
}
