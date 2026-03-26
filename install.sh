#!/bin/bash
# ⛵ Vela Engine — One-line installer (Plugin format)
# Usage: curl -fsSL https://raw.githubusercontent.com/EcoKG/vela/main/install.sh | bash

REPO="https://github.com/EcoKG/vela.git"
TMP="$HOME/.vela-install-tmp"
PLUGIN_DIR="$HOME/.claude/skills/vela"
COMMANDS_DIR="$HOME/.claude/commands/vela"
SETTINGS="$HOME/.claude/settings.json"

echo "⛵ Vela Engine v4 — Installing as plugin..."

# Clean previous attempts
rm -rf "$TMP" 2>/dev/null

# Clone
git clone --depth 1 "$REPO" "$TMP" 2>/dev/null || { echo "❌ git clone failed"; exit 1; }

# Create plugin directory
mkdir -p "$PLUGIN_DIR"

# Copy plugin structure
cp -r "$TMP/scripts" "$PLUGIN_DIR/"
cp -r "$TMP/templates" "$PLUGIN_DIR/"
cp -r "$TMP/references" "$PLUGIN_DIR/" 2>/dev/null
cp "$TMP/README.md" "$PLUGIN_DIR/" 2>/dev/null

# Keep SKILL.md as fallback
cp "$TMP/SKILL.md" "$PLUGIN_DIR/" 2>/dev/null

# ─── Install slash commands ───
mkdir -p "$COMMANDS_DIR"
cp "$TMP/commands/"*.md "$COMMANDS_DIR/"
echo "🧭 Slash commands installed: $COMMANDS_DIR"

# Cleanup
rm -rf "$TMP" 2>/dev/null

echo ""
echo "✦ Vela Engine v4 installed successfully! ✦"
echo ""
echo "⛵ Plugin: $PLUGIN_DIR"
echo "🧭 Commands: $COMMANDS_DIR"
echo ""
echo "🧭 Commands:"
echo "   /vela:init     — 프로젝트에 Vela 환경 구축"
echo "   /vela:start    — 파이프라인 시작"
echo "   /vela:discuss  — 요구사항 확정"
echo "   /vela:plan     — research + plan 생성"
echo "   /vela:execute  — Wave 실행 + git commit"
echo "   /vela:verify   — 검증"
echo "   /vela:ship     — PR 생성"
echo "   /vela:next     — 다음 단계 자동 감지"
echo "   /vela:status   — 현재 상태"
echo "   /vela:pause    — 작업 중단"
echo "   /vela:resume   — 작업 재개"
echo "   /vela:quick    — 빠른 실행"
echo ""
echo "✦─────────────────────✦"
