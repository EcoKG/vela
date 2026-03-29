/**
 * Pipeline artifact management for the Vela orchestrator.
 *
 * Manages artifact file paths, stage completion detection (by monitoring
 * Write tool calls), and artifact retrieval for downstream stage injection.
 *
 * Artifact layout:
 *   .vela/artifacts/{pipelineId}/research.md
 *   .vela/artifacts/{pipelineId}/plan.md
 *   .vela/artifacts/{pipelineId}/execute.md
 *   .vela/artifacts/{pipelineId}/verify.md
 *   .vela/artifacts/{pipelineId}/commit.md
 */
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import type { PipelineStage } from './pipeline-prompts.js';

// ── Constants ──────────────────────────────────────────────────────

/** Valid artifact stages with expected file extensions. */
const STAGE_FILENAMES: Record<PipelineStage, string> = {
  research: 'research.md',
  plan: 'plan.md',
  execute: 'execute.md',
  verify: 'verify.md',
  commit: 'commit.md',
};

// ── Path helpers ───────────────────────────────────────────────────

/**
 * Returns the directory where a pipeline's artifacts are stored.
 * Path: {cwd}/.vela/artifacts/{pipelineId}/
 */
export function getArtifactDir(cwd: string, pipelineId: string): string {
  return path.join(cwd, '.vela', 'artifacts', pipelineId);
}

/**
 * Returns the full file path for a specific stage artifact.
 * Path: {cwd}/.vela/artifacts/{pipelineId}/{stage}.md
 */
export function getArtifactPath(
  cwd: string,
  pipelineId: string,
  stage: PipelineStage,
): string {
  return path.join(getArtifactDir(cwd, pipelineId), STAGE_FILENAMES[stage]);
}

/**
 * Ensures the artifact directory exists for a pipeline.
 * Creates the full path recursively if missing.
 */
export async function ensureArtifactDir(
  cwd: string,
  pipelineId: string,
): Promise<string> {
  const dir = getArtifactDir(cwd, pipelineId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// ── Stage completion detection ─────────────────────────────────────

/**
 * Result of a stage completion check.
 */
export interface CompletionSignal {
  /** Whether a stage completion was detected. */
  detected: boolean;
  /** Which stage completed (if detected). */
  stage: PipelineStage | null;
  /** The artifact file path (if detected). */
  artifactPath: string | null;
}

/** No completion detected — singleton for reuse. */
const NO_COMPLETION: CompletionSignal = {
  detected: false,
  stage: null,
  artifactPath: null,
};

/**
 * Detects whether a tool call (specifically a Write) creates a stage
 * artifact file, signaling that the stage is complete.
 *
 * The orchestrator calls this after each Write tool execution to check
 * whether the written file matches the expected artifact path pattern
 * for any pipeline stage.
 *
 * @param toolName  - The tool that was invoked (only "Write" triggers detection).
 * @param toolInput - The tool's input parameters (must contain `path`).
 * @param cwd       - The working directory of the project.
 * @param pipelineId - The active pipeline's identifier.
 * @returns A CompletionSignal indicating whether a stage artifact was created.
 */
export function detectStageCompletion(
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd: string,
  pipelineId: string,
): CompletionSignal {
  // Only Write tool calls can produce artifacts
  if (toolName !== 'Write') return NO_COMPLETION;

  const writtenPath = toolInput.path;
  if (typeof writtenPath !== 'string') return NO_COMPLETION;

  // Normalise to absolute for comparison
  const absWritten = path.isAbsolute(writtenPath)
    ? path.normalize(writtenPath)
    : path.normalize(path.join(cwd, writtenPath));

  // Check against each stage's expected artifact path
  for (const stage of Object.keys(STAGE_FILENAMES) as PipelineStage[]) {
    const expected = path.normalize(getArtifactPath(cwd, pipelineId, stage));
    if (absWritten === expected) {
      return {
        detected: true,
        stage,
        artifactPath: expected,
      };
    }
  }

  return NO_COMPLETION;
}

// ── Artifact reading ───────────────────────────────────────────────

/**
 * Result of reading a stage artifact.
 */
export type ArtifactReadResult =
  | { ok: true; content: string; stage: PipelineStage }
  | { ok: false; error: string };

/**
 * Reads a stage artifact from disk.
 *
 * Used by the orchestrator to inject prior stage output into downstream
 * system prompts (e.g. research output → plan stage prompt).
 *
 * @param cwd        - The working directory of the project.
 * @param pipelineId - The pipeline identifier.
 * @param stage      - Which stage's artifact to read.
 */
export async function readStageArtifact(
  cwd: string,
  pipelineId: string,
  stage: PipelineStage,
): Promise<ArtifactReadResult> {
  const artifactPath = getArtifactPath(cwd, pipelineId, stage);

  try {
    const content = await fs.readFile(artifactPath, 'utf-8');
    return { ok: true, content, stage };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {
        ok: false,
        error: `Artifact not found: ${stage} (${artifactPath})`,
      };
    }
    return {
      ok: false,
      error: `Failed to read artifact ${stage}: ${(err as Error).message}`,
    };
  }
}

/**
 * Synchronous variant of readStageArtifact for use in prompt builders
 * and other synchronous contexts.
 */
export function readStageArtifactSync(
  cwd: string,
  pipelineId: string,
  stage: PipelineStage,
): ArtifactReadResult {
  const artifactPath = getArtifactPath(cwd, pipelineId, stage);

  try {
    const content = fsSync.readFileSync(artifactPath, 'utf-8');
    return { ok: true, content, stage };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {
        ok: false,
        error: `Artifact not found: ${stage} (${artifactPath})`,
      };
    }
    return {
      ok: false,
      error: `Failed to read artifact ${stage}: ${(err as Error).message}`,
    };
  }
}

// ── Artifact listing ───────────────────────────────────────────────

/**
 * Lists all available artifacts for a pipeline.
 * Returns the stages that have artifact files on disk.
 */
export async function listArtifacts(
  cwd: string,
  pipelineId: string,
): Promise<PipelineStage[]> {
  const dir = getArtifactDir(cwd, pipelineId);
  const stages: PipelineStage[] = [];

  for (const [stage, filename] of Object.entries(STAGE_FILENAMES)) {
    const filePath = path.join(dir, filename);
    try {
      await fs.access(filePath);
      stages.push(stage as PipelineStage);
    } catch {
      // File doesn't exist — skip
    }
  }

  return stages;
}

// ── Artifact writing ───────────────────────────────────────────────

/**
 * Writes a stage artifact to disk.
 *
 * Used by the orchestrator to persist stage output after a stage completes.
 * Creates the artifact directory if it doesn't exist.
 *
 * @param cwd        - The working directory of the project.
 * @param pipelineId - The pipeline identifier.
 * @param stage      - Which stage's artifact to write.
 * @param content    - The artifact content to write.
 */
export async function writeStageArtifact(
  cwd: string,
  pipelineId: string,
  stage: PipelineStage,
  content: string,
): Promise<string> {
  await ensureArtifactDir(cwd, pipelineId);
  const artifactPath = getArtifactPath(cwd, pipelineId, stage);
  await fs.writeFile(artifactPath, content, 'utf-8');
  return artifactPath;
}
