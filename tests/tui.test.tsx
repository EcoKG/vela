import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Header } from '../src/tui/Header.js';
import { PipelinePanel } from '../src/tui/PipelinePanel.js';
import { TaskProgress } from '../src/tui/TaskProgress.js';
import { AutoModeStatus } from '../src/tui/AutoModeStatus.js';
import type { Pipeline, Task } from '../src/state.js';
import type { AutoModeState } from '../src/auto-mode.js';

// ── Helpers ────────────────────────────────────────────────────────

function makePipeline(overrides?: Partial<Pipeline>): Pipeline {
  return {
    id: 'test-pipeline',
    status: 'active',
    pipeline_type: 'standard',
    request: 'Add feature X',
    type: 'code',
    scale: 'large',
    current_step: 'execute',
    steps: ['init', 'research', 'plan', 'execute', 'verify', 'commit', 'finalize'],
    completed_steps: ['init', 'research', 'plan'],
    revisions: {},
    git: null,
    artifact_dir: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTask(id: string, status: string): Task {
  return {
    id,
    slice_id: 'S01',
    milestone_id: 'M001',
    title: `Task ${id}`,
    status,
    description: null,
    summary: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function makeAutoModeState(overrides?: Partial<AutoModeState>): AutoModeState {
  return {
    status: 'running',
    milestone_id: 'M001',
    slice_id: 'S01',
    task_ids: ['T01', 'T02', 'T03'],
    current_index: 1,
    completed_count: 1,
    blocker: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── Header ─────────────────────────────────────────────────────────

describe('Header', () => {
  it('renders branding text with ⛵ and ✦', () => {
    const { lastFrame } = render(<Header />);
    const frame = lastFrame()!;
    expect(frame).toContain('⛵');
    expect(frame).toContain('Vela');
    expect(frame).toContain('✦');
  });

  it('renders decorative separator line', () => {
    const { lastFrame } = render(<Header />);
    const frame = lastFrame()!;
    expect(frame).toContain('─');
  });
});

// ── PipelinePanel ──────────────────────────────────────────────────

describe('PipelinePanel', () => {
  it('shows "No active pipeline" when pipeline is null', () => {
    const { lastFrame } = render(<PipelinePanel pipeline={null} />);
    const frame = lastFrame()!;
    expect(frame).toContain('No active pipeline');
  });

  it('shows pipeline type and scale for an active pipeline', () => {
    const pipeline = makePipeline();
    const { lastFrame } = render(<PipelinePanel pipeline={pipeline} />);
    const frame = lastFrame()!;
    expect(frame).toContain('standard');
    expect(frame).toContain('large');
  });

  it('shows current step name', () => {
    const pipeline = makePipeline({ current_step: 'execute' });
    const { lastFrame } = render(<PipelinePanel pipeline={pipeline} />);
    const frame = lastFrame()!;
    expect(frame).toContain('execute');
  });

  it('shows step progress fraction', () => {
    const pipeline = makePipeline({
      steps: ['init', 'plan', 'execute'],
      completed_steps: ['init'],
    });
    const { lastFrame } = render(<PipelinePanel pipeline={pipeline} />);
    const frame = lastFrame()!;
    expect(frame).toContain('1/3');
  });
});

// ── TaskProgress ───────────────────────────────────────────────────

describe('TaskProgress', () => {
  it('shows "No tasks" when tasks array is empty', () => {
    const { lastFrame } = render(<TaskProgress tasks={[]} />);
    const frame = lastFrame()!;
    expect(frame).toContain('No tasks');
  });

  it('shows task completion fraction', () => {
    const tasks = [
      makeTask('T01', 'complete'),
      makeTask('T02', 'complete'),
      makeTask('T03', 'pending'),
      makeTask('T04', 'pending'),
      makeTask('T05', 'pending'),
    ];
    const { lastFrame } = render(<TaskProgress tasks={tasks} />);
    const frame = lastFrame()!;
    expect(frame).toContain('2/5 tasks completed');
  });

  it('shows percentage', () => {
    const tasks = [
      makeTask('T01', 'complete'),
      makeTask('T02', 'pending'),
    ];
    const { lastFrame } = render(<TaskProgress tasks={tasks} />);
    const frame = lastFrame()!;
    expect(frame).toContain('50%');
  });
});

// ── AutoModeStatus ─────────────────────────────────────────────────

describe('AutoModeStatus', () => {
  it('shows "not active" when state is null', () => {
    const { lastFrame } = render(<AutoModeStatus state={null} />);
    const frame = lastFrame()!;
    expect(frame).toContain('not active');
  });

  it('shows RUNNING status for running state', () => {
    const state = makeAutoModeState({ status: 'running' });
    const { lastFrame } = render(<AutoModeStatus state={state} />);
    const frame = lastFrame()!;
    expect(frame).toContain('RUNNING');
  });

  it('shows PAUSED status for paused state', () => {
    const state = makeAutoModeState({ status: 'paused' });
    const { lastFrame } = render(<AutoModeStatus state={state} />);
    const frame = lastFrame()!;
    expect(frame).toContain('PAUSED');
  });

  it('shows blocker info when present', () => {
    const state = makeAutoModeState({
      status: 'paused',
      blocker: {
        reason: 'Missing API key',
        task_id: 'T02',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    });
    const { lastFrame } = render(<AutoModeStatus state={state} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Blocker');
    expect(frame).toContain('Missing API key');
  });

  it('shows task progress index', () => {
    const state = makeAutoModeState({ current_index: 1, task_ids: ['T01', 'T02', 'T03'] });
    const { lastFrame } = render(<AutoModeStatus state={state} />);
    const frame = lastFrame()!;
    expect(frame).toContain('task 2 of 3');
  });
});
