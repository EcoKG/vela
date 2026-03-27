import { Command } from 'commander';
import { join } from 'node:path';
import { getVersion } from './version.js';
import { initProject } from './init.js';
import { findProjectRoot } from './config.js';
import {
  startAutoMode,
  nextTask,
  getAutoStatus,
  pauseAutoMode,
  resumeAutoMode,
  cancelAutoMode,
} from './auto-mode.js';
import {
  openStateDb,
  createMilestone,
  listMilestones,
  createSlice,
  listSlices,
  createTask,
  listTasks,
} from './state.js';
import { closeDb } from './db.js';
import {
  initPipeline,
  getPipelineState,
  transitionPipeline,
  cancelPipeline,
} from './pipeline.js';
import type { Scale } from './pipeline.js';
import { completeTask, completeSlice, completeMilestone } from './hierarchy.js';
import { ensureBoundarySchema, setBoundary, getBoundary } from './boundary.js';
import { saveContinuePoint, loadContinuePoint, clearContinuePoint } from './continue.js';
import { createBranch, commitChanges, squashMerge } from './git.js';
import { listAgentRoles, getAgentPrompt, getAgentStrategy } from './agents.js';
import { createSession, advanceStage, getStagePrompt, getSessionStatus, renderContext } from './discuss.js';
import { getCostReport } from './cost.js';
import {
  ensureRequirementsSchema,
  createRequirement,
  getRequirement,
  updateRequirement,
  listRequirements,
  deleteRequirement,
  renderRequirementsToFile,
  VALID_STATUSES,
  VALID_CLASSES,
} from './requirements.js';
import type { RequirementStatus, RequirementClass } from './requirements.js';

const program = new Command();

program
  .name('vela')
  .description('Vela CLI — Development governance for AI coding agents')
  .version(getVersion());

/**
 * Opens the state DB for the current project, runs `fn`, then closes DB.
 * Prints JSON error and exits 1 if no .vela/ project is found.
 */
function withProjectDb<T>(fn: (db: import('better-sqlite3').Database) => T): T {
  const projectRoot = findProjectRoot(process.cwd());
  if (!projectRoot) {
    console.log(JSON.stringify({ ok: false, error: 'No Vela project found. Run "vela init" first.' }));
    process.exit(1);
  }
  const db = openStateDb(join(projectRoot, '.vela'));
  try {
    return fn(db);
  } finally {
    closeDb(db);
  }
}

program
  .command('init')
  .description('Initialize Vela in the current project')
  .action(() => {
    const result = initProject(process.cwd());
    console.log(JSON.stringify(result));
    process.exit(0);
  });

program
  .command('start')
  .description('Start a new pipeline')
  .argument('<request>', 'Task description for the pipeline')
  .option('--scale <size>', 'Pipeline scale (small, medium, large)', 'medium')
  .option('--type <name>', 'Pipeline type (builtin: standard/quick/trivial, or custom from .vela/pipelines/)')
  .action((request: string, opts: { scale: string; type?: string }) => {
    const projectRoot = findProjectRoot(process.cwd());
    const velaDir = projectRoot ? join(projectRoot, '.vela') : undefined;
    const result = withProjectDb((db) => initPipeline(db, request, opts.scale as Scale, {
      type: opts.type,
      velaDir,
    }));
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });

program
  .command('state')
  .description('Show current pipeline state')
  .action(() => {
    const pipeline = withProjectDb((db) => getPipelineState(db));
    if (pipeline) {
      console.log(JSON.stringify({ ok: true, pipeline }));
    } else {
      console.log(JSON.stringify({ ok: false, error: 'No active pipeline' }));
    }
    process.exit(0);
  });

program
  .command('transition')
  .description('Transition to next pipeline step')
  .action(() => {
    const result = withProjectDb((db) => transitionPipeline(db));
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });

program
  .command('cancel')
  .description('Cancel the active pipeline')
  .action(() => {
    const result = withProjectDb((db) => cancelPipeline(db));
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });

// ── Milestone commands ──────────────────────────────────────────────

const milestoneCmd = program
  .command('milestone')
  .description('Manage milestones');

milestoneCmd
  .command('create')
  .description('Create a new milestone')
  .argument('<title>', 'Milestone title')
  .option('--id <id>', 'Milestone ID (auto-generated if omitted)')
  .option('--description <desc>', 'Milestone description')
  .action((title: string, opts: { id?: string; description?: string }) => {
    const result = withProjectDb((db) => {
      const id = opts.id ?? `M${String(Date.now()).slice(-6)}`;
      return createMilestone(db, { id, title, description: opts.description });
    });
    console.log(JSON.stringify({ ok: true, milestone: result }));
    process.exit(0);
  });

milestoneCmd
  .command('list')
  .description('List all milestones')
  .action(() => {
    const milestones = withProjectDb((db) => listMilestones(db));
    console.log(JSON.stringify({ ok: true, milestones }));
    process.exit(0);
  });

milestoneCmd
  .command('complete')
  .description('Complete a milestone')
  .argument('<id>', 'Milestone ID')
  .action((id: string) => {
    const result = withProjectDb((db) => completeMilestone(db, id));
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });

// ── Slice commands ─────────────────────────────────────────────────

const sliceCmd = program
  .command('slice')
  .description('Manage slices');

sliceCmd
  .command('create')
  .description('Create a new slice')
  .argument('<title>', 'Slice title')
  .requiredOption('--milestone <id>', 'Parent milestone ID')
  .option('--id <id>', 'Slice ID (auto-generated if omitted)')
  .option('--description <desc>', 'Slice description')
  .action((title: string, opts: { milestone: string; id?: string; description?: string }) => {
    const result = withProjectDb((db) => {
      const id = opts.id ?? `S${String(Date.now()).slice(-4)}`;
      return createSlice(db, { id, milestone_id: opts.milestone, title, description: opts.description });
    });
    console.log(JSON.stringify({ ok: true, slice: result }));
    process.exit(0);
  });

sliceCmd
  .command('list')
  .description('List slices for a milestone')
  .requiredOption('--milestone <id>', 'Milestone ID')
  .action((opts: { milestone: string }) => {
    const slices = withProjectDb((db) => listSlices(db, { milestone_id: opts.milestone }));
    console.log(JSON.stringify({ ok: true, slices }));
    process.exit(0);
  });

sliceCmd
  .command('complete')
  .description('Complete a slice')
  .argument('<id>', 'Slice ID')
  .action((id: string) => {
    const result = withProjectDb((db) => completeSlice(db, id));
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });

sliceCmd
  .command('boundary')
  .description('Set boundary map for a slice')
  .argument('<id>', 'Slice ID')
  .option('--produces <items>', 'Comma-separated list of produced artifacts', '')
  .option('--consumes <items>', 'Comma-separated list of consumed artifacts', '')
  .action((id: string, opts: { produces: string; consumes: string }) => {
    withProjectDb((db) => {
      ensureBoundarySchema(db);
      const produces = opts.produces ? opts.produces.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const consumes = opts.consumes ? opts.consumes.split(',').map((s) => s.trim()).filter(Boolean) : [];
      setBoundary(db, id, { produces, consumes });
    });
    const boundary = withProjectDb((db) => {
      ensureBoundarySchema(db);
      return getBoundary(db, id);
    });
    console.log(JSON.stringify({ ok: true, boundary: boundary ?? { produces: [], consumes: [] } }));
    process.exit(0);
  });

// ── Task commands ──────────────────────────────────────────────────

const taskCmd = program
  .command('task')
  .description('Manage tasks');

taskCmd
  .command('create')
  .description('Create a new task')
  .argument('<title>', 'Task title')
  .requiredOption('--slice <id>', 'Parent slice ID')
  .requiredOption('--milestone <id>', 'Parent milestone ID')
  .option('--id <id>', 'Task ID (auto-generated if omitted)')
  .option('--description <desc>', 'Task description')
  .action((title: string, opts: { slice: string; milestone: string; id?: string; description?: string }) => {
    const result = withProjectDb((db) => {
      const id = opts.id ?? `T${String(Date.now()).slice(-4)}`;
      return createTask(db, {
        id,
        slice_id: opts.slice,
        milestone_id: opts.milestone,
        title,
        description: opts.description,
      });
    });
    console.log(JSON.stringify({ ok: true, task: result }));
    process.exit(0);
  });

taskCmd
  .command('list')
  .description('List tasks for a slice')
  .requiredOption('--slice <id>', 'Slice ID')
  .action((opts: { slice: string }) => {
    const tasks = withProjectDb((db) => listTasks(db, { slice_id: opts.slice }));
    console.log(JSON.stringify({ ok: true, tasks }));
    process.exit(0);
  });

taskCmd
  .command('complete')
  .description('Complete a task (cascades to slice/milestone if all done)')
  .argument('<id>', 'Task ID')
  .action((id: string) => {
    const result = withProjectDb((db) => completeTask(db, id));
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });

// ── Continue commands ──────────────────────────────────────────────

/**
 * Returns the .vela/ directory for the current project, or exits with error JSON.
 */
function getVelaDir(): string {
  const projectRoot = findProjectRoot(process.cwd());
  if (!projectRoot) {
    console.log(JSON.stringify({ ok: false, error: 'No Vela project found. Run "vela init" first.' }));
    process.exit(1);
  }
  return join(projectRoot, '.vela');
}

const continueCmd = program
  .command('continue')
  .description('Manage continue-here resume points');

continueCmd
  .command('save')
  .description('Save a continue point')
  .requiredOption('--milestone <id>', 'Milestone ID')
  .requiredOption('--slice <id>', 'Slice ID')
  .option('--task <id>', 'Task ID')
  .option('--step <step>', 'Current step')
  .option('--notes <notes>', 'Notes')
  .action((opts: { milestone: string; slice: string; task?: string; step?: string; notes?: string }) => {
    const velaDir = getVelaDir();
    const result = saveContinuePoint(velaDir, {
      milestone_id: opts.milestone,
      slice_id: opts.slice,
      task_id: opts.task,
      step: opts.step,
      notes: opts.notes,
    });
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });

continueCmd
  .command('load')
  .description('Load the current continue point')
  .action(() => {
    const velaDir = getVelaDir();
    const result = loadContinuePoint(velaDir);
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });

continueCmd
  .command('clear')
  .description('Clear the continue point')
  .action(() => {
    const velaDir = getVelaDir();
    const result = clearContinuePoint(velaDir);
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });

// ── Cost command ────────────────────────────────────────────────────

program
  .command('cost')
  .description('Show cost report for the active or most recent pipeline')
  .action(() => {
    const velaDir = getVelaDir();
    const result = getCostReport(velaDir);
    if (result.ok) {
      console.log(JSON.stringify({ ok: true, ...result.report }, null, 2));
      process.exit(0);
    } else {
      console.log(JSON.stringify({ ok: false, error: result.error }));
      process.exit(1);
    }
  });

// ── Requirement commands ────────────────────────────────────────────

const reqCmd = program
  .command('req')
  .description('Manage requirements');

reqCmd
  .command('create')
  .description('Create a new requirement')
  .argument('<id>', 'Requirement ID (e.g. R001)')
  .requiredOption('--title <title>', 'Requirement title')
  .requiredOption('--class <class>', 'Requirement class (e.g. core-capability, differentiator)')
  .option('--status <status>', 'Initial status (default: active)', 'active')
  .option('--description <desc>', 'Description')
  .option('--why <reason>', 'Why it matters')
  .option('--source <source>', 'Source (user, inferred)')
  .option('--owner <owner>', 'Primary owning slice (e.g. M001/S01)')
  .option('--supporting <slices>', 'Supporting slices')
  .option('--validation <proof>', 'Validation proof')
  .option('--notes <notes>', 'Additional notes')
  .action((id: string, opts: {
    title: string;
    class: string;
    status: string;
    description?: string;
    why?: string;
    source?: string;
    owner?: string;
    supporting?: string;
    validation?: string;
    notes?: string;
  }) => {
    try {
      const result = withProjectDb((db) => {
        ensureRequirementsSchema(db);
        return createRequirement(db, {
          id,
          title: opts.title,
          req_class: opts.class as RequirementClass,
          status: opts.status as RequirementStatus,
          description: opts.description,
          why_it_matters: opts.why,
          source: opts.source,
          primary_owner: opts.owner,
          supporting_slices: opts.supporting,
          validation: opts.validation,
          notes: opts.notes,
        });
      });
      console.log(JSON.stringify({ ok: true, requirement: result }));
      process.exit(0);
    } catch (err) {
      console.log(JSON.stringify({ ok: false, error: (err as Error).message }));
      process.exit(1);
    }
  });

reqCmd
  .command('list')
  .description('List requirements')
  .option('--status <status>', 'Filter by status (active, validated, deferred, out-of-scope)')
  .option('--class <class>', 'Filter by class')
  .action((opts: { status?: string; class?: string }) => {
    const result = withProjectDb((db) => {
      ensureRequirementsSchema(db);
      return listRequirements(db, {
        status: opts.status as RequirementStatus | undefined,
        req_class: opts.class as RequirementClass | undefined,
      });
    });
    console.log(JSON.stringify({ ok: true, requirements: result }));
    process.exit(0);
  });

reqCmd
  .command('update')
  .description('Update a requirement')
  .argument('<id>', 'Requirement ID')
  .option('--title <title>', 'New title')
  .option('--class <class>', 'New class')
  .option('--status <status>', 'New status')
  .option('--description <desc>', 'New description')
  .option('--why <reason>', 'New why_it_matters')
  .option('--source <source>', 'New source')
  .option('--owner <owner>', 'New primary owning slice')
  .option('--supporting <slices>', 'New supporting slices')
  .option('--validation <proof>', 'New validation proof')
  .option('--notes <notes>', 'New notes')
  .action((id: string, opts: {
    title?: string;
    class?: string;
    status?: string;
    description?: string;
    why?: string;
    source?: string;
    owner?: string;
    supporting?: string;
    validation?: string;
    notes?: string;
  }) => {
    try {
      const result = withProjectDb((db) => {
        ensureRequirementsSchema(db);
        return updateRequirement(db, id, {
          title: opts.title,
          req_class: opts.class as RequirementClass | undefined,
          status: opts.status as RequirementStatus | undefined,
          description: opts.description,
          why_it_matters: opts.why,
          source: opts.source,
          primary_owner: opts.owner,
          supporting_slices: opts.supporting,
          validation: opts.validation,
          notes: opts.notes,
        });
      });
      if (result) {
        console.log(JSON.stringify({ ok: true, requirement: result }));
        process.exit(0);
      } else {
        console.log(JSON.stringify({ ok: false, error: `Requirement "${id}" not found` }));
        process.exit(1);
      }
    } catch (err) {
      console.log(JSON.stringify({ ok: false, error: (err as Error).message }));
      process.exit(1);
    }
  });

reqCmd
  .command('delete')
  .description('Delete a requirement')
  .argument('<id>', 'Requirement ID')
  .action((id: string) => {
    const deleted = withProjectDb((db) => {
      ensureRequirementsSchema(db);
      return deleteRequirement(db, id);
    });
    if (deleted) {
      console.log(JSON.stringify({ ok: true, deleted: id }));
      process.exit(0);
    } else {
      console.log(JSON.stringify({ ok: false, error: `Requirement "${id}" not found` }));
      process.exit(1);
    }
  });

reqCmd
  .command('render')
  .description('Render REQUIREMENTS.md from database')
  .option('--output <dir>', 'Output directory (defaults to .vela/)')
  .action((opts: { output?: string }) => {
    const projectRoot = findProjectRoot(process.cwd());
    if (!projectRoot) {
      console.log(JSON.stringify({ ok: false, error: 'No Vela project found. Run "vela init" first.' }));
      process.exit(1);
    }
    const velaDir = join(projectRoot, '.vela');
    const outputDir = opts.output ?? velaDir;

    const result = withProjectDb((db) => {
      ensureRequirementsSchema(db);
      return renderRequirementsToFile(db, outputDir);
    });
    console.log(JSON.stringify(result));
    process.exit(0);
  });

// ── Auto-mode commands ─────────────────────────────────────────────

const autoCmd = program
  .command('auto')
  .description('Auto-mode: continuous task execution');

autoCmd
  .command('start')
  .description('Start auto-mode for a milestone/slice')
  .requiredOption('--milestone <id>', 'Milestone ID')
  .requiredOption('--slice <id>', 'Slice ID')
  .action((opts: { milestone: string; slice: string }) => {
    const projectRoot = findProjectRoot(process.cwd());
    if (!projectRoot) {
      console.log(JSON.stringify({ ok: false, error: 'No Vela project found. Run "vela init" first.' }));
      process.exit(1);
    }
    const velaDir = join(projectRoot, '.vela');
    const result = withProjectDb((db) => startAutoMode(db, velaDir, opts.milestone, opts.slice));
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });

autoCmd
  .command('next')
  .description('Mark current task done and advance to next')
  .action(() => {
    const projectRoot = findProjectRoot(process.cwd());
    if (!projectRoot) {
      console.log(JSON.stringify({ ok: false, error: 'No Vela project found. Run "vela init" first.' }));
      process.exit(1);
    }
    const velaDir = join(projectRoot, '.vela');
    const result = withProjectDb((db) => nextTask(db, velaDir));
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });

autoCmd
  .command('status')
  .description('Show auto-mode status')
  .action(() => {
    const projectRoot = findProjectRoot(process.cwd());
    if (!projectRoot) {
      console.log(JSON.stringify({ ok: false, error: 'No Vela project found. Run "vela init" first.' }));
      process.exit(1);
    }
    const velaDir = join(projectRoot, '.vela');
    const result = withProjectDb((db) => getAutoStatus(db, velaDir));
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });

autoCmd
  .command('pause')
  .description('Pause auto-mode')
  .option('--reason <text>', 'Blocker reason')
  .action((opts: { reason?: string }) => {
    const projectRoot = findProjectRoot(process.cwd());
    if (!projectRoot) {
      console.log(JSON.stringify({ ok: false, error: 'No Vela project found. Run "vela init" first.' }));
      process.exit(1);
    }
    const velaDir = join(projectRoot, '.vela');
    const result = pauseAutoMode(velaDir, opts.reason);
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });

autoCmd
  .command('resume')
  .description('Resume paused auto-mode')
  .action(() => {
    const projectRoot = findProjectRoot(process.cwd());
    if (!projectRoot) {
      console.log(JSON.stringify({ ok: false, error: 'No Vela project found. Run "vela init" first.' }));
      process.exit(1);
    }
    const velaDir = join(projectRoot, '.vela');
    const result = resumeAutoMode(velaDir);
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });

autoCmd
  .command('cancel')
  .description('Cancel auto-mode')
  .action(() => {
    const projectRoot = findProjectRoot(process.cwd());
    if (!projectRoot) {
      console.log(JSON.stringify({ ok: false, error: 'No Vela project found. Run "vela init" first.' }));
      process.exit(1);
    }
    const velaDir = join(projectRoot, '.vela');
    const result = cancelAutoMode(velaDir);
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });

// ── Git commands ───────────────────────────────────────────────────

const gitCmd = program
  .command('git')
  .description('Git operations');

gitCmd
  .command('branch')
  .description('Create or reuse a branch for the active pipeline')
  .action(() => {
    const result = withProjectDb((db) => createBranch(db, process.cwd()));
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });

gitCmd
  .command('commit')
  .description('Stage and commit changes for the active pipeline')
  .action(() => {
    const result = withProjectDb((db) => commitChanges(db, process.cwd()));
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });

gitCmd
  .command('merge')
  .description('Squash-merge the pipeline branch back to base')
  .action(() => {
    const result = withProjectDb((db) => squashMerge(db, process.cwd()));
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });

// ── Agent commands ─────────────────────────────────────────────────

const agentsCmd = program
  .command('agents')
  .description('Manage agent prompts and strategies');

agentsCmd
  .command('list')
  .description('List all bundled agent roles')
  .action(() => {
    const roles = listAgentRoles();
    console.log(JSON.stringify({ ok: true, roles }));
    process.exit(0);
  });

agentsCmd
  .command('show')
  .description('Show the prompt for an agent role')
  .argument('<role>', 'Agent role name (e.g. researcher, planner)')
  .action((role: string) => {
    const projectRoot = findProjectRoot(process.cwd());
    const result = getAgentPrompt(role, projectRoot ?? undefined);
    if (result) {
      console.log(JSON.stringify({ ok: true, role, content: result.content, source: result.source }));
    } else {
      console.log(JSON.stringify({ ok: false, error: `Unknown agent role: ${role}` }));
    }
    process.exit(result ? 0 : 1);
  });

agentsCmd
  .command('strategy')
  .description('Show the agent strategy for a pipeline scale')
  .requiredOption('--scale <size>', 'Pipeline scale (small, medium, large)')
  .action((opts: { scale: string }) => {
    const validScales = new Set(['small', 'medium', 'large']);
    if (!validScales.has(opts.scale)) {
      console.log(JSON.stringify({ ok: false, error: `Invalid scale "${opts.scale}". Must be one of: small, medium, large` }));
      process.exit(1);
    }
    const strategy = getAgentStrategy(opts.scale as Scale);
    console.log(JSON.stringify({ ok: true, ...strategy }));
    process.exit(0);
  });

// ── Discuss commands ───────────────────────────────────────────────

const discussCmd = program
  .command('discuss')
  .description('Conversational project planning sessions');

discussCmd
  .command('start')
  .description('Start a new discuss session')
  .action(() => {
    const projectRoot = findProjectRoot(process.cwd());
    if (!projectRoot) {
      console.log(JSON.stringify({ ok: false, error: 'No Vela project found. Run "vela init" first.' }));
      process.exit(1);
    }
    const velaDir = join(projectRoot, '.vela');
    const result = createSession(velaDir);
    if (!result.ok) {
      console.log(JSON.stringify(result));
      process.exit(1);
    }
    const prompt = getStagePrompt(result.session.stage);
    console.log(JSON.stringify({ ok: true, session: result.session, prompt: prompt.ok ? prompt.prompt : null }));
    process.exit(0);
  });

discussCmd
  .command('status')
  .description('Show current discuss session state')
  .option('--session <id>', 'Session ID (defaults to most recent)')
  .action((opts: { session?: string }) => {
    const projectRoot = findProjectRoot(process.cwd());
    if (!projectRoot) {
      console.log(JSON.stringify({ ok: false, error: 'No Vela project found. Run "vela init" first.' }));
      process.exit(1);
    }
    const velaDir = join(projectRoot, '.vela');
    const result = getSessionStatus(velaDir, opts.session);
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });

discussCmd
  .command('advance')
  .description('Advance the discuss session to the next stage')
  .requiredOption('--data <text>', 'Data for the current stage')
  .option('--session <id>', 'Session ID (defaults to most recent)')
  .action((opts: { data: string; session?: string }) => {
    const projectRoot = findProjectRoot(process.cwd());
    if (!projectRoot) {
      console.log(JSON.stringify({ ok: false, error: 'No Vela project found. Run "vela init" first.' }));
      process.exit(1);
    }
    const velaDir = join(projectRoot, '.vela');
    // Resolve session ID — use provided or find latest
    let sessionId = opts.session;
    if (!sessionId) {
      const statusResult = getSessionStatus(velaDir);
      if (!statusResult.ok) {
        console.log(JSON.stringify(statusResult));
        process.exit(1);
      }
      sessionId = statusResult.session.id;
    }
    const result = advanceStage(velaDir, sessionId, opts.data);
    if (!result.ok) {
      console.log(JSON.stringify(result));
      process.exit(1);
    }
    const prompt = getStagePrompt(result.session.stage);
    console.log(JSON.stringify({ ok: true, session: result.session, prompt: prompt.ok ? prompt.prompt : null }));
    process.exit(0);
  });

discussCmd
  .command('render')
  .description('Render context document from a completed session')
  .option('--session <id>', 'Session ID (defaults to most recent)')
  .option('--output <path>', 'Output file path')
  .action((opts: { session?: string; output?: string }) => {
    const projectRoot = findProjectRoot(process.cwd());
    if (!projectRoot) {
      console.log(JSON.stringify({ ok: false, error: 'No Vela project found. Run "vela init" first.' }));
      process.exit(1);
    }
    const velaDir = join(projectRoot, '.vela');
    // Resolve session ID
    let sessionId = opts.session;
    if (!sessionId) {
      const statusResult = getSessionStatus(velaDir);
      if (!statusResult.ok) {
        console.log(JSON.stringify(statusResult));
        process.exit(1);
      }
      sessionId = statusResult.session.id;
    }
    const result = renderContext(velaDir, sessionId, opts.output);
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });

// ── TUI command ────────────────────────────────────────────────────

program
  .command('tui')
  .description('Launch TUI dashboard')
  .action(async () => {
    const nodeMajor = parseInt(process.versions.node, 10);
    if (nodeMajor < 20) {
      process.stderr.write(
        `Error: 'vela tui' requires Node.js 20 or later (current: ${process.versions.node}).\n` +
        `The TUI dashboard uses ink v6 + React 19 which need Node 20+.\n` +
        `All other vela commands work on Node 18+.\n`
      );
      process.exit(1);
    }
    const { runTui } = await import('./tui/App.js');
    runTui();
  });

program.parse();
