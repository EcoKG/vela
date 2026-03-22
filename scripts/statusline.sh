#!/bin/bash
# ⛵ Vela Status Line — shows pipeline state in Claude Code's bottom bar
# Receives JSON session data via stdin from Claude Code

input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name // "unknown"' 2>/dev/null)
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' 2>/dev/null | cut -d. -f1)
CWD=$(echo "$input" | jq -r '.workspace.current_dir // "."' 2>/dev/null)

# Find .vela directory
VELA_DIR=""
if [ -d "$CWD/.vela" ]; then
  VELA_DIR="$CWD/.vela"
elif [ -d ".vela" ]; then
  VELA_DIR=".vela"
fi

# No Vela installed — show nothing
if [ -z "$VELA_DIR" ]; then
  echo "$MODEL | ${PCT}% ctx"
  exit 0
fi

# Find active pipeline
PIPELINE_STATE="none"
CURRENT_STEP=""
PIPELINE_TYPE=""
REQUEST=""

if [ -d "$VELA_DIR/artifacts" ]; then
  # Find most recent pipeline-state.json
  STATE_FILE=$(find "$VELA_DIR/artifacts" -name "pipeline-state.json" -type f 2>/dev/null | \
    xargs ls -t 2>/dev/null | head -1)

  if [ -n "$STATE_FILE" ]; then
    STATUS=$(jq -r '.status // "unknown"' "$STATE_FILE" 2>/dev/null)
    if [ "$STATUS" = "active" ]; then
      PIPELINE_STATE="active"
      CURRENT_STEP=$(jq -r '.current_step // "?"' "$STATE_FILE" 2>/dev/null)
      PIPELINE_TYPE=$(jq -r '.pipeline_type // "?"' "$STATE_FILE" 2>/dev/null)
      REQUEST=$(jq -r '.request // ""' "$STATE_FILE" 2>/dev/null | cut -c1-30)
    fi
  fi
fi

# Build status line
if [ "$PIPELINE_STATE" = "active" ]; then
  echo -e "⛵ Vela ✦ \033[32m${PIPELINE_TYPE}\033[0m 🧭 ${CURRENT_STEP} │ ${REQUEST}… │ $MODEL ${PCT}%"
else
  echo -e "⛵ Vela ✦ Explore │ $MODEL ${PCT}%"
fi
