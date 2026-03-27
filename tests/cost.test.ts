/**
 * Tests for src/cost.ts — cost module.
 *
 * Uses fixture-based temp directories with synthetic pipeline-state.json
 * and trace.jsonl data.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findArtifactDir, parseTraceEntries, getCostReport } from '../src/cost.js';
import type { CostResult, TraceEntry } from '../src/cost.js';

let tmpDir: string;
let velaDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-cost-test-'));
  velaDir = path.join(tmpDir, '.vela');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Create a pipeline artifact directory with pipeline-state.json and optional trace.jsonl.
 */
function createPipeline(
  opts: {
    dateSlug?: string;
    state?: Record<string, unknown>;
    /** When true, use state as-is without merging defaults */
    rawState?: boolean;
    traceLines?: string[];
  } = {},
): string {
  const slug = opts.dateSlug ?? '2026-01-15_001_test';
  // Support both date-only dirs and full slug dirs
  // The prototype scans date dirs, then slugs inside them
  // Our findArtifactDir matches /^\d{4}-\d{2}-\d{2}/ so we need a date-like parent
  const parts = slug.split('/');
  let artDir: string;
  if (parts.length === 2) {
    artDir = path.join(velaDir, 'artifacts', parts[0], parts[1]);
  } else {
    // Single slug: create inside a date directory
    artDir = path.join(velaDir, 'artifacts', '2026-01-15', slug);
  }
  fs.mkdirSync(artDir, { recursive: true });

  const defaultState = {
    pipeline_type: 'standard',
    status: 'active',
    request: 'Build cost feature',
    steps: ['research', 'plan', 'execute', 'validate'],
    completed_steps: ['research', 'plan'],
    current_step: 'execute',
    created_at: '2026-01-15T10:00:00.000Z',
    updated_at: '2026-01-15T10:30:00.000Z',
  };

  fs.writeFileSync(
    path.join(artDir, 'pipeline-state.json'),
    JSON.stringify(opts.rawState ? (opts.state ?? {}) : { ...defaultState, ...(opts.state ?? {}) }),
  );

  if (opts.traceLines) {
    fs.writeFileSync(path.join(artDir, 'trace.jsonl'), opts.traceLines.join('\n') + '\n');
  }

  return artDir;
}

// ── findArtifactDir ────────────────────────────────────────────────

describe('findArtifactDir', () => {
  it('returns null when .vela/artifacts/ does not exist', () => {
    expect(findArtifactDir(velaDir)).toBeNull();
  });

  it('returns null when artifacts dir is empty', () => {
    fs.mkdirSync(path.join(velaDir, 'artifacts'), { recursive: true });
    expect(findArtifactDir(velaDir)).toBeNull();
  });

  it('finds the most recent pipeline artifact directory', () => {
    const artDir = createPipeline();
    const found = findArtifactDir(velaDir);
    expect(found).toBe(artDir);
  });

  it('prefers more recent date directories', () => {
    createPipeline({ dateSlug: '2026-01-10/older' });
    const newer = createPipeline({ dateSlug: '2026-01-20/newer' });
    const found = findArtifactDir(velaDir);
    expect(found).toBe(newer);
  });

  it('returns null when directories exist but no pipeline-state.json', () => {
    const artDir = path.join(velaDir, 'artifacts', '2026-01-15', 'test-slug');
    fs.mkdirSync(artDir, { recursive: true });
    // No pipeline-state.json written
    expect(findArtifactDir(velaDir)).toBeNull();
  });
});

// ── parseTraceEntries ──────────────────────────────────────────────

describe('parseTraceEntries', () => {
  it('returns empty array for non-existent file', () => {
    expect(parseTraceEntries('/nonexistent/trace.jsonl')).toEqual([]);
  });

  it('parses valid trace entries', () => {
    const tracePath = path.join(tmpDir, 'trace.jsonl');
    fs.writeFileSync(
      tracePath,
      [
        JSON.stringify({ action: 'tool_use', tool: 'Read', step: 'execute', timestamp: 1000 }),
        JSON.stringify({ action: 'agent_dispatch', tool: 'Agent', step: 'execute', timestamp: 2000 }),
      ].join('\n'),
    );
    const entries = parseTraceEntries(tracePath);
    expect(entries).toHaveLength(2);
    expect(entries[0].action).toBe('tool_use');
    expect(entries[1].action).toBe('agent_dispatch');
  });

  it('skips malformed JSON lines', () => {
    const tracePath = path.join(tmpDir, 'trace.jsonl');
    fs.writeFileSync(
      tracePath,
      [
        JSON.stringify({ action: 'tool_use', tool: 'Read' }),
        '{ this is not valid json }}}',
        'not json at all',
        JSON.stringify({ action: 'tool_use', tool: 'Write' }),
      ].join('\n'),
    );
    const entries = parseTraceEntries(tracePath);
    expect(entries).toHaveLength(2);
    expect(entries[0].tool).toBe('Read');
    expect(entries[1].tool).toBe('Write');
  });

  it('skips entries without action field', () => {
    const tracePath = path.join(tmpDir, 'trace.jsonl');
    fs.writeFileSync(
      tracePath,
      [
        JSON.stringify({ action: 'tool_use', tool: 'Read' }),
        JSON.stringify({ tool: 'Write' }), // missing action
        JSON.stringify({ action: 123 }), // action is not string
      ].join('\n'),
    );
    const entries = parseTraceEntries(tracePath);
    expect(entries).toHaveLength(1);
  });

  it('handles empty file (0 bytes)', () => {
    const tracePath = path.join(tmpDir, 'trace.jsonl');
    fs.writeFileSync(tracePath, '');
    expect(parseTraceEntries(tracePath)).toEqual([]);
  });

  it('handles whitespace-only lines', () => {
    const tracePath = path.join(tmpDir, 'trace.jsonl');
    fs.writeFileSync(tracePath, '  \n\n  \n');
    expect(parseTraceEntries(tracePath)).toEqual([]);
  });

  it('handles single trace entry', () => {
    const tracePath = path.join(tmpDir, 'trace.jsonl');
    fs.writeFileSync(tracePath, JSON.stringify({ action: 'tool_use', tool: 'Bash' }));
    const entries = parseTraceEntries(tracePath);
    expect(entries).toHaveLength(1);
    expect(entries[0].tool).toBe('Bash');
  });
});

// ── getCostReport ──────────────────────────────────────────────────

describe('getCostReport', () => {
  it('returns ok:false when no artifacts dir exists', () => {
    const result = getCostReport(velaDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/No pipeline/i);
    }
  });

  it('returns ok:false when artifacts dir is empty', () => {
    fs.mkdirSync(path.join(velaDir, 'artifacts'), { recursive: true });
    const result = getCostReport(velaDir);
    expect(result.ok).toBe(false);
  });

  it('returns report with zero metrics when pipeline exists but no trace.jsonl', () => {
    createPipeline(); // No traceLines
    const result = getCostReport(velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.metrics.tool_calls).toBe(0);
      expect(result.report.metrics.agent_dispatches).toBe(0);
      expect(result.report.metrics.step_breakdown).toEqual({});
      expect(result.report.pipeline.status).toBe('active');
      expect(result.report.pipeline.type).toBe('standard');
    }
  });

  it('computes correct tool_calls and agent_dispatches counts', () => {
    createPipeline({
      traceLines: [
        JSON.stringify({ action: 'tool_use', tool: 'Read', step: 'execute' }),
        JSON.stringify({ action: 'tool_use', tool: 'Write', step: 'execute' }),
        JSON.stringify({ action: 'tool_use', tool: 'Bash', step: 'research' }),
        JSON.stringify({ action: 'agent_dispatch', tool: 'Agent', step: 'execute' }),
        JSON.stringify({ action: 'agent_dispatch', tool: 'Task', step: 'execute' }),
        JSON.stringify({ action: 'build_test_signal', signal_type: 'build', result: 'pass' }),
      ],
    });
    const result = getCostReport(velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.metrics.tool_calls).toBe(3);
      expect(result.report.metrics.agent_dispatches).toBe(2);
    }
  });

  it('computes correct step_breakdown', () => {
    createPipeline({
      traceLines: [
        JSON.stringify({ action: 'tool_use', tool: 'Read', step: 'research' }),
        JSON.stringify({ action: 'tool_use', tool: 'Read', step: 'research' }),
        JSON.stringify({ action: 'tool_use', tool: 'Write', step: 'execute' }),
        JSON.stringify({ action: 'tool_use', tool: 'Bash', step: 'execute' }),
        JSON.stringify({ action: 'tool_use', tool: 'Bash', step: 'execute' }),
        JSON.stringify({ action: 'tool_use', tool: 'Read' }), // no step → 'unknown'
      ],
    });
    const result = getCostReport(velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.metrics.step_breakdown).toEqual({
        research: 2,
        execute: 3,
        unknown: 1,
      });
    }
  });

  it('computes duration_minutes from pipeline timestamps', () => {
    createPipeline({
      state: {
        created_at: '2026-01-15T10:00:00.000Z',
        updated_at: '2026-01-15T12:30:00.000Z',
      },
    });
    const result = getCostReport(velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.metrics.duration_minutes).toBe(150);
    }
  });

  it('returns zero duration when timestamps are missing', () => {
    createPipeline({
      rawState: true,
      state: {
        pipeline_type: 'standard',
        status: 'active',
        request: 'test',
        steps: [],
        completed_steps: [],
      },
    });
    const result = getCostReport(velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.metrics.duration_minutes).toBe(0);
    }
  });

  it('counts artifacts_produced (non-hidden files)', () => {
    const artDir = createPipeline({
      traceLines: [JSON.stringify({ action: 'tool_use', tool: 'Read' })],
    });
    // Create some extra artifact files
    fs.writeFileSync(path.join(artDir, 'research-context.md'), 'context');
    fs.writeFileSync(path.join(artDir, 'plan.md'), 'plan');
    fs.writeFileSync(path.join(artDir, '.hidden'), 'hidden');
    const result = getCostReport(velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // pipeline-state.json + trace.jsonl + research-context.md + plan.md = 4
      // .hidden is excluded
      expect(result.report.metrics.artifacts_produced).toBe(4);
    }
  });

  it('populates pipeline info from state', () => {
    createPipeline({
      state: {
        pipeline_type: 'research-only',
        status: 'completed',
        request: 'Add user auth',
        steps: ['research', 'plan', 'execute'],
        completed_steps: ['research', 'plan', 'execute'],
      },
    });
    const result = getCostReport(velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.pipeline.type).toBe('research-only');
      expect(result.report.pipeline.status).toBe('completed');
      expect(result.report.pipeline.request).toBe('Add user auth');
      expect(result.report.pipeline.steps_completed).toBe(3);
      expect(result.report.pipeline.steps_total).toBe(3);
    }
  });

  it('handles pipeline-state.json without steps/completed_steps arrays', () => {
    createPipeline({
      rawState: true,
      state: {
        pipeline_type: 'standard',
        status: 'active',
        request: 'test',
        created_at: '2026-01-15T10:00:00.000Z',
        updated_at: '2026-01-15T10:00:00.000Z',
      },
    });
    const result = getCostReport(velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.pipeline.steps_completed).toBe(0);
      expect(result.report.pipeline.steps_total).toBe(0);
    }
  });

  it('includes command: "cost" in report', () => {
    createPipeline();
    const result = getCostReport(velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.command).toBe('cost');
    }
  });

  it('skips malformed trace lines in full cost report', () => {
    createPipeline({
      traceLines: [
        JSON.stringify({ action: 'tool_use', tool: 'Read', step: 'execute' }),
        '{invalid json here',
        JSON.stringify({ action: 'tool_use', tool: 'Write', step: 'execute' }),
      ],
    });
    const result = getCostReport(velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.metrics.tool_calls).toBe(2);
    }
  });

  it('handles empty trace.jsonl', () => {
    const artDir = createPipeline();
    fs.writeFileSync(path.join(artDir, 'trace.jsonl'), '');
    const result = getCostReport(velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.metrics.tool_calls).toBe(0);
      expect(result.report.metrics.agent_dispatches).toBe(0);
    }
  });

  it('handles corrupt pipeline-state.json', () => {
    const artDir = path.join(velaDir, 'artifacts', '2026-01-15', 'corrupt-test');
    fs.mkdirSync(artDir, { recursive: true });
    fs.writeFileSync(path.join(artDir, 'pipeline-state.json'), 'not valid json {{');
    const result = getCostReport(velaDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Failed to read/);
    }
  });

  it('handles pipeline-state.json with invalid date fields gracefully', () => {
    createPipeline({
      state: {
        created_at: 'not-a-date',
        updated_at: 'also-not-a-date',
      },
    });
    const result = getCostReport(velaDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.metrics.duration_minutes).toBe(0);
    }
  });
});
