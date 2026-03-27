import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Scale } from './pipeline.js';

// ── Types ──────────────────────────────────────────────────────────

export interface AgentRole {
  name: string;
  description: string;
  hasModular: boolean;
}

export interface AgentStrategy {
  strategy: 'solo' | 'scout' | 'role-separation';
  roles: string[];
  description: string;
}

export interface AgentPromptResult {
  content: string;
  source: 'project' | 'bundled';
}

// ── Internal helpers ───────────────────────────────────────────────

/**
 * Returns the directory where bundled agent prompts live inside the
 * installed npm package. Uses import.meta.url to resolve relative
 * to this module (same pattern as getBundledHooksDir in hook-registration.ts).
 */
export function getBundledAgentsDir(): string {
  const thisDir = path.dirname(new URL(import.meta.url).pathname);
  return path.join(thisDir, 'agents');
}

/**
 * The 6 core agent roles. vela.md is the PM standalone prompt,
 * not a separate role.
 */
const CORE_ROLES = new Set([
  'researcher',
  'planner',
  'executor',
  'debugger',
  'synthesizer',
  'pm',
]);

/**
 * Extracts a description from an agent markdown file.
 * Checks (in order):
 * 1. YAML frontmatter `description:` field
 * 2. First `>` blockquote line
 * 3. First `#` heading line
 * Falls back to empty string.
 */
function extractDescription(content: string): string {
  const lines = content.split('\n');

  // Check for YAML frontmatter
  if (lines[0]?.trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') break;
      const match = lines[i].match(/^description:\s*(.+)/);
      if (match) return match[1].trim();
    }
  }

  // Check for blockquote line
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('> ')) {
      return trimmed.slice(2).trim();
    }
  }

  // Check for heading line
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      return trimmed.slice(2).trim();
    }
  }

  return '';
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Scans the bundled agents directory for core agent roles.
 * A role is identified by:
 * - A top-level `<role>.md` file, OR
 * - A subdirectory `<role>/` containing `index.md`
 *
 * Only returns the 6 core roles (researcher, planner, executor,
 * debugger, synthesizer, pm). vela.md is excluded.
 *
 * If projectRoot is provided, project-local overrides are checked
 * but do not add new roles — they only override existing ones.
 */
export function listAgentRoles(projectRoot?: string): AgentRole[] {
  const bundledDir = getBundledAgentsDir();

  if (!fs.existsSync(bundledDir)) {
    return [];
  }

  const roles: AgentRole[] = [];
  const seen = new Set<string>();

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(bundledDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    let roleName: string;
    let promptPath: string;
    let hasModular = false;

    if (entry.isFile() && entry.name.endsWith('.md')) {
      roleName = entry.name.replace(/\.md$/, '');
      if (!CORE_ROLES.has(roleName)) continue;
      promptPath = path.join(bundledDir, entry.name);

      // Check if a matching subdirectory also exists (modular prompts)
      const subDir = path.join(bundledDir, roleName);
      hasModular = fs.existsSync(subDir) && fs.statSync(subDir).isDirectory();
    } else if (entry.isDirectory()) {
      roleName = entry.name;
      if (!CORE_ROLES.has(roleName)) continue;
      const indexPath = path.join(bundledDir, entry.name, 'index.md');
      if (!fs.existsSync(indexPath)) continue;
      promptPath = indexPath;
      hasModular = true;
    } else {
      continue;
    }

    if (seen.has(roleName)) continue;
    seen.add(roleName);

    // Read description — prefer project-local override if available
    let content: string;
    if (projectRoot) {
      const projectPath = path.join(projectRoot, '.vela', 'agents', `${roleName}.md`);
      if (fs.existsSync(projectPath)) {
        content = fs.readFileSync(projectPath, 'utf-8');
      } else {
        content = fs.readFileSync(promptPath, 'utf-8');
      }
    } else {
      content = fs.readFileSync(promptPath, 'utf-8');
    }

    roles.push({
      name: roleName,
      description: extractDescription(content),
      hasModular,
    });
  }

  return roles.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolves an agent prompt by role name.
 *
 * Resolution order:
 * 1. Project-local `.vela/agents/<role>.md` (if projectRoot provided)
 * 2. Bundled `dist/agents/<role>.md`
 * 3. Bundled `dist/agents/<role>/index.md`
 *
 * Returns the content and source indicator, or null if the role
 * is not found.
 */
export function getAgentPrompt(
  role: string,
  projectRoot?: string,
): AgentPromptResult | null {
  // 1. Project-local override
  if (projectRoot) {
    const projectPath = path.join(projectRoot, '.vela', 'agents', `${role}.md`);
    if (fs.existsSync(projectPath)) {
      return {
        content: fs.readFileSync(projectPath, 'utf-8'),
        source: 'project',
      };
    }
  }

  // 2. Bundled top-level file
  const bundledDir = getBundledAgentsDir();
  const topLevel = path.join(bundledDir, `${role}.md`);
  if (fs.existsSync(topLevel)) {
    return {
      content: fs.readFileSync(topLevel, 'utf-8'),
      source: 'bundled',
    };
  }

  // 3. Bundled subdirectory index
  const indexPath = path.join(bundledDir, role, 'index.md');
  if (fs.existsSync(indexPath)) {
    return {
      content: fs.readFileSync(indexPath, 'utf-8'),
      source: 'bundled',
    };
  }

  return null;
}

/**
 * Maps a pipeline scale to an agent strategy.
 *
 * - small  → solo: single agent handles everything
 * - medium → scout: researcher scouts context before execution
 * - large  → role-separation: full team with specialized roles
 */
export function getAgentStrategy(scale: Scale): AgentStrategy {
  switch (scale) {
    case 'small':
      return {
        strategy: 'solo',
        roles: [],
        description: 'Single agent handles the entire task',
      };
    case 'medium':
      return {
        strategy: 'scout',
        roles: ['researcher'],
        description: 'Researcher scouts context before execution',
      };
    case 'large':
      return {
        strategy: 'role-separation',
        roles: ['researcher', 'planner', 'executor', 'debugger', 'synthesizer'],
        description: 'Full team with specialized roles for complex tasks',
      };
  }
}
