#!/bin/bash
# ⛵ Vela Engine — Update script
# Updates global skill and optionally the current project's .vela/
#
# Global only:   curl -fsSL https://raw.githubusercontent.com/EcoKG/vela/main/update.sh | bash
# Global + local: curl -fsSL https://raw.githubusercontent.com/EcoKG/vela/main/update.sh | bash -s -- --local

set -e

REPO="https://github.com/EcoKG/vela.git"
TMP="$HOME/.vela-update-tmp"
SKILL_DIR="$HOME/.claude/skills/vela"
COMMANDS_DIR="$HOME/.claude/commands/vela"
LOCAL_FLAG="$1"

echo "⛵ Vela Engine v4 — Updating..."

rm -rf "$TMP" 2>/dev/null
git clone --depth 1 "$REPO" "$TMP" 2>/dev/null || { echo "❌ git clone failed"; exit 1; }

# ─── Global skill update ───
mkdir -p "$SKILL_DIR"
cp "$TMP/SKILL.md" "$SKILL_DIR/"
cp -r "$TMP/scripts" "$SKILL_DIR/"
cp -r "$TMP/templates" "$SKILL_DIR/"
cp -r "$TMP/references" "$SKILL_DIR/" 2>/dev/null
cp "$TMP/README.md" "$SKILL_DIR/" 2>/dev/null
echo "✦ Global skill updated: $SKILL_DIR"

# ─── Slash commands update ───
mkdir -p "$COMMANDS_DIR"
cp "$TMP/commands/"*.md "$COMMANDS_DIR/"
echo "🧭 Slash commands updated: $COMMANDS_DIR"

# ─── Local project update (--local) ───
if [ "$LOCAL_FLAG" = "--local" ]; then
  if [ -d ".vela" ]; then
    # Hooks
    cp "$TMP/scripts/hooks/"*.js .vela/hooks/
    cp "$TMP/scripts/hooks/shared/"*.js .vela/hooks/shared/
    # CLI
    cp "$TMP/scripts/cli/"*.js .vela/cli/
    # Cache
    cp "$TMP/scripts/cache/"*.js .vela/cache/
    # Install script + statusline
    cp "$TMP/scripts/install.js" .vela/
    cp "$TMP/scripts/statusline.sh" .vela/
    # Flat agent MD files
    cp "$TMP/scripts/agents/"*.md .vela/agents/
    # Agent tree structure (v4: removed reviewer, conflict-manager; added synthesizer)
    for role in pm researcher executor planner synthesizer debugger; do
      mkdir -p ".vela/agents/$role"
      cp "$TMP/scripts/agents/$role/"*.md ".vela/agents/$role/" 2>/dev/null || true
    done
    # Templates
    cp "$TMP/templates/"*.json .vela/templates/
    # References
    mkdir -p .vela/references
    cp "$TMP/references/"*.md .vela/references/ 2>/dev/null || true
    # Guidelines
    mkdir -p .vela/guidelines
    cp "$TMP/scripts/guidelines/"*.md .vela/guidelines/ 2>/dev/null || true
    # Update .claude/agents/vela.md
    if [ -d ".claude/agents" ]; then
      cp "$TMP/scripts/agents/vela.md" .claude/agents/
    fi
    # Re-run install to update settings
    node .vela/install.js 2>/dev/null | tail -1
    echo "🧭 Local project updated: $(pwd)/.vela/"
  else
    echo "⚠ No .vela/ found in current directory. Use /vela:init first."
  fi
fi

rm -rf "$TMP" 2>/dev/null

echo ""
echo "✦ Update complete! ✦"
echo ""
