#!/bin/bash
# ⛵ Vela Engine — One-line installer (Plugin format)
# Usage: curl -fsSL https://raw.githubusercontent.com/EcoKG/vela/main/install.sh | bash

REPO="https://github.com/EcoKG/vela.git"
TMP="$HOME/.vela-install-tmp"
PLUGIN_DIR="$HOME/.claude/skills/vela"
COMMANDS_DIR="$HOME/.claude/commands/vela"

echo "⛵ Vela Engine v4 — Installing as plugin..."

# Clean previous attempts
rm -rf "$TMP" 2>/dev/null

# Clone
git clone --depth 1 "$REPO" "$TMP" 2>/dev/null || { echo "❌ git clone failed"; exit 1; }

# ─── Global plugin install ───
mkdir -p "$PLUGIN_DIR"

cp "$TMP/SKILL.md" "$PLUGIN_DIR/"
cp -r "$TMP/scripts"    "$PLUGIN_DIR/"
cp -r "$TMP/templates"  "$PLUGIN_DIR/"
cp -r "$TMP/skills"     "$PLUGIN_DIR/"
cp -r "$TMP/bin"        "$PLUGIN_DIR/" 2>/dev/null || true
cp -r "$TMP/lib"        "$PLUGIN_DIR/" 2>/dev/null || true
cp -r "$TMP/references" "$PLUGIN_DIR/" 2>/dev/null || true
cp    "$TMP/README.md"  "$PLUGIN_DIR/" 2>/dev/null || true
cp    "$TMP/package.json" "$PLUGIN_DIR/" 2>/dev/null || true

echo "✦ Plugin installed: $PLUGIN_DIR"

# ─── Slash commands ───
mkdir -p "$COMMANDS_DIR"
cp "$TMP/commands/"*.md "$COMMANDS_DIR/"
echo "🧭 Slash commands installed: $COMMANDS_DIR"

# Cleanup
rm -rf "$TMP" 2>/dev/null

echo ""
echo "✦ Vela Engine v4 installed successfully! ✦"
echo ""
echo "⛵ Plugin:   $PLUGIN_DIR"
echo "🧭 Commands: $COMMANDS_DIR"
echo ""
echo "▶ 다음 단계:"
echo "   1. 프로젝트 디렉토리로 이동"
echo "   2. /vela:init   — Vela 환경 구축"
echo "   3. /vela:start  — 파이프라인 시작"
echo ""
echo "🧭 전체 명령어:"
echo "   /vela:start    /vela:discuss  /vela:plan"
echo "   /vela:execute  /vela:verify   /vela:ship"
echo "   /vela:next     /vela:status   /vela:quick"
echo "   /vela:pause    /vela:resume"
echo ""
echo "✦─────────────────────✦"
