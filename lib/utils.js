/**
 * ⛵ Vela CLI — Shared Utilities
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { err, highlight, reset } = require('./banner');

function velaDir(projectDir) {
  return path.join(projectDir, '.vela');
}

function isVelaProject(projectDir) {
  return fs.existsSync(path.join(velaDir(projectDir), 'config.json'));
}

function requireVela(projectDir) {
  if (!isVelaProject(projectDir)) {
    console.error(`\n${err('Not a Vela project.')}`);
    console.error(`  Run ${highlight('vela init')} first.\n`);
    process.exit(1);
  }
}

function runEngine(projectDir, cmd) {
  const enginePath = path.join(velaDir(projectDir), 'cli', 'vela-engine.js');
  if (!fs.existsSync(enginePath)) {
    console.error(`\n${err('Engine not found.')}`);
    console.error(`  Run ${highlight('vela init')} first.\n`);
    process.exit(1);
  }
  try {
    const result = execSync(`node "${enginePath}" ${cmd}`, {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return JSON.parse(result.trim());
  } catch (e) {
    const stdout = e.stdout ? e.stdout.toString() : '';
    try { return JSON.parse(stdout.trim()); } catch (_) {}
    return { ok: false, error: e.stderr ? e.stderr.toString().trim() : e.message };
  }
}

function findActivePipeline(projectDir) {
  const artifactsDir = path.join(velaDir(projectDir), 'artifacts');
  if (!fs.existsSync(artifactsDir)) return null;

  try {
    const allDirs = fs.readdirSync(artifactsDir).sort().reverse();

    // Flat: {date}_{id}_{slug}/
    for (const dir of allDirs.filter(d => /^\d{4}-\d{2}-\d{2}_/.test(d))) {
      const dirPath = path.join(artifactsDir, dir);
      try { if (!fs.statSync(dirPath).isDirectory()) continue; } catch { continue; }
      const statePath = path.join(dirPath, 'pipeline-state.json');
      if (!fs.existsSync(statePath)) continue;
      try {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        if (state.status === 'completed' || state.status === 'cancelled') continue;
        state._dir = dir;
        state._path = statePath;
        return state;
      } catch { continue; }
    }

    // Backward compat: {date}/{slug}/
    for (const dd of allDirs.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
      const dp = path.join(artifactsDir, dd);
      let slugs;
      try { slugs = fs.readdirSync(dp).filter(d => fs.statSync(path.join(dp, d)).isDirectory()); } catch { continue; }
      for (const s of slugs) {
        const sp = path.join(dp, s, 'pipeline-state.json');
        if (!fs.existsSync(sp)) continue;
        try {
          const state = JSON.parse(fs.readFileSync(sp, 'utf-8'));
          if (state.status === 'completed' || state.status === 'cancelled') continue;
          state._dir = `${dd}/${s}`;
          state._path = sp;
          return state;
        } catch { continue; }
      }
    }
  } catch { }
  return null;
}

module.exports = { velaDir, isVelaProject, requireVela, runEngine, findActivePipeline };
