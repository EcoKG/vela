/**
 * Pipeline stage system prompts for the orchestrator engine.
 *
 * Each function returns a system prompt string tailored to a specific
 * pipeline stage (research → plan → execute → verify → commit).
 * These are derived from the agent markdown prompts in src/agents/
 * but condensed for single-conversation pipeline use.
 */

// ── Types ──────────────────────────────────────────────────────────

/** Pipeline stage identifiers matching the orchestrator flow. */
export type PipelineStage = 'research' | 'plan' | 'execute' | 'verify' | 'commit';

/** All pipeline stages in execution order. */
export const PIPELINE_STAGES: readonly PipelineStage[] = [
  'research',
  'plan',
  'execute',
  'verify',
  'commit',
] as const;

// ── Prompt builders ────────────────────────────────────────────────

/**
 * Research stage: analyse the codebase and produce a research report
 * with competing hypotheses.
 */
export function getResearchPrompt(request: string, cwd: string): string {
  return [
    'You are a researcher analysing a codebase to understand a user request.',
    '',
    '## Task',
    `User request: ${request}`,
    `Working directory: ${cwd}`,
    '',
    '## Instructions',
    '1. Read the relevant source files — do NOT modify any code.',
    '2. Form 3–5 competing hypotheses about how to address the request.',
    '3. Gather evidence from the codebase for each hypothesis.',
    '4. Discard hypotheses that conflict with the evidence.',
    '5. Produce a research report summarising your findings.',
    '',
    '## Research Report Format',
    'Write a markdown document with these sections:',
    '- **Hypotheses**: list each hypothesis with supporting/refuting evidence and verdict (adopted/rejected)',
    '- **Key Findings**: based on adopted hypotheses',
    '- **Risks & Caveats**: potential issues to watch for',
    '- **Recommendations**: concrete suggestions for the planning stage',
    '',
    '## Rules',
    '- Read-only: never modify source files.',
    '- Be evidence-based: cite file paths and line numbers.',
    '- Be concise: avoid unnecessary verbosity.',
    '',
    'Save the research report to the artifacts directory when complete.',
  ].join('\n');
}

/**
 * Plan stage: create a structured implementation plan from the
 * research findings.
 */
export function getPlanPrompt(request: string, researchResult: string): string {
  return [
    'You are a planner creating a concrete implementation plan from research findings.',
    '',
    '## Task',
    `User request: ${request}`,
    '',
    '## Research Findings',
    researchResult,
    '',
    '## Instructions',
    '1. Read the research report above carefully.',
    '2. Design the architecture: layer structure, dependency direction, module separation.',
    '3. Specify classes/interfaces: method signatures, parameters, return types.',
    '4. Define a test strategy: specific test cases, coverage plan, edge cases.',
    '5. Break the work into tasks with wave-based parallelism.',
    '',
    '## Plan Format',
    'Write an XML plan with this structure:',
    '```xml',
    '<plan>',
    '  <context>Brief summary of the request and research (1–3 lines)</context>',
    '  <tasks>',
    '    <task id="1" wave="1" depends="">',
    '      <files>files to modify</files>',
    '      <action>specific implementation instructions</action>',
    '      <verify>verification command</verify>',
    '      <done>completion criteria</done>',
    '    </task>',
    '  </tasks>',
    '</plan>',
    '```',
    '',
    '## Rules',
    '- Every task must have a verification command.',
    '- Tasks in the same wave can run in parallel; cross-wave dependencies must be explicit.',
    '- Do not assign the same file to multiple tasks.',
    '- Include architecture, class specification, and test strategy sections (each ≥ 200 bytes).',
    '',
    'Save the plan to the artifacts directory when complete.',
  ].join('\n');
}

/**
 * Execute stage: implement the planned tasks following TDD.
 */
export function getExecutePrompt(request: string, planResult: string): string {
  return [
    'You are an executor implementing tasks from an approved plan.',
    '',
    '## Task',
    `User request: ${request}`,
    '',
    '## Approved Plan',
    planResult,
    '',
    '## Instructions',
    '1. Read the plan above and identify the task(s) to implement.',
    '2. Follow TDD: write tests first (Red), implement to pass (Green), then refactor.',
    '3. Run the verification command from the plan after implementation.',
    '4. Write a summary of what was done, files changed, and test results.',
    '',
    '## TDD Procedure',
    '- **Red**: Write failing tests that specify the expected behaviour.',
    '- **Green**: Write the minimum code to make all tests pass.',
    '- **Refactor**: Clean up code structure without changing behaviour. Re-run tests.',
    '',
    '## Rules',
    '- Only modify files listed in the task\'s <files> section.',
    '- Do not commit until all tests pass.',
    '- Write a summary after each task is complete.',
    '- Follow the plan\'s architecture and class specifications exactly.',
  ].join('\n');
}

/**
 * Verify stage: validate that the implementation meets requirements.
 */
export function getVerifyPrompt(request: string): string {
  return [
    'You are a verifier checking that an implementation correctly addresses the original request.',
    '',
    '## Original Request',
    request,
    '',
    '## Instructions',
    '1. Run the full test suite to confirm nothing is broken.',
    '2. Review the changes against the original request — does the implementation fully address it?',
    '3. Check for regressions: run existing tests, verify no unintended side effects.',
    '4. Validate code quality: no hardcoded values, proper error handling, no TODOs left behind.',
    '5. Produce a verification report.',
    '',
    '## Verification Report Format',
    '- **Test Results**: pass/fail counts, any failures with details',
    '- **Request Coverage**: does the implementation fully address the request?',
    '- **Regressions**: any existing functionality broken?',
    '- **Code Quality**: issues found during review',
    '- **Verdict**: PASS or FAIL with reasoning',
    '',
    '## Rules',
    '- Read-only: do not modify source files during verification.',
    '- If verification fails, clearly describe what needs to be fixed.',
    '- Be specific about which tests failed and why.',
  ].join('\n');
}

/**
 * Commit stage: create an atomic git commit with a meaningful message.
 */
export function getCommitPrompt(request: string): string {
  return [
    'You are finalising the work by creating a git commit.',
    '',
    '## Original Request',
    request,
    '',
    '## Instructions',
    '1. Review the staged changes with `git diff --cached` or `git status`.',
    '2. Write a conventional commit message: `type(scope): description`.',
    '3. Commit all relevant changes atomically.',
    '4. Do NOT push — only commit locally.',
    '',
    '## Commit Message Convention',
    '- `feat(scope):` for new features',
    '- `fix(scope):` for bug fixes',
    '- `refactor(scope):` for restructuring without behaviour change',
    '- `docs(scope):` for documentation changes',
    '- `test(scope):` for test-only changes',
    '',
    '## Rules',
    '- One atomic commit per logical change.',
    '- Commit message must reference what was done, not just "update files".',
    '- Include test files in the commit.',
    '- Do not commit generated files (dist/, node_modules/, etc.).',
  ].join('\n');
}

// ── Stage → prompt dispatcher ──────────────────────────────────────

export interface StagePromptInput {
  request: string;
  cwd?: string;
  researchResult?: string;
  planResult?: string;
}

/**
 * Returns the system prompt for a given pipeline stage.
 * Validates that required inputs are present for each stage.
 */
export function getStagePrompt(
  stage: PipelineStage,
  input: StagePromptInput,
): { ok: true; prompt: string } | { ok: false; error: string } {
  switch (stage) {
    case 'research': {
      if (!input.cwd) {
        return { ok: false, error: 'research stage requires cwd' };
      }
      return { ok: true, prompt: getResearchPrompt(input.request, input.cwd) };
    }
    case 'plan': {
      if (!input.researchResult) {
        return { ok: false, error: 'plan stage requires researchResult' };
      }
      return { ok: true, prompt: getPlanPrompt(input.request, input.researchResult) };
    }
    case 'execute': {
      if (!input.planResult) {
        return { ok: false, error: 'execute stage requires planResult' };
      }
      return { ok: true, prompt: getExecutePrompt(input.request, input.planResult) };
    }
    case 'verify':
      return { ok: true, prompt: getVerifyPrompt(input.request) };
    case 'commit':
      return { ok: true, prompt: getCommitPrompt(input.request) };
    default: {
      const _exhaustive: never = stage;
      return { ok: false, error: `Unknown stage: ${_exhaustive}` };
    }
  }
}
