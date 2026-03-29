export { getVersion } from './version.js';
export { getDb, closeDb } from './db.js';
export { initProject } from './init.js';
export { findProjectRoot, readConfig, getDefaultConfig } from './config.js';
export type { VelaConfig } from './config.js';
export {
  openStateDb,
  ensureSchema,
  createPipeline,
  getPipeline,
  updatePipeline,
  listPipelines,
  createMilestone,
  getMilestone,
  updateMilestone,
  listMilestones,
  createSlice,
  getSlice,
  updateSlice,
  listSlices,
  createTask,
  getTask,
  updateTask,
  listTasks,
} from './state.js';
export type {
  PipelineData,
  Pipeline,
  PipelineUpdate,
  MilestoneData,
  Milestone,
  MilestoneUpdate,
  SliceData,
  Slice,
  SliceUpdate,
  TaskData,
  Task,
  TaskUpdate,
} from './state.js';
export {
  initPipeline,
  getPipelineState,
  transitionPipeline,
  cancelPipeline,
  getStepsForType,
  scaleToType,
  generatePipelineId,
} from './pipeline.js';
export type {
  PipelineType,
  Scale,
  StepMode,
  StepDef,
  PipelineResult,
} from './pipeline.js';

// ── Hierarchy orchestration ────────────────────────────────────────
export {
  completeTask,
  completeSlice,
  completeMilestone,
} from './hierarchy.js';
export type {
  CompleteTaskResult,
  CompleteSliceResult,
  CompleteMilestoneResult,
} from './hierarchy.js';

// ── Markdown artifact renderers ────────────────────────────────────
export {
  renderRoadmap,
  renderSlicePlan,
  renderTaskSummary,
  renderSliceSummary,
} from './artifacts.js';
export type { BoundaryEntry } from './artifacts.js';

// ── Boundary map ───────────────────────────────────────────────────
export {
  ensureBoundarySchema,
  setBoundary,
  getBoundary,
  listBoundaries,
  renderBoundaryMap,
} from './boundary.js';
export type { BoundaryData } from './boundary.js';

// ── Continue-here protocol ─────────────────────────────────────────
export {
  saveContinuePoint,
  loadContinuePoint,
  clearContinuePoint,
} from './continue.js';
export type {
  ContinuePoint,
  ContinueResult,
} from './continue.js';

// ── Git operations ─────────────────────────────────────────────────
export {
  gitExec,
  snapshotGitState,
  createBranch,
  commitChanges,
  squashMerge,
} from './git.js';
export type {
  GitState,
  GitResult,
} from './git.js';

// ── Agent prompts & strategy ───────────────────────────────────────
export {
  listAgentRoles,
  getAgentPrompt,
  getAgentStrategy,
  getBundledAgentsDir,
} from './agents.js';
export type {
  AgentRole,
  AgentStrategy,
  AgentPromptResult,
} from './agents.js';

// ── Discuss session ────────────────────────────────────────────────
export {
  createSession,
  advanceStage,
  getStagePrompt,
  getSessionStatus,
  renderContext,
} from './discuss.js';
export type {
  DiscussStage,
  DiscussSession,
  StagePrompt,
} from './discuss.js';

// ── Cost intelligence ──────────────────────────────────────────────
export {
  findArtifactDir,
  parseTraceEntries,
  getCostReport,
} from './cost.js';
export type {
  CostReport,
  CostResult,
  CostMetrics,
  PipelineInfo,
  StepBreakdown,
  TraceEntry,
} from './cost.js';

// ── Auth ───────────────────────────────────────────────────────────
export {
  resolveApiKey,
  saveApiKey,
  getAuthFilePath,
  addProfile,
  listProfiles,
  useProfile,
  removeProfile,
  getActiveProfile,
  maskApiKey,
} from './auth.js';
export type { AuthProfile, AuthFileV2 } from './auth.js';

// ── Claude client ──────────────────────────────────────────────────
export {
  sendMessage,
  extractToolUseBlocks,
  isToolUseResponse,
} from './claude-client.js';
export type {
  ChatMessage,
  SendMessageOptions,
} from './claude-client.js';

// ── Tool engine ────────────────────────────────────────────────────
export {
  runToolLoop,
  executeTool,
  TOOL_DEFINITIONS,
} from './tool-engine.js';
export type { ToolResult } from './tool-engine.js';

// ── TUI components ─────────────────────────────────────────────────
export { ChatApp } from './tui/ChatApp.js';
export type { ChatAppProps } from './tui/ChatApp.js';

// ── Governance ─────────────────────────────────────────────────────
export { checkGate, buildGateContext } from './governance/index.js';
export type { GateContext, GateResult } from './governance/index.js';

// ── Model aliases ──────────────────────────────────────────────────
export { resolveModelAlias, DEFAULT_MODEL, MODEL_ALIASES, KNOWN_MODELS } from './models.js';
