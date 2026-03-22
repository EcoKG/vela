#!/bin/bash
# ⛵ Vela Engine — One-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/EcoKG/vela/main/install.sh | bash

set -e

REPO="https://github.com/EcoKG/vela.git"
TMP="/tmp/vela-install-$$"
SKILL_DIR="$HOME/.claude/skills/vela"

echo "⛵ Vela Engine — Installing..."

# Clone
git clone --depth 1 "$REPO" "$TMP" 2>/dev/null

# Create skill directory
mkdir -p "$SKILL_DIR"

# Copy skill files
cp "$TMP/SKILL.md" "$SKILL_DIR/"
cp -r "$TMP/scripts" "$SKILL_DIR/"
cp -r "$TMP/templates" "$SKILL_DIR/"

# Cleanup
rm -rf "$TMP"

echo ""
echo "✦ Vela Engine installed successfully! ✦"
echo ""
echo "⛵ Global skill registered at: $SKILL_DIR"
echo ""
echo "🧭 Next steps:"
echo "   1. Open any project with Claude Code"
echo "   2. Type: /vela"
echo "   3. Or say: 이 프로젝트에 Vela 환경을 구축해줘"
echo ""
echo "✦─────────────────────✦"
