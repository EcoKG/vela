#!/bin/bash
# ⛵ Vela Engine — One-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/EcoKG/vela/main/install.sh | bash

REPO="https://github.com/EcoKG/vela.git"
TMP="$HOME/.vela-install-tmp"
SKILL_DIR="$HOME/.claude/skills/vela"
SETTINGS="$HOME/.claude/settings.json"

echo "⛵ Vela Engine — Installing..."

# Clean previous attempts
rm -rf "$TMP" 2>/dev/null

# Clone to home directory (avoids /tmp permission issues)
git clone --depth 1 "$REPO" "$TMP" 2>/dev/null || { echo "❌ git clone failed"; exit 1; }

# Create skill directory
mkdir -p "$SKILL_DIR"

# Copy skill files
cp "$TMP/SKILL.md" "$SKILL_DIR/"
cp -r "$TMP/scripts" "$SKILL_DIR/"
cp -r "$TMP/templates" "$SKILL_DIR/"

# Cleanup
rm -rf "$TMP" 2>/dev/null

# Enable Agent Teams in global settings
if command -v node &>/dev/null; then
  mkdir -p "$HOME/.claude"
  node -e "
    const fs = require('fs');
    const p = '$SETTINGS';
    let d = {};
    try { d = JSON.parse(fs.readFileSync(p, 'utf-8')); } catch(e) {}
    if (!d.env) d.env = {};
    d.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';
    fs.writeFileSync(p, JSON.stringify(d, null, 2));
    console.log('🌟 Agent Teams enabled');
  " 2>/dev/null || echo "⚠ Add manually: CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1"
fi

echo ""
echo "✦ Vela Engine installed successfully! ✦"
echo ""
echo "⛵ Global skill: $SKILL_DIR"
echo ""
echo "🧭 Next steps:"
echo "   1. Open any project with Claude Code"
echo "   2. Type: /vela"
echo "   3. Or say: 이 프로젝트에 Vela 환경을 구축해줘"
echo ""
echo "✦─────────────────────✦"
