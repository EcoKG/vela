#!/bin/bash
# ⛵ Vela Engine — One-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/EcoKG/vela/main/install.sh | bash

set -e

REPO="https://github.com/EcoKG/vela.git"
TMP="/tmp/vela-install-$$"

# Clean up any previous failed installs
for old in /tmp/vela-install-*; do
  [ -d "$old" ] && chmod -R u+w "$old" 2>/dev/null && rm -rf "$old" 2>/dev/null
done
SKILL_DIR="$HOME/.claude/skills/vela"
SETTINGS="$HOME/.claude/settings.json"

echo "⛵ Vela Engine — Installing..."

# Clone
git clone --depth 1 "$REPO" "$TMP" 2>/dev/null

# Create skill directory
mkdir -p "$SKILL_DIR"

# Copy skill files
cp "$TMP/SKILL.md" "$SKILL_DIR/"
cp -r "$TMP/scripts" "$SKILL_DIR/"
cp -r "$TMP/templates" "$SKILL_DIR/"

# Cleanup (chmod first to handle git's read-only files)
chmod -R u+w "$TMP" 2>/dev/null || true
rm -rf "$TMP"

# Enable Agent Teams in global settings
if command -v node &>/dev/null; then
  node -e "
    const fs = require('fs');
    const p = '$SETTINGS';
    let d = {};
    try { d = JSON.parse(fs.readFileSync(p, 'utf-8')); } catch(e) {}
    if (!d.env) d.env = {};
    d.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';
    fs.mkdirSync(require('path').dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(d, null, 2));
    console.log('🌟 Agent Teams enabled in ~/.claude/settings.json');
  " 2>/dev/null || echo "⚠ Could not enable Agent Teams automatically. Add manually:"
  echo '   "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }'
fi

echo ""
echo "✦ Vela Engine installed successfully! ✦"
echo ""
echo "⛵ Global skill: $SKILL_DIR"
echo "🌟 Agent Teams: enabled"
echo ""
echo "🧭 Next steps:"
echo "   1. Open any project with Claude Code"
echo "   2. Type: /vela"
echo "   3. Or say: 이 프로젝트에 Vela 환경을 구축해줘"
echo ""
echo "✦─────────────────────✦"
