/**
 * Vela Cost Intelligence — reads trace.jsonl + pipeline-state.json
 * from a pipeline's artifact directory and produces a structured cost report.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Types ──────────────────────────────────────────────────────────

export interface StepBreakdown {
  [step: string]: number;
}

export interface CostMetrics {
  tool_calls: number;
  agent_dispatches: number;
  artifacts_produced: number;
  duration_minutes: number;
  step_breakdown: StepBreakdown;
}

export interface PipelineInfo {
  type: string;
  status: string;
  request: string;
  steps_completed: number;
  steps_total: number;
}

export interface CostReport {
  command: 'cost';
  pipeline: PipelineInfo;
  metrics: CostMetrics;
}

export type CostResult =
  | { ok: true; report: CostReport }
  | { ok: false; error: string };

export interface TraceEntry {
  action: string;
  tool?: string;
  step?: string | null;
  timestamp?: number;
  signal_type?: string;
  result?: string;
  command?: string;
  description?: string;
}

// ── Artifact directory scanning ────────────────────────────────────

/**
 * Scan `.vela/artifacts/` for the most recent pipeline artifact directory
 * containing a pipeline-state.json. Optionally match a specific pipelineId.
 *
 * Returns the absolute path to the artifact directory, or null if not found.
 */
export function findArtifactDir(velaDir: string, pipelineId?: string): string | null {
  const artifactsDir = path.join(velaDir, 'artifacts');
  if (!fs.existsSync(artifactsDir)) return null;

  let dateDirs: string[];
  try {
    dateDirs = fs.readdirSync(artifactsDir)
      .filter(d => /^\d{4}-\d{2}-\d{2}/.test(d))
      .sort()
      .reverse();
  } catch {
    return null;
  }

  for (const dd of dateDirs) {
    const datePath = path.join(artifactsDir, dd);
    let slugs: string[];
    try {
      slugs = fs.readdirSync(datePath)
        .filter(d => {
          try { return fs.statSync(path.join(datePath, d)).isDirectory(); } catch { return false; }
        })
        .sort()
        .reverse();
    } catch {
      continue;
    }

    for (const slug of slugs) {
      if (pipelineId && !slug.includes(pipelineId)) continue;
      const statePath = path.join(datePath, slug, 'pipeline-state.json');
      if (fs.existsSync(statePath)) {
        return path.join(datePath, slug);
      }
    }
  }

  return null;
}

// ── Trace parsing ──────────────────────────────────────────────────

/**
 * Read trace.jsonl and return parsed entries. Malformed lines are skipped.
 */
export function parseTraceEntries(tracePath: string): TraceEntry[] {
  if (!fs.existsSync(tracePath)) return [];

  let raw: string;
  try {
    raw = fs.readFileSync(tracePath, 'utf-8');
  } catch {
    return [];
  }

  const entries: TraceEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && typeof parsed.action === 'string') {
        entries.push(parsed as TraceEntry);
      }
    } catch {
      // Skip malformed lines
    }
  }
  return entries;
}

// ── Cost report computation ────────────────────────────────────────

/**
 * Main entry point: produce a CostResult from the .vela directory.
 * Scans for the most recent (or specified) pipeline and computes metrics.
 */
export function getCostReport(velaDir: string, pipelineId?: string): CostResult {
  const artifactDir = findArtifactDir(velaDir, pipelineId);
  if (!artifactDir) {
    return { ok: false, error: 'No pipeline found.' };
  }

  // Read pipeline state
  const statePath = path.join(artifactDir, 'pipeline-state.json');
  let state: Record<string, unknown>;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  } catch {
    return { ok: false, error: 'Failed to read pipeline-state.json.' };
  }

  // Parse trace entries (missing trace.jsonl → zero metrics, not error)
  const tracePath = path.join(artifactDir, 'trace.jsonl');
  const entries = parseTraceEntries(tracePath);

  // Compute metrics
  let toolCalls = 0;
  let agentDispatches = 0;
  const stepBreakdown: StepBreakdown = {};

  for (const entry of entries) {
    if (entry.action === 'tool_use') {
      toolCalls++;
      const step = entry.step || 'unknown';
      stepBreakdown[step] = (stepBreakdown[step] || 0) + 1;
    }
    if (entry.action === 'agent_dispatch') {
      agentDispatches++;
    }
  }

  // Duration from pipeline timestamps
  const createdAt = state.created_at as string | undefined;
  const updatedAt = state.updated_at as string | undefined;
  let durationMinutes = 0;
  if (createdAt && updatedAt) {
    const created = new Date(createdAt);
    const updated = new Date(updatedAt);
    if (!isNaN(created.getTime()) && !isNaN(updated.getTime())) {
      durationMinutes = Math.round((updated.getTime() - created.getTime()) / 60000);
    }
  }

  // Count artifact files (non-hidden)
  let artifactsProduced = 0;
  try {
    artifactsProduced = fs.readdirSync(artifactDir).filter(f => !f.startsWith('.')).length;
  } catch {
    // zero if unreadable
  }

  // Build pipeline info
  const completedSteps = Array.isArray(state.completed_steps) ? state.completed_steps : [];
  const allSteps = Array.isArray(state.steps) ? state.steps : [];

  const pipeline: PipelineInfo = {
    type: (state.pipeline_type as string) || 'unknown',
    status: (state.status as string) || 'unknown',
    request: (state.request as string) || '',
    steps_completed: completedSteps.length,
    steps_total: allSteps.length,
  };

  const metrics: CostMetrics = {
    tool_calls: toolCalls,
    agent_dispatches: agentDispatches,
    artifacts_produced: artifactsProduced,
    duration_minutes: durationMinutes,
    step_breakdown: stepBreakdown,
  };

  return {
    ok: true,
    report: {
      command: 'cost',
      pipeline,
      metrics,
    },
  };
}
