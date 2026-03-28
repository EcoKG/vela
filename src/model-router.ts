/**
 * Model router — complexity-based automatic model selection for Vela.
 *
 * Classifies message complexity (simple / moderate / complex) and selects
 * the optimal model tier. Budget pressure can force downgrades:
 *   - blocked or ≥95% spent → force haiku
 *   - warning zone (≥80%) → cap at sonnet (never upgrade to opus)
 *
 * Auto-routing is opt-in. User's explicit /model choice is respected
 * unless budget enforcement forces a downgrade.
 */

import type { BudgetStatus } from './budget-manager.js';
import { MODEL_TIERS } from './models.js';

// ── Constants ─────────────────────────────────────────────────

/** Message length below which it's considered short (simple candidate). */
const SHORT_MESSAGE_THRESHOLD = 100;

/** Message length above which it's considered long (complex candidate). */
const LONG_MESSAGE_THRESHOLD = 500;

/** Fraction of keywords in total words above which complexity increases. */
const KEYWORD_DENSITY_THRESHOLD = 0.15;

/** Budget percentage at or above which we force haiku regardless. */
const BUDGET_DOWNGRADE_THRESHOLD = 0.95;

/** Technical keywords that signal code-related or complex queries. */
const TECHNICAL_KEYWORDS: readonly string[] = [
  'function', 'class', 'async', 'await', 'promise',
  'error', 'debug', 'refactor', 'implement', 'algorithm',
  'database', 'api', 'typescript', 'javascript',
  'import', 'export', 'interface', 'type', 'const',
  'component', 'render', 'hook', 'state', 'effect',
  'query', 'mutation', 'schema', 'migration',
  'test', 'mock', 'stub', 'assert',
  'deploy', 'docker', 'kubernetes', 'ci', 'pipeline',
  'performance', 'optimize', 'cache', 'index',
  'authentication', 'authorization', 'middleware',
  'endpoint', 'route', 'controller', 'service',
  'repository', 'module', 'package', 'dependency',
];

/** Pre-compiled set for O(1) keyword lookup. */
const KEYWORD_SET = new Set(TECHNICAL_KEYWORDS.map(k => k.toLowerCase()));

// ── Complexity ────────────────────────────────────────────────

export type Complexity = 'simple' | 'moderate' | 'complex';

/**
 * Classify message complexity based on length, code block presence,
 * and technical keyword density.
 *
 * Rules:
 *  - Short + no code blocks + low keyword density → simple
 *  - Long OR code blocks OR high keyword density → complex
 *  - Everything else → moderate
 */
export function classifyComplexity(message: string): Complexity {
  const trimmed = message.trim();

  // Empty or whitespace-only → simple
  if (trimmed.length === 0) return 'simple';

  const hasCodeBlocks = /```[\s\S]*?```/.test(trimmed) || /```/.test(trimmed);
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  // Compute keyword density
  let keywordHits = 0;
  for (const word of words) {
    // Strip punctuation for matching
    const clean = word.toLowerCase().replace(/[^a-z]/g, '');
    if (KEYWORD_SET.has(clean)) keywordHits++;
  }
  const keywordDensity = wordCount > 0 ? keywordHits / wordCount : 0;

  const isShort = trimmed.length < SHORT_MESSAGE_THRESHOLD;
  const isLong = trimmed.length > LONG_MESSAGE_THRESHOLD;
  const highKeywordDensity = keywordDensity >= KEYWORD_DENSITY_THRESHOLD;

  // Complex: any strong signal
  if (isLong || hasCodeBlocks || highKeywordDensity) return 'complex';

  // Simple: short with no strong signals
  if (isShort) return 'simple';

  // Middle ground
  return 'moderate';
}

// ── Model selection ───────────────────────────────────────────

export interface ModelSelection {
  /** The selected model ID. */
  model: string;
  /** Human-readable reason for the selection. */
  reason: string;
}

/**
 * Select the optimal model for a message considering complexity,
 * budget pressure, and user preference.
 *
 * Priority order:
 *  1. Budget blocked → force haiku
 *  2. Budget ≥95% (near-blocked) → force haiku
 *  3. Budget warning → cap at sonnet (never opus)
 *  4. User explicit choice → respect it (with budget overrides above)
 *  5. Auto-route by classified complexity
 *
 * Budget pressure only applies when `budgetStatus.limit !== null`.
 */
export function selectModel(
  message: string,
  budgetStatus: BudgetStatus,
  userModel: string,
  isExplicitChoice: boolean,
): ModelSelection {
  const hasBudget = budgetStatus.limit !== null;

  // (1) Budget blocked → force haiku
  if (hasBudget && budgetStatus.blocked) {
    return {
      model: MODEL_TIERS.simple,
      reason: 'Budget exhausted — forced haiku',
    };
  }

  // (2) Near-blocked (≥95%) → force haiku
  if (hasBudget && budgetStatus.percentage >= BUDGET_DOWNGRADE_THRESHOLD) {
    return {
      model: MODEL_TIERS.simple,
      reason: `Budget at ${Math.round(budgetStatus.percentage * 100)}% — forced haiku`,
    };
  }

  // (3) Budget warning → cap at sonnet
  if (hasBudget && budgetStatus.warning) {
    if (isExplicitChoice) {
      // User chose explicitly — cap at sonnet
      const capped = capAtSonnet(userModel);
      if (capped !== userModel) {
        return {
          model: capped,
          reason: `Budget warning — capped to sonnet (was ${userModel})`,
        };
      }
      return { model: userModel, reason: 'User choice (within budget cap)' };
    }

    // Auto-route but cap at sonnet
    const complexity = classifyComplexity(message);
    const tier = complexity === 'complex' ? 'moderate' : complexity;
    return {
      model: MODEL_TIERS[tier],
      reason: `Auto-routed as ${complexity}, capped to sonnet (budget warning)`,
    };
  }

  // (4) User explicit choice → respect it
  if (isExplicitChoice) {
    return { model: userModel, reason: 'User choice' };
  }

  // (5) Auto-route by complexity
  const complexity = classifyComplexity(message);
  return {
    model: MODEL_TIERS[complexity],
    reason: `Auto-routed: ${complexity}`,
  };
}

// ── Helpers ───────────────────────────────────────────────────

/** Cap a model to sonnet tier — if it's opus, downgrade to sonnet. */
function capAtSonnet(model: string): string {
  if (model === MODEL_TIERS.complex) {
    return MODEL_TIERS.moderate;
  }
  return model;
}
