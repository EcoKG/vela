/**
 * Tests for pipeline artifact management.
 *
 * Covers:
 * - Artifact path generation
 * - Stage completion detection from Write tool calls
 * - Artifact reading (async + sync)
 * - Artifact writing
 * - Artifact listing
 * - Edge cases: missing files, non-Write tools, relative/absolute paths
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  getArtifactDir,
  getArtifactPath,
  ensureArtifactDir,
  detectStageCompletion,
  readStageArtifact,
  readStageArtifactSync,
  listArtifacts,
  writeStageArtifact,
} from '../src/pipeline-artifacts.js';
import type { PipelineStage } from '../src/pipeline-prompts.js';

// ── Helpers ────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vela-artifacts-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const TEST_PIPELINE_ID = '20260327_abc123_fix-login-bug';

// ── getArtifactDir ─────────────────────────────────────────────────

describe('getArtifactDir', () => {
  it('returns .vela/artifacts/{pipelineId}/', () => {
    const result = getArtifactDir('/project', 'my-pipeline');
    expect(result).toBe(path.join('/project', '.vela', 'artifacts', 'my-pipeline'));
  });

  it('handles nested cwd paths', () => {
    const result = getArtifactDir('/home/user/code/project', TEST_PIPELINE_ID);
    expect(result).toBe(
      path.join('/home/user/code/project', '.vela', 'artifacts', TEST_PIPELINE_ID),
    );
  });
});

// ── getArtifactPath ────────────────────────────────────────────────

describe('getArtifactPath', () => {
  const stages: PipelineStage[] = ['research', 'plan', 'execute', 'verify', 'commit'];

  it.each(stages)('returns correct path for %s stage', (stage) => {
    const result = getArtifactPath('/project', TEST_PIPELINE_ID, stage);
    expect(result).toBe(
      path.join('/project', '.vela', 'artifacts', TEST_PIPELINE_ID, `${stage}.md`),
    );
  });
});

// ── ensureArtifactDir ──────────────────────────────────────────────

describe('ensureArtifactDir', () => {
  it('creates the artifact directory recursively', async () => {
    const dir = await ensureArtifactDir(tmpDir, TEST_PIPELINE_ID);
    const stat = await fs.stat(dir);
    expect(stat.isDirectory()).toBe(true);
    expect(dir).toBe(getArtifactDir(tmpDir, TEST_PIPELINE_ID));
  });

  it('is idempotent — calling twice does not throw', async () => {
    await ensureArtifactDir(tmpDir, TEST_PIPELINE_ID);
    const dir = await ensureArtifactDir(tmpDir, TEST_PIPELINE_ID);
    const stat = await fs.stat(dir);
    expect(stat.isDirectory()).toBe(true);
  });
});

// ── detectStageCompletion ──────────────────────────────────────────

describe('detectStageCompletion', () => {
  it('detects Write to a research artifact path', () => {
    const artifactPath = getArtifactPath(tmpDir, TEST_PIPELINE_ID, 'research');
    const signal = detectStageCompletion(
      'Write',
      { path: artifactPath, content: '# Research' },
      tmpDir,
      TEST_PIPELINE_ID,
    );
    expect(signal.detected).toBe(true);
    expect(signal.stage).toBe('research');
    expect(signal.artifactPath).toBe(path.normalize(artifactPath));
  });

  it('detects Write to a plan artifact path', () => {
    const artifactPath = getArtifactPath(tmpDir, TEST_PIPELINE_ID, 'plan');
    const signal = detectStageCompletion(
      'Write',
      { path: artifactPath, content: '<plan>...</plan>' },
      tmpDir,
      TEST_PIPELINE_ID,
    );
    expect(signal.detected).toBe(true);
    expect(signal.stage).toBe('plan');
  });

  it('detects Write with relative path', () => {
    const relativePath = path.join('.vela', 'artifacts', TEST_PIPELINE_ID, 'execute.md');
    const signal = detectStageCompletion(
      'Write',
      { path: relativePath, content: '# Execute report' },
      tmpDir,
      TEST_PIPELINE_ID,
    );
    expect(signal.detected).toBe(true);
    expect(signal.stage).toBe('execute');
  });

  it('returns no detection for non-Write tool', () => {
    const artifactPath = getArtifactPath(tmpDir, TEST_PIPELINE_ID, 'research');
    const signal = detectStageCompletion(
      'Read',
      { path: artifactPath },
      tmpDir,
      TEST_PIPELINE_ID,
    );
    expect(signal.detected).toBe(false);
    expect(signal.stage).toBeNull();
    expect(signal.artifactPath).toBeNull();
  });

  it('returns no detection for Bash tool', () => {
    const signal = detectStageCompletion(
      'Bash',
      { command: 'echo hello' },
      tmpDir,
      TEST_PIPELINE_ID,
    );
    expect(signal.detected).toBe(false);
  });

  it('returns no detection for Write to unrelated path', () => {
    const signal = detectStageCompletion(
      'Write',
      { path: '/tmp/some-other-file.md', content: 'hello' },
      tmpDir,
      TEST_PIPELINE_ID,
    );
    expect(signal.detected).toBe(false);
  });

  it('returns no detection for Write to wrong pipeline ID', () => {
    const wrongPath = getArtifactPath(tmpDir, 'wrong-pipeline-id', 'research');
    const signal = detectStageCompletion(
      'Write',
      { path: wrongPath, content: '# Research' },
      tmpDir,
      TEST_PIPELINE_ID,
    );
    expect(signal.detected).toBe(false);
  });

  it('returns no detection when path is missing from input', () => {
    const signal = detectStageCompletion(
      'Write',
      { content: 'hello' },
      tmpDir,
      TEST_PIPELINE_ID,
    );
    expect(signal.detected).toBe(false);
  });

  it('returns no detection when path is not a string', () => {
    const signal = detectStageCompletion(
      'Write',
      { path: 42, content: 'hello' },
      tmpDir,
      TEST_PIPELINE_ID,
    );
    expect(signal.detected).toBe(false);
  });

  it('detects all five stages', () => {
    const stages: PipelineStage[] = ['research', 'plan', 'execute', 'verify', 'commit'];
    for (const stage of stages) {
      const artifactPath = getArtifactPath(tmpDir, TEST_PIPELINE_ID, stage);
      const signal = detectStageCompletion(
        'Write',
        { path: artifactPath, content: `# ${stage}` },
        tmpDir,
        TEST_PIPELINE_ID,
      );
      expect(signal.detected).toBe(true);
      expect(signal.stage).toBe(stage);
    }
  });
});

// ── writeStageArtifact ─────────────────────────────────────────────

describe('writeStageArtifact', () => {
  it('writes content to the correct path', async () => {
    const content = '# Research Report\n\nFindings here.';
    const writtenPath = await writeStageArtifact(
      tmpDir,
      TEST_PIPELINE_ID,
      'research',
      content,
    );

    const expected = getArtifactPath(tmpDir, TEST_PIPELINE_ID, 'research');
    expect(writtenPath).toBe(expected);

    const read = await fs.readFile(writtenPath, 'utf-8');
    expect(read).toBe(content);
  });

  it('creates the directory if it does not exist', async () => {
    await writeStageArtifact(tmpDir, TEST_PIPELINE_ID, 'plan', '<plan>x</plan>');
    const dir = getArtifactDir(tmpDir, TEST_PIPELINE_ID);
    const stat = await fs.stat(dir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('overwrites existing artifact', async () => {
    await writeStageArtifact(tmpDir, TEST_PIPELINE_ID, 'execute', 'v1');
    await writeStageArtifact(tmpDir, TEST_PIPELINE_ID, 'execute', 'v2');

    const result = await readStageArtifact(tmpDir, TEST_PIPELINE_ID, 'execute');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toBe('v2');
  });
});

// ── readStageArtifact (async) ──────────────────────────────────────

describe('readStageArtifact', () => {
  it('reads an existing artifact', async () => {
    const content = '# Plan\n\n## Tasks\n1. Do the thing';
    await writeStageArtifact(tmpDir, TEST_PIPELINE_ID, 'plan', content);

    const result = await readStageArtifact(tmpDir, TEST_PIPELINE_ID, 'plan');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe(content);
      expect(result.stage).toBe('plan');
    }
  });

  it('returns error for missing artifact', async () => {
    const result = await readStageArtifact(tmpDir, TEST_PIPELINE_ID, 'research');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Artifact not found');
      expect(result.error).toContain('research');
    }
  });

  it('returns error for missing artifact directory', async () => {
    const result = await readStageArtifact(tmpDir, 'nonexistent', 'verify');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Artifact not found');
    }
  });
});

// ── readStageArtifactSync ──────────────────────────────────────────

describe('readStageArtifactSync', () => {
  it('reads an existing artifact synchronously', async () => {
    const content = '## Verification Report\n\nAll tests pass.';
    await writeStageArtifact(tmpDir, TEST_PIPELINE_ID, 'verify', content);

    const result = readStageArtifactSync(tmpDir, TEST_PIPELINE_ID, 'verify');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe(content);
      expect(result.stage).toBe('verify');
    }
  });

  it('returns error for missing artifact', () => {
    const result = readStageArtifactSync(tmpDir, TEST_PIPELINE_ID, 'commit');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Artifact not found');
      expect(result.error).toContain('commit');
    }
  });
});

// ── listArtifacts ──────────────────────────────────────────────────

describe('listArtifacts', () => {
  it('returns empty array when no artifacts exist', async () => {
    const stages = await listArtifacts(tmpDir, TEST_PIPELINE_ID);
    expect(stages).toEqual([]);
  });

  it('returns stages with artifacts on disk', async () => {
    await writeStageArtifact(tmpDir, TEST_PIPELINE_ID, 'research', 'r');
    await writeStageArtifact(tmpDir, TEST_PIPELINE_ID, 'plan', 'p');

    const stages = await listArtifacts(tmpDir, TEST_PIPELINE_ID);
    expect(stages).toContain('research');
    expect(stages).toContain('plan');
    expect(stages).not.toContain('execute');
    expect(stages).toHaveLength(2);
  });

  it('returns all stages when all artifacts exist', async () => {
    const allStages: PipelineStage[] = ['research', 'plan', 'execute', 'verify', 'commit'];
    for (const stage of allStages) {
      await writeStageArtifact(tmpDir, TEST_PIPELINE_ID, stage, `content-${stage}`);
    }

    const stages = await listArtifacts(tmpDir, TEST_PIPELINE_ID);
    expect(stages).toHaveLength(5);
    for (const stage of allStages) {
      expect(stages).toContain(stage);
    }
  });
});

// ── Integration: write → detect → read cycle ──────────────────────

describe('artifact lifecycle', () => {
  it('write → detect → read cycle works end-to-end', async () => {
    const content = '# Research Report\n\n## Key Findings\n- Found the bug in auth.ts';

    // 1. Write the artifact
    const writtenPath = await writeStageArtifact(
      tmpDir,
      TEST_PIPELINE_ID,
      'research',
      content,
    );

    // 2. Detect completion via a simulated Write tool call
    const signal = detectStageCompletion(
      'Write',
      { path: writtenPath, content },
      tmpDir,
      TEST_PIPELINE_ID,
    );
    expect(signal.detected).toBe(true);
    expect(signal.stage).toBe('research');

    // 3. Read the artifact for downstream injection
    const readResult = await readStageArtifact(tmpDir, TEST_PIPELINE_ID, 'research');
    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      expect(readResult.content).toBe(content);
    }

    // 4. Verify listing
    const stages = await listArtifacts(tmpDir, TEST_PIPELINE_ID);
    expect(stages).toContain('research');
  });

  it('multi-stage pipeline artifact flow', async () => {
    // Simulate a full pipeline: research → plan → execute
    await writeStageArtifact(tmpDir, TEST_PIPELINE_ID, 'research', '# Research output');
    await writeStageArtifact(tmpDir, TEST_PIPELINE_ID, 'plan', '# Plan based on research');
    await writeStageArtifact(tmpDir, TEST_PIPELINE_ID, 'execute', '# Execute based on plan');

    // Read artifacts in sequence like the orchestrator would
    const research = await readStageArtifact(tmpDir, TEST_PIPELINE_ID, 'research');
    const plan = await readStageArtifact(tmpDir, TEST_PIPELINE_ID, 'plan');
    const execute = await readStageArtifact(tmpDir, TEST_PIPELINE_ID, 'execute');

    expect(research.ok).toBe(true);
    expect(plan.ok).toBe(true);
    expect(execute.ok).toBe(true);

    // Verify listing reflects all three
    const stages = await listArtifacts(tmpDir, TEST_PIPELINE_ID);
    expect(stages).toHaveLength(3);
  });
});
