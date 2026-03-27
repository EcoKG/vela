import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Types ──────────────────────────────────────────────────────────

export type DiscussStage =
  | 'vision'
  | 'reflection'
  | 'qa'
  | 'depth-check'
  | 'requirements'
  | 'roadmap';

export interface DiscussSession {
  id: string;
  stage: DiscussStage;
  stages_completed: DiscussStage[];
  data: Partial<Record<DiscussStage, string>>;
  created_at: string;
  updated_at: string;
}

export interface StagePrompt {
  stage: DiscussStage;
  title: string;
  system_prompt: string;
  user_instructions: string;
  expected_output: string;
}

export type DiscussResult<T = DiscussSession> =
  | { ok: true } & T
  | { ok: false; error: string };

export type SessionResult = DiscussResult<{ session: DiscussSession }>;
export type PromptResult = DiscussResult<{ prompt: StagePrompt }>;
export type RenderResult = DiscussResult<{ content: string; path?: string }>;

// ── Stage ordering ─────────────────────────────────────────────────

export const STAGE_ORDER: DiscussStage[] = [
  'vision',
  'reflection',
  'qa',
  'depth-check',
  'requirements',
  'roadmap',
];

/**
 * Returns the stage after the given one, or null if already at 'roadmap'.
 */
export function getNextStage(current: DiscussStage): DiscussStage | null {
  const idx = STAGE_ORDER.indexOf(current);
  if (idx === -1 || idx === STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[idx + 1];
}

/**
 * Returns true when `to` is the immediate successor of `from`.
 */
export function isValidTransition(from: DiscussStage, to: DiscussStage): boolean {
  const fromIdx = STAGE_ORDER.indexOf(from);
  const toIdx = STAGE_ORDER.indexOf(to);
  return fromIdx !== -1 && toIdx === fromIdx + 1;
}

// ── Prompt templates ───────────────────────────────────────────────

export const STAGE_PROMPTS: Record<DiscussStage, StagePrompt> = {
  vision: {
    stage: 'vision',
    title: 'Project Vision',
    system_prompt:
      'You are a project management agent guiding a user through defining their project vision. ' +
      'Ask open-ended questions to understand the core purpose, target audience, and desired outcomes. ' +
      'Encourage the user to think broadly before narrowing scope.',
    user_instructions:
      'Describe your project idea. What problem does it solve? Who is it for? What does success look like?',
    expected_output:
      'A concise vision statement covering purpose, audience, and success criteria.',
  },
  reflection: {
    stage: 'reflection',
    title: 'Reflection & Constraints',
    system_prompt:
      'You are helping the user reflect on constraints, risks, and assumptions. ' +
      'Probe for timeline expectations, technical constraints, team size, budget, and known risks. ' +
      'Surface implicit assumptions that could derail the project.',
    user_instructions:
      'What constraints does this project face? Think about time, technology, team, budget, and risks.',
    expected_output:
      'A list of constraints, assumptions, and identified risks.',
  },
  qa: {
    stage: 'qa',
    title: 'Q&A Deep Dive',
    system_prompt:
      'You are conducting a structured Q&A session to fill gaps in the project understanding. ' +
      'Based on the vision and constraints, ask targeted questions about unclear areas. ' +
      'Focus on functional requirements, user workflows, and integration points.',
    user_instructions:
      'Answer the following clarifying questions about your project. Be as specific as possible.',
    expected_output:
      'Detailed answers covering functional requirements, workflows, and integrations.',
  },
  'depth-check': {
    stage: 'depth-check',
    title: 'Depth Check',
    system_prompt:
      'You are verifying that enough detail exists to proceed to requirements. ' +
      'Review all gathered information and identify any remaining ambiguities. ' +
      'Ask follow-up questions only for critical gaps.',
    user_instructions:
      'Review the summary of what we have discussed so far. Are there any corrections or additions?',
    expected_output:
      'Confirmation or corrections on the project understanding so far.',
  },
  requirements: {
    stage: 'requirements',
    title: 'Requirements Synthesis',
    system_prompt:
      'You are synthesizing all gathered information into structured requirements. ' +
      'Organize into functional requirements, non-functional requirements, and acceptance criteria. ' +
      'Each requirement should be testable and prioritized.',
    user_instructions:
      'Review the draft requirements below. Approve, modify, or add missing requirements.',
    expected_output:
      'A validated list of prioritized requirements with acceptance criteria.',
  },
  roadmap: {
    stage: 'roadmap',
    title: 'Roadmap Skeleton',
    system_prompt:
      'You are creating a high-level roadmap skeleton from the validated requirements. ' +
      'Group requirements into milestones with rough sequencing. ' +
      'Identify dependencies and suggest a phased delivery approach.',
    user_instructions:
      'Review the proposed roadmap. Adjust priorities, grouping, or sequencing as needed.',
    expected_output:
      'A milestone-based roadmap with sequenced deliverables and dependencies.',
  },
};

// ── ID generation ──────────────────────────────────────────────────

function shortUid(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

// ── Session file helpers ───────────────────────────────────────────

function stateDir(velaDir: string): string {
  return path.join(velaDir, 'state');
}

function sessionFilePath(velaDir: string, sessionId: string): string {
  return path.join(stateDir(velaDir), `discuss-${sessionId}.json`);
}

function ensureStateDir(velaDir: string): void {
  fs.mkdirSync(stateDir(velaDir), { recursive: true });
}

export function writeSession(velaDir: string, session: DiscussSession): void {
  ensureStateDir(velaDir);
  const filePath = sessionFilePath(velaDir, session.id);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
}

export function readSession(velaDir: string, sessionId: string): SessionResult {
  const filePath = sessionFilePath(velaDir, sessionId);
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: `Session file not found: ${filePath}` };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const session: DiscussSession = JSON.parse(raw);
    return { ok: true, session };
  } catch (err) {
    return { ok: false, error: `Failed to read session: ${(err as Error).message}` };
  }
}

export function findLatestSession(velaDir: string): SessionResult {
  const dir = stateDir(velaDir);
  if (!fs.existsSync(dir)) {
    return { ok: false, error: 'No state directory found' };
  }

  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith('discuss-') && f.endsWith('.json'));

  if (files.length === 0) {
    return { ok: false, error: 'No discuss sessions found' };
  }

  // Read all sessions and sort by updated_at descending, using file mtime
  // as a tiebreaker when timestamps match (e.g. sub-millisecond operations).
  let latest: DiscussSession | null = null;
  let latestMtime = 0;

  for (const file of files) {
    try {
      const filePath = path.join(dir, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const session: DiscussSession = JSON.parse(raw);
      const mtime = fs.statSync(filePath).mtimeMs;
      if (
        !latest ||
        session.updated_at > latest.updated_at ||
        (session.updated_at === latest.updated_at && mtime > latestMtime)
      ) {
        latest = session;
        latestMtime = mtime;
      }
    } catch {
      // skip corrupt files
    }
  }

  if (!latest) {
    return { ok: false, error: 'No valid discuss sessions found' };
  }

  return { ok: true, session: latest };
}

// ── Core functions ─────────────────────────────────────────────────

/**
 * Creates a new discuss session starting at the 'vision' stage.
 */
export function createSession(velaDir: string): SessionResult {
  const id = shortUid();
  const now = formatTimestamp();

  const session: DiscussSession = {
    id,
    stage: 'vision',
    stages_completed: [],
    data: {},
    created_at: now,
    updated_at: now,
  };

  try {
    writeSession(velaDir, session);
    return { ok: true, session };
  } catch (err) {
    return { ok: false, error: `Failed to create session: ${(err as Error).message}` };
  }
}

/**
 * Advances the session's current stage. Stores the provided data for the
 * current stage, then moves to the next stage. Rejects if already at
 * 'roadmap' (final stage).
 */
export function advanceStage(
  velaDir: string,
  sessionId: string,
  data: string,
): SessionResult {
  const result = readSession(velaDir, sessionId);
  if (!result.ok) return result;

  const session = result.session;
  const currentStage = session.stage;
  const nextStage = getNextStage(currentStage);

  if (nextStage === null) {
    return { ok: false, error: `Cannot advance past final stage "${currentStage}"` };
  }

  // Store data for the current stage
  session.data[currentStage] = data;
  session.stages_completed.push(currentStage);
  session.stage = nextStage;
  session.updated_at = formatTimestamp();

  try {
    writeSession(velaDir, session);
    return { ok: true, session };
  } catch (err) {
    return { ok: false, error: `Failed to advance stage: ${(err as Error).message}` };
  }
}

/**
 * Returns the StagePrompt for a given stage.
 */
export function getStagePrompt(stage: string): PromptResult {
  if (!STAGE_ORDER.includes(stage as DiscussStage)) {
    return { ok: false, error: `Invalid stage: "${stage}"` };
  }
  return { ok: true, prompt: STAGE_PROMPTS[stage as DiscussStage] };
}

/**
 * Returns the current status of a session. If sessionId is omitted,
 * returns the most recent session.
 */
export function getSessionStatus(velaDir: string, sessionId?: string): SessionResult {
  if (sessionId) {
    return readSession(velaDir, sessionId);
  }
  return findLatestSession(velaDir);
}

/**
 * Renders a structured markdown context document from a completed session.
 * All 6 stages must have data. If outputPath is provided, writes the
 * document to that path; otherwise just returns the content.
 */
export function renderContext(
  velaDir: string,
  sessionId: string,
  outputPath?: string,
): RenderResult {
  const result = readSession(velaDir, sessionId);
  if (!result.ok) return result;

  const session = result.session;

  // Verify all stages have data
  const missingStages = STAGE_ORDER.filter((s) => !session.data[s]);
  if (missingStages.length > 0) {
    return {
      ok: false,
      error: `Incomplete session — missing data for stages: ${missingStages.join(', ')}`,
    };
  }

  // Render markdown
  const lines: string[] = [];
  lines.push(`# Project Context — Session ${session.id}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  for (const stage of STAGE_ORDER) {
    const prompt = STAGE_PROMPTS[stage];
    lines.push(`## ${prompt.title}`);
    lines.push('');
    lines.push(session.data[stage]!);
    lines.push('');
  }

  const content = lines.join('\n');

  if (outputPath) {
    try {
      const dir = path.dirname(outputPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outputPath, content, 'utf-8');
      return { ok: true, content, path: outputPath };
    } catch (err) {
      return { ok: false, error: `Failed to write context: ${(err as Error).message}` };
    }
  }

  return { ok: true, content };
}
