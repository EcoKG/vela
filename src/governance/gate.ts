/**
 * Vela Governance Gate Engine
 * Pure decision function: takes tool name, input, and project context;
 * returns allow or block with a gate code. No process.exit, no stderr,
 * no side effects — only a return value.
 *
 * Gate ordering matches CJS vela-gate.cjs exactly:
 * VK-03 → VK-01 → VK-02 → VK-04 → VK-05 → VK-06 →
 * VG-EXPLORE → VG-01 → VG-04 → VG-02 → VG-11 → VG-03 →
 * VG-06 → VG-07 → VG-08 → VG-09 → VG-13
 *
 * Skipped gates (not applicable in ESM context):
 * VK-07 (PM source code prohibition — no PM model)
 * VG-00 (TaskCreate blocking — no Task tools)
 * VG-12 (PM delegation — no PM model)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  WRITE_TOOLS,
  SENSITIVE_FILES,
  SECRET_PATTERNS,
  SAFE_BASH_READ,
  BASH_WRITE_PATTERNS,
  CODE_EXTENSIONS,
  SKIP_PATHS,
} from './constants.js';

import type { GovernanceConfig, PipelineState, StepDef } from './pipeline-helpers.js';
import {
  findActivePipeline,
  readGovernanceConfig,
  readPipelineDefinition,
  getCurrentStepDef,
} from './pipeline-helpers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GateContext {
  cwd: string;
  velaDir?: string;
  config?: GovernanceConfig | null;
  pipelineState?: PipelineState | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipelineDef?: any;
  stepDef?: StepDef | null;
  mode: string;
  currentStep?: string;
  artifactDir?: string;
}

export type GateResult =
  | { allowed: true; warnings?: string[] }
  | { allowed: false; code: string; message: string };

// ---------------------------------------------------------------------------
// Context builder — reads .vela/ filesystem state exactly once per helper
// ---------------------------------------------------------------------------

/**
 * Build a GateContext from the project root. Each pipeline-helper is called
 * once (I/O dedup), mirroring the shared top-level reads in vela-gate.cjs.
 */
export function buildGateContext(cwd: string): GateContext {
  const velaDir = path.join(cwd, '.vela');
  const config = readGovernanceConfig(cwd);
  const state = findActivePipeline(velaDir);
  const pipelineDef = readPipelineDefinition(cwd);
  const stepDef = getCurrentStepDef(pipelineDef, state);
  const mode = stepDef?.mode || 'read';
  const currentStep = state?.current_step ?? undefined;
  const artifactDir = state?._artifactDir ?? undefined;

  return {
    cwd,
    velaDir,
    config,
    pipelineState: state,
    pipelineDef,
    stepDef,
    mode,
    currentStep,
    artifactDir,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function block(code: string, message: string): GateResult {
  return { allowed: false, code, message };
}

function allow(warnings?: string[]): GateResult {
  return warnings?.length ? { allowed: true, warnings } : { allowed: true };
}

/**
 * Check if a target step has been reached in the pipeline.
 * Ported from vela-gate.cjs isStepReached.
 */
function isStepReached(
  state: PipelineState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipelineDef: any,
  targetStepId: string,
): boolean {
  if (!pipelineDef || !state) return false;
  const pipelineType = state.pipeline_type || 'standard';
  const pipeline = pipelineDef.pipelines?.[pipelineType];
  if (!pipeline) return false;

  let steps = pipeline.steps as Array<{ id: string; name: string }>;
  if (pipeline.inherits && pipeline.steps_only) {
    const parent = pipelineDef.pipelines[pipeline.inherits];
    if (parent) {
      steps = (parent.steps as Array<{ id: string; name: string }>).filter(
        (s) => (pipeline.steps_only as string[]).includes(s.id),
      );
    }
  }

  const currentIdx = steps.findIndex((s) => s.id === state.current_step);
  const targetIdx = steps.findIndex((s) => s.id === targetStepId);
  return currentIdx >= targetIdx;
}

/**
 * Get the list of step names from current to target (inclusive).
 * Ported from vela-gate.cjs getStepsUntil.
 */
function getStepsUntil(
  state: PipelineState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipelineDef: any,
  targetStepId: string,
): string[] {
  if (!pipelineDef || !state) return [];
  const pipelineType = state.pipeline_type || 'standard';
  const pipeline = pipelineDef.pipelines?.[pipelineType];
  if (!pipeline) return [];

  let steps = pipeline.steps as Array<{ id: string; name: string }>;
  if (pipeline.inherits && pipeline.steps_only) {
    const parent = pipelineDef.pipelines[pipeline.inherits];
    if (parent) {
      steps = (parent.steps as Array<{ id: string; name: string }>).filter(
        (s) => (pipeline.steps_only as string[]).includes(s.id),
      );
    }
  }

  const currentIdx = steps.findIndex((s) => s.id === state.current_step);
  const targetIdx = steps.findIndex((s) => s.id === targetStepId);
  if (currentIdx < 0 || targetIdx < 0) return [];

  return steps.slice(currentIdx, targetIdx + 1).map((s) => s.name);
}

// ---------------------------------------------------------------------------
// Core gate function — 16 applicable gates
// ---------------------------------------------------------------------------

/**
 * Evaluate all applicable governance gates against a tool invocation.
 * Returns allow (with optional warnings) or block (with gate code + message).
 *
 * Pure: no process.exit, no stderr/stdout writes, no mutations.
 * Filesystem reads occur only for artifact-existence checks (VG-01, VG-03, VG-04).
 */
export function checkGate(
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: GateContext,
): GateResult {
  const config = ctx.config;
  const sandboxEnabled = !!(config?.sandbox?.enabled);
  const guardEnabled = !!(config?.gate_guard?.enabled);

  // Neither feature enabled → pass through
  if (!sandboxEnabled && !guardEnabled) return allow();

  const state = ctx.pipelineState ?? null;
  const pipelineDef = ctx.pipelineDef;
  const stepDef = ctx.stepDef ?? null;
  const currentMode = ctx.mode;
  const currentStep = ctx.currentStep ?? null;
  const artifactDir = ctx.artifactDir ?? null;
  const velaDir = ctx.velaDir ?? path.join(ctx.cwd, '.vela');

  const targetFile = (toolInput.file_path as string) || (toolInput.path as string) || '';
  const isWriteTool = WRITE_TOOLS.has(toolName);

  // ══════════════════════════════════════════════════════════
  // UNIFIED: pipeline-state.json protection (VK-03)
  // Merges VK-03, VG-05 GUARD 2, VG-05 GUARD 5
  // ══════════════════════════════════════════════════════════
  if (isWriteTool) {
    if (path.basename(targetFile) === 'pipeline-state.json') {
      return block(
        'VK-03',
        'pipeline-state.json is immutable. Run: node .vela/cli/vela-engine.js transition',
      );
    }
  }

  // ══════════════════════════════════════════════════════════
  // GATE-KEEPER GATES (VK-*) — sandbox mode enforcement
  // ══════════════════════════════════════════════════════════
  if (sandboxEnabled) {
    // ─── VK-01 / VK-02: Bash Blocking ───
    if (toolName === 'Bash') {
      const cmd = ((toolInput.command as string) || '').trim();

      const isVelaCli =
        (cmd.startsWith('node ') && cmd.includes('.vela/cli/')) ||
        (cmd.startsWith('python') && cmd.includes('.vela/cli/'));
      const isSafeRead = SAFE_BASH_READ.test(cmd);
      const isGitWithPipeline = /^\s*(git|gh)\s/.test(cmd) && !!state;

      if (!isVelaCli && !isSafeRead && !isGitWithPipeline) {
        const hasWritePattern = BASH_WRITE_PATTERNS.some((p) => p.test(cmd));
        if (hasWritePattern && currentMode === 'read') {
          return block(
            'VK-01',
            'Bash write blocked in read mode. Run: node .vela/cli/vela-engine.js transition',
          );
        }

        return block(
          'VK-02',
          'Bash restricted in sandbox. Use .vela/cli/ tools or built-in Read/Write/Edit/Glob/Grep.',
        );
      }
      // Allowed bash (Vela CLI, safe read, git/gh with pipeline) falls through to guards
    }

    // ─── VK-04: Mode Enforcement — block writes in read-only mode ───
    if (currentMode === 'read' && isWriteTool) {
      // Allow .vela/ internal writes (pipeline-state.json already handled above)
      if (!targetFile.includes('.vela/')) {
        return block(
          'VK-04',
          'Write blocked in read mode. Run: node .vela/cli/vela-engine.js transition',
        );
      }
    }

    // ─── VK-05: Sensitive File Protection ───
    if (isWriteTool) {
      const fileName = path.basename(targetFile);
      if (SENSITIVE_FILES.includes(fileName)) {
        if (
          !fileName.includes('.example') &&
          !fileName.includes('.template') &&
          !fileName.includes('.sample')
        ) {
          return block(
            'VK-05',
            'Sensitive file protected. Use .env.example or .env.template instead.',
          );
        }
      }
    }

    // ─── VK-06: Secret Detection ───
    if (isWriteTool) {
      const content =
        (toolInput.content as string) || (toolInput.new_string as string) || '';
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(content)) {
          // Must NOT echo matched secret content
          return block(
            'VK-06',
            'Secret/credential detected in write content. Use environment variables instead.',
          );
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // GATE-GUARD GUARDS (VG-*) — pipeline compliance
  // ══════════════════════════════════════════════════════════
  if (guardEnabled) {
    // ─── VG-EXPLORE: No active pipeline ───
    if (!state) {
      if (isWriteTool) {
        if (targetFile.includes('.vela/')) {
          return allow();
        }
        return block(
          'VG-EXPLORE',
          'No active pipeline. Run: node .vela/cli/vela-engine.js init "<task>" --scale <small|medium|large>',
        );
      }
      // Explore mode: reads, glob, grep all allowed
      return allow();
    }

    // ─── Early exit: non-write/non-Bash tools need no further guards ───
    if (!isWriteTool && toolName !== 'Bash') {
      return allow();
    }

    // ─── VG-01: Research before Plan ───
    if (isWriteTool) {
      const fileName = path.basename(targetFile);

      if (fileName === 'plan.md' && artifactDir) {
        const researchPath = path.join(artifactDir, 'research.md');
        if (!fs.existsSync(researchPath)) {
          return block(
            'VG-01',
            'Cannot create plan without research. Complete research step first.',
          );
        }
      }

      // ─── VG-04: Verification before Report ───
      if (fileName === 'report.md' && artifactDir) {
        const verificationPath = path.join(artifactDir, 'verification.md');
        if (!fs.existsSync(verificationPath)) {
          return block(
            'VG-04',
            'Cannot create report without verification. Complete verification step first.',
          );
        }
      }
    }

    // ─── VG-02: No source code edits before execute step ───
    if (isWriteTool) {
      // Skip .vela/ internal files — EXCEPT protected files
      if (targetFile.includes('.vela/')) {
        const protectedFile = path.basename(targetFile);

        // ─── VG-11: approval/review files — team step only ───
        if (
          protectedFile.startsWith('approval-') ||
          protectedFile.startsWith('review-')
        ) {
          const hasTeam = !!(stepDef?.team);
          if (!hasTeam) {
            return block(
              'VG-11',
              `${protectedFile} only allowed during team steps.`,
            );
          }
        }

        // Allow other .vela/ writes
        return allow();
      }

      // Skip non-code files
      const ext = path.extname(targetFile).toLowerCase();
      if (!CODE_EXTENSIONS.has(ext)) {
        return allow();
      }

      // Skip files in excluded paths
      const inSkipPath = SKIP_PATHS.some((sp) => targetFile.includes(sp));
      if (inSkipPath) {
        return allow();
      }

      // Check if we're at or past the execute step
      const executeReached = isStepReached(state, pipelineDef, 'execute');
      if (!executeReached) {
        return block(
          'VG-02',
          `Source code edit before execute step. Complete: ${getStepsUntil(state, pipelineDef, 'execute').join(' → ')}`,
        );
      }
    }

    // ─── VG-03: Build/test pass before git commit ───
    if (toolName === 'Bash') {
      const cmd = ((toolInput.command as string) || '').trim();
      if (/\bgit\s+commit\b/.test(cmd)) {
        const signalsPath = path.join(velaDir, 'tracker-signals.json');
        if (fs.existsSync(signalsPath)) {
          try {
            const signals = JSON.parse(
              fs.readFileSync(signalsPath, 'utf-8'),
            ) as Array<{
              type: string;
              result: string;
              timestamp: number;
            }>;
            const recentFail = signals.some(
              (s) =>
                (s.type === 'build' || s.type === 'test') &&
                s.result === 'fail' &&
                Date.now() - s.timestamp < 5 * 60 * 1000,
            );
            if (recentFail) {
              return block(
                'VG-03',
                'Cannot commit with failed build/tests. Fix and re-run first.',
              );
            }
          } catch {
            /* signal file corrupt, allow commit */
          }
        }
      }
    }

    // ─── VG-06: Revision limit enforcement ───
    if (isWriteTool && state.revisions) {
      if (stepDef?.max_revisions) {
        const currentRevisions =
          (state.revisions[currentStep ?? ''] as number) || 0;
        if (currentRevisions >= stepDef.max_revisions) {
          return block(
            'VG-06',
            `Revision limit reached for step "${currentStep}". Transition to next step or request approval.`,
          );
        }
      }
    }

    // ─── VG-07: Git commit only during execute/commit/finalize ───
    if (toolName === 'Bash') {
      const cmd = ((toolInput.command as string) || '').trim();
      if (/\bgit\s+commit\b/.test(cmd) && state) {
        const allowedSteps = ['execute', 'commit', 'finalize'];
        if (!allowedSteps.includes(currentStep ?? '')) {
          return block(
            'VG-07',
            'Git commit only allowed during execute/commit/finalize. Run: node .vela/cli/vela-engine.js commit',
          );
        }
      }
    }

    // ─── VG-08: Git push only after verify ───
    if (toolName === 'Bash') {
      const cmd = ((toolInput.command as string) || '').trim();
      if (
        /\bgit\s+push\b/.test(cmd) &&
        !/\bgit\s+stash\s+push\b/.test(cmd) &&
        state
      ) {
        const verifyReached = isStepReached(state, pipelineDef, 'verify');
        if (!verifyReached) {
          return block(
            'VG-08',
            'Git push only allowed after verification step. Complete verification first.',
          );
        }
      }
    }

    // ─── VG-09: Protected branch commit warning (non-blocking) ───
    if (toolName === 'Bash') {
      const cmd = ((toolInput.command as string) || '').trim();
      if (/\bgit\s+commit\b/.test(cmd) && state?.git) {
        const protectedBranches = ['main', 'master', 'develop'];
        const currentBranch = (state.git.current_branch ||
          state.git.base_branch) as string;
        if (protectedBranches.includes(currentBranch)) {
          return allow([
            `[VG-09] WARNING: Committing to protected branch "${currentBranch}". Consider: git checkout -b vela/<feature> from main`,
          ]);
        }
      }
    }
    // ─── VG-13: TDD sub-phase enforcement ───
    if (isWriteTool && currentStep === 'execute' && stepDef?.sub_phases?.length) {
      // Read TDD phase state
      let tddPhase: string | null = null;
      try {
        const phasePath = path.join(velaDir, 'state', 'tdd-phase.json');
        const raw = fs.readFileSync(phasePath, 'utf-8');
        const parsed = JSON.parse(raw) as { phase?: string };
        tddPhase = parsed.phase ?? null;
      } catch {
        // fail-open: missing or corrupt file → allow
      }

      if (tddPhase === 'test-write') {
        const ext = path.extname(targetFile).toLowerCase();
        if (CODE_EXTENSIONS.has(ext)) {
          // Check if it's a test file
          const isTestFile =
            /\.(test|spec)\./i.test(path.basename(targetFile)) ||
            targetFile.includes('__tests__/') ||
            /\/tests\//.test(targetFile) ||
            targetFile.startsWith('tests/');
          if (!isTestFile) {
            return block(
              'VG-13',
              'Non-test code write blocked during test-write TDD phase. Write tests first.',
            );
          }
        }
      }
    }
  }

  // All gates and guards passed
  return allow();
}
